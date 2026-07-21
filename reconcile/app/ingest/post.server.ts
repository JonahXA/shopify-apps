/**
 * Posting pipeline: paid payouts -> engine -> QBO, idempotently.
 * Errors never block other payouts; each failure lands in the fix-it queue
 * (QboPosting.state = "error" with a self-serve hint key).
 */
import prisma from "../db.server";
import { buildPayoutEntry } from "../reconcile/engine";
import { ReconciliationError } from "../reconcile/types";
import type {
  AccountMapping,
  BalanceTxn as EngineTxn,
  NormalizedOrder,
  NormalizedRefund,
} from "../reconcile/types";
import { docNumberFor, toQboJournalEntry } from "../qbo/mapper";
import { QboApiError } from "../qbo/client";
import { qboClientFor } from "../qbo/connection.server";

function mappingFromRow(row: {
  salesAccountId: string;
  shippingAccountId: string;
  feesAccountId: string;
  clearingAccountId: string;
  adjustmentsAccountId: string;
  roundingAccountId: string;
  defaultTaxAccountId: string;
  taxAccountsJson: string;
}): AccountMapping {
  return { ...row, taxAccountByJurisdiction: JSON.parse(row.taxAccountsJson) };
}

const taxLines = (json: string, currency: string) =>
  (JSON.parse(json) as Array<{ title: string; amount: number }>).map((t) => ({
    title: t.title,
    amount: { amount: t.amount, currency },
  }));

export interface PostResult {
  payoutId: string;
  state: "posted" | "error" | "skipped";
  detail?: string;
}

export async function postEligiblePayouts(shop: string): Promise<PostResult[]> {
  const map = await prisma.accountMap.findUnique({ where: { shop } });
  const client = await qboClientFor(shop);
  if (!map?.onboarded || !client) {
    return []; // wizard not finished — dashboard points there
  }
  const mapping = mappingFromRow(map);

  const paid = await prisma.payout.findMany({ where: { shop, status: "paid" } });
  const results: PostResult[] = [];

  for (const payout of paid) {
    const existing = await prisma.qboPosting.findUnique({ where: { payoutId: payout.id } });
    if (existing?.state === "posted") {
      results.push({ payoutId: payout.id, state: "skipped", detail: "already posted" });
      continue;
    }

    try {
      const txnRows = await prisma.balanceTxn.findMany({ where: { shop, payoutId: payout.id } });
      const txns: EngineTxn[] = txnRows.map((t) => ({
        id: t.id,
        type: t.type as EngineTxn["type"],
        sourceId: t.sourceId,
        amount: { amount: t.amount, currency: t.currency },
        fee: { amount: t.fee, currency: t.currency },
        net: { amount: t.net, currency: t.currency },
      }));

      const orderIds = txns.filter((t) => t.type === "charge" && t.sourceId).map((t) => t.sourceId!);
      const refundIds = txns.filter((t) => t.type === "refund" && t.sourceId).map((t) => t.sourceId!);
      const orders = await prisma.shopOrder.findMany({ where: { id: { in: orderIds } } });
      const refunds = await prisma.shopRefund.findMany({ where: { id: { in: refundIds } } });

      const ordersById = new Map<string, NormalizedOrder>(
        orders.map((o) => [
          o.id,
          {
            id: o.id,
            name: o.name,
            subtotal: { amount: o.subtotal, currency: o.currency },
            shipping: { amount: o.shipping, currency: o.currency },
            taxLines: taxLines(o.taxJson, o.currency),
            total: { amount: o.total, currency: o.currency },
          },
        ]),
      );
      const refundsById = new Map<string, NormalizedRefund>(
        refunds.map((r) => [
          r.id,
          {
            id: r.id,
            orderId: r.orderId,
            subtotal: { amount: r.subtotal, currency: r.currency },
            shipping: { amount: r.shipping, currency: r.currency },
            taxLines: taxLines(r.taxJson, r.currency),
            total: { amount: r.total, currency: r.currency },
          },
        ]),
      );

      const plan = buildPayoutEntry({
        payout: {
          id: payout.id,
          date: payout.date.toISOString().slice(0, 10),
          amount: { amount: payout.amount, currency: payout.currency },
          currency: payout.currency,
        },
        txns,
        ordersById,
        refundsById,
        mapping,
      });

      // Idempotent write: check QBO for our DocNumber before creating.
      const doc = docNumberFor(payout.id);
      const entry = toQboJournalEntry(plan);
      const prior = await client.findJournalEntryByDocNumber(doc);
      const posted = prior
        ? await client.updateJournalEntry({ ...entry, Id: prior.Id, SyncToken: prior.SyncToken })
        : await client.createJournalEntry(entry);

      await prisma.qboPosting.upsert({
        where: { payoutId: payout.id },
        create: {
          payoutId: payout.id,
          shop,
          docNumber: doc,
          qboId: posted.Id,
          state: "posted",
          planJson: JSON.stringify(plan),
          attempts: 1,
          postedAt: new Date(),
        },
        update: {
          qboId: posted.Id,
          state: "posted",
          errorCode: null,
          errorHint: null,
          planJson: JSON.stringify(plan),
          attempts: { increment: 1 },
          postedAt: new Date(),
        },
      });
      results.push({ payoutId: payout.id, state: "posted" });
    } catch (e) {
      const [code, hint] =
        e instanceof ReconciliationError
          ? ["reconciliation", e.message]
          : e instanceof QboApiError
            ? [`qbo-${e.status}`, e.body.slice(0, 500)]
            : ["unknown", e instanceof Error ? e.message : String(e)];
      await prisma.qboPosting.upsert({
        where: { payoutId: payout.id },
        create: {
          payoutId: payout.id,
          shop,
          docNumber: docNumberFor(payout.id),
          state: "error",
          errorCode: code,
          errorHint: hint,
          planJson: "{}",
          attempts: 1,
        },
        update: { state: "error", errorCode: code, errorHint: hint, attempts: { increment: 1 } },
      });
      results.push({ payoutId: payout.id, state: "error", detail: `${code}: ${hint}` });
    }
  }
  return results;
}

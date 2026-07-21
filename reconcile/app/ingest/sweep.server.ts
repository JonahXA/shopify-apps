/**
 * Payout + order sweep via the Admin GraphQL API.
 * Payouts have no webhook, so this runs on app-open and via /jobs/sweep.
 * Also heals missed webhooks (webhooks are at-least-once, not guaranteed).
 *
 * NOTE: field names follow the documented ShopifyPaymentsAccount schema;
 * first live run against a dev store (credential-gated) validates them.
 */
import prisma from "../db.server";
import { decimalToCents, mapBalanceTxnType, normalizeOrder } from "./normalize";

type AdminGraphql = (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;

const PAYOUTS_QUERY = `#graphql
  query ReconcilePayouts($payoutCursor: String, $txnCursor: String) {
    shopifyPaymentsAccount {
      payouts(first: 25, after: $payoutCursor) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          id legacyResourceId issuedAt status
          net { amount currencyCode }
        } }
      }
      balanceTransactions(first: 100, after: $txnCursor) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          id type sourceId sourceOrderTransactionId
          amount { amount currencyCode }
          fee { amount currencyCode }
          net { amount currencyCode }
          associatedPayout { id }
          associatedOrder { id }
        } }
      }
    }
  }`;

const ORDERS_QUERY = `#graphql
  query ReconcileOrders($cursor: String, $search: String) {
    orders(first: 100, after: $cursor, query: $search) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id name presentmentCurrencyCode
        subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        taxLines { title priceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }
      } }
    }
  }`;

const gidTail = (gid: string | null | undefined) =>
  gid ? gid.split("/").pop()! : null;

export async function sweepPayouts(graphql: AdminGraphql, shop: string): Promise<{ payouts: number; txns: number }> {
  let payoutCursor: string | null = null;
  let txnCursor: string | null = null;
  let payouts = 0;
  let txns = 0;
  // paginate both connections until exhausted (independent cursors)
  for (let guard = 0; guard < 40; guard++) {
    const res = await graphql(PAYOUTS_QUERY, {
      variables: { payoutCursor, txnCursor },
    });
    const body = (await res.json()) as any;
    const acct = body.data?.shopifyPaymentsAccount;
    if (!acct) break; // shop not on Shopify Payments — surfaced in dashboard

    for (const { node } of acct.payouts.edges) {
      await prisma.payout.upsert({
        where: { id: String(node.legacyResourceId ?? gidTail(node.id)) },
        create: {
          id: String(node.legacyResourceId ?? gidTail(node.id)),
          shop,
          date: new Date(node.issuedAt),
          currency: node.net.currencyCode,
          amount: decimalToCents(node.net.amount),
          status: String(node.status).toLowerCase(),
        },
        update: { status: String(node.status).toLowerCase() },
      });
      payouts++;
    }
    for (const { node } of acct.balanceTransactions.edges) {
      await prisma.balanceTxn.upsert({
        where: { id: gidTail(node.id)! },
        create: {
          id: gidTail(node.id)!,
          shop,
          payoutId: gidTail(node.associatedPayout?.id),
          type: mapBalanceTxnType(node.type),
          sourceId: gidTail(node.associatedOrder?.id) ?? node.sourceId ?? null,
          currency: node.net.currencyCode,
          amount: decimalToCents(node.amount.amount),
          fee: decimalToCents(node.fee.amount),
          net: decimalToCents(node.net.amount),
        },
        update: { payoutId: gidTail(node.associatedPayout?.id) },
      });
      txns++;
    }
    const pMore = acct.payouts.pageInfo.hasNextPage;
    const tMore = acct.balanceTransactions.pageInfo.hasNextPage;
    payoutCursor = pMore ? acct.payouts.pageInfo.endCursor : payoutCursor;
    txnCursor = tMore ? acct.balanceTransactions.pageInfo.endCursor : txnCursor;
    if (!pMore && !tMore) break;
  }
  return { payouts, txns };
}

/** Backfill the last N days of orders (default 60 — v1 scope guard). */
export async function backfillOrders(graphql: AdminGraphql, shop: string, days = 60): Promise<number> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  let cursor: string | null = null;
  let count = 0;
  for (let guard = 0; guard < 100; guard++) {
    const res = await graphql(ORDERS_QUERY, {
      variables: { cursor, search: `created_at:>=${since}` },
    });
    const body = (await res.json()) as any;
    const conn = body.data?.orders;
    if (!conn) break;
    for (const { node } of conn.edges) {
      const row = normalizeOrder({
        id: gidTail(node.id)!,
        name: node.name,
        presentment_currency: node.presentmentCurrencyCode,
        subtotal_price_set: toSet(node.subtotalPriceSet),
        total_shipping_price_set: toSet(node.totalShippingPriceSet),
        total_price_set: toSet(node.totalPriceSet),
        tax_lines: node.taxLines.map((t: any) => ({ title: t.title, price_set: toSet(t.priceSet) })),
      });
      await prisma.shopOrder.upsert({
        where: { id: row.id },
        create: { ...row, shop },
        update: { ...row, shop },
      });
      count++;
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return count;
}

function toSet(s: any) {
  return {
    shop_money: { amount: s.shopMoney.amount, currency_code: s.shopMoney.currencyCode },
    presentment_money: { amount: s.presentmentMoney.amount, currency_code: s.presentmentMoney.currencyCode },
  };
}

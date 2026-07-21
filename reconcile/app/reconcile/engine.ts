/**
 * The reconciliation engine: builds one balanced QBO journal-entry plan per
 * Shopify Payments payout.
 *
 * Design invariants (see docs/reconcile-architecture.md):
 *  I1. debits == credits (entry balances exactly)
 *  I2. the clearing line equals the payout amount to the cent
 *  I3. every settled cent is attributed: sales, shipping, tax (per
 *      jurisdiction), fees, refunds, adjustments — any residue from FX
 *      allocation rounding lands in an explicit rounding line, never dropped
 *  I4. inputs that don't internally reconcile raise ReconciliationError
 *      (visible fix-it queue) rather than posting anything
 */
import type {
  AccountMapping,
  BalanceTxn,
  JournalEntryPlan,
  JournalLine,
  NormalizedOrder,
  NormalizedRefund,
  Payout,
} from "./types";
import { ReconciliationError } from "./types";
import { allocate, assertSupportedCurrency, fmt, sum } from "./money";

interface Ledger {
  /** signed minor units per bucket; positive = credit for income/liability
   * buckets, we normalize to sides at the end */
  sales: number;
  shipping: number;
  tax: Map<string, number>; // jurisdiction title -> signed amount
  fees: number;
  adjustments: number;
}

export interface EngineInput {
  payout: Payout;
  txns: BalanceTxn[];
  ordersById: Map<string, NormalizedOrder>;
  refundsById: Map<string, NormalizedRefund>;
  mapping: AccountMapping;
}

/**
 * Split one settlement-currency amount over an order/refund's presentment
 * components (subtotal, shipping, tax lines) proportionally.
 * Returns [subtotal, shipping, ...taxLineAmounts] in settlement minor units.
 */
function splitSettledAmount(
  settled: number,
  components: { subtotal: number; shipping: number; taxes: number[] },
): number[] {
  return allocate(settled, [
    components.subtotal,
    components.shipping,
    ...components.taxes,
  ]);
}

export function buildPayoutEntry(input: EngineInput): JournalEntryPlan {
  const { payout, txns, ordersById, refundsById, mapping } = input;
  const cur = payout.currency;
  assertSupportedCurrency(cur);

  // I4 pre-check: uniform currency, then payout total == sum of nets.
  for (const t of txns) {
    if (t.amount.currency !== cur || t.fee.currency !== cur || t.net.currency !== cur) {
      throw new ReconciliationError(
        `Transaction ${t.id} currency ${t.amount.currency} != payout currency ${cur}`,
        payout.id,
      );
    }
  }
  const netSum = sum(cur, txns.map((t) => t.net)).amount;
  if (netSum !== payout.amount.amount) {
    throw new ReconciliationError(
      `Payout ${payout.id} amount ${fmt(payout.amount)} != sum of transaction nets ${fmt({ amount: netSum, currency: cur })}`,
      payout.id,
      { expected: payout.amount.amount, actual: netSum },
    );
  }

  const ledger: Ledger = {
    sales: 0,
    shipping: 0,
    tax: new Map(),
    fees: 0,
    adjustments: 0,
  };
  const audit: string[] = [];

  for (const txn of txns) {
    if (txn.amount.currency !== cur || txn.fee.currency !== cur) {
      throw new ReconciliationError(
        `Transaction ${txn.id} currency ${txn.amount.currency} != payout currency ${cur}`,
        payout.id,
      );
    }
    if (txn.net.amount !== txn.amount.amount - txn.fee.amount) {
      throw new ReconciliationError(
        `Transaction ${txn.id} net ${fmt(txn.net)} != amount - fee`,
        payout.id,
      );
    }
    ledger.fees += txn.fee.amount;

    switch (txn.type) {
      case "charge": {
        const order = txn.sourceId ? ordersById.get(txn.sourceId) : undefined;
        if (!order) {
          throw new ReconciliationError(
            `Charge ${txn.id} has no matching order (${txn.sourceId})`,
            payout.id,
          );
        }
        const parts = splitSettledAmount(txn.amount.amount, {
          subtotal: order.subtotal.amount,
          shipping: order.shipping.amount,
          taxes: order.taxLines.map((t) => t.amount.amount),
        });
        ledger.sales += parts[0];
        ledger.shipping += parts[1];
        order.taxLines.forEach((t, i) => {
          ledger.tax.set(t.title, (ledger.tax.get(t.title) ?? 0) + parts[2 + i]);
        });
        audit.push(
          `charge ${txn.id} (${order.name}): settled ${fmt(txn.amount)} -> sales ${parts[0]}, shipping ${parts[1]}, tax [${parts.slice(2).join(",")}], fee ${txn.fee.amount}`,
        );
        break;
      }
      case "refund": {
        const refund = txn.sourceId ? refundsById.get(txn.sourceId) : undefined;
        if (!refund) {
          throw new ReconciliationError(
            `Refund txn ${txn.id} has no matching refund (${txn.sourceId})`,
            payout.id,
          );
        }
        // txn.amount is negative for refunds; allocation keeps the sign.
        const parts = splitSettledAmount(txn.amount.amount, {
          subtotal: refund.subtotal.amount,
          shipping: refund.shipping.amount,
          taxes: refund.taxLines.map((t) => t.amount.amount),
        });
        ledger.sales += parts[0];
        ledger.shipping += parts[1];
        refund.taxLines.forEach((t, i) => {
          ledger.tax.set(t.title, (ledger.tax.get(t.title) ?? 0) + parts[2 + i]);
        });
        audit.push(
          `refund ${txn.id}: settled ${fmt(txn.amount)} -> sales ${parts[0]}, shipping ${parts[1]}, tax [${parts.slice(2).join(",")}], fee ${txn.fee.amount}`,
        );
        break;
      }
      case "dispute":
      case "adjustment":
      case "fee_only": {
        ledger.adjustments += txn.amount.amount;
        audit.push(`${txn.type} ${txn.id}: ${fmt(txn.amount)}, fee ${txn.fee.amount}`);
        break;
      }
    }
  }

  // Build lines. Convention: income/liability buckets carry credit-positive
  // sign in the ledger; the clearing (deposit) line is a debit.
  const lines: JournalLine[] = [];
  const push = (accountId: string, signed: number, memo: string, invert = false) => {
    if (signed === 0) return;
    // income accumulates as positive => credit; negative => debit (contra)
    const v = invert ? -signed : signed;
    lines.push({
      accountId,
      side: v >= 0 ? "credit" : "debit",
      amount: Math.abs(v),
      memo,
    });
  };

  push(mapping.salesAccountId, ledger.sales, "Gross sales (net of refunds)");
  push(mapping.shippingAccountId, ledger.shipping, "Shipping collected");
  for (const [title, amt] of [...ledger.tax.entries()].sort()) {
    const acct = mapping.taxAccountByJurisdiction?.[title] ?? mapping.defaultTaxAccountId;
    push(acct, amt, `Sales tax — ${title}`);
  }
  // fees are an expense: ledger.fees positive => debit
  push(mapping.feesAccountId, ledger.fees, "Gateway fees", true);
  push(mapping.adjustmentsAccountId, ledger.adjustments, "Adjustments/disputes");

  // Clearing line: the actual bank deposit (I2).
  lines.push({
    accountId: mapping.clearingAccountId,
    side: payout.amount.amount >= 0 ? "debit" : "credit",
    amount: Math.abs(payout.amount.amount),
    memo: `Shopify payout ${payout.id}`,
  });

  // I1/I3: residual from allocation rounding goes to an explicit line.
  const debits = lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
  const credits = lines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
  const residual = credits - debits;
  if (residual !== 0) {
    lines.push({
      accountId: mapping.roundingAccountId,
      side: residual > 0 ? "debit" : "credit",
      amount: Math.abs(residual),
      memo: "FX/rounding residual",
    });
    audit.push(`rounding residual ${residual} -> ${mapping.roundingAccountId}`);
  }

  // Final invariant check (I1) — belt and braces.
  const d2 = lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
  const c2 = lines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
  if (d2 !== c2) {
    throw new ReconciliationError(
      `Internal error: entry does not balance (debits ${d2} != credits ${c2})`,
      payout.id,
    );
  }

  return { payoutId: payout.id, date: payout.date, currency: cur, lines, audit };
}

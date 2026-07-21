/**
 * Normalized shapes for the reconciliation engine.
 * All monetary values are integer minor units (cents) in a named currency.
 * Nothing in this module touches Shopify or QBO APIs directly — ingest
 * normalizes into these types; the engine is pure and fully unit-testable.
 */

export interface Money {
  /** integer minor units, e.g. cents. Negative = contra. */
  amount: number;
  currency: string; // ISO 4217
}

/** One tax line on an order, e.g. "CA State Tax" 7.25%. */
export interface TaxLine {
  title: string;
  amount: Money; // presentment currency
}

export interface NormalizedOrder {
  id: string;
  name: string; // e.g. #1001
  /** presentment currency breakdown (what the buyer saw) */
  subtotal: Money;
  shipping: Money;
  taxLines: TaxLine[];
  total: Money; // subtotal + shipping + sum(tax)
}

export interface NormalizedRefund {
  id: string;
  orderId: string;
  subtotal: Money; // positive magnitudes; engine applies sign
  shipping: Money;
  taxLines: TaxLine[];
  total: Money;
}

export type BalanceTxnType =
  | "charge"
  | "refund"
  | "dispute"
  | "adjustment"
  | "fee_only";

/**
 * A Shopify Payments balance transaction, already in SETTLEMENT currency.
 * amount is gross; fee is the gateway fee; net = amount - fee.
 */
export interface BalanceTxn {
  id: string;
  type: BalanceTxnType;
  /** order or refund this settles; null for adjustments */
  sourceId: string | null;
  amount: Money; // settlement currency, signed (refunds negative)
  fee: Money; // settlement currency, >= 0
  net: Money; // amount - fee
}

export interface Payout {
  id: string;
  date: string; // ISO date
  amount: Money; // settlement currency — must equal sum of txn nets
  currency: string;
}

/** Merchant's account mapping from the onboarding wizard. */
export interface AccountMapping {
  salesAccountId: string;
  shippingAccountId: string;
  feesAccountId: string;
  clearingAccountId: string;
  adjustmentsAccountId: string;
  roundingAccountId: string;
  /** default liability account when a jurisdiction has no explicit mapping */
  defaultTaxAccountId: string;
  /** optional per-jurisdiction overrides, keyed by tax line title */
  taxAccountByJurisdiction?: Record<string, string>;
}

export type EntrySide = "debit" | "credit";

export interface JournalLine {
  accountId: string;
  side: EntrySide;
  amount: number; // positive minor units
  memo: string;
}

/** A planned QBO journal entry for one payout. Net of lines is zero. */
export interface JournalEntryPlan {
  payoutId: string;
  date: string;
  currency: string;
  lines: JournalLine[];
  /** human-readable audit of how each line was derived */
  audit: string[];
}

export class ReconciliationError extends Error {
  constructor(
    message: string,
    public readonly payoutId: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

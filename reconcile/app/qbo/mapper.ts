/**
 * JournalEntryPlan (engine, integer cents) -> QBO JournalEntry JSON
 * (decimal dollars). The cents->decimal conversion happens exactly here and
 * nowhere else, via exact integer math (no float division).
 */
import type { JournalEntryPlan } from "../reconcile/types";
import type { QboJournalEntry } from "./client";

export function docNumberFor(payoutId: string): string {
  // QBO DocNumber max length is 21; payout ids are numeric strings
  const dn = `RC-${payoutId}`;
  if (dn.length > 21) throw new Error(`DocNumber too long: ${dn}`);
  return dn;
}

/** exact integer cents -> "1234.05"-style decimal number */
export function centsToDecimal(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Line amounts must be non-negative integer cents, got ${cents}`);
  }
  // Construct via string to avoid float artifacts like 1005/100 = 10.049999
  const s = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  return Number(s);
}

export function toQboJournalEntry(plan: JournalEntryPlan): QboJournalEntry {
  return {
    DocNumber: docNumberFor(plan.payoutId),
    TxnDate: plan.date,
    PrivateNote: `Shopify payout ${plan.payoutId} — posted by Reconcile. ${plan.audit.length} source transactions.`,
    Line: plan.lines.map((l) => ({
      Description: l.memo,
      Amount: centsToDecimal(l.amount),
      DetailType: "JournalEntryLineDetail" as const,
      JournalEntryLineDetail: {
        PostingType: l.side === "debit" ? ("Debit" as const) : ("Credit" as const),
        AccountRef: { value: l.accountId },
      },
    })),
  };
}

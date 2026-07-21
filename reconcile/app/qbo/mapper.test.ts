import { describe, expect, it } from "vitest";
import { centsToDecimal, docNumberFor, toQboJournalEntry } from "./mapper";
import type { JournalEntryPlan } from "../reconcile/types";

describe("centsToDecimal", () => {
  it("converts exactly without float artifacts", () => {
    expect(centsToDecimal(1005)).toBe(10.05);
    expect(centsToDecimal(999999901)).toBe(9999999.01);
    expect(centsToDecimal(1)).toBe(0.01);
    expect(centsToDecimal(0)).toBe(0);
    expect(centsToDecimal(10)).toBe(0.1);
  });
  it("rejects negatives and non-integers", () => {
    expect(() => centsToDecimal(-1)).toThrow();
    expect(() => centsToDecimal(10.5)).toThrow();
  });
});

describe("docNumberFor", () => {
  it("prefixes and bounds length", () => {
    expect(docNumberFor("123456789")).toBe("RC-123456789");
    expect(() => docNumberFor("x".repeat(30))).toThrow(/too long/);
  });
});

describe("toQboJournalEntry", () => {
  const plan: JournalEntryPlan = {
    payoutId: "98765",
    date: "2026-07-20",
    currency: "USD",
    audit: ["charge t1 ..."],
    lines: [
      { accountId: "42", side: "credit", amount: 700000, memo: "Gross sales (net of refunds)" },
      { accountId: "43", side: "debit", amount: 25900, memo: "Gateway fees" },
      { accountId: "44", side: "debit", amount: 674100, memo: "Shopify payout 98765" },
    ],
  };
  const je = toQboJournalEntry(plan);

  it("maps doc number, date, and lines", () => {
    expect(je.DocNumber).toBe("RC-98765");
    expect(je.TxnDate).toBe("2026-07-20");
    expect(je.Line).toHaveLength(3);
  });
  it("maps sides to QBO posting types with decimal amounts", () => {
    expect(je.Line[0]).toMatchObject({
      Amount: 7000,
      JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "42" } },
    });
    expect(je.Line[1].JournalEntryLineDetail.PostingType).toBe("Debit");
  });
  it("QBO debits equal credits after conversion", () => {
    const d = je.Line.filter((l) => l.JournalEntryLineDetail.PostingType === "Debit").reduce(
      (s, l) => s + Math.round(l.Amount * 100),
      0,
    );
    const c = je.Line.filter((l) => l.JournalEntryLineDetail.PostingType === "Credit").reduce(
      (s, l) => s + Math.round(l.Amount * 100),
      0,
    );
    expect(d).toBe(c);
  });
});

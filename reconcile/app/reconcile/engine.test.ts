import { describe, expect, it } from "vitest";
import { buildPayoutEntry, type EngineInput } from "./engine";
import { allocate, money } from "./money";
import type {
  AccountMapping,
  BalanceTxn,
  NormalizedOrder,
  NormalizedRefund,
  Payout,
} from "./types";
import { ReconciliationError } from "./types";

const MAP: AccountMapping = {
  salesAccountId: "acct-sales",
  shippingAccountId: "acct-shipping",
  feesAccountId: "acct-fees",
  clearingAccountId: "acct-clearing",
  adjustmentsAccountId: "acct-adjust",
  roundingAccountId: "acct-rounding",
  defaultTaxAccountId: "acct-tax",
  taxAccountByJurisdiction: { "CA State Tax": "acct-tax-ca" },
};

function order(
  id: string,
  cur: string,
  subtotal: number,
  shipping: number,
  taxes: Array<[string, number]> = [],
): NormalizedOrder {
  const taxTotal = taxes.reduce((s, [, a]) => s + a, 0);
  return {
    id,
    name: `#${id}`,
    subtotal: money(subtotal, cur),
    shipping: money(shipping, cur),
    taxLines: taxes.map(([title, amount]) => ({ title, amount: money(amount, cur) })),
    total: money(subtotal + shipping + taxTotal, cur),
  };
}

function charge(id: string, sourceId: string, cur: string, amount: number, fee: number): BalanceTxn {
  return {
    id,
    type: "charge",
    sourceId,
    amount: money(amount, cur),
    fee: money(fee, cur),
    net: money(amount - fee, cur),
  };
}

function payoutOf(cur: string, txns: BalanceTxn[]): Payout {
  const total = txns.reduce((s, t) => s + t.net.amount, 0);
  return { id: "po-1", date: "2026-07-20", amount: money(total, cur), currency: cur };
}

function debits(plan: { lines: { side: string; amount: number }[] }) {
  return plan.lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
}
function credits(plan: { lines: { side: string; amount: number }[] }) {
  return plan.lines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
}
function lineFor(plan: { lines: any[] }, accountId: string) {
  return plan.lines.find((l) => l.accountId === accountId);
}

describe("allocate (largest remainder)", () => {
  it("sums exactly to target", () => {
    const parts = allocate(1000, [333, 333, 333]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1000);
  });
  it("handles awkward splits without losing a cent", () => {
    // 100 cents over weights [1,1,1] -> 34/33/33
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("keeps sign for negative targets (refunds)", () => {
    const parts = allocate(-1001, [700, 200, 101]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(-1001);
    expect(parts.every((p) => p <= 0)).toBe(true);
  });
  it("gives zero-weight components zero", () => {
    expect(allocate(500, [500, 0])).toEqual([500, 0]);
  });
});

describe("buildPayoutEntry — plain USD payout", () => {
  const o1 = order("1001", "USD", 5000, 500, [["CA State Tax", 399]]);
  const o2 = order("1002", "USD", 2000, 0, []);
  const txns = [
    charge("t1", "1001", "USD", 5899, 171),
    charge("t2", "1002", "USD", 2000, 88),
  ];
  const input: EngineInput = {
    payout: payoutOf("USD", txns),
    txns,
    ordersById: new Map([
      ["1001", o1],
      ["1002", o2],
    ]),
    refundsById: new Map(),
    mapping: MAP,
  };
  const plan = buildPayoutEntry(input);

  it("balances to the cent (I1)", () => {
    expect(debits(plan)).toBe(credits(plan));
  });
  it("clearing line equals payout amount (I2)", () => {
    const clearing = lineFor(plan, "acct-clearing")!;
    expect(clearing.side).toBe("debit");
    expect(clearing.amount).toBe(5899 - 171 + 2000 - 88);
  });
  it("credits sales, shipping, and per-jurisdiction tax", () => {
    expect(lineFor(plan, "acct-sales")).toMatchObject({ side: "credit", amount: 7000 });
    expect(lineFor(plan, "acct-shipping")).toMatchObject({ side: "credit", amount: 500 });
    expect(lineFor(plan, "acct-tax-ca")).toMatchObject({ side: "credit", amount: 399 });
  });
  it("debits gateway fees", () => {
    expect(lineFor(plan, "acct-fees")).toMatchObject({ side: "debit", amount: 259 });
  });
  it("has no rounding line when settlement matches presentment", () => {
    expect(lineFor(plan, "acct-rounding")).toBeUndefined();
  });
});

describe("buildPayoutEntry — FX order (EUR presentment, USD settlement)", () => {
  // EUR 100.00 order (85 subtotal, 5 shipping, 10 tax) settles as USD 108.37.
  const o = order("2001", "EUR", 8500, 500, [["VAT", 1000]]);
  const txns = [charge("t1", "2001", "USD", 10837, 315)];
  const input: EngineInput = {
    payout: payoutOf("USD", txns),
    txns,
    ordersById: new Map([["2001", o]]),
    refundsById: new Map(),
    mapping: MAP,
  };
  const plan = buildPayoutEntry(input);

  it("attributes every settled cent (I3): components sum to settled amount", () => {
    const sales = lineFor(plan, "acct-sales")!.amount;
    const shipping = lineFor(plan, "acct-shipping")!.amount;
    const tax = lineFor(plan, "acct-tax")!.amount; // VAT -> default tax acct
    expect(sales + shipping + tax).toBe(10837);
  });
  it("splits proportionally to presentment weights", () => {
    const sales = lineFor(plan, "acct-sales")!.amount;
    // 85% of 10837 = 9211.45 -> largest-remainder keeps it within 1 cent
    expect(Math.abs(sales - 10837 * 0.85)).toBeLessThan(2);
  });
  it("still balances (I1)", () => {
    expect(debits(plan)).toBe(credits(plan));
  });
});

describe("buildPayoutEntry — partial refund in same payout", () => {
  const o = order("3001", "USD", 4000, 0, [["CA State Tax", 290]]);
  const refund: NormalizedRefund = {
    id: "r1",
    orderId: "3001",
    subtotal: money(-1000, "USD"),
    shipping: money(0, "USD"),
    taxLines: [{ title: "CA State Tax", amount: money(-73, "USD") }],
    total: money(-1073, "USD"),
  };
  const txns: BalanceTxn[] = [
    charge("t1", "3001", "USD", 4290, 154),
    {
      id: "t2",
      type: "refund",
      sourceId: "r1",
      amount: money(-1073, "USD"),
      fee: money(0, "USD"),
      net: money(-1073, "USD"),
    },
  ];
  const input: EngineInput = {
    payout: payoutOf("USD", txns),
    txns,
    ordersById: new Map([["3001", o]]),
    refundsById: new Map([["r1", refund]]),
    mapping: MAP,
  };
  const plan = buildPayoutEntry(input);

  it("nets the refund against sales and tax", () => {
    expect(lineFor(plan, "acct-sales")).toMatchObject({ side: "credit", amount: 3000 });
    expect(lineFor(plan, "acct-tax-ca")).toMatchObject({ side: "credit", amount: 217 });
  });
  it("balances and clearing matches net deposit", () => {
    expect(debits(plan)).toBe(credits(plan));
    expect(lineFor(plan, "acct-clearing")!.amount).toBe(4290 - 154 - 1073);
  });
});

describe("buildPayoutEntry — chargeback/adjustment", () => {
  const o = order("4001", "USD", 6000, 0, []);
  const txns: BalanceTxn[] = [
    charge("t1", "4001", "USD", 6000, 204),
    {
      id: "t2",
      type: "dispute",
      sourceId: null,
      amount: money(-2500, "USD"),
      fee: money(1500, "USD"), // dispute fee
      net: money(-4000, "USD"),
    },
  ];
  const input: EngineInput = {
    payout: payoutOf("USD", txns),
    txns,
    ordersById: new Map([["4001", o]]),
    refundsById: new Map(),
    mapping: MAP,
  };
  const plan = buildPayoutEntry(input);

  it("routes dispute amount to adjustments and its fee to fees", () => {
    expect(lineFor(plan, "acct-adjust")).toMatchObject({ side: "debit", amount: 2500 });
    expect(lineFor(plan, "acct-fees")).toMatchObject({ side: "debit", amount: 204 + 1500 });
  });
  it("balances", () => {
    expect(debits(plan)).toBe(credits(plan));
  });
});

describe("buildPayoutEntry — negative payout (refund-heavy period)", () => {
  const refund: NormalizedRefund = {
    id: "r1",
    orderId: "5001",
    subtotal: money(-9000, "USD"),
    shipping: money(0, "USD"),
    taxLines: [],
    total: money(-9000, "USD"),
  };
  const txns: BalanceTxn[] = [
    {
      id: "t1",
      type: "refund",
      sourceId: "r1",
      amount: money(-9000, "USD"),
      fee: money(0, "USD"),
      net: money(-9000, "USD"),
    },
  ];
  const input: EngineInput = {
    payout: payoutOf("USD", txns),
    txns,
    ordersById: new Map(),
    refundsById: new Map([["r1", refund]]),
    mapping: MAP,
  };
  const plan = buildPayoutEntry(input);

  it("credits the clearing account (money leaves the bank)", () => {
    expect(lineFor(plan, "acct-clearing")).toMatchObject({ side: "credit", amount: 9000 });
  });
  it("balances", () => {
    expect(debits(plan)).toBe(credits(plan));
  });
});

describe("error handling (I4) — never post bad data", () => {
  const o = order("6001", "USD", 1000, 0, []);
  const goodTxns = [charge("t1", "6001", "USD", 1000, 30)];

  it("rejects payout totals that don't match transaction nets", () => {
    expect(() =>
      buildPayoutEntry({
        payout: { id: "po-x", date: "2026-07-20", amount: money(99999, "USD"), currency: "USD" },
        txns: goodTxns,
        ordersById: new Map([["6001", o]]),
        refundsById: new Map(),
        mapping: MAP,
      }),
    ).toThrow(ReconciliationError);
  });

  it("rejects charges with no matching order", () => {
    expect(() =>
      buildPayoutEntry({
        payout: payoutOf("USD", goodTxns),
        txns: goodTxns,
        ordersById: new Map(),
        refundsById: new Map(),
        mapping: MAP,
      }),
    ).toThrow(/no matching order/);
  });

  it("rejects mixed-currency transactions", () => {
    const bad = [charge("t1", "6001", "EUR", 1000, 30)];
    expect(() =>
      buildPayoutEntry({
        payout: { id: "po-x", date: "2026-07-20", amount: money(970, "USD"), currency: "USD" },
        txns: bad,
        ordersById: new Map([["6001", o]]),
        refundsById: new Map(),
        mapping: MAP,
      }),
    ).toThrow(ReconciliationError);
  });

  it("rejects unsupported zero-decimal currencies loudly", () => {
    expect(() =>
      buildPayoutEntry({
        payout: { id: "po-x", date: "2026-07-20", amount: money(1000, "JPY"), currency: "JPY" },
        txns: [],
        ordersById: new Map(),
        refundsById: new Map(),
        mapping: MAP,
      }),
    ).toThrow(/not supported/);
  });

  it("rejects non-integer money at construction", () => {
    expect(() => money(10.5, "USD")).toThrow(/integer minor units/);
  });
});

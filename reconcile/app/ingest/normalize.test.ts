import { describe, expect, it } from "vitest";
import {
  decimalToCents,
  mapBalanceTxnType,
  normalizeOrder,
  normalizeRefund,
  type OrderWebhookPayload,
  type RefundWebhookPayload,
} from "./normalize";

const ms = (amount: string, cur = "USD") => ({
  shop_money: { amount, currency_code: cur },
  presentment_money: { amount, currency_code: cur },
});

describe("decimalToCents", () => {
  it("parses exact decimal strings", () => {
    expect(decimalToCents("10.05")).toBe(1005);
    expect(decimalToCents("0.01")).toBe(1);
    expect(decimalToCents("1234")).toBe(123400);
    expect(decimalToCents("99.9")).toBe(9990);
    expect(decimalToCents("-5.25")).toBe(-525);
  });
  it("rejects garbage and >2dp", () => {
    expect(() => decimalToCents("10.055")).toThrow();
    expect(() => decimalToCents("abc")).toThrow();
    expect(() => decimalToCents("")).toThrow();
  });
  it("survives amounts that would break parseFloat rounding", () => {
    expect(decimalToCents("0.29")).toBe(29); // 0.29*100 === 28.999... in float
    expect(decimalToCents("1.15")).toBe(115);
  });
});

describe("normalizeOrder", () => {
  const payload: OrderWebhookPayload = {
    id: 123,
    name: "#1001",
    presentment_currency: "EUR",
    subtotal_price_set: ms("85.00", "EUR"),
    total_shipping_price_set: ms("5.00", "EUR"),
    tax_lines: [{ title: "VAT", price_set: ms("10.00", "EUR") }],
    total_price_set: ms("100.00", "EUR"),
  };
  it("normalizes to presentment cents with derived total", () => {
    const row = normalizeOrder(payload);
    expect(row).toMatchObject({
      id: "123",
      currency: "EUR",
      subtotal: 8500,
      shipping: 500,
      total: 10000,
    });
    expect(JSON.parse(row.taxJson)).toEqual([{ title: "VAT", amount: 1000 }]);
  });
});

describe("normalizeRefund", () => {
  const payload: RefundWebhookPayload = {
    id: 9,
    order_id: 123,
    refund_line_items: [
      { subtotal_set: ms("10.00"), total_tax_set: ms("0.73") },
    ],
    order_adjustments: [],
  };
  it("produces negative amounts attributed to the order's jurisdiction", () => {
    const row = normalizeRefund(payload, "USD", ["CA State Tax"]);
    expect(row).toMatchObject({ subtotal: -1000, shipping: 0, total: -1073 });
    expect(JSON.parse(row.taxJson)).toEqual([{ title: "CA State Tax", amount: -73 }]);
  });
  it("routes shipping refunds separately", () => {
    const withShip: RefundWebhookPayload = {
      ...payload,
      order_adjustments: [
        { kind: "shipping_refund", amount_set: ms("-5.00"), tax_amount_set: ms("0.00") },
      ],
    };
    const row = normalizeRefund(withShip, "USD", []);
    expect(row.shipping).toBe(-500);
  });
});

describe("mapBalanceTxnType", () => {
  it("maps the families", () => {
    expect(mapBalanceTxnType("CHARGE")).toBe("charge");
    expect(mapBalanceTxnType("REFUND")).toBe("refund");
    expect(mapBalanceTxnType("DISPUTE_WITHDRAWAL")).toBe("dispute");
    expect(mapBalanceTxnType("SHOPIFY_FEE")).toBe("fee_only");
    expect(mapBalanceTxnType("TRANSFER")).toBe("adjustment");
  });
});

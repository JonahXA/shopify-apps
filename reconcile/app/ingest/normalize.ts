/**
 * Normalizers: Shopify payloads -> engine-ready records.
 * Money arrives as decimal strings ("10.05"); we convert via string math —
 * never parseFloat — so no cent is ever lost to float representation.
 */

export function decimalToCents(s: string | number): number {
  const str = String(s).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(str);
  if (!m) {
    throw new Error(`Unparseable money amount: "${s}"`);
  }
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

interface MoneySet {
  shop_money: { amount: string; currency_code: string };
  presentment_money: { amount: string; currency_code: string };
}

/** Shopify order webhook payload (the fields we consume). */
export interface OrderWebhookPayload {
  id: number | string;
  name: string;
  presentment_currency: string;
  subtotal_price_set: MoneySet;
  total_shipping_price_set: MoneySet;
  tax_lines: Array<{ title: string; price_set: MoneySet }>;
  total_price_set: MoneySet;
}

export interface NormalizedOrderRow {
  id: string;
  name: string;
  currency: string;
  subtotal: number;
  shipping: number;
  taxJson: string; // [{title, amount}]
  total: number;
}

/**
 * We normalize in PRESENTMENT currency: those are the weights the engine
 * uses to split settled amounts (see docs/reconcile-architecture.md).
 */
export function normalizeOrder(p: OrderWebhookPayload): NormalizedOrderRow {
  const cur = p.presentment_currency;
  const pick = (ms: MoneySet) => {
    const src = ms.presentment_money.currency_code === cur ? ms.presentment_money : ms.shop_money;
    return decimalToCents(src.amount);
  };
  const taxes = p.tax_lines.map((t) => ({ title: t.title, amount: pick(t.price_set) }));
  const subtotal = pick(p.subtotal_price_set);
  const shipping = pick(p.total_shipping_price_set);
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  return {
    id: String(p.id),
    name: p.name,
    currency: cur,
    subtotal,
    shipping,
    taxJson: JSON.stringify(taxes),
    // derive rather than trust total_price_set: engine weights must be
    // internally consistent, and discounts/tips are inside subtotal here
    total: subtotal + shipping + taxTotal,
  };
}

/** Shopify refund webhook payload (fields we consume). */
export interface RefundWebhookPayload {
  id: number | string;
  order_id: number | string;
  refund_line_items: Array<{ subtotal_set: MoneySet; total_tax_set: MoneySet }>;
  order_adjustments: Array<{
    kind: string; // "shipping_refund" | "refund_discrepancy"
    amount_set: MoneySet; // negative amounts
    tax_amount_set: MoneySet;
  }>;
}

export interface NormalizedRefundRow {
  id: string;
  orderId: string;
  currency: string;
  subtotal: number; // negative
  shipping: number; // negative
  taxJson: string;
  total: number; // negative
}

export function normalizeRefund(
  p: RefundWebhookPayload,
  orderCurrency: string,
  orderTaxTitles: string[],
): NormalizedRefundRow {
  const pick = (ms: MoneySet) => {
    const src =
      ms.presentment_money.currency_code === orderCurrency
        ? ms.presentment_money
        : ms.shop_money;
    return decimalToCents(src.amount);
  };
  let subtotal = 0;
  let tax = 0;
  for (const li of p.refund_line_items) {
    subtotal -= Math.abs(pick(li.subtotal_set));
    tax -= Math.abs(pick(li.total_tax_set));
  }
  let shipping = 0;
  for (const adj of p.order_adjustments) {
    const amt = -Math.abs(pick(adj.amount_set));
    if (adj.kind === "shipping_refund") shipping += amt;
    else subtotal += amt; // discrepancies net against sales
    tax -= Math.abs(pick(adj.tax_amount_set));
  }
  // v1: refund webhooks don't break tax down by jurisdiction; attribute to
  // the order's first jurisdiction (single-jurisdiction is the common case;
  // multi-jurisdiction refunds fall back to proportional in a later pass).
  const title = orderTaxTitles[0] ?? "Sales tax";
  const taxes = tax !== 0 ? [{ title, amount: tax }] : [];
  return {
    id: String(p.id),
    orderId: String(p.order_id),
    currency: orderCurrency,
    subtotal,
    shipping,
    taxJson: JSON.stringify(taxes),
    total: subtotal + shipping + tax,
  };
}

/** Map Shopify Payments balance-transaction GraphQL types to engine types. */
export function mapBalanceTxnType(
  shopifyType: string,
): "charge" | "refund" | "dispute" | "adjustment" | "fee_only" {
  const t = shopifyType.toUpperCase();
  if (t === "CHARGE" || t === "PAYMENT") return "charge";
  if (t === "REFUND" || t === "REFUND_FAILURE") return "refund";
  if (t.startsWith("DISPUTE") || t === "CHARGEBACK") return "dispute";
  if (t.includes("FEE")) return "fee_only";
  return "adjustment";
}

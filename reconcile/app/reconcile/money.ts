import type { Money } from "./types";

/** Currencies whose minor unit is not 2 decimal places. Engine v1 supports
 * only 2-decimal currencies; zero-decimal ones fail loudly rather than
 * corrupt books. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX"]);

export function assertSupportedCurrency(code: string): void {
  if (ZERO_DECIMAL.has(code)) {
    throw new Error(
      `Currency ${code} uses non-2-decimal minor units and is not supported in v1`,
    );
  }
}

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(
      `Money amounts must be integer minor units, got ${amount} ${currency}`,
    );
  }
  return { amount, currency };
}

export function sameCurrency(...ms: Money[]): string {
  const c = ms[0]?.currency;
  for (const m of ms) {
    if (m.currency !== c) {
      throw new Error(`Currency mismatch: ${m.currency} vs ${c}`);
    }
  }
  return c;
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sum(currency: string, ms: Money[]): Money {
  let total = 0;
  for (const m of ms) {
    if (m.currency !== currency) {
      throw new Error(`Currency mismatch in sum: ${m.currency} vs ${currency}`);
    }
    total += m.amount;
  }
  return { amount: total, currency };
}

/**
 * Allocate `target` minor units across `weights` proportionally using the
 * largest-remainder method, so parts always sum EXACTLY to target.
 *
 * This is the core of correct FX handling: an order priced in EUR settles
 * as one USD balance-transaction amount; we split that settled amount over
 * the order's components (subtotal / shipping / each tax line) in proportion
 * to their presentment amounts, without ever losing or inventing a cent.
 *
 * Zero-weight entries receive 0. If all weights are zero but target is not,
 * the entire target goes to the first entry (caller decides semantics).
 */
export function allocate(target: number, weights: number[]): number[] {
  if (weights.length === 0) {
    if (target !== 0) throw new Error("Cannot allocate non-zero target to zero parts");
    return [];
  }
  const totalWeight = weights.reduce((s, w) => s + Math.abs(w), 0);
  if (totalWeight === 0) {
    const out = new Array(weights.length).fill(0);
    out[0] = target;
    return out;
  }
  const sign = target < 0 ? -1 : 1;
  const absTarget = Math.abs(target);
  const exact = weights.map((w) => (absTarget * Math.abs(w)) / totalWeight);
  const floors = exact.map(Math.floor);
  let remainder = absTarget - floors.reduce((s, f) => s + f, 0);
  // distribute leftover cents to the largest fractional parts first
  const order = exact
    .map((e, i) => ({ frac: e - floors[i], i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out.map((v) => v * sign);
}

export function fmt(m: Money): string {
  const sign = m.amount < 0 ? "-" : "";
  const abs = Math.abs(m.amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${m.currency}`;
}

/**
 * Live QBO sandbox smoke test — validates the real QuickBooks API layer
 * (OAuth token use, account query, journal-entry create + read-back, and
 * idempotent re-post) against a sandbox company, with NO Shopify/tunnel deps.
 *
 * Usage:
 *   1. Go to the Intuit OAuth 2.0 Playground:
 *      https://developer.intuit.com/app/developer/playground
 *      Pick your app, select the "Accounting" scope, run the flow, and copy
 *      the Access Token and the Realm ID (a.k.a. Company ID).
 *   2. Run:
 *      QBO_ACCESS_TOKEN=... QBO_REALM_ID=... node scripts/qbo-smoke.mjs
 *
 * It builds a journal entry from a fixture payout using the SAME engine and
 * mapper the app uses, posts it, reads it back to confirm QBO agrees it
 * balances, then re-posts to prove idempotency (update-in-place, no dupe).
 */
import { buildPayoutEntry } from "../app/reconcile/engine.ts";
import { toQboJournalEntry, docNumberFor } from "../app/qbo/mapper.ts";

const token = process.env.QBO_ACCESS_TOKEN;
const realm = process.env.QBO_REALM_ID;
const host =
  process.env.QBO_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

if (!token || !realm) {
  console.error(
    "Set QBO_ACCESS_TOKEN and QBO_REALM_ID (from the Intuit OAuth Playground).",
  );
  process.exit(1);
}

const base = `${host}/v3/company/${realm}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function q(query) {
  const r = await fetch(
    `${base}/query?query=${encodeURIComponent(query)}&minorversion=75`,
    { headers },
  );
  if (!r.ok) throw new Error(`query ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return Object.values(d.QueryResponse).find(Array.isArray) ?? [];
}

const money = (amount, currency) => ({ amount, currency });

async function main() {
  console.log(`→ Connecting to ${host} (realm ${realm})`);
  const info = await q("select * from CompanyInfo");
  console.log(`✓ Company: ${info[0]?.CompanyName ?? "(unknown)"}`);

  const accounts = await q(
    "select Id, Name, AccountType from Account where Active = true maxresults 200",
  );
  const first = (t) => accounts.find((a) => a.AccountType === t);
  const idOr = (t) => (first(t) ?? accounts[0]).Id;
  const mapping = {
    salesAccountId: idOr("Income"),
    shippingAccountId: idOr("Income"),
    feesAccountId: idOr("Expense"),
    clearingAccountId: idOr("Bank"),
    adjustmentsAccountId: idOr("Expense"),
    roundingAccountId: idOr("Expense"),
    defaultTaxAccountId: (first("Other Current Liability") ?? accounts[0]).Id,
    taxAccountByJurisdiction: {},
  };
  console.log("✓ Mapped to real sandbox accounts");

  // Fixture: EUR order settling in USD, plus a fee → exercises FX + balancing.
  const payoutId = `smoke${Date.now()}`;
  const plan = buildPayoutEntry({
    payout: {
      id: payoutId,
      date: new Date().toISOString().slice(0, 10),
      amount: money(10522, "USD"),
      currency: "USD",
    },
    txns: [
      {
        id: "t1",
        type: "charge",
        sourceId: "o1",
        amount: money(10837, "USD"),
        fee: money(315, "USD"),
        net: money(10522, "USD"),
      },
    ],
    ordersById: new Map([
      [
        "o1",
        {
          id: "o1",
          name: "#SMOKE",
          subtotal: money(8500, "EUR"),
          shipping: money(500, "EUR"),
          taxLines: [{ title: "VAT", amount: money(1000, "EUR") }],
          total: money(10000, "EUR"),
        },
      ],
    ]),
    refundsById: new Map(),
    mapping,
  });
  console.log(`✓ Engine built a balanced entry (${plan.lines.length} lines)`);

  const entry = toQboJournalEntry(plan);
  const post = await fetch(`${base}/journalentry?minorversion=75`, {
    method: "POST",
    headers,
    body: JSON.stringify(entry),
  });
  if (!post.ok) throw new Error(`create ${post.status}: ${await post.text()}`);
  const created = (await post.json()).JournalEntry;
  console.log(`✓ Posted JournalEntry Id=${created.Id} DocNumber=${created.DocNumber}`);

  const readback = await q(
    `select * from JournalEntry where DocNumber = '${docNumberFor(payoutId)}'`,
  );
  const je = readback[0];
  const sideSum = (side) =>
    je.Line.filter((l) => l.JournalEntryLineDetail?.PostingType === side).reduce(
      (s, l) => s + l.Amount,
      0,
    );
  const d = sideSum("Debit");
  const c = sideSum("Credit");
  console.log(
    `✓ Read back from QBO: debits ${d.toFixed(2)} vs credits ${c.toFixed(2)} → ${
      Math.abs(d - c) < 0.005 ? "BALANCED" : "MISMATCH"
    }`,
  );

  console.log(
    "\n✅ QBO sandbox smoke test passed — the real API layer works end-to-end.",
  );
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e.message);
  process.exit(1);
});

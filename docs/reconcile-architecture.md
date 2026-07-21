# Reconcile — architecture (v1)

Working name: **reconcile**. Shopify → QuickBooks Online bookkeeping sync, $19/mo, 14-day trial,
fully self-serve. The wedge: multi-currency, sales tax, and payout reconciliation **correct by
default**, with a visible "books match to the cent" proof view.

## The core design decision: post payout summaries, not per-order receipts

The Intuit connector's worst failure mode (from 1★ reviews) is posting individual transactions:
thousands of QBO entries, deposits that match nothing, "gross lower than net, fees missing."
A2X — the loved incumbent — posts **one journal entry per payout**. We do the same:

- Order-level detail lives **in our app** (drill-down, audit trail).
- QBO receives **one journal entry per Shopify Payments payout**, whose net equals the bank
  deposit exactly. Reconciliation in QBO is then a one-click match.

### Journal entry shape (per payout)

| Line | Account (merchant-mapped) | Side |
|---|---|---|
| Gross sales | Sales income | CR |
| Shipping collected | Shipping income | CR |
| Sales tax collected | Sales tax liability (per jurisdiction) | CR |
| Refunds | Sales income (contra) | DR |
| Tax refunded | Sales tax liability | DR |
| Gateway fees | Merchant fees expense | DR |
| Adjustments/chargebacks | Adjustments account | DR/CR |
| **Net deposit** | Bank clearing account | **DR = payout amount** |

Invariant (tested): sum(lines) == 0 and clearing-line == payout.amount **to the cent**.
Any residual (rounding, FX) goes to an explicit "rounding/FX gain-loss" line — never silently
dropped. That invariant *is* the product.

## Multi-currency

Complaint: "any order in a foreign currency will send incorrect price data."
Root cause in bad integrations: using **presentment** currency amounts (what the buyer saw)
instead of **settlement** amounts (what the merchant receives).

Rule: all QBO postings use the **payout/settlement currency** amounts from Shopify's balance
transactions (`shopify_payments_balance_transaction`). Presentment amounts are display-only in
our app. FX difference between order-time rate and settlement lands in the FX gain/loss line of
the payout entry. QBO multicurrency mode: v1 requires the QBO home currency == payout currency
(validated in onboarding wizard; clear error if not, with docs page). Multi-payout-currency
stores: post per-currency clearing accounts (v1.1 if demand shows).

## Sales tax

Complaint: "doesn't record the sales tax."
Order tax lines are aggregated per payout **per jurisdiction title** (e.g. "CA State Tax") and
posted to a merchant-mapped liability account (default: one "Sales Tax Payable" account; wizard
offers per-jurisdiction mapping for merchants using QBO sales-tax center = "do not let tax
silently vanish"). Tax-inclusive pricing handled via Shopify's `tax_lines` on orders — never
recomputed by us.

## Scope guards (v1)

- **Shopify Payments payouts only.** Manual/other gateways (PayPal etc.) shown in-app as
  "unsettled by Reconcile" with exported CSV — not posted. (A2X charges more for multi-gateway;
  this is our v1.1 lever.)
- One-way sync. No inventory, no COGS (v1.1), no historical backfill beyond 60 days.
- QBO only (Xero is a later app/major version).

## Data flow

1. **Ingest**: webhooks (`orders/*`, `refunds/*`, `shopify_payments/payouts` via polling — no
   webhook for payouts) + nightly GraphQL sweep (missed-webhook healing; webhooks are
   at-least-once, not guaranteed).
2. **Normalize**: Prisma models `Order`, `Refund`, `BalanceTransaction`, `Payout`,
   `PayoutLine` (derived aggregation), `QboPosting` (idempotency: one posting per payout,
   `payoutId` unique; re-post = update, never duplicate).
3. **Post**: on payout paid-status, build journal entry, validate invariant, post to QBO,
   store QBO txn id. Failures → visible queue with per-error fix-it guidance (self-serve!).
4. **Prove**: dashboard shows per-payout: Shopify amount, QBO entry, delta (always $0.00 or
   an explicit actionable state).

## Idempotency & trust rules

- Every QBO write carries an idempotency record; retries are read-check-then-write.
- We request the **minimum QBO scopes** (accounting only).
- We never delete or modify anything we didn't create (learned from Orderly Emails' disaster —
  and it's a marketing point: "read-only on your store, additive-only in your books").
- Rate limits: QBO 500 req/min/realm is ample at one entry per payout (~daily).

## Stack

- Shopify official Remix template (app/), Prisma + SQLite dev / Postgres prod, single Node host.
- QBO client: hand-rolled thin client (OAuth2 + the 4 endpoints we need: JournalEntry, Account,
  TaxCode query, CompanyInfo) — no heavyweight SDK dependency.
- Tests: vitest; fixture payouts in USD/EUR/GBP/CAD incl. refund-crossing-payout,
  partial refund, multi-jurisdiction tax, rounding residue cases.

## Credential gates (Jonah)

1. Shopify Partner account + dev store + emergency contact (blocks `shopify app dev` + submission).
2. Intuit Developer account + sandbox company + app registration → client id/secret
   (blocks live QBO OAuth; code is built against sandbox spec meanwhile).
3. Production Postgres + host (Fly/Railway/Render — pick at deploy time) + payment method.
4. App Store listing submission (agreements).

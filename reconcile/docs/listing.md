# App Store listing draft

**Name:** Reconcile — QuickBooks Sync
**Tagline (70 chars):** Payout-level QuickBooks sync that matches your bank to the cent

**Category:** Store management → Finances

## Description

Your QuickBooks should match your bank account to the cent. Reconcile posts one
balanced journal entry per Shopify Payments payout — sales, shipping, tax by
jurisdiction, fees, refunds, and disputes — so every deposit reconciles in one click.

No per-order clutter. No missing fees. No foreign-currency surprises. No sales tax
silently dropped. If a payout can't be fully verified, Reconcile shows you why and how
to fix it — it never posts a number it can't prove.

- One journal entry per payout; net equals the bank deposit exactly
- Multi-currency done right: posts what Shopify settled, FX residue shown explicitly
- Sales tax to a liability account, split by jurisdiction
- Refunds, disputes, and adjustments handled — not skipped
- Self-serve setup in ~3 minutes; changes never rewrite your history
- Additive-only: never edits or deletes anything it didn't create

**Pricing:** $19/month after a 14-day free trial. One plan, everything included.

## Screenshots needed (dev store, gated on Partner account)

1. Dashboard: payout list, all "Posted / 0.00 matched"
2. Mapping wizard with QBO accounts loaded
3. A QBO journal entry side-by-side with the Shopify payout
4. The needs-attention state with its plain-language fix

## Review notes (submission)

- Test store + QBO sandbox credentials: (Jonah supplies at submission)
- Emergency developer contact: (Jonah's, in Partner dashboard)
- App requests read_orders + read_shopify_payments_payouts; no storefront injection,
  zero Lighthouse impact (embedded admin only).

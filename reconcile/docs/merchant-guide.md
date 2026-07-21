# Reconcile — merchant guide

Reconcile posts **one balanced journal entry per Shopify Payments payout** to QuickBooks
Online, so every bank deposit matches your books to the cent.

## Setup (about 3 minutes)

1. **Connect QuickBooks** — click *Connect QuickBooks* and approve access. Reconcile
   requests accounting scope only.
2. **Map your accounts** — choose where each part of a payout posts:
   - *Sales income* — gross sales, net of refunds
   - *Shipping income* — shipping you collected
   - *Sales tax liability* — tax collected (a liability, never income)
   - *Payment fees* — Shopify Payments processing fees (expense)
   - *Payout clearing* — where the deposit lands; match it against your bank feed
   - *Adjustments & disputes* — chargebacks and balance adjustments
   - *Rounding / FX residual* — sub-cent residue from currency conversion (pennies)
3. Done. Payouts post automatically; use **Sync now** anytime.

## What posts, exactly

For each payout, one journal entry (DocNumber `RC-<payout id>`) with sales, shipping,
tax per jurisdiction, fees, refunds, and adjustments — the net always equals the deposit.
In your bank feed, match the deposit to the clearing account. That's the whole workflow.

## Multi-currency stores

Amounts post in your **payout currency** using what Shopify actually settled — not the
storefront price the buyer saw. Currency conversion differences land in the FX residual
line, visibly. If your QuickBooks home currency differs from your payout currency,
Reconcile tells you during setup instead of posting wrong numbers.

## When something needs attention

Reconcile never posts an entry it can't fully verify. If a payout can't be reconciled
(for example, an order is missing from history), it appears under **Needs attention**
with the specific reason and the fix. Nothing partial ever reaches your books.

## What Reconcile never does

- Never modifies or deletes anything in QuickBooks it didn't create.
- Never writes to your Shopify store — read-only access to orders and payouts.
- Never recomputes tax — your Shopify tax settings are the source of truth.

## FAQ

**Existing entries from another app?** Reconcile only posts payouts issued after you
finish setup (plus up to 60 days of history if you run Sync now — each gets its own
`RC-` DocNumber, so duplicates are easy to spot and we never re-post the same payout).

**PayPal or other gateways?** v1 covers Shopify Payments payouts. Other gateways show
in the dashboard as not-posted; export them as CSV.

**Uninstalling?** Entries already in QuickBooks stay (they're your books). Our copy of
your data is deleted within 48 hours per Shopify's privacy rules.

Support: email — answered within one business day.

# Shopify micro-SaaS portfolio

Data-driven Shopify App Store app portfolio. Solo builder + AI, self-serve only.
See `MEMORY.md` context in the Claude session for operating principles.

## Phase 1 — Market research (done)
- `research/scrape.py` — category scanner (52 leaf categories → apps.json)
- `research/scrape_details.py` — listing-page detail (launch date, pricing → details.json)
- `research/scrape_reviews.py` — 1–2★ review miner (static; ~10/filter, JS-paginated beyond)
- `research/analyze_final.py` — niche scorecard (dissatisfaction × revenue signal × buildability)
- `research/report.html` — the ranked shortlist + 2 recommended targets + build plans

Data in `research/data/`. Cache (gitignored) in `research/cache/`.

### Verdict
1. **Accounting reconciliation for Shopify** (primary) — finance niche, lowest avg rating
   among high-willingness-to-pay categories; incumbents reconcile multi-currency / sales tax /
   payouts incorrectly. Correctness wedge, solo-buildable.
2. **Safe self-serve transactional-email editor** (faster v1 / fallback) — wounded incumbent
   (Orderly Emails 3.8), but lower moat.

## Run
    pip install -r requirements.txt
    python3 research/scrape.py && python3 research/scrape_details.py && python3 research/analyze_final.py

"""Shopify App Store research scraper — polite, cached, resumable.
Stage 1: category scan -> apps.csv (incumbents per category with rating/reviews/price)
Stage 2: app detail scan -> details.json (launched, updated, pricing tiers, developer, JSON-LD)
Respects robots.txt (avoids /internal/,/services/, q= params). ~1.2s between requests.
"""
import requests, re, time, json, os, sys, hashlib
from bs4 import BeautifulSoup
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT/"cache"; CACHE.mkdir(exist_ok=True)
DATA = ROOT/"data"; DATA.mkdir(exist_ok=True)
H = {"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
DELAY = 1.2

CATEGORIES = """finding-products finding-products-sourcing-options-dropshipping finding-products-sourcing-options-print-on-demand-pod finding-products-sourcing-options-wholesale marketing-and-conversion marketing-and-conversion-advertising marketing-and-conversion-advertising-affiliate-programs marketing-and-conversion-checkout marketing-and-conversion-customer-loyalty marketing-and-conversion-gifts marketing-and-conversion-marketing marketing-and-conversion-marketing-email-marketing marketing-and-conversion-promotions marketing-and-conversion-social-trust marketing-and-conversion-social-trust-product-reviews marketing-and-conversion-upsell-and-bundles orders-and-shipping orders-and-shipping-inventory orders-and-shipping-orders orders-and-shipping-returns-and-warranty orders-and-shipping-shipping-solutions orders-and-shipping-shipping-solutions-shipping sales-channels sales-channels-selling-in-person sales-channels-selling-in-person-retail sales-channels-selling-online sales-channels-selling-online-marketplaces selling-products selling-products-custom-products selling-products-custom-products-product-variants selling-products-digital-goods-and-services selling-products-payments selling-products-payments-subscriptions selling-products-pricing store-design store-design-content store-design-design-elements store-design-images-and-media store-design-internationalization store-design-internationalization-currency-and-translation store-design-notifications store-design-product-display store-design-search-and-navigation store-design-site-optimization store-design-site-optimization-seo store-design-storefronts store-management store-management-finances store-management-operations store-management-operations-analytics store-management-security store-management-support""".split()

def fetch(url, force=False):
    key = hashlib.md5(url.encode()).hexdigest()+".html"
    fp = CACHE/key
    if fp.exists() and not force:
        return fp.read_text(encoding="utf-8")
    time.sleep(DELAY)
    r = requests.get(url, headers=H, timeout=30)
    r.raise_for_status()
    fp.write_text(r.text, encoding="utf-8")
    return r.text

def parse_card(c):
    txt = re.sub(r'\s+',' ', c.get_text(" ", strip=True))
    rating = re.search(r'([\d.]+) out of 5', txt)
    reviews = re.search(r'([\d,]+) total reviews', txt)
    price = re.search(r'(Free to install|Free plan available|Free trial available|Free|From \$[\d.]+/month|\$[\d.]+/month)', txt)
    return {
        "handle": c.get("data-app-card-handle-value"),
        "name": c.get("data-app-card-name-value"),
        "rating": float(rating.group(1)) if rating else None,
        "reviews": int(reviews.group(1).replace(",","")) if reviews else 0,
        "price_tag": price.group(1) if price else None,
    }

def scan_categories():
    rows = []
    for i, cat in enumerate(CATEGORIES):
        url = f"https://apps.shopify.com/categories/{cat}"
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  ! {cat}: {e}"); continue
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select('[data-controller="app-card"]')
        for pos, c in enumerate(cards):
            d = parse_card(c)
            if not d["handle"]: continue
            d["category"] = cat
            d["rank_in_cat"] = pos
            rows.append(d)
        print(f"[{i+1}/{len(CATEGORIES)}] {cat}: {len(cards)} apps")
    (DATA/"apps.json").write_text(json.dumps(rows, indent=1))
    print(f"\nSaved {len(rows)} app-category rows -> data/apps.json")
    return rows

if __name__ == "__main__":
    scan_categories()

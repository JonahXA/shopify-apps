"""Stage 2: fetch app listing pages for a set of handles, extract structured detail."""
import re, json
from bs4 import BeautifulSoup
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from scrape import fetch, DATA

def parse_detail(handle):
    html = fetch(f"https://apps.shopify.com/{handle}")
    soup = BeautifulSoup(html, "html.parser")
    out = {"handle": handle}
    # JSON-LD
    ld = soup.find("script", type="application/ld+json")
    if ld:
        try:
            d = json.loads(ld.string)
            out["name"] = d.get("name")
            ar = d.get("aggregateRating") or {}
            out["rating"] = ar.get("ratingValue")
            out["reviews"] = ar.get("ratingCount")
            out["developer"] = (d.get("brand") or {}).get("name") if isinstance(d.get("brand"),dict) else d.get("brand")
        except Exception: pass
    txt = re.sub(r'\s+',' ', soup.get_text(" ", strip=True))
    # Launched date
    m = re.search(r'Launched\s+([A-Z][a-z]+ \d{1,2}, \d{4})', txt)
    out["launched"] = m.group(1) if m else None
    # Pricing: collect $X/month mentions and plan names
    prices = re.findall(r'\$[\d,]+(?:\.\d+)?\s*/\s*month', txt)
    out["price_points"] = sorted(set(prices))
    out["free_plan"] = "Free plan available" in txt or "Free to install" in txt
    out["free_trial"] = bool(re.search(r'(\d+)-day free trial', txt))
    # Works with (checkout, POS, etc.)
    m = re.search(r'Works with\s+([A-Za-z0-9,\- ]{0,80})', txt)
    out["works_with"] = m.group(1).strip() if m else None
    # highlights / categories breadcrumb
    cats = re.findall(r'/categories/([a-z0-9\-]+)', html)
    out["breadcrumb_cats"] = sorted(set(cats))
    return out

if __name__ == "__main__":
    rows = json.load(open(DATA/"apps.json"))
    # select handles worth detailing: big&unhappy + top-3 of every subcategory
    from collections import defaultdict
    bycat = defaultdict(list)
    for r in rows: bycat[r["category"]].append(r)
    sel = set()
    for c, items in bycat.items():
        items = sorted(items, key=lambda x:x["rank_in_cat"])
        for it in items[:5]: sel.add(it["handle"])          # category leaders
        for it in items:
            if it["reviews"]>100 and it["rating"] and it["rating"]<4.6:
                sel.add(it["handle"])                        # big & unhappy
    sel = sorted(sel)
    print(f"detailing {len(sel)} apps...")
    details=[]
    for i,h in enumerate(sel):
        try:
            details.append(parse_detail(h))
        except Exception as e:
            print(f"  ! {h}: {e}")
        if (i+1)%25==0: print(f"  {i+1}/{len(sel)}")
    json.dump(details, open(DATA/"details.json","w"), indent=1)
    print(f"saved {len(details)} details")

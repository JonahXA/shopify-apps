import json, re
from collections import defaultdict, Counter
details={d["handle"]:d for d in json.load(open("research/data/details.json"))}
rows=json.load(open("research/data/apps.json"))
# pricing distribution per niche (from card price_tag) + how many charge (revenue signal)
cats=defaultdict(list)
for r in rows: cats[r["category"]].append(r)
def pricenum(handle):
    d=details.get(handle,{})
    pp=d.get("price_points") or []
    nums=[float(re.sub(r'[^\d.]','',p)) for p in pp if re.search(r'\d',p)]
    return max(nums) if nums else None

FOCUS=["marketing-and-conversion-marketing-email-marketing","store-design-search-and-navigation",
       "orders-and-shipping-returns-and-warranty","store-management-operations-analytics",
       "marketing-and-conversion-promotions","store-design-product-display",
       "store-design-notifications","store-management-finances","marketing-and-conversion-upsell-and-bundles",
       "store-design-content","selling-products-custom-products"]
print(f"{'niche':52}{'apps':>5}{'avgR':>6}{'medRev':>7}{'topPrice':>9}{'paidShare':>10}")
for c in FOCUS:
    items=cats.get(c,[])
    if not items: continue
    rats=[i['rating'] for i in items if i['rating']]
    revs=sorted(i['reviews'] for i in items)
    prices=[pricenum(i['handle']) for i in items]
    prices=[p for p in prices if p]
    paid=sum(1 for i in items if i['price_tag'] not in (None,'Free'))
    avg=round(sum(rats)/len(rats),2) if rats else 0
    med=revs[len(revs)//2] if revs else 0
    tp=f"${max(prices):.0f}" if prices else "?"
    print(f"{c:52}{len(items):>5}{avg:>6}{med:>7}{tp:>9}{paid/len(items):>10.0%}")

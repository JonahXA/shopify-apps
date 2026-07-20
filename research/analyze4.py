import json, re
from collections import defaultdict
rows=json.load(open("research/data/apps.json"))
cats=defaultdict(list)
for r in rows: cats[r["category"]].append(r)
FIRSTPARTY=re.compile(r'^(google|facebook|shopify|pinterest|whatsapp|point of sale|tiktok|amazon|ebay|walmart)\b',re.I)
for c in ["orders-and-shipping-inventory","store-management-operations","orders-and-shipping-orders",
          "store-management-finances","store-management-operations-analytics","orders-and-shipping-returns-and-warranty"]:
    items=sorted(cats[c],key=lambda x:-x["reviews"])
    print(f"\n### {c}")
    for i in items[:10]:
        fp="[1P]" if FIRSTPARTY.match(i["name"] or "") else "    "
        print(f"  {fp} {i['rating']} ({i['reviews']:>5})  {i['price_tag'] or '':22} {i['handle']}")

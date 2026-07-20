import json, re
from collections import defaultdict
details={d["handle"]:d for d in json.load(open("research/data/details.json"))}
rows=json.load(open("research/data/apps.json"))
cats=defaultdict(list)
for r in rows: cats[r["category"]].append(r)

# Exclude first-party & partnership/channel-dependent niches for solo-buildability
FIRSTPARTY = re.compile(r'^(google|facebook|shopify|pinterest|whatsapp|point of sale|tiktok|snapchat|microsoft|amazon|ebay|walmart|linktree)\b', re.I)
CHANNEL_CATS = {"sales-channels","sales-channels-selling-online","sales-channels-selling-online-marketplaces",
                "sales-channels-selling-in-person","sales-channels-selling-in-person-retail",
                "finding-products-sourcing-options-dropshipping","finding-products-sourcing-options-print-on-demand-pod",
                "finding-products-sourcing-options-wholesale","finding-products"}
# Score each SUBcategory (leaf-ish) for solo opportunity
def leaf(c): return c.count("-")>=1  # subcategories
scored=[]
for c, items in cats.items():
    if c in CHANNEL_CATS: continue
    # incumbents that are solo-buildable & unhappy
    inc=[i for i in items if not FIRSTPARTY.match(i["name"] or "")]
    unhappy=[i for i in inc if i["reviews"]>80 and i["rating"] and i["rating"]<4.7]
    if not inc: continue
    rats=[i["rating"] for i in inc if i["rating"]]
    avg=sum(rats)/len(rats) if rats else 0
    tot_rev=sum(i["reviews"] for i in inc)
    scored.append((c, len(inc), round(avg,2), tot_rev, len(unhappy)))
print(f"{'subcategory':52}{'apps':>5}{'avgRat':>7}{'totRev':>8}{'unhappy':>8}")
for c,n,avg,tr,uh in sorted(scored,key=lambda x:(-x[4],x[2]))[:22]:
    print(f"{c:52}{n:>5}{avg:>7}{tr:>8}{uh:>8}")

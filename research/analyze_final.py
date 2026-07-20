import json, re
from collections import defaultdict
details={d["handle"]:d for d in json.load(open("research/data/details.json"))}
rows=json.load(open("research/data/apps.json"))
cats=defaultdict(list)
for r in rows: cats[r["category"]].append(r)
def price_max(h):
    pp=details.get(h,{}).get("price_points") or []
    nums=[float(re.sub(r'[^\d.]','',p)) for p in pp if re.search(r'\d',p)]
    return max(nums) if nums else None
# niche scorecard: for each subcategory compute the composite
def leaf(c): return c.count('-')>=1
niches=[]
for c,items in cats.items():
    rats=[i['rating'] for i in items if i['rating']]
    if not rats: continue
    revs=sorted(i['reviews'] for i in items)
    prices=[price_max(i['handle']) for i in items]; prices=[p for p in prices if p]
    paid=sum(1 for i in items if i['price_tag'] not in (None,'Free'))/len(items)
    avg=sum(rats)/len(rats)
    dissat=sum(1 for r in rats if r<4.7)/len(rats)  # share of mediocre apps
    med_rev=revs[len(revs)//2]
    top_price=max(prices) if prices else 0
    niches.append(dict(niche=c,apps=len(items),avg=round(avg,2),dissat=round(dissat,2),
        med_rev=med_rev,top_price=int(top_price),paid=round(paid,2)))
# save
json.dump(niches, open("research/data/niche_scorecard.json","w"), indent=1)
print("saved niche_scorecard.json;", len(niches), "niches")
# print ranked by (dissat desc, top_price desc)
rk=sorted(niches,key=lambda x:(-x['dissat'],-x['top_price']))
print(f"\n{'niche':50}{'apps':>5}{'avg':>5}{'dissat':>7}{'medRev':>7}{'$max':>6}{'paid':>6}")
for n in rk[:15]:
    print(f"{n['niche']:50}{n['apps']:>5}{n['avg']:>5}{n['dissat']:>7}{n['med_rev']:>7}{n['top_price']:>6}{n['paid']:>6}")

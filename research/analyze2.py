import json, re
from datetime import datetime
from collections import defaultdict
details = json.load(open("research/data/details.json"))
rows = json.load(open("research/data/apps.json"))
byhandle_cat = defaultdict(list)
for r in rows: byhandle_cat[r["handle"]].append(r["category"])

NOW = datetime(2026,7,20)
def age_days(s):
    if not s: return None
    try: return (NOW - datetime.strptime(s, "%B %d, %Y")).days
    except: return None

# staleness = launched long ago (proxy; 'updated' not always present). We got 'launched'.
det = {d["handle"]:d for d in details}
# Build enriched app records: rating, reviews, launched age, price
enr=[]
for h,d in det.items():
    enr.append({
        "handle":h,"name":d.get("name"),"rating":d.get("rating"),"reviews":d.get("reviews") or 0,
        "launched":d.get("launched"),"age_days":age_days(d.get("launched")),
        "price_points":d.get("price_points"),"free_plan":d.get("free_plan"),
        "cats":byhandle_cat.get(h,[]),
    })
# Which incumbents are BIG (reviews>200), UNHAPPY (rating<4.6), and OLD (age>1500d ~4yr)?
print("BIG + UNHAPPY + OLD incumbents (reviews>150, rating<4.6):")
print(f"{'app':38}{'rating':>7}{'reviews':>8}{'launched':>16}{'age_yr':>7}")
cand=[e for e in enr if e["reviews"]>150 and e["rating"] and e["rating"]<4.6]
for e in sorted(cand,key=lambda x:-x["reviews"])[:35]:
    ay = round(e["age_days"]/365,1) if e["age_days"] else "?"
    print(f"{(e['name'] or e['handle'])[:36]:38}{e['rating']:>7}{e['reviews']:>8}{str(e['launched']):>16}{str(ay):>7}")

import json
from collections import defaultdict
rows = json.load(open("research/data/apps.json"))
# dedupe apps (same handle in multiple cats) keep max reviews
apps = {}
for r in rows:
    h=r["handle"]
    if h not in apps or r["reviews"]>apps[h]["reviews"]:
        apps[h]=r
print(f"distinct apps: {len(apps)}  (from {len(rows)} rows)")

# Category-level signal: for each SUBcategory, look at incumbents
cat = defaultdict(list)
for r in rows:
    cat[r["category"]].append(r)

print(f"\n{'category':52} {'apps':>4} {'medRev':>7} {'medRating':>9} {'low★share':>9} {'bigUnhappy':>10}")
def med(xs):
    xs=sorted(xs); n=len(xs)
    return xs[n//2] if n else 0
scores=[]
for c, items in cat.items():
    revs=[i["reviews"] for i in items]
    rats=[i["rating"] for i in items if i["rating"]]
    # "big & unhappy": apps with >100 reviews AND rating<4.6
    bu=[i for i in items if i["reviews"]>100 and i["rating"] and i["rating"]<4.6]
    lowshare = sum(1 for r in rats if r<4.6)/len(rats) if rats else 0
    scores.append((c,len(items),med(revs),round(med(rats),2) if rats else 0, round(lowshare,2), len(bu)))
# sort by number of big&unhappy incumbents
for c,n,mr,mrat,ls,bu in sorted(scores,key=lambda x:-x[5])[:20]:
    print(f"{c:52} {n:>4} {mr:>7} {mrat:>9} {ls:>9} {bu:>10}")

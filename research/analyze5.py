import json, re
from collections import defaultdict
rows=json.load(open("research/data/apps.json"))
# distinct apps, best (max) review count, with their categories
apps={}
appcats=defaultdict(set)
for r in rows:
    h=r["handle"]; appcats[h].add(r["category"])
    if h not in apps or r["reviews"]>apps[h]["reviews"]: apps[h]=r
FIRSTPARTY=re.compile(r'^(google|facebook|shopify|pinterest|whatsapp|point of sale|tiktok|amazon|ebay|walmart|microsoft|snapchat)\b',re.I)
CHANNEL=re.compile(r'(etsy|ebay|amazon|tiktok|walmart|marketplace|multichannel|multi-channel|sync)',re.I)
# genuinely unhappy + big + solo-buildable
targets=[]
for h,a in apps.items():
    if FIRSTPARTY.match(a["name"] or ""): continue
    if a["rating"] and a["reviews"]>=250 and a["rating"]<=4.5:
        solo = not CHANNEL.search((a["name"] or "")+" "+" ".join(appcats[h]))
        targets.append((a["rating"],a["reviews"],a["name"],h,"solo" if solo else "sync/channel",sorted(appcats[h])[:2]))
print(f"{'rat':>4}{'revs':>7}  {'app':34}{'type':14}cats")
for rat,rev,name,h,typ,cs in sorted(targets):
    print(f"{rat:>4}{rev:>7}  {(name or h)[:32]:34}{typ:14}{','.join(c.split('-')[-1] for c in cs)}")

import json
from collections import defaultdict
revs=json.load(open("research/data/reviews.json"))
byapp=defaultdict(list)
for r in revs: byapp[r["handle"]].append(r)
for h,rs in byapp.items():
    print(f"\n===== {h} ({len(rs)} reviews, {sum(1 for r in rs if r['rating']==1)}×1★) =====")
    for r in rs[:5]:
        print(f"  [{r['rating']}★ {r['date']}] {r['text'][:220]}")

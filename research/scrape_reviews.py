"""Stage 3: mine low-star (1-2) reviews for a set of app handles."""
import re, json, sys
from bs4 import BeautifulSoup
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from scrape import fetch, DATA

def get_reviews(handle, ratings=(1,2,3)):
    # NOTE: review ?page=N is JS-driven (server returns page 1 for all N),
    # so we can only reliably read the first ~10 reviews per rating filter.
    revs=[]; seen=set()
    for rating in ratings:
            url=f"https://apps.shopify.com/{handle}/reviews?rating={rating}&sort_by=most_recent"
            try: html=fetch(url)
            except Exception: continue
            soup=BeautifulSoup(html,"html.parser")
            blocks=soup.select('[data-merchant-review]')
            if not blocks: continue
            for rv in blocks:
                star=None
                for a in rv.select('[aria-label]'):
                    m=re.match(r'(\d) out of 5 stars', a.get("aria-label",""))
                    if m: star=int(m.group(1)); break
                if star not in ratings: continue
                txt=re.sub(r'\s+',' ', rv.get_text(" ",strip=True))
                txt=re.sub(r'^Edited\s+','',txt)
                date=re.match(r'([A-Z][a-z]+ \d{1,2}, \d{4})', txt)
                body=txt
                if date: body=txt[date.end():].strip()
                body=re.sub(r'\s*Show more\s*.*$','',body)  # strip trailer (merchant/country/tenure)
                key=(handle, body[:120])
                if key in seen: continue
                seen.add(key)
                revs.append({"handle":handle,"rating":star,"date":date.group(1) if date else None,"text":body[:500]})
    return revs

if __name__=="__main__":
    handles = sys.argv[1:]
    allr=[]
    for h in handles:
        r=get_reviews(h)
        print(f"{h}: {len(r)} low-star reviews")
        allr+=r
    out=DATA/"reviews.json"
    existing=json.load(open(out)) if out.exists() else []
    json.dump(existing+allr, open(out,"w"), indent=1)
    print(f"total saved: {len(existing)+len(allr)}")

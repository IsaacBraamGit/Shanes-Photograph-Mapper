#!/usr/bin/env python3
"""Fetch a real photo per location from Wikimedia Commons. Resumable."""
import urllib.request, urllib.parse, json, ssl, os, time

ctx = ssl.create_default_context()
UA = {"User-Agent": "PhotoshootScout/1.0 (personal scouting project)"}
os.makedirs("static/img", exist_ok=True)
DATA = "data/locations.json"


def api(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=20, context=ctx))


def search_image(query):
    d = api({"action": "query", "format": "json", "generator": "search",
             "gsrsearch": query, "gsrlimit": 4, "gsrnamespace": 6,
             "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 900})
    pages = list(d.get("query", {}).get("pages", {}).values())
    pages.sort(key=lambda p: p.get("index", 99))
    for p in pages:
        ii = p.get("imageinfo", [{}])[0]
        mime = ii.get("mime", "")
        if mime.startswith("image/") and mime not in ("image/svg+xml", "image/gif"):
            return ii.get("thumburl") or ii.get("url")
    return None


def download(url, dest):
    req = urllib.request.Request(url, headers=UA)
    data = urllib.request.urlopen(req, timeout=30, context=ctx).read()
    open(dest, "wb").write(data)
    return len(data)


locs = json.load(open(DATA))
for l in locs:
    dest = f"static/img/{l['id']}.jpg"
    if os.path.exists(dest) and os.path.getsize(dest) > 2000:
        l["image"] = f"/img/{l['id']}.jpg"
        l["image_source"] = "Wikimedia Commons"
        continue
    title, city, country = l["title"], l.get("city", ""), l.get("country", "")
    key = title.split("(")[0].split("&")[0].split(",")[0].strip()
    thumb = None
    for q in [f"{key} {city}", f"{title} {city}", f"{key} {city} {country}", key]:
        try:
            thumb = search_image(q)
        except Exception:
            thumb = None
        if thumb:
            break
    if not thumb:
        print(f"{l['id']}: NO IMAGE for {title}", flush=True)
        continue
    try:
        n = download(thumb, dest)
        l["image"] = f"/img/{l['id']}.jpg"
        l["image_source"] = "Wikimedia Commons"
        json.dump(locs, open(DATA, "w"), indent=2, ensure_ascii=False)  # save after each
        print(f"{l['id']}: {n // 1024}KB  {title[:40]}", flush=True)
    except Exception as e:
        print(f"{l['id']}: DL ERR {e}", flush=True)

json.dump(locs, open(DATA, "w"), indent=2, ensure_ascii=False)
ok = sum(1 for l in locs if l.get("image"))
print(f"DONE {ok}/{len(locs)} have a real photo", flush=True)

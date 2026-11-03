#!/usr/bin/env python3
"""Build models.json: every Mac model -> newest Boot Camp ESD package (for the MDfW site).

Uses the same catalog logic as bootcamp_esd_url.py, but scans all models at once.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from bootcamp_esd_url import SUCATALOG_URL, fetch
import plistlib

MODEL_RE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{4,12}\d{1,2},\d{1,2})(?![0-9])")


def main(out_path="site/models.json"):
    products = plistlib.loads(fetch(SUCATALOG_URL))["Products"]
    bc = [(pid, p) for pid, p in products.items()
          if "BootCamp" in p.get("ServerMetadataURL", "")
          and "English" in p.get("Distributions", {})]

    def scan(item):
        pid, p = item
        dist = fetch(p["Distributions"]["English"]).decode("utf-8", "replace")
        pkg = p["Packages"][0]
        return pid, p.get("PostDate"), pkg["URL"], pkg.get("Size"), set(MODEL_RE.findall(dist))

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(scan, bc))

    models = {}
    for pid, date, url, size, found in results:
        for m in found:
            cur = models.get(m)
            if cur is None or date > cur["_date"]:
                models[m] = {"_date": date, "product": pid,
                             "date": date.strftime("%Y-%m-%d"),
                             "url": url.replace("http://", "https://", 1), "size": size}
    for v in models.values():
        del v["_date"]
    ordered = dict(sorted(models.items(), key=lambda kv: kv[0].lower()))
    with open(out_path, "w") as f:
        json.dump(ordered, f, indent=0, separators=(",", ":"))
    print(f"{len(bc)} Boot Camp products, {len(ordered)} models -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:])

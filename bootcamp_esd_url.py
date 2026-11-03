#!/usr/bin/env python3
"""Print the Boot Camp ESD (Windows Support drivers) download URL for a Mac model.

Essential logic extracted from brigadier 0.2.6, ported to Python 3, stdlib only.

Usage:
    python3 bootcamp_esd_url.py <model>      e.g. python3 bootcamp_esd_url.py MacBookPro14,3
"""
import os
import plistlib
import re
import ssl
import sys
import urllib.request

SUCATALOG_URL = (
    "https://swscan.apple.com/content/catalogs/others/"
    "index-11-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-"
    "snowleopard-leopard.merged-1.sucatalog"
)


# python.org builds of Python ship without CA certs; also trust macOS's system bundle
SSL_CTX = ssl.create_default_context()
if os.path.exists("/etc/ssl/cert.pem"):
    SSL_CTX.load_verify_locations("/etc/ssl/cert.pem")


def fetch(url):
    with urllib.request.urlopen(url, context=SSL_CTX) as resp:
        return resp.read()


def find_esd(model):
    """Return (product_id, package_url, post_date) of the newest Boot Camp ESD for model."""
    products = plistlib.loads(fetch(SUCATALOG_URL))["Products"]
    # Exact match only: 'MacBookPro1,1' must not match 'MacBookPro11,1' or 'MacBookPro1,10'
    model_re = re.compile(r"(?<![A-Za-z0-9])" + re.escape(model) + r"(?![0-9])")

    matches = []
    for prod_id, prod in products.items():
        if "BootCamp" not in prod.get("ServerMetadataURL", ""):
            continue
        dist_url = prod.get("Distributions", {}).get("English")
        if not dist_url:
            continue
        if model_re.search(fetch(dist_url).decode("utf-8", "replace")):
            matches.append((prod_id, prod["Packages"][0]["URL"], prod.get("PostDate")))

    if not matches:
        return None
    # Several ESDs may list the model; brigadier picks the most recently posted one
    return max(matches, key=lambda m: m[2])


def main():
    if len(sys.argv) != 2:
        sys.exit(f"Usage: {sys.argv[0]} <model>   (e.g. MacBookPro14,3)")
    model = sys.argv[1]
    print(f"Model: {model}")
    esd = find_esd(model)
    if not esd:
        sys.exit(f"No Boot Camp ESD found for {model} "
                 "(Apple Silicon Macs have no Boot Camp support).")
    prod_id, url, post_date = esd
    print(f"Product: {prod_id} (posted {post_date})")
    print(f"URL: {url}")


if __name__ == "__main__":
    main()

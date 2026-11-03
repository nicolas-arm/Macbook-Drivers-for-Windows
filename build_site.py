#!/usr/bin/env python3
"""Render the MDfW site from site/template.html, site/models.json, i18n_data.py and mdfw_extract.py.

Writes site/mdfw.html (body only, for the Claude artifact) and site/index.html (standalone page to self-host).
Run build_models.py first to refresh site/models.json.
"""
import datetime
import html
import json
import os
import sys

from i18n_data import LANGS, T

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")

template = open(os.path.join(SITE, "template.html")).read()
models = json.load(open(os.path.join(SITE, "models.json")))
extract_py = open(os.path.join(ROOT, "mdfw_extract.py")).read()
built = datetime.date.fromtimestamp(os.path.getmtime(os.path.join(SITE, "models.json")))


def tag_translatable(markup):
    """Add data-t="key" to the element whose entire content is T[key]["en"]."""
    head, sep, script = markup.partition("<script>")
    for key, tr in T.items():
        if key.startswith("js."):
            continue
        needle = ">" + tr["en"] + "</"
        count = head.count(needle)
        if count != 1:
            sys.exit(f"i18n: '{key}' found {count}x in template (expected once): {tr['en'][:60]!r}")
        idx = head.index(needle)
        start = head.rindex("<", 0, idx)
        if head[start + 1] == "/":
            sys.exit(f"i18n: '{key}' is not the full content of one element")
        head = head[:idx] + f' data-t="{key}"' + head[idx:]
    return head + sep + script


def js(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


page = tag_translatable(template)
page = (page
        .replace("__MODELS_JSON__", js(models))
        .replace("__I18N_JSON__", js(T))
        .replace("__LANGS_JSON__", js(LANGS))
        .replace("__N_MODELS__", str(len(models)))
        .replace("__EXTRACT_PY__", html.escape(extract_py, quote=False))
        .replace("__BUILD_DATE__", built.isoformat()))

open(os.path.join(SITE, "mdfw.html"), "w").write(page)
open(os.path.join(SITE, "index.html"), "w").write(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>\n'
    '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
print(f"wrote site/mdfw.html and site/index.html ({len(T)} strings x {len(LANGS)} languages)")

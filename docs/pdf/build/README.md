# PDF build

Regenerates `../KGT-AI-Hub-Process-Flow.pdf` from `docs/PROCESS_FLOW.md`, in the
KGT Solutions brand: obsidian cover and back, brand blue `#1364D8` and green
`#22C55E` accents, Geist, and the logo from `assets/`.

Edit the markdown, not the PDF — then rebuild.

## Requirements

- Google Chrome (headless, for layout and print)
- Node with `puppeteer-core` — taken from `apps/api/node_modules`
- Python 3 with `markdown` and `pymupdf`

## One-time: fetch the assets the build embeds

Kept out of git because of their size; the build needs them in `assets/`.

```bash
cd docs/pdf/build/assets
curl -sS -o mermaid.min.js https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js
# Geist + Geist Mono, latin subsets, rewritten to local paths
# the full UA matters: a short one makes Google serve legacy TTF, not woff2
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400;500&display=swap" \
  -o geist.css
python3 - <<'PY'
import re, pathlib, urllib.request, hashlib
css, keep = pathlib.Path('geist.css').read_text(), []
for b in re.split(r'(?=/\* )', css):
    m = re.match(r'/\* ([^*]+) \*/', b or '')
    if not m or m.group(1).strip() not in ('latin', 'latin-ext'): continue
    u = re.search(r'url\((https://[^)]+\.woff2)\)', b)
    if not u: continue
    fam = re.search(r"font-family: '([^']+)'", b).group(1).replace(' ', '')
    fn = f"{fam}-{m.group(1).strip()}-{hashlib.md5(u.group(1).encode()).hexdigest()[:6]}.woff2"
    urllib.request.urlretrieve(u.group(1), fn); keep.append(b.replace(u.group(1), fn))
pathlib.Path('fonts.css').write_text(''.join(keep))
PY
```

## Build

```bash
cd docs/pdf/build

# Process Flow
python3 build_process_flow.py
DOC_FOOTER='KGT AI HUB &nbsp;&middot;&nbsp; END-TO-END PROCESS FLOW' node render.js process-flow
python3 finish.py process-flow ../KGT-AI-Hub-Process-Flow.pdf "KGT AI Hub — End-to-End Process Flow"

# Specifications & Features
python3 build_specifications.py
DOC_FOOTER='KGT AI HUB &nbsp;&middot;&nbsp; SPECIFICATIONS &amp; FEATURES' node render.js specifications
python3 finish.py specifications ../KGT-AI-Hub-Specifications.pdf "KGT AI Hub — Product Specifications & Features"
```

`brandpdf.py` holds the shared brand layout; each `build_*.py` is just that
document's source file and cover copy. A new document is a new config, not a
new stylesheet.

## Screenshots

The specification's figures live in `docs/figures/`, cropped from captures of
the live platform. To refresh them, re-capture at 1500x940 with a 2x device
scale factor, crop to the region of interest, and keep the filenames — the
markdown references them by name.

## How it works, and why

| Step | Why it is done this way |
|---|---|
| Two render passes | The cover and back page need a true full bleed, which means a zero page margin; the body needs 15mm margins for its running footer. One pass cannot do both — Chrome ignores `@page` named-page margins here. |
| `@page { margin: 0 }` injected into `bleed.html` | The base `@page` margin governs *layout* even when `page.pdf` asks for none, which otherwise fragments a full-page element across two pages. |
| Bleed pages are 297mm, body art is not | The merged document is assembled page by page in `finish.py`, so each pass keeps its own geometry. |
| Repo-relative links become code spans | A PDF reader cannot open `../apps/api/src/...`; in-document anchors stay live. |
| Diagrams capped at 168mm tall | A taller figure is pushed to its own page and leaves most of the previous one blank. |
| Bookmarks found by 17pt text | The web fonts embed as Type3, so the bold flag is unreliable — size identifies section headings. |
| Front matter unnumbered | Cover and back carry no footer; the body numbers 1…27, the usual editorial convention. |

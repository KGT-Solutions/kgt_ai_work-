#!/usr/bin/env python3
"""Shared brand layout for KGT Solutions PDF documents.

One markdown file in, two HTML files out: `<prefix>-bleed.html` (the full-bleed
cover and back cover, printed with no page margin) and `<prefix>-body.html`
(contents plus numbered sections, printed with margins and a running footer).
render.js turns each into a PDF and finish.py merges them.

Shared by build_process_flow.py and build_specifications.py — the brand lives
here, the content and cover copy live in those.
"""
import re, pathlib, datetime, html as htmllib
import markdown

ROOT = pathlib.Path(__file__).resolve().parents[3]
BUILD = pathlib.Path(__file__).parent


def slugify(text, _state={}):
    """GitHub-compatible heading slugs, so in-document links resolve."""
    seen = _state.setdefault('seen', {})
    s = re.sub(r'<[^>]+>', '', text).lower()
    s = re.sub(r'[^\w\s-]', '', s).strip().replace(' ', '-')
    n = seen.get(s, 0)
    seen[s] = n + 1
    return s if n == 0 else f'{s}-{n}'


CSS = r"""
@page { size: A4; margin: 15mm 0 15mm 0; }
.bleedpage { background: var(--obsidian); }
.bleedpage .back { page-break-before: auto; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; padding: 0 17mm;
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  font-size: 9.7pt; line-height: 1.62; color: #22262F; background: #fff;
  font-feature-settings: 'ss01','cv11';
}
/* ── brand tokens ───────────────────────────────── */
:root {
  --obsidian:#090A0F; --panel:#0E1117; --panel2:#12151D;
  --brand:#1364D8; --brand-400:#5596F3; --brand-50:#EEF5FF; --brand-700:#0F50B0;
  --green:#22C55E; --green-50:#ECFDF3;
  --fg:#0A0B0F; --fg2:#5A6274; --fg3:#8A92A3; --line:#E3E8F0;
}
a { color: var(--brand-700); text-decoration: none; }

/* ── cover ──────────────────────────────────────── */
.cover {
  position: relative; margin: 0; padding: 32mm 20mm 20mm;
  height: 297mm; color: #fff; page-break-after: always; overflow: hidden;
  background:
    radial-gradient(ellipse 118mm 80mm at 64% 4%, rgba(19,100,216,.52) 0%, rgba(19,100,216,.16) 44%, transparent 72%),
    radial-gradient(ellipse 92mm 66mm at 23% 10%, rgba(34,197,94,.24) 0%, transparent 66%),
    var(--obsidian);
}
.cover::before {
  content: ''; position: absolute; inset: 0;
  background-image: linear-gradient(to right, rgba(255,255,255,.045) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,.045) 1px, transparent 1px);
  background-size: 11mm 11mm;
  -webkit-mask-image: radial-gradient(ellipse 72% 52% at 50% 4%, #000 32%, transparent 100%);
}
.cover > * { position: relative; z-index: 2; }
.cover-logo svg { width: 46mm; height: auto; display: block; }
.cover-kicker {
  margin-top: 40mm; font-size: 8.6pt; font-weight: 600; letter-spacing: .20em;
  text-transform: uppercase; color: var(--brand-400);
}
.cover h1 {
  margin: 5mm 0 0; font-size: 36pt; font-weight: 700; line-height: 1.07;
  letter-spacing: -.025em; color: #fff; max-width: 150mm;
}
.cover h1 em { font-style: normal; color: #5596F3; }
.cover h1 em i { font-style: normal; color: #4ADE80; }
.cover-lede {
  margin: 7mm 0 0; max-width: 128mm; font-size: 11pt; line-height: 1.6; color: #B6BECE;
}
.cover-rule {
  margin: 11mm 0; width: 42mm; height: 3px; border-radius: 2px;
  background: linear-gradient(90deg, var(--brand) 0%, var(--green) 100%);
}
.cover-meta { display: flex; gap: 10mm; }
.cover-meta div { min-width: 34mm; }
.cover-meta dt {
  font-size: 7.2pt; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #6B7385;
}
.cover-meta dd { margin: 2mm 0 0; font-size: 9.6pt; color: #E7E9EE; font-weight: 500; }
.cover-foot {
  position: absolute; left: 20mm; right: 20mm; bottom: 20mm;
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 5mm; border-top: 1px solid rgba(255,255,255,.10);
  font-size: 8.4pt; color: #6B7385;
}
.cover-foot b { color: var(--brand-400); font-weight: 600; }

/* ── contents ───────────────────────────────────── */
.toc-page { page-break-after: always; padding-top: 4mm; }
.page-title {
  font-size: 17pt; font-weight: 700; letter-spacing: -.02em; color: var(--fg); margin: 0;
}
.page-title + .sub { margin: 2mm 0 9mm; color: var(--fg2); font-size: 9.4pt; }
.toc-page ol { list-style: none; margin: 0; padding: 0; counter-reset: toc; }
.toc-page li {
  counter-increment: toc; display: flex; align-items: baseline; gap: 5mm;
  padding: 3.1mm 0; border-bottom: 1px solid var(--line);
}
.toc-page li::before {
  content: counter(toc, decimal-leading-zero);
  font-family: 'Geist Mono', monospace; font-size: 8.4pt; font-weight: 500;
  color: var(--brand); min-width: 8mm;
}
.toc-page li a { font-size: 10.2pt; font-weight: 500; color: var(--fg); }
.toc-page li:last-child { border-bottom: none; }
.lede { font-size: 10pt; color: var(--fg2); line-height: 1.65; }
.lede strong { color: var(--fg); }

/* ── sections ───────────────────────────────────── */
.sec { page-break-before: always; }
.sec-head {
  display: flex; align-items: center; gap: 5mm;
  margin: 0 0 7mm; padding-bottom: 4mm; border-bottom: 2px solid var(--line);
}
.sec-num {
  flex: none; width: 11mm; height: 11mm; border-radius: 3mm;
  background: linear-gradient(145deg, var(--brand) 0%, #0F50B0 100%);
  color: #fff; font-size: 12pt; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.sec-head h2 {
  margin: 0; font-size: 17pt; font-weight: 700; letter-spacing: -.022em; color: var(--fg);
}
h3 {
  margin: 8mm 0 3mm; font-size: 11.4pt; font-weight: 650; letter-spacing: -.012em; color: var(--fg);
  page-break-after: avoid;
}
h3::before {
  content: ''; display: inline-block; width: 2.6mm; height: 2.6mm; margin-right: 2.4mm;
  border-radius: 1mm; background: var(--green); vertical-align: middle;
}
h4 { margin: 6mm 0 2mm; font-size: 9.8pt; font-weight: 650; color: var(--brand-700); page-break-after: avoid; }
p { margin: 0 0 3.4mm; }
strong { font-weight: 650; color: var(--fg); }
ul, ol { margin: 0 0 4mm; padding-left: 5.5mm; }
li { margin-bottom: 1.6mm; }
li::marker { color: var(--brand); }

/* ── tables ─────────────────────────────────────── */
table {
  width: 100%; border-collapse: collapse; margin: 3mm 0 6mm; font-size: 8.4pt;
}
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
thead th {
  background: var(--panel); color: #fff; text-align: left; font-weight: 600;
  padding: 2.5mm 3mm; font-size: 8pt; letter-spacing: .01em;
  border: none;
}
thead th:first-child { border-top-left-radius: 1.6mm; }
thead th:last-child { border-top-right-radius: 1.6mm; }
tbody td { padding: 2.4mm 3mm; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) { background: #F7F9FC; }
tbody tr:last-child td { border-bottom: 1px solid var(--line); }
td code, th code { font-size: 7.7pt; }

/* ── code ───────────────────────────────────────── */
code {
  font-family: 'Geist Mono', monospace; font-size: 8.5pt;
  background: var(--brand-50); color: var(--brand-700);
  padding: .2mm .7mm; border-radius: .8mm;
}
pre {
  background: var(--panel); color: #D7DCE6; border-radius: 2.4mm;
  padding: 4mm 5mm; margin: 3mm 0 6mm; overflow: hidden;
  font-size: 8.2pt; line-height: 1.55; page-break-inside: avoid;
  border-left: 3px solid var(--brand);
}
pre code {
  background: none; border: none; color: inherit; padding: 0; font-size: inherit;
}

/* ── diagrams ───────────────────────────────────── */
.dia {
  margin: 4mm 0 7mm; padding: 5mm 4mm; background: #FBFCFE;
  border: 1px solid var(--line); border-radius: 3mm;
  text-align: center; page-break-inside: avoid;
}
/* mermaid renders into a <pre>, which must not keep the dark code-block skin */
.dia pre.mermaid {
  background: none; border: none; border-left: none; padding: 0; margin: 0;
  color: inherit; font-family: inherit; font-size: inherit;
}
.dia svg { max-width: 100%; max-height: 168mm; height: auto; }
blockquote {
  margin: 4mm 0; padding: 3mm 4mm; background: var(--green-50);
  border-left: 3px solid var(--green); border-radius: 0 2mm 2mm 0; color: #15532F;
}
blockquote p:last-child { margin-bottom: 0; }

/* ── back page ──────────────────────────────────── */
.back {
  page-break-before: always; overflow: hidden; margin: 0; padding: 56mm 20mm 34mm;
  height: 297mm; color: #fff; position: relative; overflow: hidden;
  background:
    radial-gradient(ellipse 112mm 74mm at 68% 6%, rgba(19,100,216,.44) 0%, transparent 70%),
    radial-gradient(ellipse 90mm 60mm at 20% 12%, rgba(34,197,94,.22) 0%, transparent 68%),
    var(--obsidian);
}
.back-logo svg { width: 40mm; height: auto; }
.back h2 { margin: 24mm 0 4mm; font-size: 18pt; font-weight: 700; color: #fff; }
.back p { color: #A0A8B8; max-width: 120mm; font-size: 10pt; }
.back .cover-rule { margin: 8mm 0 10mm; }
.back-grid { display: flex; gap: 10mm; flex-wrap: wrap; margin-top: 12mm; }
.back-grid div {
  flex: 1 1 42mm; padding: 4mm; border: 1px solid rgba(255,255,255,.10); border-radius: 2.5mm;
  background: rgba(255,255,255,.025);
}
.back-grid dt { font-size: 7.4pt; letter-spacing: .14em; text-transform: uppercase; color: var(--brand-400); font-weight: 600; }
.back-grid dd { margin: 2mm 0 0; font-size: 9pt; color: #E7E9EE; }
.back-foot {
  position: absolute; left: 20mm; right: 20mm; bottom: 20mm;
  padding-top: 5mm; border-top: 1px solid rgba(255,255,255,.10);
  font-size: 8.6pt; color: #6B7385; display: flex; justify-content: space-between;
}
.back-foot b { color: #fff; font-weight: 600; }

/* ── screenshots ────────────────────────────────── */
figure.shot {
  margin: 4mm 0 7mm; page-break-inside: avoid; text-align: center;
}
figure.shot img {
  display: block; width: 100%; height: auto; border-radius: 2.4mm;
  border: 1px solid #D9E0EB; box-shadow: 0 2mm 6mm -3mm rgba(10,11,15,.30);
}
figure.shot figcaption {
  margin: 2.6mm auto 0; max-width: 150mm; font-size: 8pt; line-height: 1.5;
  color: var(--fg2); text-align: left;
}
figure.shot figcaption::before {
  content: 'Figure ' counter(fig) ' · '; counter-increment: fig;
  color: var(--brand); font-weight: 650;
}
body { counter-reset: fig; }
"""


def build(cfg):
    """cfg keys: source, prefix, kicker, title_lines, lede, meta, back, doc_title."""
    src = ROOT / cfg['source']
    raw = src.read_text()

    # ── 1. lift mermaid fences out before markdown runs ──
    diagrams = []

    def stash(m):
        diagrams.append(m.group(1))
        return f'\n\nMERMAIDPLACEHOLDER{len(diagrams) - 1}ENDPLACEHOLDER\n\n'

    raw = re.sub(r'```mermaid\n(.*?)```', stash, raw, flags=re.S)

    # ── 2. split off the title and the contents list ──
    raw = re.sub(r'\A# .*?\n', '', raw, count=1)
    m = re.search(r'\A(.*?)^## Contents\n(.*?)^---', raw, flags=re.S | re.M)
    intro = m.group(1).strip() if m else ''
    contents_md = m.group(2).strip() if m else ''
    body_md = raw[m.end():] if m else raw

    # ── 3. repo-relative links become code spans; a PDF cannot open them ──
    link_re = r'\[([^\]]+)\]\(([^)]+)\)'

    def delink(mm):
        label, target = mm.group(1), mm.group(2)
        if target.startswith(('#', 'http', 'mailto')):
            return mm.group(0)
        return f'`{label}`'

    # images must survive delinking
    images = []

    def stash_img(mm):
        images.append((mm.group(1), mm.group(2)))
        return f'IMAGEPLACEHOLDER{len(images) - 1}ENDPLACEHOLDER'

    body_md = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', stash_img, body_md)
    body_md = re.sub(link_re, delink, body_md)
    intro = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', stash_img, intro)
    intro = re.sub(link_re, delink, intro)

    md = markdown.Markdown(extensions=['tables', 'fenced_code', 'attr_list', 'sane_lists'])

    def render(text):
        md.reset()
        return md.convert(text)

    body_html, contents_html, intro_html = render(body_md), render(contents_md), render(intro)

    # ── 4. heading ids, then a display header per numbered section ──
    def add_ids(mm):
        level, attrs, inner = mm.group(1), mm.group(2), mm.group(3)
        return f'<h{level} id="{slugify(inner)}"{attrs}>{inner}</h{level}>'

    body_html = re.sub(r'<h([2-4])([^>]*)>(.*?)</h\1>', add_ids, body_html, flags=re.S)

    def section_head(mm):
        hid, inner = mm.group(1), mm.group(2)
        num = re.match(r'(\d+)\.\s*(.*)', inner)
        if not num:
            return mm.group(0)
        return (f'<section class="sec"><div class="sec-head">'
                f'<span class="sec-num">{num.group(1)}</span>'
                f'<h2 id="{hid}">{num.group(2)}</h2></div>')

    body_html = re.sub(r'<h2 id="([^"]+)"[^>]*>(.*?)</h2>', section_head, body_html, flags=re.S)
    body_html = body_html.replace('<section class="sec">', '</section><section class="sec">', 1000)
    if body_html.startswith('</section>'):
        body_html = body_html[len('</section>'):]
    body_html += '</section>'

    # ── 5. put diagrams and screenshots back ──
    def unstash(mm):
        return f'<figure class="dia"><pre class="mermaid">{htmllib.escape(diagrams[int(mm.group(1))])}</pre></figure>'

    body_html = re.sub(r'<p>MERMAIDPLACEHOLDER(\d+)ENDPLACEHOLDER</p>', unstash, body_html)
    body_html = re.sub(r'MERMAIDPLACEHOLDER(\d+)ENDPLACEHOLDER', unstash, body_html)

    def unstash_img(mm):
        alt, path = images[int(mm.group(1))]
        abs_path = (src.parent / path).resolve()      # Chrome needs a real path
        cap = f'<figcaption>{htmllib.escape(alt)}</figcaption>' if alt else ''
        return f'<figure class="shot"><img src="file://{abs_path}" alt="">{cap}</figure>'

    body_html = re.sub(r'<p>IMAGEPLACEHOLDER(\d+)ENDPLACEHOLDER</p>', unstash_img, body_html)
    body_html = re.sub(r'IMAGEPLACEHOLDER(\d+)ENDPLACEHOLDER', unstash_img, body_html)
    intro_html = re.sub(r'IMAGEPLACEHOLDER(\d+)ENDPLACEHOLDER', '', intro_html)

    body_html = body_html.replace('<hr />', '')

    today = datetime.date.today().strftime('%d %B %Y')
    logo = (BUILD / 'assets' / 'logo-dark-bg.svg').read_text()
    t1, t2, t3 = cfg['title_lines']
    meta = ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in cfg['meta'])

    HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{cfg['doc_title']}</title>
<link rel="stylesheet" href="assets/fonts.css">
<style>{CSS}</style>
</head><body>

<div class="cover">
  <div class="cover-logo">{logo}</div>
  <div class="cover-kicker">{cfg['kicker']}</div>
  <h1>{t1}<br><em>{t2} <i>{t3}</i></em></h1>
  <p class="cover-lede">{cfg['lede']}</p>
  <div class="cover-rule"></div>
  <div class="cover-meta">{meta}</div>
  <div class="cover-foot"><span>&copy; KGT Solutions</span><span><b>ai.kgt.solutions</b></span></div>
</div>

<div class="toc-page">
  <h1 class="page-title">Contents</h1>
  <p class="sub">{cfg['contents_sub']}</p>
  {contents_html}
  <div style="margin-top:9mm;padding-top:5mm;border-top:1px solid var(--line)">
  <div class="lede">{intro_html}</div>
  </div>
</div>

{body_html}

<div class="back">
  <div class="back-logo">{logo}</div>
  <h2>{cfg['back']['heading']}</h2>
  <div class="cover-rule"></div>
  <p>{cfg['back']['body']}</p>
  <div class="back-grid">{''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in cfg['back']['cards'])}</div>
  <div class="back-foot"><span>{cfg['back']['foot']}</span><span><b>ai.kgt.solutions</b></span></div>
</div>

<script src="assets/mermaid.min.js"></script>
<script>
mermaid.initialize({{
  startOnLoad: false, securityLevel: 'loose', flowchart: {{ htmlLabels: true, curve: 'basis', padding: 10 }},
  theme: 'base',
  themeVariables: {{
    fontFamily: 'Geist, system-ui, sans-serif', fontSize: '13px',
    primaryColor: '#EEF5FF', primaryTextColor: '#0A0B0F', primaryBorderColor: '#1364D8',
    secondaryColor: '#ECFDF3', secondaryBorderColor: '#22C55E', secondaryTextColor: '#0A0B0F',
    tertiaryColor: '#F7F9FC', tertiaryBorderColor: '#C9D3E2', tertiaryTextColor: '#22262F',
    lineColor: '#5596F3', textColor: '#22262F',
    mainBkg: '#EEF5FF', nodeBorder: '#1364D8', clusterBkg: '#FBFCFE', clusterBorder: '#D7DEEA',
    edgeLabelBackground: '#ffffff',
    actorBkg: '#EEF5FF', actorBorder: '#1364D8', actorTextColor: '#0A0B0F',
    signalColor: '#3A4150', signalTextColor: '#22262F',
    labelBoxBkgColor: '#ECFDF3', labelBoxBorderColor: '#22C55E', labelTextColor: '#0A0B0F',
    loopTextColor: '#22262F', altBackground: '#FBFCFE',
    noteBkgColor: '#ECFDF3', noteBorderColor: '#22C55E', noteTextColor: '#0A0B0F',
    sequenceNumberColor: '#fff'
  }}
}});
(async () => {{
  const nodes = document.querySelectorAll('pre.mermaid');
  if (nodes.length) await mermaid.run({{ querySelector: 'pre.mermaid' }});
  document.querySelectorAll('.dia svg').forEach(s => {{ s.removeAttribute('height'); s.style.maxWidth = '100%'; }});
  await Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => {{ i.onload = i.onerror = r; }})));
  window.__renderReady = true;
}})();
</script>
</body></html>
"""

    HEAD = HTML[:HTML.index('<body>') + len('<body>')]
    TAIL = HTML[HTML.index('<script src="assets/mermaid.min.js">'):]
    cover_html = HTML[HTML.index('<div class="cover">'):HTML.index('<div class="toc-page">')]
    back_html = HTML[HTML.index('<div class="back">'):HTML.index('<script src="assets/mermaid.min.js">')]
    body_inner = HTML[HTML.index('<div class="toc-page">'):HTML.index('<div class="back">')]

    prefix = cfg['prefix']
    # The base @page margin governs layout even when page.pdf asks for none,
    # which would fragment a full-page element across two layout pages.
    (BUILD / f'{prefix}-bleed.html').write_text(
        HEAD.replace('</head>', '<style>@page { size: A4; margin: 0; }</style></head>')
            .replace('<body>', '<body class="bleedpage" style="padding:0">')
        + cover_html + back_html
        + '<script>window.__renderReady = true;</script></body></html>')

    (BUILD / f'{prefix}-body.html').write_text(HEAD + body_inner + TAIL)
    print(f'{prefix}: wrote bleed + body html ({len(diagrams)} diagrams, {len(images)} figures)')

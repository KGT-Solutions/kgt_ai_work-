// PDF -> training documents: the upload counterpart to crawler.js, for the
// sites a crawl can't read (JS-only storefronts, bot-blocking CDNs) or reads
// badly. Produces the same "## Heading" markdown shape
// knowledgeLoader.parseIntoChunks expects, and the same {title, markdown}
// page shape crawlSite returns, so the registration wizard's review step and
// /complete treat an uploaded manual exactly like a crawled page.
//
// Uses pdfjs-dist directly rather than pdf-parse: pdf-parse 1.x bundles a
// 2017 PDF.js that predates CVE-2024-4367 (arbitrary JS via a crafted font),
// and pdf-parse 2.x requires Node >= 20.16 plus a native canvas binary.
// pdfjs-dist 4.2.67 is the first release with that CVE fixed that still
// runs on Node 18, and isEvalSupported:false below closes the same class of
// bug defensively. Going direct also exposes per-run font sizes, which is
// what makes heading detection below work on real manuals — a raw text dump
// has no way to tell "Directions" the heading from "Directions" the word.

const MAX_PDF_PAGES = 150;
const PARSE_BUDGET_MS = 15000; // pdf.js runs on the main thread in Node; don't let one upload hog it
const MAX_SECTION_WORDS = 350; // longer sections are split so a lexical hit lands on a focused chunk
const MAX_DOC_CHARS = 15000; // under publicRegister's 20k per-page ceiling, with room for edits
const MAX_DOCS = 10;

class PdfIngestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'PdfIngestError';
    this.statusCode = statusCode;
  }
}

let pdfjsPromise = null;
function loadPdfjs() {
  // ESM-only package; import lazily so requiring this module (e.g. from a
  // route file at boot) costs nothing until the first upload.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function isPdfBuffer(buffer) {
  // The %PDF- marker may legally sit anywhere in the first 1KB.
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes('%PDF-');
}

function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function countWords(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------
// Extraction: pdf.js text runs -> visual lines with a font size and y.
// ---------------------------------------------------------------------

function itemsToLines(items) {
  const lines = [];
  let current = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue; // marked-content markers
    const y = item.transform[5];
    const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 10) / 10 || item.height || 0;
    const sameLine = current && Math.abs(current.y - y) <= Math.max(current.size, size, 1) * 0.5;
    if (!sameLine && current) {
      lines.push(current);
      current = null;
    }
    if (!current) current = { text: '', size: 0, y };
    current.text += item.str;
    if (item.str.trim()) current.size = Math.max(current.size, size);
    if (item.hasEOL) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines
    .map((l) => ({ ...l, text: cleanText(l.text) }))
    .filter((l) => l.text);
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ title: string, pages: Array<Array<{text:string,size:number,y:number}>>, truncated: boolean }>}
 */
async function extractPdfLines(buffer) {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0
    }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw new PdfIngestError('That PDF is password-protected — please upload an unlocked copy', 400);
    }
    throw new PdfIngestError('That file could not be read as a PDF', 400);
  }

  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new PdfIngestError(`That PDF has ${doc.numPages} pages — the limit is ${MAX_PDF_PAGES}`, 413);
    }

    let title = '';
    try {
      const meta = await doc.getMetadata();
      title = cleanText(meta?.info?.Title);
    } catch {
      // metadata is optional; fall back to the filename in the caller
    }

    const deadline = Date.now() + PARSE_BUDGET_MS;
    const pages = [];
    let truncated = false;
    for (let n = 1; n <= doc.numPages; n++) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items));
      page.cleanup();
    }
    return { title, pages, truncated };
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------
// Lines -> sections. Everything below is pure (no pdf.js), so it's tested
// directly with hand-built line arrays.
// ---------------------------------------------------------------------

const BULLET_RE = /^[•●▪◦‣∙·■□➢➤✓✔\-–*]\s*/;
const PAGE_NUMBER_RE = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const NUMBERED_HEADING_RE = /^(\d{1,2}(\.\d{1,2})*\.?|[A-Z]\.)\s+[A-Z]/;

// Running headers/footers ("Acme Product Manual — Confidential", "Page 3")
// repeat on most pages and would otherwise be stitched into every section.
// Candidates must sit in a page's first/last EDGE_LINES lines (where
// running heads live) AND be no larger than body text — a catalog's
// "Directions" heading recurring right under the running header on every
// product page is set bigger than body text, and must never be dropped.
const EDGE_LINES = 2;

function findRunningHeadsAndFeet(pages, bodySize) {
  if (pages.length < 3) return () => false;
  const key = (t) => t.toLowerCase().replace(/\d+/g, '#');
  const isCandidate = (line, index, pageLength) =>
    (index < EDGE_LINES || index >= pageLength - EDGE_LINES) && line.size <= bodySize * 1.05;

  const seenOnPages = new Map();
  for (const lines of pages) {
    const keys = new Set(lines.filter((l, i) => isCandidate(l, i, lines.length)).map((l) => key(l.text)));
    for (const k of keys) seenOnPages.set(k, (seenOnPages.get(k) || 0) + 1);
  }
  const repeated = new Set();
  for (const [k, count] of seenOnPages) {
    if (count >= pages.length * 0.5) repeated.add(k);
  }
  return (line, index, pageLength) => isCandidate(line, index, pageLength) && repeated.has(key(line.text));
}

// The size most of the document's characters are set in — "body text."
function bodyFontSize(pages) {
  const weight = new Map();
  for (const lines of pages) {
    for (const l of lines) weight.set(l.size, (weight.get(l.size) || 0) + l.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

function isHeadingLine(line, bodySize) {
  const text = line.text;
  const words = countWords(text);
  if (BULLET_RE.test(text) || /[.,;]$/.test(text)) return false;
  // Bigger than body text: the strongest signal a PDF gives us.
  if (bodySize && line.size >= bodySize * 1.15 && words <= 14) return true;
  // FAQ PDFs: each question becomes its own chunk, which is exactly the
  // granularity the support bot's lexical search needs.
  if (/\?$/.test(text) && words <= 20 && /^[A-Z0-9"“]/.test(text)) return true;
  if (words > 10) return false;
  // Same-size headings: "INGREDIENTS", "3.2 Cleaning the filter"
  if (/[A-Z]{3}/.test(text) && text === text.toUpperCase()) return true;
  return NUMBERED_HEADING_RE.test(text);
}

/**
 * @param {Array<Array<{text:string,size:number,y:number}>>} pages
 * @param {string} defaultHeading heading for any text before the first detected heading
 * @returns {Array<{ heading: string, paragraphs: string[] }>}
 */
function linesToSections(pages, defaultHeading = 'Overview') {
  const bodySize = bodyFontSize(pages);
  const isRunningHeadOrFoot = findRunningHeadsAndFeet(pages, bodySize);

  const sections = [];
  let current = null;
  let para = null; // paragraph being assembled from wrapped lines
  let lastLine = null;
  let lastWasHeading = false;

  const flushPara = () => {
    if (para && para.trim()) {
      if (!current) current = { heading: defaultHeading, paragraphs: [] };
      current.paragraphs.push(para.trim());
    }
    para = null;
  };

  pages.forEach((lines, pageIndex) => {
    lines.forEach((line, lineIndex) => {
      const text = line.text;
      if (PAGE_NUMBER_RE.test(text) || isRunningHeadOrFoot(line, lineIndex, lines.length)) return;

      if (isHeadingLine(line, bodySize)) {
        flushPara();
        // A heading wrapped onto two lines arrives as two consecutive heading
        // lines of the same size — merge rather than emit an empty section.
        if (lastWasHeading && current && !current.paragraphs.length && Math.abs(lastLine.size - line.size) < 0.5) {
          current.heading = `${current.heading} ${text}`;
        } else {
          if (current && current.paragraphs.length) sections.push(current);
          current = { heading: text, paragraphs: [] };
        }
        lastWasHeading = true;
        lastLine = { ...line, pageIndex };
        return;
      }

      const bullet = BULLET_RE.test(text) && text.length > 1;
      const body = bullet ? text.replace(BULLET_RE, '') : text;
      const bigGap =
        lastLine && lastLine.pageIndex === pageIndex && Math.abs(lastLine.y - line.y) > Math.max(line.size, 1) * 1.8;
      const pageBreakAfterSentence = lastLine && lastLine.pageIndex !== pageIndex && /[.!?:]$/.test(para || '');

      if (!para || bullet || bigGap || pageBreakAfterSentence) {
        flushPara();
        para = bullet ? `- ${body}` : body;
      } else if (/[a-z]-$/.test(para) && /^[a-z]/.test(body)) {
        para = para.slice(0, -1) + body; // re-join a hyphenated line break: "ingre-" + "dients"
      } else {
        para = `${para} ${body}`;
      }
      lastWasHeading = false;
      lastLine = { ...line, pageIndex };
    });
  });
  flushPara();
  if (current && current.paragraphs.length) sections.push(current);

  return splitLongSections(sections);
}

function splitLongSections(sections) {
  const out = [];
  for (const section of sections) {
    let part = { heading: section.heading, paragraphs: [] };
    let words = 0;
    for (const p of section.paragraphs) {
      const w = countWords(p);
      if (part.paragraphs.length && words + w > MAX_SECTION_WORDS) {
        out.push(part);
        part = { heading: `${section.heading} (continued)`, paragraphs: [] };
        words = 0;
      }
      part.paragraphs.push(p);
      words += w;
    }
    if (part.paragraphs.length) out.push(part);
  }
  return out;
}

// Packs sections into as few documents as fit under MAX_DOC_CHARS each, so
// a long manual arrives in the wizard as a handful of editable parts rather
// than one textarea /complete would silently cut off at 20k characters.
function sectionsToDocuments(sections, title) {
  const docs = [];
  let buf = [];
  let len = 0;
  for (const s of sections) {
    const md = `## ${s.heading}\n\n${s.paragraphs.join('\n\n')}`;
    if (buf.length && len + md.length + 2 > MAX_DOC_CHARS) {
      docs.push(buf.join('\n\n'));
      buf = [];
      len = 0;
    }
    buf.push(md.length > MAX_DOC_CHARS ? md.slice(0, MAX_DOC_CHARS) : md);
    len += md.length + 2;
  }
  if (buf.length) docs.push(buf.join('\n\n'));

  const truncated = docs.length > MAX_DOCS;
  const kept = docs.slice(0, MAX_DOCS);
  return {
    truncated,
    documents: kept.map((markdown, i) => ({
      title: kept.length === 1 ? title : `${title} (part ${i + 1} of ${kept.length})`,
      markdown
    }))
  };
}

function titleFromFilename(filename) {
  const base = String(filename || '').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  return cleanText(base) || 'Uploaded PDF';
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<{ title: string, pages: Array<{ title: string, markdown: string }>, pdfPageCount: number, truncated: boolean }>}
 */
async function pdfToDocuments(buffer, filename) {
  if (!isPdfBuffer(buffer)) throw new PdfIngestError('That file is not a PDF', 400);

  const extracted = await extractPdfLines(buffer);
  const title = (extracted.title && extracted.title.length <= 120 ? extracted.title : '') || titleFromFilename(filename);
  const sections = linesToSections(extracted.pages, title);
  if (!sections.length) {
    throw new PdfIngestError(
      'No selectable text was found in that PDF — it may be a scanned image. Please upload a text-based PDF.',
      422
    );
  }

  const { documents, truncated } = sectionsToDocuments(sections, title);
  return {
    title,
    pages: documents,
    pdfPageCount: extracted.pages.length,
    truncated: truncated || extracted.truncated
  };
}

module.exports = { pdfToDocuments, PdfIngestError, linesToSections, isPdfBuffer, MAX_DOCS };

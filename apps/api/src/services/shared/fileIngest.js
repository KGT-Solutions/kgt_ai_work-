const path = require('path');
const yauzl = require('yauzl');
const mammoth = require('mammoth');

// Same polyfill as crawler.js: cheerio 1.x eagerly loads undici, which needs
// the global `File` that Node only provides from v20 (dev machines run 18).
if (typeof globalThis.File === 'undefined') globalThis.File = require('buffer').File;
const cheerio = require('cheerio');
const { pdfToDocuments, PdfIngestError, splitLongSections, sectionsToDocuments, cleanText } = require('./pdfIngest');

// Turns an uploaded file into knowledge pages — { title, markdown } each,
// the same shape as pdfIngest.js — for the signup wizard and the workspace
// Documents tab. Accepts:
//   .pdf               via pdfIngest.js
//   .docx              Word, via mammoth (headings, paragraphs, lists, tables)
//   .txt .md .markdown plain text; "#" headings become sections
//   .zip               any mix of the above, unpacked in memory, in one upload
// Every format ends in the same sections -> documents packing as PDFs, so a
// long file arrives as a few editable parts under the 20k-per-document cap.
//
// ZIP files come from untrusted visitors, so unpacking is bounded: entries
// are streamed and the bytes actually inflated are counted (a zip's declared
// sizes can lie), with caps on file count, per-file size and total size.
// Nested archives, folders, hidden and system files are skipped. Nothing is
// written to disk.

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;         // the upload itself (a zip)
const MAX_FILE_BYTES = 10 * 1024 * 1024;           // one document, uploaded or inside a zip
const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024;      // everything inflated from one zip
const MAX_ZIP_FILES = 40;                          // documents read from one zip
const MAX_ZIP_ENTRIES = 1000;                      // entries looked at, including skipped ones
const DOC_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'];
const ACCEPTED_EXTENSIONS = [...DOC_EXTENSIONS, '.zip'];

class FileIngestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const titleFromName = (name) => cleanText(path.basename(String(name || ''), extOf(name)).replace(/[_-]+/g, ' ')) || 'Uploaded document';

// ── Sections: [{ heading, paragraphs[] }], as pdfIngest's linesToSections makes.

function sectionsFromMarkdown(text, title) {
  const sections = [];
  let current = { heading: title, paragraphs: [] };
  let para = [];
  const flushPara = () => {
    const p = cleanText(para.join(' '));
    if (p) current.paragraphs.push(p);
    para = [];
  };
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      if (current.paragraphs.length) sections.push(current);
      current = { heading: cleanText(heading[1]), paragraphs: [] };
    } else if (!line) {
      flushPara();
    } else if (/^([-*•]|\d+[.)])\s+/.test(line)) {
      flushPara(); // a list item is its own line
      current.paragraphs.push(`- ${cleanText(line.replace(/^([-*•]|\d+[.)])\s+/, ''))}`);
    } else {
      para.push(line);
    }
  }
  flushPara();
  if (current.paragraphs.length) sections.push(current);
  return sections;
}

async function docxSections(buffer, title) {
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer }));
  } catch {
    throw new FileIngestError('That Word file could not be read — it may be damaged, or an older .doc file. Save it as .docx or PDF and try again.', 422);
  }
  const $ = cheerio.load(html || '');
  const sections = [];
  let current = { heading: title, paragraphs: [] };
  $('body').children().each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const text = cleanText($(el).text());
    if (!text) return;
    if (/^h[1-6]$/.test(tag)) {
      if (current.paragraphs.length) sections.push(current);
      current = { heading: text, paragraphs: [] };
    } else if (tag === 'ul' || tag === 'ol') {
      $(el).find('li').each((__, li) => { const t = cleanText($(li).text()); if (t) current.paragraphs.push(`- ${t}`); });
    } else if (tag === 'table') {
      $(el).find('tr').each((__, tr) => {
        const cells = $(tr).find('th,td').map((___, c) => cleanText($(c).text())).get().filter(Boolean);
        if (cells.length) current.paragraphs.push(cells.join(' | '));
      });
    } else {
      current.paragraphs.push(text);
    }
  });
  if (current.paragraphs.length) sections.push(current);
  return sections;
}

function toPages(sections, title, emptyMessage) {
  if (!sections.length) throw new FileIngestError(emptyMessage, 422);
  const { documents, truncated } = sectionsToDocuments(splitLongSections(sections), title);
  return { pages: documents, truncated };
}

/**
 * One document file (not a zip).
 * @returns {Promise<{ title: string, pages: Array<{ title: string, markdown: string }>, truncated: boolean }>}
 * @throws {FileIngestError | PdfIngestError}
 */
async function ingestDocument(buffer, filename) {
  const ext = extOf(filename);
  const title = titleFromName(filename);
  if (buffer.length > MAX_FILE_BYTES) throw new FileIngestError(`${path.basename(filename)} is larger than ${MAX_FILE_BYTES / (1024 * 1024)}MB`, 413);
  if (ext === '.pdf') {
    const r = await pdfToDocuments(buffer, filename);
    return { title: r.title, pages: r.pages, truncated: r.truncated };
  }
  if (ext === '.docx') {
    return { title, ...toPages(await docxSections(buffer, title), title, 'No text was found in that Word file.') };
  }
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new FileIngestError(`${path.basename(filename)} doesn't look like a text file.`, 422);
    return { title, ...toPages(sectionsFromMarkdown(text, title), title, 'That file is empty.') };
  }
  throw new FileIngestError(`Unsupported file type "${ext || path.basename(filename)}". Use PDF, Word (.docx), .txt, .md or a .zip of them.`, 415);
}

// ── ZIP

const skipReason = (name) => {
  const base = path.basename(name);
  if (name.endsWith('/')) return 'folder';
  if (name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')) return 'hidden or system file';
  if (base.startsWith('~$')) return 'Office temporary file';
  const ext = extOf(name);
  if (ext === '.zip') return 'archives inside archives are not opened';
  if (!DOC_EXTENSIONS.includes(ext)) return 'unsupported type';
  return null;
};

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

// Reads one entry, counting the bytes actually inflated against both limits.
function readEntry(zip, entry, budget) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const parts = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        budget.used += chunk.length;
        if (size > MAX_FILE_BYTES) {
          // This file only: the zip says it's smaller than it inflates to.
          stream.destroy(Object.assign(new FileIngestError(`larger than ${MAX_FILE_BYTES / (1024 * 1024)}MB`, 413), { fileOnly: true }));
        } else if (budget.used > MAX_ZIP_TOTAL_BYTES) {
          stream.destroy(new FileIngestError(`The zip unpacks to more than ${MAX_ZIP_TOTAL_BYTES / (1024 * 1024)}MB. Upload fewer files at a time.`, 413));
        } else {
          parts.push(chunk);
        }
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(parts)));
    });
  });
}

/**
 * @returns {Promise<{ pages: object[], files: Array<{ name: string, ok: boolean, pages?: number, truncated?: boolean, reason?: string }> }>}
 */
async function ingestZip(buffer) {
  let zip;
  try {
    zip = await openZip(buffer);
  } catch {
    throw new FileIngestError('That .zip file could not be opened — it may be damaged or password-protected.', 422);
  }
  const budget = { used: 0 };
  const pages = [];
  const files = [];
  let entries = 0;
  let read = 0;

  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', async (entry) => {
        try {
          entries += 1;
          if (entries > MAX_ZIP_ENTRIES) throw new FileIngestError(`The zip has more than ${MAX_ZIP_ENTRIES} entries.`, 413);
          const name = entry.fileName;
          const reason = skipReason(name);
          if (reason) {
            if (reason !== 'folder' && reason !== 'hidden or system file') files.push({ name, ok: false, reason });
          } else if (read >= MAX_ZIP_FILES) {
            files.push({ name, ok: false, reason: `only the first ${MAX_ZIP_FILES} documents are read` });
          } else if (entry.uncompressedSize > MAX_FILE_BYTES) {
            files.push({ name, ok: false, reason: `larger than ${MAX_FILE_BYTES / (1024 * 1024)}MB` });
          } else {
            read += 1;
            let data = null;
            try {
              data = await readEntry(zip, entry, budget);
            } catch (err) {
              if (!err.fileOnly) throw err; // over the whole zip's budget, or unreadable: stop
              files.push({ name, ok: false, reason: err.message });
            }
            if (data) try {
              const doc = await ingestDocument(data, name);
              pages.push(...doc.pages.map((p) => ({ ...p, sourceFile: name })));
              files.push({ name, ok: true, pages: doc.pages.length, truncated: doc.truncated });
            } catch (err) {
              if (!(err instanceof FileIngestError || err instanceof PdfIngestError)) throw err;
              files.push({ name, ok: false, reason: err.message });
            }
          }
          zip.readEntry();
        } catch (err) {
          reject(err);
        }
      });
      zip.readEntry();
    });
  } catch (err) {
    if (err instanceof FileIngestError) throw err;
    throw new FileIngestError('That .zip file could not be read completely — it may be damaged.', 422);
  } finally {
    zip.close();
  }

  if (!pages.length) {
    throw new FileIngestError(files.length
      ? `No readable documents in that zip (${files.map((f) => `${path.basename(f.name)}: ${f.reason}`).slice(0, 3).join('; ')}).`
      : 'That zip contains no PDF, Word, .txt or .md files.', 422);
  }
  return { pages, files };
}

/**
 * Any accepted upload — a document or a zip of them.
 * @returns {Promise<{ pages: Array<{ title: string, markdown: string, sourceFile: string }>,
 *   files: Array<{ name: string, ok: boolean, pages?: number, truncated?: boolean, reason?: string }> }>}
 *   files: what happened to each file (one entry for a single document)
 * @throws {FileIngestError | PdfIngestError} the upload as a whole is unusable
 */
async function ingestUpload(buffer, filename) {
  const ext = extOf(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new FileIngestError(`Unsupported file type "${ext || filename}". Use PDF, Word (.docx), .txt, .md or a .zip of them.`, 415);
  }
  if (buffer.length > MAX_UPLOAD_BYTES) throw new FileIngestError(`Uploads are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`, 413);
  if (ext === '.zip') return ingestZip(buffer);
  const doc = await ingestDocument(buffer, filename);
  return {
    pages: doc.pages.map((p) => ({ ...p, sourceFile: filename })),
    files: [{ name: filename, ok: true, pages: doc.pages.length, truncated: doc.truncated }]
  };
}

module.exports = {
  ingestUpload, ingestDocument, sectionsFromMarkdown, FileIngestError,
  ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_FILE_BYTES, MAX_ZIP_FILES, MAX_ZIP_TOTAL_BYTES
};

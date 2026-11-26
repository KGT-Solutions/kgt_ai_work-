// Minimal, dependency-free .xlsx (Office Open XML) workbook reader for product-
// catalog uploads — the spreadsheet counterpart to csvCatalog.js. An .xlsx file
// is just a ZIP of XML parts, so it is unpacked with the yauzl reader already
// used for .docx/.zip (services/shared/fileIngest.js) and parsed with the
// cheerio already used for HTML, rather than pulling in a heavy spreadsheet
// dependency (SheetJS/exceljs) with its own advisory history. Deliberately
// small and defensive: only the parts a flat catalog needs are read, every
// limit is explicit, and anything malformed is skipped, never thrown blindly.
//
// Two steps, mirroring the feature's "inspect, then import" flow:
//   inspectWorkbook(buffer)          -> sheets, their headers and a few sample
//                                       rows, so the owner can PREVIEW and pick.
//   extractProductsFromWorkbook(...) -> the chosen sheet + column→field mapping
//                                       turned into the SAME product rows
//                                       csvCatalog produces, so the rest of the
//                                       catalog pipeline (catalogIngest.js) is
//                                       untouched and the strict price rule /
//                                       grounded retrieval keep working.
//
// .xls (the old binary BIFF format) is NOT supported — it cannot be read cleanly
// without a large dependency; the caller tells the owner to save it as .xlsx.

const yauzl = require('yauzl');
if (typeof globalThis.File === 'undefined') globalThis.File = require('buffer').File; // cheerio→undici, as in crawler.js
const cheerio = require('cheerio');

// Abuse ceilings. A real catalog upload stays far under all of these; they exist
// so a hostile or runaway file can't exhaust memory/CPU.
const MAX_XLSX_BYTES = 10 * 1024 * 1024;        // the uploaded file itself
const MAX_INFLATED_BYTES = 80 * 1024 * 1024;    // everything we inflate from it (zip-bomb guard)
const MAX_ZIP_ENTRIES = 2000;                   // parts looked at inside the archive
const MAX_SHEETS = 30;                           // sheets inspected
const MAX_ROWS = 5000;                           // data rows read per sheet (matches csvCatalog)
const MAX_COLS = 200;                            // columns read per row
const MAX_CELL_LEN = 2000;                       // one cell (matches csvCatalog MAX_FIELD_LEN)
const MAX_SAMPLE_ROWS = 10;                      // preview rows returned per sheet

// Fields a catalog column can map to. `name` is the only required mapping; a SKU
// is generated from the name when its column is left unmapped (same leniency the
// auto-extractor uses), so a plain "item + price" sheet imports cleanly.
const MAPPABLE_FIELDS = ['name', 'sku', 'price', 'description', 'category', 'imageUrl', 'productUrl'];

class XlsxCatalogError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'XlsxCatalogError';
    this.statusCode = statusCode;
  }
}

// ── ZIP: inflate only the parts we need, under one global byte budget. Modelled
// on fileIngest.readEntry — the bytes actually inflated are counted (a zip's
// declared sizes can lie), and a stream is destroyed the moment the budget is
// passed. Returns { name -> utf8 string } for entries the predicate accepts.
function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function readWantedEntries(buffer, wanted) {
  return new Promise((resolve, reject) => {
    openZip(buffer).then((zip) => {
      const out = new Map();
      let used = 0;
      let entries = 0;
      const fail = (err) => { try { zip.close(); } catch { /* already closing */ } reject(err); };
      zip.on('error', fail);
      zip.on('end', () => { zip.close(); resolve(out); });
      zip.on('entry', (entry) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) return fail(new XlsxCatalogError('That spreadsheet has too many internal parts to be a real workbook.', 413));
        const name = entry.fileName;
        if (name.endsWith('/') || !wanted(name)) return zip.readEntry(); // a folder or a part we don't need
        if (used + entry.uncompressedSize > MAX_INFLATED_BYTES) return fail(new XlsxCatalogError(`That spreadsheet expands to more than ${MAX_INFLATED_BYTES / (1024 * 1024)}MB. Split it into smaller files.`, 413));
        return zip.openReadStream(entry, (err, stream) => {
          if (err) return fail(err);
          const parts = [];
          stream.on('data', (chunk) => {
            used += chunk.length;
            if (used > MAX_INFLATED_BYTES) stream.destroy(new XlsxCatalogError(`That spreadsheet expands to more than ${MAX_INFLATED_BYTES / (1024 * 1024)}MB. Split it into smaller files.`, 413));
            else parts.push(chunk);
          });
          stream.on('error', fail);
          stream.on('end', () => { out.set(name, Buffer.concat(parts).toString('utf8')); zip.readEntry(); });
        });
      });
      zip.readEntry();
    }).catch(() => reject(new XlsxCatalogError('That file could not be read as an .xlsx workbook — it may be damaged, password-protected, or an older .xls file. Save it as .xlsx and try again.', 422)));
  });
}

const loadXml = (xml) => cheerio.load(xml || '', { xmlMode: true, decodeEntities: true });

// A1-style column reference -> zero-based column index ("A"->0, "AB"->27).
function colIndexFromRef(ref) {
  const m = /^([A-Za-z]+)\d+$/.exec(String(ref || ''));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const clampCell = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_LEN);

// ── Shared strings: <sst><si>…</si></sst>, index-addressable from cells with t="s".
// Each <si> is either a bare <t> or a set of rich-text runs <r><t>; joining all
// descendant <t> text reconstructs the cell's visible string either way.
function parseSharedStrings(xml) {
  if (!xml) return [];
  const $ = loadXml(xml);
  const out = [];
  $('si').each((_, el) => out.push($(el).find('t').text()));
  return out;
}

// ── Workbook: sheet names + their r:id, in document (tab) order.
function parseWorkbook(xml) {
  const $ = loadXml(xml);
  const sheets = [];
  $('sheets > sheet, sheet').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    const rid = $el.attr('r:id') || $el.attr('r:Id') || $el.attr('id');
    if (name) sheets.push({ name, rid });
  });
  return sheets;
}

// ── Relationships: r:id -> the worksheet part's path inside the archive.
function parseRels(xml) {
  const $ = loadXml(xml);
  const map = new Map();
  $('Relationship, relationship').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('Id') || $el.attr('id');
    let target = $el.attr('Target') || $el.attr('target');
    if (!id || !target) return;
    target = target.replace(/^\/+/, '').replace(/^\.\.\//, '');
    if (!target.startsWith('xl/')) target = `xl/${target}`;
    map.set(id, target);
  });
  return map;
}

// ── One worksheet -> an array of rows, each an array of cell strings positioned
// by column index (gaps filled with ''). Bounded by MAX_ROWS / MAX_COLS.
function parseSheet(xml, sharedStrings) {
  const $ = loadXml(xml);
  const rows = [];
  $('sheetData > row, row').each((_, rowEl) => {
    if (rows.length >= MAX_ROWS) return;
    const cells = [];
    let maxIdx = -1;
    $(rowEl).find('c').each((__, cEl) => {
      const $c = $(cEl);
      let idx = colIndexFromRef($c.attr('r'));
      if (idx < 0) idx = maxIdx + 1; // a cell with no ref: assume the next column
      if (idx >= MAX_COLS) return;
      const type = $c.attr('t');
      let value = '';
      if (type === 's') {
        const i = Number($c.find('v').first().text());
        value = Number.isInteger(i) && sharedStrings[i] != null ? sharedStrings[i] : '';
      } else if (type === 'inlineStr') {
        value = $c.find('is t').text();
      } else if (type === 'str') {
        value = $c.find('v').first().text(); // formula result string
      } else {
        value = $c.find('v').first().text(); // number / date serial / boolean
      }
      cells[idx] = clampCell(value);
      if (idx > maxIdx) maxIdx = idx;
    });
    for (let i = 0; i <= maxIdx; i++) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
  });
  return rows;
}

const WANTED = (name) => name === 'xl/workbook.xml'
  || name === 'xl/_rels/workbook.xml.rels'
  || name === 'xl/sharedStrings.xml'
  || /^xl\/worksheets\/[^/]+\.xml$/.test(name);

async function loadWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new XlsxCatalogError('No spreadsheet file was provided.');
  if (buffer.length > MAX_XLSX_BYTES) throw new XlsxCatalogError(`The spreadsheet is too large (limit ${MAX_XLSX_BYTES / (1024 * 1024)}MB).`, 413);
  // Quick magic-byte sanity check: every .xlsx (a ZIP) starts with "PK".
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new XlsxCatalogError('That does not look like an .xlsx workbook. If it is an older .xls file, save it as .xlsx and try again.', 415);
  }
  const files = await readWantedEntries(buffer, WANTED);
  const workbookXml = files.get('xl/workbook.xml');
  if (!workbookXml) throw new XlsxCatalogError('That .xlsx workbook is missing its workbook definition and cannot be read.', 422);

  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml'));
  const rels = parseRels(files.get('xl/_rels/workbook.xml.rels') || '');
  const sheetDefs = parseWorkbook(workbookXml).slice(0, MAX_SHEETS);

  const sheets = [];
  let fallbackIdx = 0;
  for (const def of sheetDefs) {
    let path = def.rid ? rels.get(def.rid) : null;
    if (!path || !files.has(path)) {
      // No/stale relationship: fall back to worksheets in file order.
      const names = [...files.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort();
      path = names[fallbackIdx];
    }
    fallbackIdx += 1;
    const xml = path ? files.get(path) : null;
    sheets.push({ name: def.name, rows: xml ? parseSheet(xml, sharedStrings) : [] });
  }
  if (!sheets.length) throw new XlsxCatalogError('No worksheets were found in that .xlsx file.', 422);
  return sheets;
}

/**
 * PREVIEW step: the workbook's sheets, their header row and a few sample rows,
 * so the owner can choose which sheet and map columns before importing.
 * @returns {Promise<{ sheets: Array<{ index:number, name:string, rowCount:number, columnCount:number, headers:string[], sampleRows:string[][] }> }>}
 */
async function inspectWorkbook(buffer) {
  const sheets = await loadWorkbook(buffer);
  return {
    sheets: sheets.map((sheet, index) => {
      const headers = sheet.rows[0] || [];
      const columnCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
      return {
        index,
        name: sheet.name || `Sheet ${index + 1}`,
        rowCount: sheet.rows.length,
        columnCount,
        headers: headers.map((h, i) => clampCell(h) || `Column ${i + 1}`),
        sampleRows: sheet.rows.slice(1, 1 + MAX_SAMPLE_ROWS)
      };
    })
  };
}

const slugSku = (name) => String(name || '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

// Validates one sheet selection: { index, headerRow?, mapping: { field: columnIndex } }.
function normalizeSelection(sel) {
  const index = Number(sel?.index);
  if (!Number.isInteger(index) || index < 0) throw new XlsxCatalogError('A sheet to import must be chosen.');
  const headerRow = Number.isInteger(Number(sel?.headerRow)) && Number(sel.headerRow) >= 0 ? Number(sel.headerRow) : 0;
  const rawMap = sel?.mapping && typeof sel.mapping === 'object' ? sel.mapping : {};
  const mapping = {};
  for (const field of MAPPABLE_FIELDS) {
    const col = Number(rawMap[field]);
    if (Number.isInteger(col) && col >= 0 && col < MAX_COLS) mapping[field] = col;
  }
  if (mapping.name === undefined) throw new XlsxCatalogError('Map a column to the product/item name before importing.');
  return { index, headerRow, mapping };
}

/**
 * IMPORT step: turn the chosen sheet(s) + column mapping into catalog product
 * rows — the SAME shape csvCatalog.parseCatalogCsv returns, so catalogIngest can
 * import them unchanged. Price is carried through verbatim (ranges, "POA" and
 * currency symbols all stay valid), keeping the strict price rule accurate.
 * @param {Buffer} buffer
 * @param {{ sheets: Array<{ index:number, headerRow?:number, mapping:object }> }} selections
 * @returns {Promise<{ products: Array<object>, skipped: number, rows: number }>}
 */
async function extractProductsFromWorkbook(buffer, selections) {
  const list = Array.isArray(selections?.sheets) ? selections.sheets : [];
  if (!list.length) throw new XlsxCatalogError('Choose at least one sheet to import.');
  const sheets = await loadWorkbook(buffer);
  const chosen = list.map(normalizeSelection);

  const products = [];
  let skipped = 0;
  let rows = 0;
  for (const { index, headerRow, mapping } of chosen) {
    const sheet = sheets[index];
    if (!sheet) throw new XlsxCatalogError(`That workbook has no sheet #${index + 1}.`);
    const dataRows = sheet.rows.slice(headerRow + 1);
    if (products.length + dataRows.length > MAX_ROWS) throw new XlsxCatalogError(`Too many rows (limit ${MAX_ROWS}). Split the catalog into smaller files.`, 413);
    const pick = (row, field) => (mapping[field] === undefined ? '' : clampCell(row[mapping[field]]));
    for (const row of dataRows) {
      if (!row.some((c) => String(c || '').trim() !== '')) continue; // blank line
      rows += 1;
      const name = pick(row, 'name');
      if (!name) { skipped += 1; continue; } // a product needs at least a name
      products.push({
        name,
        sku: pick(row, 'sku') || slugSku(name),
        price: pick(row, 'price'),
        description: pick(row, 'description'),
        category: pick(row, 'category'),
        imageUrl: pick(row, 'imageUrl'),
        productUrl: pick(row, 'productUrl')
      });
    }
  }
  if (!products.length) throw new XlsxCatalogError('No usable product rows — every row was missing a value in the name column.');
  return { products, skipped, rows };
}

module.exports = {
  inspectWorkbook,
  extractProductsFromWorkbook,
  XlsxCatalogError,
  MAPPABLE_FIELDS,
  MAX_XLSX_BYTES,
  MAX_SHEETS,
  MAX_ROWS,
  // exported for tests
  colIndexFromRef
};

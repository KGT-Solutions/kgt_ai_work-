const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const yazl = require('yazl');

const { inspectWorkbook, extractProductsFromWorkbook, XlsxCatalogError, colIndexFromRef } = require('../../src/services/shared/xlsxCatalog');

// Build a real .xlsx (a ZIP of the OOXML parts the reader needs) in memory with
// yazl, so these tests exercise the actual unzip + XML parse path end to end —
// no fixture files, no network, no spreadsheet dependency.
function buildXlsx(sheets) {
  // sheets: [{ name, rows: [[cell, ...], ...] }]. A string cell goes through the
  // shared-strings table (t="s"); a number cell is written inline.
  const shared = [];
  const sharedIndex = (s) => { let i = shared.indexOf(s); if (i < 0) { i = shared.length; shared.push(s); } return i; };
  const colLetter = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  const sheetXmls = sheets.map((sheet) => {
    const rowsXml = sheet.rows.map((row, ri) => {
      const cells = row.map((val, ci) => {
        const ref = `${colLetter(ci)}${ri + 1}`;
        if (val === '' || val == null) return '';
        if (typeof val === 'number') return `<c r="${ref}"><v>${val}</v></c>`;
        return `<c r="${ref}" t="s"><v>${sharedIndex(String(val))}</v></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  });

  const sheetTags = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  const sstXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`;

  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(workbookXml), 'xl/workbook.xml');
    zip.addBuffer(Buffer.from(relsXml), 'xl/_rels/workbook.xml.rels');
    zip.addBuffer(Buffer.from(sstXml), 'xl/sharedStrings.xml');
    sheetXmls.forEach((xml, i) => zip.addBuffer(Buffer.from(xml), `xl/worksheets/sheet${i + 1}.xml`));
    const chunks = [];
    zip.outputStream.on('data', (c) => chunks.push(c));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

const CATALOG = [
  ['Item', 'Code', 'Price', 'Details', 'Type'],
  ['Blue Widget', 'WID-1', 19.99, 'A sturdy blue widget', 'Widgets'],
  ['Red Gadget', 'GAD-2', 149, 'Top-of-the-line gadget', 'Gadgets'],
  ['', '', '', '', ''],            // a blank row — must be ignored
  ['Nameless', '', 5, 'no name col value here is fine', 'Misc']
];

describe('xlsxCatalog: colIndexFromRef', () => {
  test('A1-style refs map to zero-based column indices', () => {
    assert.equal(colIndexFromRef('A1'), 0);
    assert.equal(colIndexFromRef('B3'), 1);
    assert.equal(colIndexFromRef('AA10'), 26);
    assert.equal(colIndexFromRef('bad'), -1);
  });
});

describe('xlsxCatalog: inspectWorkbook (preview)', () => {
  test('returns each sheet, its headers and sample rows', async () => {
    const buf = await buildXlsx([
      { name: 'Products', rows: CATALOG },
      { name: 'Notes', rows: [['heading'], ['just a note']] }
    ]);
    const { sheets } = await inspectWorkbook(buf);
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0].name, 'Products');
    assert.deepEqual(sheets[0].headers, ['Item', 'Code', 'Price', 'Details', 'Type']);
    assert.equal(sheets[0].rowCount, CATALOG.length);
    // Sample rows are the data rows (header excluded); numbers come through as text.
    assert.equal(sheets[0].sampleRows[0][0], 'Blue Widget');
    assert.equal(sheets[0].sampleRows[0][2], '19.99');
    assert.equal(sheets[1].name, 'Notes');
  });

  test('rejects a non-xlsx buffer with a clear error', async () => {
    await assert.rejects(() => inspectWorkbook(Buffer.from('not a zip at all')), (e) => e instanceof XlsxCatalogError && e.statusCode === 415);
  });
});

describe('xlsxCatalog: extractProductsFromWorkbook (import mapping)', () => {
  test('maps the chosen sheet columns to product rows; price kept verbatim', async () => {
    const buf = await buildXlsx([{ name: 'Products', rows: CATALOG }]);
    const { products, skipped } = await extractProductsFromWorkbook(buf, {
      sheets: [{ index: 0, headerRow: 0, mapping: { name: 0, sku: 1, price: 2, description: 3, category: 4 } }]
    });
    assert.equal(products.length, 3); // two full rows + the nameless-but-present row (blank row dropped)
    assert.deepEqual(products[0], {
      name: 'Blue Widget', sku: 'WID-1', price: '19.99', description: 'A sturdy blue widget',
      category: 'Widgets', imageUrl: '', productUrl: ''
    });
    assert.equal(products[1].price, '149'); // integer price kept as text, no rounding/currency guessing
    // The third row has a name but no SKU value → SKU generated from the name.
    assert.equal(products[2].name, 'Nameless');
    assert.equal(products[2].sku, 'nameless');
    assert.equal(skipped, 0);
  });

  test('a row with no value in the name column is skipped, not imported', async () => {
    const buf = await buildXlsx([{ name: 'S', rows: [['Item', 'Price'], ['', 10], ['Only Price', 20]] }]);
    const { products, skipped } = await extractProductsFromWorkbook(buf, { sheets: [{ index: 0, mapping: { name: 0, price: 1 } }] });
    assert.equal(products.length, 1);
    assert.equal(products[0].name, 'Only Price');
    assert.equal(skipped, 1);
  });

  test('a mapping without a name column is refused', async () => {
    const buf = await buildXlsx([{ name: 'S', rows: [['Price'], [10]] }]);
    await assert.rejects(() => extractProductsFromWorkbook(buf, { sheets: [{ index: 0, mapping: { price: 0 } }] }),
      (e) => e instanceof XlsxCatalogError);
  });

  test('an empty selection is refused', async () => {
    const buf = await buildXlsx([{ name: 'S', rows: [['Item'], ['x']] }]);
    await assert.rejects(() => extractProductsFromWorkbook(buf, { sheets: [] }), (e) => e instanceof XlsxCatalogError);
  });
});

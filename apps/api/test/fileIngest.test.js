const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const yazl = require('yazl');

// services/shared/fileIngest.js: .txt / .md / .docx / .zip uploads become
// knowledge pages, and zips are unpacked within strict limits. Fixtures
// (a real .docx and real zips) are built in memory with yazl.

const { ingestUpload, FileIngestError, MAX_FILE_BYTES } = require('../src/services/shared/fileIngest');

/** A zip of { name: string|Buffer } (compressed). */
function makeZip(entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
    zip.end();
    const parts = [];
    zip.outputStream.on('data', (c) => parts.push(c)).on('end', () => resolve(Buffer.concat(parts))).on('error', reject);
  });
}

/** A minimal, valid Word document with the given <w:body> XML. */
function makeDocx(bodyXml) {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${w}><w:body>${bodyXml}</w:body></w:document>`
  });
}
const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc>${p(text)}</w:tc>`;

describe('single documents', () => {
  test('.md: "#" headings become sections; list items stay list items', async () => {
    const r = await ingestUpload(Buffer.from('# Returns\nYou can return items\nwithin 30 days.\n\n# Shipping\n- Free over ₹999\n- 3-5 days'), 'policies.md');
    assert.equal(r.pages.length, 1);
    assert.equal(r.pages[0].title, 'policies');
    assert.equal(r.pages[0].sourceFile, 'policies.md');
    assert.match(r.pages[0].markdown, /## Returns\n\nYou can return items within 30 days\./);
    assert.match(r.pages[0].markdown, /## Shipping\n\n- Free over ₹999\n\n- 3-5 days/);
    assert.deepEqual(r.files, [{ name: 'policies.md', ok: true, pages: 1, truncated: false }]);
  });

  test('.txt without headings is one section named after the file', async () => {
    const r = await ingestUpload(Buffer.from('We are open 9am to 6pm, Monday to Saturday.'), 'support_hours.txt');
    assert.match(r.pages[0].markdown, /^## support hours\n\nWe are open 9am/);
  });

  test('.docx: headings, paragraphs, lists and tables', async () => {
    const docx = await makeDocx(
      p('Warranty', 'Heading1') + p('Every device has a two year warranty.') +
      p('Plans', 'Heading1') + `<w:tbl><w:tr>${cell('Plan')}${cell('Price')}</w:tr><w:tr>${cell('Pro')}${cell('₹999')}</w:tr></w:tbl>`
    );
    const r = await ingestUpload(docx, 'Acme Handbook.docx');
    const md = r.pages[0].markdown;
    assert.equal(r.pages[0].title, 'Acme Handbook');
    assert.match(md, /## Warranty\n\nEvery device has a two year warranty\./);
    assert.match(md, /## Plans\n\nPlan \| Price\n\nPro \| ₹999/);
  });

  test('a long document arrives as several parts under the per-document cap', async () => {
    const sections = Array.from({ length: 60 }, (_, i) => `# Topic ${i}\n${'Detailed explanation sentence. '.repeat(40)}`).join('\n\n');
    const r = await ingestUpload(Buffer.from(sections), 'manual.md');
    assert.ok(r.pages.length > 1);
    assert.ok(r.pages.every((pg) => pg.markdown.length <= 15000));
    assert.match(r.pages[0].title, /^manual \(part 1 of \d+\)$/);
  });

  test('unsupported, damaged or binary files are refused with a clear message', async () => {
    await assert.rejects(ingestUpload(Buffer.from('MZ'), 'setup.exe'), (e) => e instanceof FileIngestError && e.statusCode === 415);
    await assert.rejects(ingestUpload(Buffer.from('not a word file'), 'broken.docx'), (e) => e.statusCode === 422 && /could not be read/.test(e.message));
    await assert.rejects(ingestUpload(Buffer.from('abc\u0000def'), 'data.txt'), (e) => e.statusCode === 422);
    await assert.rejects(ingestUpload(Buffer.from('not a zip'), 'docs.zip'), (e) => e.statusCode === 422 && /could not be opened/.test(e.message));
  });
});

describe('.zip uploads', () => {
  test('every supported document is read; the rest are listed with the reason they were skipped', async () => {
    const zip = await makeZip({
      'faq.txt': '# Opening hours\nWe open at 9am.',
      'guides/setup.md': '# Setup\nPlug it in.',
      'handbook.docx': await makeDocx(p('Refunds', 'Heading1') + p('Refunds take 5 days.')),
      'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'old.zip': 'PK',
      '__MACOSX/._faq.txt': 'mac metadata',
      '.DS_Store': 'x',
      '~$handbook.docx': 'lock file'
    });
    const r = await ingestUpload(zip, 'company-docs.zip');
    assert.deepEqual(r.pages.map((pg) => pg.sourceFile).sort(), ['faq.txt', 'guides/setup.md', 'handbook.docx']);
    assert.ok(r.pages.some((pg) => /## Refunds\n\nRefunds take 5 days\./.test(pg.markdown)));
    const skipped = Object.fromEntries(r.files.filter((f) => !f.ok).map((f) => [f.name, f.reason]));
    assert.deepEqual(skipped, {
      'logo.png': 'unsupported type',
      'old.zip': 'archives inside archives are not opened',
      '~$handbook.docx': 'Office temporary file'
    }, 'hidden and system files are skipped silently');
  });

  test('a file that inflates past the per-file limit is skipped; the others still load', async () => {
    const zip = await makeZip({ 'huge.txt': Buffer.alloc(MAX_FILE_BYTES + 1024, 0x61), 'ok.txt': 'Fine.' });
    const r = await ingestUpload(zip, 'mixed.zip');
    assert.deepEqual(r.pages.map((pg) => pg.sourceFile), ['ok.txt']);
    assert.match(r.files.find((f) => f.name === 'huge.txt').reason, /larger than 10MB/);
  });

  test('a zip bomb is stopped once the total inflated size passes the limit', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 0x20); // 9MB of spaces compresses to a few KB
    const entries = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`part${i}.txt`, big]));
    const zip = await makeZip(entries);
    assert.ok(zip.length < 1024 * 1024, 'tiny on the wire');
    await assert.rejects(ingestUpload(zip, 'bomb.zip'), (e) => e.statusCode === 413 && /unpacks to more than 60MB/.test(e.message));
  });

  test('a zip with no usable documents is refused, naming what was in it', async () => {
    const zip = await makeZip({ 'photo.jpg': 'x', 'sheet.xlsx': 'y' });
    await assert.rejects(ingestUpload(zip, 'media.zip'), (e) => e.statusCode === 422 && /photo\.jpg: unsupported type/.test(e.message));
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { pdfToDocuments, linesToSections, isPdfBuffer, PdfIngestError } = require('../src/services/shared/pdfIngest');

// Builds a minimal but valid PDF (correct xref offsets, Helvetica) where each
// page is a list of { text, size, y } runs — enough to exercise real pdf.js
// extraction, font-size heading detection, and page handling without
// checking binary fixtures into the repo.
function makePdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;

  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = pages.map((runs) => {
    const stream = runs.map((r) => `BT /F1 ${r.size} Tf 72 ${r.y} Td (${esc(r.text)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Lays out runs top-down so tests read like a document.
function page(...runs) {
  let y = 740;
  return runs.map(([text, size = 11, gapBefore = 0]) => {
    y -= gapBefore + size * 1.3;
    return { text, size, y };
  });
}

const line = (text, size = 11, y = 0) => ({ text, size, y });

describe('pdfIngest: linesToSections (pure layout -> markdown sections)', () => {
  test('larger-than-body lines become headings; wrapped body lines join into one paragraph', () => {
    const sections = linesToSections([[
      line('Whey Protein Manual', 20, 700),
      line('Our whey protein is made from grass-fed', 11, 680),
      line('milk and contains 25g of protein per serving.', 11, 666),
      line('Directions', 16, 630),
      line('Mix one scoop with water.', 11, 610)
    ]]);
    assert.deepEqual(sections, [
      { heading: 'Whey Protein Manual', paragraphs: ['Our whey protein is made from grass-fed milk and contains 25g of protein per serving.'] },
      { heading: 'Directions', paragraphs: ['Mix one scoop with water.'] }
    ]);
  });

  test('FAQ questions at body size each become their own section', () => {
    const sections = linesToSections([[
      line('Is it vegan?', 11, 700), line('No, it contains milk.', 11, 686),
      line('Is it gluten free?', 11, 650), line('Yes, it is certified gluten free.', 11, 636)
    ]]);
    assert.deepEqual(sections.map((s) => s.heading), ['Is it vegan?', 'Is it gluten free?']);
  });

  test('bullets become "- " items, and a hyphenated line break is re-joined', () => {
    const sections = linesToSections([[
      line('INGREDIENTS', 11, 700),
      line('• Whey protein isolate', 11, 686),
      line('• Natural cocoa and sunflower lecithin for mix-', 11, 672),
      line('ability in cold water', 11, 658)
    ]], 'Doc');
    assert.equal(sections[0].heading, 'INGREDIENTS');
    assert.deepEqual(sections[0].paragraphs, [
      '- Whey protein isolate',
      '- Natural cocoa and sunflower lecithin for mixability in cold water'
    ]);
  });

  test('drops page numbers and running headers/footers, but keeps a recurring body heading', () => {
    const products = ['Whey Protein', 'Creatine Monohydrate', 'Fish Oil'];
    const p = (n) => [
      line('Acme Product Manual — Confidential', 9, 780),
      line('Directions', 16, 700),
      line(`Take ${products[n - 1]} once daily with a meal.`, 11, 680),
      line(`Store ${products[n - 1]} in a cool, dry place.`, 11, 666),
      line(`Page ${n} of 3`, 9, 30)
    ];
    const sections = linesToSections([p(1), p(2), p(3)]);
    const md = JSON.stringify(sections);
    assert.doesNotMatch(md, /Confidential/);
    assert.doesNotMatch(md, /Page \d of 3/);
    assert.equal(sections.filter((s) => s.heading === 'Directions').length, 3);
  });

  test('a heading wrapped across two lines is merged, not emitted as an empty section', () => {
    const sections = linesToSections([[
      line('Storage and Handling of', 16, 700), line('Opened Containers', 16, 680), line('Keep sealed and dry.', 11, 660),
      line('filler body text so body size is eleven', 11, 640)
    ]]);
    assert.equal(sections[0].heading, 'Storage and Handling of Opened Containers');
  });

  test('text before the first heading goes under the supplied default heading', () => {
    const sections = linesToSections([[line('Plain intro text with no heading.', 11, 700)]], 'GNC Price Sheet');
    assert.equal(sections[0].heading, 'GNC Price Sheet');
  });

  test('a section over the word budget is split into "(continued)" parts at paragraph boundaries', () => {
    const para = Array.from({ length: 200 }, () => 'word').join(' ');
    const lines = [line('Warranty', 16, 700)];
    for (let i = 0; i < 3; i++) lines.push(line(para, 11, 600 - i * 100)); // big y-gaps => separate paragraphs
    const sections = linesToSections([lines]);
    assert.deepEqual(sections.map((s) => s.heading), ['Warranty', 'Warranty (continued)', 'Warranty (continued)']);
  });
});

describe('pdfIngest: pdfToDocuments (real pdf.js extraction)', () => {
  test('extracts headings by font size into "## " markdown that parseIntoChunks can chunk', async () => {
    const pdf = makePdf([
      page(['Whey Protein FAQ', 20], ['Everything you need to know about our flagship protein powder.'],
        ['Is it vegan?', 11, 12], ['No, it contains milk from grass-fed cows.']),
      page(['Directions', 16], ['Mix one scoop with 8 oz of cold water and shake well.'])
    ]);
    const result = await pdfToDocuments(pdf, 'whey-faq.pdf');
    assert.equal(result.pdfPageCount, 2);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].title, 'whey faq');

    const md = result.pages[0].markdown;
    assert.match(md, /^## Whey Protein FAQ$/m);
    assert.match(md, /^## Is it vegan\?$/m);
    assert.match(md, /^## Directions$/m);
    assert.match(md, /Mix one scoop with 8 oz of cold water/);

    const { parseIntoChunks } = require('../src/engine/knowledgeLoader');
    const chunks = parseIntoChunks(result.pages[0].title, md);
    assert.deepEqual(chunks.map((c) => c.title), ['Whey Protein FAQ', 'Is it vegan?', 'Directions']);
  });

  test('a long PDF is split into multiple "(part i of n)" documents under the per-page size cap', async () => {
    // 40 pages x 20 separate ~85-char paragraphs ≈ 70k chars of markdown.
    const sentence = 'This paragraph describes a product feature in enough detail to take up real space.';
    const pdf = makePdf(Array.from({ length: 40 }, (_, i) =>
      page([`Section ${i + 1} Overview`, 16], ...Array.from({ length: 20 }, () => [sentence, 11, 14]))
    ));
    const result = await pdfToDocuments(pdf, 'catalog.pdf');
    assert.ok(result.pages.length > 1);
    result.pages.forEach((p, i) => {
      assert.equal(p.title, `catalog (part ${i + 1} of ${result.pages.length})`);
      assert.ok(p.markdown.length <= 15000);
      assert.match(p.markdown, /^## /);
    });
  });

  test('a damaged page is skipped and the rest of the PDF still imports', async () => {
    const body = (topic) => `${topic} details: residents raise requests in the app and the office resolves them within two working days.`;
    const healthy = makePdf([
      page(['Getting started', 18], [body('Getting started')]),
      page(['Billing', 18], [body('Billing')]),
      page(['Complaints', 18], [body('Complaints')])
    ]).toString('latin1');
    // Page 2's content (object 6) now points at the catalog, which isn't a stream.
    // Same byte length, so every xref offset stays valid.
    const damaged = Buffer.from(healthy.replace('/Contents 6 0 R', '/Contents 1 0 R'), 'latin1');
    assert.notEqual(damaged.toString('latin1'), healthy);

    const result = await pdfToDocuments(damaged, 'manual.pdf');
    const text = result.pages.map((p) => p.markdown).join('\n');
    assert.match(text, /## Getting started/);
    assert.match(text, /## Complaints/);
    assert.doesNotMatch(text, /Billing details/);
  });

  test('rejects a non-PDF buffer before touching pdf.js', async () => {
    assert.equal(isPdfBuffer(Buffer.from('hello')), false);
    await assert.rejects(() => pdfToDocuments(Buffer.from('<html>not a pdf</html>'), 'x.pdf'), PdfIngestError);
  });

  test('rejects a corrupt file that merely starts with %PDF-', async () => {
    await assert.rejects(
      () => pdfToDocuments(Buffer.from('%PDF-1.4\ngarbage garbage garbage'), 'broken.pdf'),
      (err) => err instanceof PdfIngestError && err.statusCode === 400
    );
  });

  test('a PDF with no text layer (e.g. a scan) is a 422, not an empty success', async () => {
    await assert.rejects(
      () => pdfToDocuments(makePdf([[]]), 'scan.pdf'),
      (err) => err instanceof PdfIngestError && err.statusCode === 422
    );
  });
});

describe('POST /analyze-pdf (real express + multer, no DB touched)', () => {
  let server;
  let base;
  before(async () => {
    const app = express();
    app.use('/r', require('../src/routes/publicRegister.routes'));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/r`;
  });
  after(() => server.close());

  const upload = (buf, name, type = 'application/pdf') => {
    const form = new FormData();
    form.append('file', new Blob([buf], { type }), name);
    return fetch(`${base}/analyze-pdf`, { method: 'POST', body: form });
  };

  test('returns pages in the same shape /analyze does', async () => {
    const res = await upload(makePdf([page(['Pricing', 18], ['Basic plan costs 10 dollars per month.'])]), 'prices.pdf');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pages.length, 1);
    assert.deepEqual(Object.keys(body.pages[0]).sort(), ['category', 'content', 'title', 'url']);
    assert.equal(body.pages[0].url, null);
    assert.equal(body.pages[0].category, 'CUSTOM_POLICY'); // "prices.pdf" — a price sheet, not an overview
    assert.match(body.pages[0].content, /## Pricing/);
  });

  test('rejects a non-PDF upload with a 400', async () => {
    const res = await upload(Buffer.from('a,b,c'), 'prices.csv', 'text/csv');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /PDF/);
  });

  test('a request with no file is a 400', async () => {
    const res = await fetch(`${base}/analyze-pdf`, { method: 'POST', body: new FormData() });
    assert.equal(res.status, 400);
  });
});

describe('POST /tenants/:id/documents/pdf (operator upload; real express + multer, Prisma stubbed)', () => {
  const prisma = require('../src/lib/prisma');
  let server;
  let base;
  let saved;
  const originals = {};

  before(async () => {
    originals.findUnique = prisma.tenant.findUnique;
    originals.createMany = prisma.tenantDocument.createMany;
    originals.count = prisma.tenantDocument.count;
    prisma.tenant.findUnique = async ({ where }) => (where.id === 't1' ? { id: 't1' } : null);
    prisma.tenantDocument.createMany = async ({ data }) => { saved = data; return { count: data.length }; };
    prisma.tenantDocument.count = async () => 0; // the per-tenant document cap check
    const app = express();
    app.use('/tenants', require('../src/routes/tenantAdmin.routes'));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/tenants`;
  });
  after(() => {
    prisma.tenant.findUnique = originals.findUnique;
    prisma.tenantDocument.createMany = originals.createMany;
    prisma.tenantDocument.count = originals.count;
    server.close();
  });

  const upload = (tenantId, buf, { name = 'guide.pdf', category } = {}) => {
    const form = new FormData();
    if (category) form.append('category', category);
    form.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    return fetch(`${base}/${tenantId}/documents/pdf`, { method: 'POST', body: form });
  };
  const guide = () => makePdf([page(['Returns', 18], ['Unopened items can be returned within 30 days for a refund.']),
    page(['Shipping', 18], ['Orders ship within two business days to any address.'])]);

  test('saves every section to the tenant and reports where they went', async () => {
    saved = null;
    const res = await upload('t1', guide());
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.ok(body.documentsCreated >= 1);
    assert.equal(saved.length, body.documentsCreated);
    assert.ok(saved.every((d) => d.tenantId === 't1' && d.title && d.content));
    assert.equal(Object.values(body.categories).reduce((a, b) => a + b, 0), body.documentsCreated);
  });

  test('an explicit category files every section there', async () => {
    const res = await upload('t1', guide(), { category: 'FAQ' });
    assert.equal(res.status, 201);
    assert.ok(saved.every((d) => d.category === 'FAQ'));
  });

  test('rejects an unknown category, a non-PDF and an unknown tenant', async () => {
    assert.equal((await upload('t1', guide(), { category: 'NOPE' })).status, 400);
    assert.equal((await upload('t1', Buffer.from('just text'), { name: 'notes.txt' })).status, 400);
    assert.equal((await upload('missing', guide())).status, 404);
  });
});

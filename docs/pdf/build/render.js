const path = require('path');
const puppeteer = require('/Users/sanyamgaba/Desktop/chatbot_integration/kgt_ai_work-/apps/api/node_modules/puppeteer-core');

const DIR = __dirname;
const PREFIX = process.argv[2] || 'process-flow';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Footer repeats on every page; page 1 (the cover) is covered over afterwards.
const FOOTER = `
<div style="width:100%;font-family:-apple-system,Helvetica Neue,sans-serif;font-size:7pt;color:#8A92A3;
            padding:0 17mm;display:flex;justify-content:space-between;align-items:center;">
  <span style="letter-spacing:.06em;">${(process.env.DOC_FOOTER || 'KGT AI HUB &nbsp;&middot;&nbsp; END-TO-END PROCESS FLOW')}</span>
  <span><span style="color:#1364D8;font-weight:600;">ai.kgt.solutions</span>
        &nbsp;&nbsp;<span style="color:#22262F;font-weight:600;" class="pageNumber"></span><span
        style="color:#C9D3E2;"> / </span><span class="totalPages"></span></span>
</div>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--disable-lcd-text']
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  // Pass 1 — cover + back, zero page margin, no running footer: a true bleed.
  await page.goto('file://' + path.join(DIR, `${PREFIX}-bleed.html`), { waitUntil: 'networkidle0', timeout: 120000 });
  await page.evaluateHandle('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 600));
  await page.pdf({
    path: path.join(DIR, `${PREFIX}-bleed.pdf`), format: 'A4', printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
  });

  // Pass 2 — contents + sections, with margins and the running footer.
  await page.goto('file://' + path.join(DIR, `${PREFIX}-body.html`), { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForFunction('window.__renderReady === true', { timeout: 180000 });
  await page.evaluateHandle('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 1200));
  const diagrams = await page.evaluate(() => document.querySelectorAll('.dia svg').length);
  console.log(`diagrams rendered: ${diagrams}`);
  await page.pdf({
    path: path.join(DIR, `${PREFIX}-body.pdf`), format: 'A4', printBackground: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: FOOTER,
    margin: { top: '15mm', bottom: '15mm', left: '0mm', right: '0mm' }
  });

  await browser.close();
  console.log(`rendered ${PREFIX}-bleed.pdf + ${PREFIX}-body.pdf`);
})().catch((e) => { console.error(e); process.exit(1); });

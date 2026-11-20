// Visual check of the 3-phase Scan-a-website drawer on /knowledge.
const { chromium } = require('@playwright/test');
const API = 'http://localhost:4100';
const WEB = 'http://localhost:3001';
const EMAIL = 'jowax62378@kranove.com';
const PW = 'OrbTest-10chars!';
const DIR = 'C:/Users/hrshi/AppData/Local/Temp/claude/D--Development-Development-kgt-orb/458afe91-520d-465e-8d74-b6ad5e12109f/scratchpad';
const log = (m) => console.log(`[scan] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newPage();
  try {
    const res = await ctx.request.post(`${API}/api/v1/client/login`, { data: { email: EMAIL, password: PW } });
    const { token } = await res.json();
    log(`login ${res.status()} token=${token ? 'yes' : 'NO'}`);
    await ctx.addInitScript((t) => localStorage.setItem('kgtClientToken', t), token);
    await ctx.goto(`${WEB}/knowledge`, { waitUntil: 'networkidle' });
    await ctx.getByText('Add knowledge').waitFor({ timeout: 15000 });

    // Phase 1 — input
    await ctx.getByRole('button', { name: /Scan a website/ }).click();
    await ctx.getByText('Orb reads the page you paste').waitFor({ timeout: 8000 });
    await sleep(400); await ctx.screenshot({ path: `${DIR}/scan-1-input.png` });
    log('phase 1 (input) shot');

    // Tick consent, start scan → phase 2
    await ctx.getByText('owns this site or may use its content').click();
    await ctx.getByRole('button', { name: 'Scan', exact: true }).click();
    await ctx.getByText('Reading pages…').waitFor({ timeout: 8000 });
    await sleep(900); await ctx.screenshot({ path: `${DIR}/scan-2-scanning.png` });
    log('phase 2 (scanning) shot');

    // Phase 3 — review
    await ctx.getByText('Review pages').waitFor({ timeout: 8000 });
    await sleep(400); await ctx.screenshot({ path: `${DIR}/scan-3-review.png` });
    // expand one editor
    await ctx.getByRole('button', { name: /^Edit/ }).first().click();
    await sleep(300); await ctx.screenshot({ path: `${DIR}/scan-3b-review-expanded.png` });
    log('phase 3 (review) shots');
    log('DONE');
  } catch (e) {
    log(`ERROR ${e.message}`);
    await ctx.screenshot({ path: `${DIR}/scan-error.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

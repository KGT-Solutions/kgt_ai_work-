// Manual-OTP E2E driver for the Orb onboarding flow (localhost:3001/orb-register).
// Fills each step, pauses at the code screen until an OTP appears in OTP_FILE,
// then finishes through Company → Knowledge → Training → Review → Create.
const fs = require('fs');
const { chromium } = require('@playwright/test');

const BASE = process.env.WEB_URL || 'http://localhost:3001';
const EMAIL = process.env.OTP_EMAIL || 'connect@kgt.solutions';
const PASSWORD = process.env.OTP_PW || 'OrbTest-10chars!';
const OTP_FILE = process.env.OTP_FILE || 'C:/Users/hrshi/AppData/Local/Temp/claude/D--Development-Development-kgt-orb/458afe91-520d-465e-8d74-b6ad5e12109f/scratchpad/otp.txt';
const SHOT = (n) => `C:/Users/hrshi/AppData/Local/Temp/claude/D--Development-Development-kgt-orb/458afe91-520d-465e-8d74-b6ad5e12109f/scratchpad/orb-${n}.png`;

const log = (m) => console.log(`[orb-e2e] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForOtp(page) {
  log(`waiting for OTP in ${OTP_FILE} (write 6 digits there) ...`);
  for (let i = 0; i < 600; i++) { // up to ~10 min
    try {
      const v = fs.readFileSync(OTP_FILE, 'utf8').replace(/\D/g, '');
      if (v.length >= 6) return v.slice(0, 6);
    } catch { /* not written yet */ }
    await sleep(1000);
  }
  throw new Error('timed out waiting for OTP file');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Log every API call the UI makes (method + path + status) so each step's
  // network activity is visible inline with the step logs.
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('/api/v1/')) log(`API  ${res.request().method()} ${new URL(u).pathname} -> ${res.status()}`);
  });
  page.on('console', (m) => log(`page> ${m.type()}: ${m.text()}`.slice(0, 200)));
  try {
    log(`email = ${EMAIL}`);
    await page.goto(`${BASE}/orb-register`, { waitUntil: 'networkidle' });
    log('step 1: Create account');
    await page.getByPlaceholder('you@clinic.com').fill(EMAIL);
    const pw = page.locator('input[type=password]');
    await pw.nth(0).fill(PASSWORD);
    await pw.nth(1).fill(PASSWORD);
    await page.screenshot({ path: SHOT('1-account') });
    await page.getByRole('button', { name: 'Send code' }).click();

    // Code screen
    await page.getByText('Check your email').waitFor({ timeout: 30000 });
    log('reached code screen — OTP email sent');
    await page.screenshot({ path: SHOT('2-code') });
    const otp = await waitForOtp(page);
    log(`got OTP ${otp} — entering`);
    await page.locator('input[aria-label="6-digit code"]').fill(otp);
    // auto-submits; click Verify as backup if still on the code screen
    await sleep(800);
    if (await page.getByText('Check your email').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Verify' }).click().catch(() => {});
    }

    // Company
    await page.getByPlaceholder('Sanvi Fertility & IVF').waitFor({ timeout: 20000 });
    log('step 2: Company');
    await page.getByPlaceholder('Sanvi Fertility & IVF').fill('Orb E2E Clinic');
    await page.getByPlaceholder('Nikita Deshpande').fill('Automated Tester');
    await page.screenshot({ path: SHOT('3-company') });
    await page.getByRole('button', { name: 'Continue' }).click();

    // Knowledge — write one entry (no network)
    await page.getByText('Add what Orb should know').waitFor({ timeout: 20000 });
    log('step 3: Knowledge — writing an entry');
    await page.getByRole('button', { name: 'Write' }).click();
    await page.getByPlaceholder('e.g. Sunday branch hours').fill('Opening hours');
    await page.locator('textarea').fill('## Opening hours\nMon–Sat 9am to 6pm. Closed Sundays. Walk-ins welcome.');
    await page.getByRole('button', { name: 'Save entry' }).click();
    await page.getByText('1 entries', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: SHOT('4-knowledge') });
    await page.getByRole('button', { name: 'Continue' }).click();

    // Training
    await page.getByText('Is Orb ready for patients?').waitFor({ timeout: 20000 });
    log('step 4: Training & bots (readiness check runs)');
    await sleep(2500);
    await page.screenshot({ path: SHOT('5-training') });
    await page.getByRole('button', { name: 'Continue' }).click();

    // Review + create
    await page.getByText('Review and create').waitFor({ timeout: 20000 });
    log('step 5: Review — creating workspace');
    await page.screenshot({ path: SHOT('6-review') });
    await page.getByRole('button', { name: /Create workspace/ }).click();

    // Success = navigate to /testorb; failure = inline error
    const res = await Promise.race([
      page.waitForURL('**/testorb', { timeout: 45000 }).then(() => 'SUCCESS: navigated to /testorb'),
      page.getByText('Couldn’t create').waitFor({ timeout: 45000 }).then(async () => `FAILED: ${await page.locator('.text-red-600').first().innerText().catch(() => 'unknown error')}`)
    ]).catch((e) => `TIMEOUT: ${e.message}`);
    await page.screenshot({ path: SHOT('7-result') });
    log(res);
  } catch (err) {
    log(`ERROR: ${err.message}`);
    await page.screenshot({ path: SHOT('error') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    log('done');
  }
})();

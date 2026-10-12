// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { waitForCode } = require('../support/mailpit');
const { uniqueEmail } = require('../support/api');
const { enterCode, percentIn } = require('../support/ui');
const { knowledgePackZip } = require('../fixtures/make-zip');

// Scenario 1 — the complete self-serve registration wizard, in a real
// browser against the real web app, API and database:
//   account → email code (read from Mailpit) → company → bots → knowledge
//   (Markdown + ZIP upload, website scan behind the legal checkbox) →
//   automatic training check → inline upload raises the Support Bot's
//   training % → review → launch → signed in on the dashboard.

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const SITE_URL = process.env.E2E_SITE_URL || 'http://stubs:8081/';
const SCORE = /^\d{1,3}%$/; // the big percentage on a bot's training card

test('a new company signs up, trains both bots and lands on its dashboard', async ({ page }) => {
  const email = uniqueEmail('signup');
  const password = 'Signup-Password-77';

  await test.step('account + email verification', async () => {
    await page.goto('/register');
    await page.locator('#r-email').fill(email);
    await page.locator('#r-password').fill(password);
    await page.locator('#r-confirm').fill(password);
    const since = Date.now();
    await page.getByRole('button', { name: 'Send verification code' }).click();
    const code = await waitForCode(email, { subject: /verification code/, since });
    await enterCode(page, code); // submits itself on the sixth digit
    await expect(page.getByText('Email verified')).toBeVisible();
    await page.getByRole('button', { name: /Continue to company details/ }).click();
  });

  await test.step('company details', async () => {
    await page.locator('#r-company').fill('Northwind Thermostats');
    await page.locator('#r-name').fill('Priya Sharma');
    await page.locator('#r-industry').selectOption('E-commerce & Retail');
    await page.getByRole('button', { name: /^Continue/ }).click();
  });

  await test.step('choose bots: both', async () => {
    await expect(page.getByText('Choose Your AI Workforce')).toBeVisible();
    await page.getByRole('radio', { name: /^Both/ }).click();
    await expect(page.getByRole('radio', { name: /^Both/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: /^Continue/ }).click();
  });

  await test.step('knowledge: Markdown + ZIP upload', async () => {
    await expect(page.getByText('Add your knowledge')).toBeVisible();
    // setInputFiles can't mix file paths with buffers, so both go in as buffers.
    await page.getByLabel('Upload documents').setInputFiles([
      { name: 'product-guide.md', mimeType: 'text/markdown', buffer: fs.readFileSync(path.join(FIXTURES, 'product-guide.md')) },
      { name: 'knowledge-pack.zip', mimeType: 'application/zip', buffer: await knowledgePackZip() }
    ]);
    // Each file becomes one entry titled after its file name; its headings
    // ("Installation", …) are inside the entry, collapsed — not on the page.
    await expect(page.getByText(/^product-guide\.md: 1 entry$/)).toBeVisible();
    await expect(page.getByText(/^knowledge-pack\.zip: 2 documents → 2 entries$/)).toBeVisible();
    for (const title of [/^product guide$/i, /^why northwind$/i, /^app faq$/i]) {
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  await test.step('knowledge: website scan needs the legal authorization', async () => {
    await page.getByLabel('Company website').fill(SITE_URL);
    const scan = page.getByRole('button', { name: 'Scan website' });
    await expect(scan).toBeDisabled();
    await expect(page.getByText('Tick the authorization box to scan this domain.')).toBeVisible();
    await page.getByRole('checkbox').check();
    await expect(scan).toBeEnabled();
    await scan.click();
    await expect(page.getByText(/Added \d+ pages? from/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /Analyze & continue/ }).click();
  });

  let before;
  await test.step('training check runs automatically and shows a path to 100%', async () => {
    await expect(page.getByRole('heading', { name: /Your bots.? training/ })).toBeVisible();
    // Each bot's score card is a group named "<Bot> training" (TrainingReadinessStep.js).
    const supportCard = page.getByRole('group', { name: 'Support Bot training' });
    await expect(supportCard.getByText(SCORE)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('group', { name: 'Sales Bot training' }).getByText(SCORE)).toBeVisible();
    before = await percentIn(supportCard.getByText(SCORE));
    expect(before).toBeLessThan(80); // not "Ready" without a refund policy
    await expect(page.getByText('Path to 100% training')).toBeVisible();
    await expect(page.getByText(/To reach 100% on your Support Bot:.*Return & Refund Policy/)).toBeVisible();
  });

  await test.step('inline upload of the missing document raises the Support Bot training', async () => {
    const item = page.locator('li', { hasText: 'Return & Refund Policy' });
    const chooser = page.waitForEvent('filechooser');
    await item.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles(path.join(FIXTURES, 'refund-policy.md'));
    // Re-checked automatically: the requirement goes away and the score rises.
    await expect(page.getByText(/Return & Refund Policy/)).toHaveCount(0, { timeout: 60_000 });
    const supportCard = page.getByRole('group', { name: 'Support Bot training' });
    await expect.poll(async () => percentIn(supportCard.getByText(SCORE)), { timeout: 30_000 }).toBeGreaterThan(before);
    await page.getByRole('button', { name: /Continue to review/ }).click();
  });

  await test.step('review and launch', async () => {
    await expect(page.getByText('Northwind Thermostats').first()).toBeVisible();
    await page.getByRole('button', { name: /Deploy & test my bots/ }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Leads & Summaries/ })).toBeVisible();
  });
});

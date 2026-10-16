// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForEmail } = require('../support/mailpit');
const { registerCompany, uniqueEmail } = require('../support/api');
const { signIn } = require('../support/ui');

// Scenario 3 — the company admin's dashboard: sign in, configure which bots
// are deployed (the knowledge split), test both bots side by side, and turn
// a sales chat into a lead with an AI summary and a confirmation email.
// Plus: KGT staff sign in to the staff console and see the company.

test('admin configures bots, tests them side by side and captures a lead', async ({ page }) => {
  const company = await registerCompany({ label: 'dash' });
  const prospect = uniqueEmail('prospect');

  await test.step('sign in', async () => {
    await signIn(page, company);
  });

  await test.step('knowledge split: switch to Support only and back to Both', async () => {
    const group = page.getByRole('radiogroup', { name: 'Deployed bots' });
    await group.getByRole('radio', { name: 'Support only' }).click();
    await expect(group.getByRole('radio', { name: 'Support only' })).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await expect(page.getByRole('radiogroup', { name: 'Deployed bots' }).getByRole('radio', { name: 'Support only' }))
      .toHaveAttribute('aria-checked', 'true'); // saved, not just local state
    await page.getByRole('radiogroup', { name: 'Deployed bots' }).getByRole('radio', { name: 'Both' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Deployed bots' }).getByRole('radio', { name: 'Both' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  await test.step('see which knowledge each bot answers from', async () => {
    await page.getByRole('link', { name: 'Test bots' }).click();
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Knowledge split' }).click();
    await expect(page.getByText(/Pricing|About Northwind|Setup help/).first()).toBeVisible();
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Compare answers' }).click();
  });

  await test.step('ask both bots the same question, side by side', async () => {
    // Regression: after Support only → Both, the tester must default to sending to both bots.
    await expect(page.getByRole('radiogroup', { name: 'Send to' }).getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Message').fill('What plans do you offer?');
    await page.getByRole('button', { name: 'Send' }).click();
    const support = page.getByLabel('Support Bot conversation');
    const sales = page.getByLabel('Sales Bot conversation');
    await expect(support.getByText('What plans do you offer?')).toBeVisible();
    await expect(sales.getByText('What plans do you offer?')).toBeVisible();
    await expect(sales.getByLabel('Thinking')).toHaveCount(0, { timeout: 30_000 });
    await expect(support.getByLabel('Thinking')).toHaveCount(0, { timeout: 30_000 });
    await expect(sales.getByText(/Northwind thermostats learn your schedule/)).toBeVisible();
  });

  await test.step('a sales chat becomes a lead', async () => {
    await page.getByRole('radiogroup', { name: 'Send to' }).getByRole('radio', { name: 'Sales' }).click();
    const sales = page.getByLabel('Sales Bot conversation');
    await page.getByLabel('Message').fill('Can I book a demo?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(sales.getByText(/email/i).last()).toBeVisible({ timeout: 30_000 }); // the bot asks where to reach them
    await page.getByLabel('Message').fill(prospect);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(sales.getByText(new RegExp(prospect.replace(/\./g, '\\.'))).last()).toBeVisible();
    await expect(sales.getByLabel('Thinking')).toHaveCount(0, { timeout: 30_000 });
  });

  await test.step('the prospect gets a confirmation email', async () => {
    const mail = await waitForEmail(prospect, { subject: /Thanks for reaching out/ });
    expect(mail.subject).toContain('Northwind dash');
  });

  await test.step('the lead appears with its AI summary', async () => {
    await page.getByRole('link', { name: /Leads & Summaries/ }).click();
    const row = page.locator('li', { hasText: prospect });
    await expect(async () => {
      await page.reload();
      await expect(row.getByText(/Wants a product demo/).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await row.getByRole('button', { name: /Details/ }).click();
    await expect(row.getByText('AI summary')).toBeVisible();
    await expect(row.getByText(/Schedule a demo call this week/)).toBeVisible();
    // Summary first: the raw chat stays folded until asked for.
    await expect(row.getByText('Can I book a demo?')).toHaveCount(0);
    await row.getByRole('button', { name: /View full transcript/ }).click();
    await expect(row.getByText('Can I book a demo?')).toBeVisible();
    await row.getByRole('button', { name: 'Mark contacted' }).click();
    await expect(row.getByRole('button', { name: 'Mark as new' })).toBeVisible();
  });
});

test('KGT staff sign in to the staff console and see the company', async ({ page }) => {
  const company = await registerCompany({ label: 'staffview' });
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(process.env.E2E_STAFF_EMAIL || 'staff@e2e.test');
  await page.locator('input[type="password"]').fill(process.env.E2E_STAFF_PASSWORD || 'E2E-Staff-Password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);
  await expect(page.getByText('Northwind staffview').first()).toBeVisible();
  void company;
});

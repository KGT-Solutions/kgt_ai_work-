// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForCode } = require('../support/mailpit');
const { registerCompany, uniqueEmail } = require('../support/api');
const { enterCode, signIn } = require('../support/ui');

// Scenario 2 — forgot password: the code arrives by real email (Mailpit),
// the new password works and the old one stops working.

test('a client resets a forgotten password with an emailed code and signs in', async ({ page }) => {
  const company = await registerCompany({ label: 'reset' });
  const newPassword = 'Brand-New-Password-9';

  await test.step('an unknown address is told so', async () => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.locator('#reset-email').fill(uniqueEmail('nobody'));
    await page.getByRole('button', { name: 'Send Reset OTP' }).click();
    await expect(page.getByText('No account found with this email address.')).toBeVisible();
  });

  await test.step('the code is emailed and accepted with a new password', async () => {
    await page.locator('#reset-email').fill(company.email);
    const since = Date.now();
    await page.getByRole('button', { name: 'Send Reset OTP' }).click();
    const code = await waitForCode(company.email, { subject: /password reset code/, since });
    await enterCode(page, code);
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Your password has been reset.', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in now' }).click();
    await expect(page.getByText('Password updated — sign in with your new password.')).toBeVisible();
  });

  await test.step('the old password no longer works', async () => {
    await page.getByLabel('Email').fill(company.email);
    await page.locator('input[type="password"]').fill(company.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step('the new password signs in', async () => {
    await signIn(page, { email: company.email, password: newPassword });
  });
});

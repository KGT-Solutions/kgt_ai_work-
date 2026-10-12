// Small UI helpers shared by the specs.
const { expect } = require('@playwright/test');

/** Types a 6-digit code into the OTP boxes (they auto-advance). */
async function enterCode(page, code) {
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code, { delay: 30 });
}

/** Signs a client in on /login and waits for the dashboard. */
async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The whole-number percentage shown in an element ("75%" → 75). */
async function percentIn(locator) {
  const text = await locator.textContent();
  const m = text && text.match(/(\d{1,3})%/);
  if (!m) throw new Error(`no percentage in "${text}"`);
  return Number(m[1]);
}

module.exports = { enterCode, signIn, percentIn };

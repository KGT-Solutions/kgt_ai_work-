// Test setup through the REAL public API (not the database): signs a company
// up exactly as the wizard does — email code from Mailpit, verify, complete —
// so tests that start from "an existing company" don't depend on each other.
const crypto = require('crypto');
const { waitForCode } = require('./mailpit');

const API = process.env.E2E_API_URL || 'http://localhost:4000';

async function post(path, body, token) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** A unique, valid address per test run. */
const uniqueEmail = (label) => `${label}.${crypto.randomBytes(4).toString('hex')}@e2e.test`;

/**
 * Registers a company and returns { email, password, slug, apiKey, token }.
 * Knowledge: a short product + pricing + support set, enough for both bots.
 */
async function registerCompany({ label = 'company', botPreference = 'both', password = 'Correct-Horse-42' } = {}) {
  const email = uniqueEmail(label);
  const since = Date.now();
  await post('/api/v1/public/auth/send-otp', { email });
  const otp = await waitForCode(email, { since });
  const { verificationToken } = await post('/api/v1/public/auth/verify-otp', { email, otp });
  const data = await post('/api/v1/public/register/complete', {
    companyName: `Northwind ${label}`, contactName: 'E2E Tester', email, password, industryLabel: 'E-commerce & Retail', botPreference,
    emailVerificationToken: verificationToken,
    pages: [
      { title: 'About Northwind', category: 'CORE_OVERVIEW', content: '## About\n\nNorthwind sells smart thermostats that learn your schedule and cut energy bills by up to 23%.' },
      { title: 'Pricing', category: 'CUSTOM_POLICY', content: '## Plans\n\nStarter costs ₹6,999 per thermostat. Plus costs ₹9,499 and adds room sensors and energy reports.' },
      { title: 'Setup help', category: 'FAQ', content: '## How do I install the thermostat?\n\nTurn off power at the breaker, connect the labelled wires to the base, restore power and follow the app.' }
    ]
  });
  return { email, password, slug: data.slug, apiKey: data.apiKey, token: data.token };
}

module.exports = { registerCompany, uniqueEmail, API };

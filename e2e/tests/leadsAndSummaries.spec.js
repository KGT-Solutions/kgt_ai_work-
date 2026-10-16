// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForEmail, countEmails } = require('../support/mailpit');
const { registerCompany, uniqueEmail, API } = require('../support/api');
const { signIn } = require('../support/ui');

// Scenario 4 — website visitors chat through the public widget API (as the
// embedded widget does, with the company's API key), and the team works the
// results in Leads & Summaries:
//   A  support, "Do you ship to Mars?" twice   handoff alert, sent once (throttled); ended -> summarized now
//   B  sales, demo request + email             lead + lead alert replying to the visitor
//   C  support, a question the docs answer     never ended -> summarized by the idle worker
// Team alerts go to the signup email (no team address set), caught by Mailpit.

async function widgetChat(company, body) {
  const res = await fetch(`${API}/api/v1/tenant-chat/${company.slug}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-api-key': company.apiKey }, body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`chat → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function endSession(company, sessionId) {
  const res = await fetch(`${API}/api/v1/tenant-chat/${company.slug}/session/end`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-api-key': company.apiKey }, body: JSON.stringify({ sessionId })
  });
  expect(res.status).toBe(204);
}

const short = (id) => `#${id.slice(0, 8)}`;
const HANDOFF_ALERT = /Support bot handed a visitor to your team/;

test('visitor chats become alerts, session summaries and improvement items', async ({ page }) => {
  const company = await registerCompany({ label: 'sessions' });
  const prospect = uniqueEmail('visitor');
  const s = {};

  await test.step('visitor A asks something the documents do not cover: one handoff alert, however often', async () => {
    const first = await widgetChat(company, { botType: 'support', query: 'Do you ship to Mars?' });
    s.a = first.sessionId;
    expect(first.handoff).toBe(true);
    const alert = await waitForEmail(company.email, { subject: HANDOFF_ALERT });
    expect(alert.text).toContain('Question: Do you ship to Mars?');
    expect(alert.text).toContain(`Session: ${s.a}`);

    await widgetChat(company, { botType: 'support', query: 'Do you ship to Jupiter then?', sessionId: s.a });
    await page.waitForTimeout(3_000); // alerts are sent in the background: give a second one time to (not) arrive
    expect(await countEmails(company.email, HANDOFF_ALERT)).toBe(1);
    await endSession(company, s.a); // the widget's "page closed" signal: summarized now
  });

  await test.step('visitor B books a demo and leaves an email: the team gets a lead alert that replies to them', async () => {
    const demo = await widgetChat(company, { botType: 'sales', query: 'Can I book a demo?' });
    s.b = demo.sessionId;
    expect(demo.awaitingContact).toBe(true);
    const captured = await widgetChat(company, { botType: 'sales', query: prospect, sessionId: s.b });
    expect(captured.contactCaptured).toBe(true);
    const alert = await waitForEmail(company.email, { subject: new RegExp(`New Lead Captured from Sales Bot! ${prospect.replace(/\./g, '\\.')}`) });
    expect(alert.replyTo).toEqual([prospect]);
    await waitForEmail(prospect, { subject: /Thanks for reaching out/ }); // and the visitor's own confirmation
  });

  await test.step('visitor C asks a question the documents answer, then goes quiet', async () => {
    const answer = await widgetChat(company, { botType: 'support', query: 'How do I install the thermostat?' });
    s.c = answer.sessionId;
    expect(answer.handoff).toBeFalsy();
    expect(answer.answer).toMatch(/Northwind/);
    await page.waitForTimeout(2_000);
    // A correct answer at a normal (~50%) score emails no one.
    expect(await countEmails(company.email, /low-confidence answer/)).toBe(0);
  });

  await test.step('Sessions: every conversation is listed with its AI summary (ended, lead and idle paths)', async () => {
    await signIn(page, company);
    await page.getByRole('link', { name: /Leads & Summaries/ }).click();
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Sessions' }).click();
    await expect(page).toHaveURL(/view=sessions/);
    for (const id of [s.a, s.b, s.c]) {
      const row = page.getByRole('button', { name: new RegExp(short(id)) });
      await expect(async () => {
        await page.reload();
        await expect(row.getByText(/Wants a product demo/)).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 45_000 });
    }
    const rowB = page.getByRole('button', { name: new RegExp(short(s.b)) });
    await expect(rowB.getByText(prospect)).toBeVisible(); // the visitor's identifier is their email once they leave one
    await expect(rowB.getByText('Sales bot')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(short(s.a)) }).getByText('Support bot')).toBeVisible();
  });

  await test.step('opening a session shows the structured summary first, the raw chat only on request', async () => {
    await page.getByRole('button', { name: new RegExp(short(s.a)) }).click();
    const drawer = page.getByRole('dialog', { name: 'Conversation' });
    await expect(page).toHaveURL(new RegExp(`session=${s.a}`));
    for (const label of ['Intent', 'Key questions', 'Outcome', 'Follow-up actions']) {
      await expect(drawer.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(drawer.getByText('Do you ship to Mars?')).toHaveCount(0);
    await drawer.getByRole('button', { name: /View full transcript \(4 messages\)/ }).click();
    await expect(drawer.getByText('Do you ship to Mars?')).toBeVisible();
    await expect(drawer.getByText(/Low confidence · 0%/).first()).toBeVisible();
    await drawer.getByRole('button', { name: /Hide full transcript/ }).click();
    await expect(drawer.getByText('Do you ship to Mars?')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  await test.step("a session's lead can be marked contacted from the session", async () => {
    await page.getByRole('button', { name: new RegExp(short(s.b)) }).click();
    const drawer = page.getByRole('dialog', { name: 'Conversation' });
    await drawer.getByRole('button', { name: 'Mark contacted' }).click();
    await expect(drawer.getByRole('button', { name: 'Mark as new' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('Improvements lists the weak answers with the question behind each', async () => {
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Improvements' }).click();
    await expect(page).toHaveURL(/view=improvements/);
    const card = page.locator('li', { hasText: short(s.a) }).first();
    await expect(card.getByText('Do you ship to Mars?')).toBeVisible();
    await expect(card.getByText('Do you ship to Jupiter then?')).toBeVisible();
    await expect(card.getByText('Lowest 0%')).toBeVisible();
    await expect(card.getByText('2 missed answers in this conversation')).toBeVisible();
    // Only answers with a retrieval score count: B's demo request and email went to the handoff actions, which have none.
    await expect(page.locator('li', { hasText: short(s.b) })).toHaveCount(0);
    // The launch blocker this guards: C's correct answer scores ~50%, which is normal, and must not be listed.
    await expect(page.locator('li', { hasText: short(s.c) })).toHaveCount(0);
    await card.getByRole('button', { name: /Open session/ }).click();
    await expect(page.getByRole('dialog', { name: 'Conversation' })).toBeVisible();
  });
});

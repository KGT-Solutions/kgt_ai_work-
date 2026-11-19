const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Step 2 G1 — a slug clash is OUR OWN random-suffix collision (makeSlug appends
// randomBytes), not a duplicate account, so /complete regenerates the slug and
// retries rather than mislabeling it ACCOUNT_EXISTS. An email/signupEmail unique
// violation IS a duplicate account. violatedTargets normalizes P2002.meta.target
// (array of fields OR a constraint name) so the catch can tell the two apart.
const router = require('../../src/routes/publicRegister.routes');
const { violatedTargets } = router;

describe('publicRegister: violatedTargets (P2002 discriminator)', () => {
  test('an array target (Prisma field list) is normalized to strings', () => {
    assert.deepEqual(violatedTargets({ meta: { target: ['slug'] } }), ['slug']);
    assert.deepEqual(violatedTargets({ meta: { target: ['signupEmail'] } }), ['signupEmail']);
  });

  test('a string target (constraint name) is wrapped in a list', () => {
    assert.deepEqual(violatedTargets({ meta: { target: 'Tenant_slug_key' } }), ['Tenant_slug_key']);
  });

  test('a missing or empty meta yields an empty list', () => {
    assert.deepEqual(violatedTargets({}), []);
    assert.deepEqual(violatedTargets({ meta: {} }), []);
    assert.deepEqual(violatedTargets(null), []);
  });

  test('the slug-vs-email discrimination the /complete catch depends on', () => {
    const slugOnly = (e) => { const t = violatedTargets(e); return t.length > 0 && t.every((x) => /slug/i.test(x)); };
    const isEmail = (e) => violatedTargets(e).some((x) => /email/i.test(x));

    // Slug collision (field name or constraint name) → retry path, never ACCOUNT_EXISTS.
    assert.equal(slugOnly({ meta: { target: ['slug'] } }), true);
    assert.equal(slugOnly({ meta: { target: 'Tenant_slug_key' } }), true);

    // Email / signupEmail → a genuine duplicate account.
    assert.equal(isEmail({ meta: { target: ['signupEmail'] } }), true);
    assert.equal(isEmail({ meta: { target: ['email'] } }), true);
    assert.equal(isEmail({ meta: { target: 'TenantUser_email_key' } }), true);

    // Not slug-only when an email index is involved.
    assert.equal(slugOnly({ meta: { target: ['signupEmail'] } }), false);
    // Unknown/empty is neither slug-only nor email → the catch falls back to ACCOUNT_EXISTS.
    assert.equal(slugOnly({}), false);
    assert.equal(isEmail({}), false);
  });
});

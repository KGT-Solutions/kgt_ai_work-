const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedImageType } = require('../src/middleware/upload');

describe('upload.isAllowedImageType — MIME allowlist', () => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  for (const type of allowed) {
    test(`accepts ${type}`, () => {
      assert.equal(isAllowedImageType(type), true);
    });
  }

  test('rejects image/svg+xml — the stored-XSS vector this fix closes', () => {
    // /uploads is served statically and unauthenticated (app.js), so an SVG
    // with an embedded <script> would execute when an admin opens the
    // "screenshot"/"receipt" URL directly.
    assert.equal(isAllowedImageType('image/svg+xml'), false);
  });

  test('rejects a non-image MIME type entirely', () => {
    assert.equal(isAllowedImageType('application/pdf'), false);
    assert.equal(isAllowedImageType('text/html'), false);
  });

  test('rejects an empty/missing mimetype', () => {
    assert.equal(isAllowedImageType(''), false);
    assert.equal(isAllowedImageType(undefined), false);
  });
});

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Feature 10 protocol layer: Google/Microsoft send-only OAuth, no DB, injectable
// fetch. Verifies scopes, token exchange/refresh, the mailbox address read from
// the id_token, and that each provider's send hits its send-only API with the
// right payload.

const PREV = {};
before(() => {
  for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_TENANT']) PREV[k] = process.env[k];
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-secret';
  process.env.MICROSOFT_OAUTH_CLIENT_ID = 'm-client';
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'm-secret';
  delete process.env.MICROSOFT_OAUTH_TENANT;
});
after(() => { for (const [k, v] of Object.entries(PREV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const oauth = require('../../src/services/emailOAuth');

const jwtWith = (claims) => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });

describe('emailOAuth: configuration & authorize URLs', () => {
  test('providerConfigured reflects env; unknown provider is false', () => {
    assert.equal(oauth.providerConfigured('google'), true);
    assert.equal(oauth.providerConfigured('microsoft'), true);
    assert.equal(oauth.providerConfigured('yahoo'), false);
    assert.deepEqual(oauth.configuredProviders().sort(), ['google', 'microsoft']);
  });

  test('Google authorize URL requests the send-only scope + offline access', () => {
    const url = oauth.authorizeUrl('google', { state: 'st8', redirectUri: 'https://api.test/cb' });
    assert.match(url, /accounts\.google\.com/);
    assert.match(decodeURIComponent(url), /gmail\.send/);
    assert.match(url, /access_type=offline/);
    assert.match(url, /state=st8/);
    assert.match(decodeURIComponent(url), /redirect_uri=https:\/\/api\.test\/cb/);
  });

  test('Microsoft authorize URL requests Mail.Send + offline_access on the common tenant', () => {
    const url = oauth.authorizeUrl('microsoft', { state: 's', redirectUri: 'https://api.test/cb' });
    assert.match(url, /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
    assert.match(decodeURIComponent(url), /Mail\.Send/);
    assert.match(decodeURIComponent(url), /offline_access/);
  });
});

describe('emailOAuth: token exchange & refresh', () => {
  test('exchangeCode returns tokens, scope and the mailbox from the id_token', async () => {
    const fetchImpl = async () => resp({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'gmail.send', id_token: jwtWith({ email: 'owner@acme.com' }) });
    const out = await oauth.exchangeCode('google', { code: 'c', redirectUri: 'u', fetchImpl, now: 0 });
    assert.equal(out.refreshToken, 'rt1');
    assert.equal(out.accessToken, 'at1');
    assert.equal(out.email, 'owner@acme.com');
    assert.equal(out.tokenExpiry.getTime(), 3600 * 1000);
  });

  test('a code exchange with no refresh token is an error (connection would be unusable)', async () => {
    const fetchImpl = async () => resp({ access_token: 'at', expires_in: 3600 });
    await assert.rejects(() => oauth.exchangeCode('google', { code: 'c', redirectUri: 'u', fetchImpl }),
      (e) => e instanceof oauth.EmailOAuthError);
  });

  test('refreshAccessToken mints a fresh access token', async () => {
    const fetchImpl = async () => resp({ access_token: 'at2', expires_in: 1800 });
    const out = await oauth.refreshAccessToken('microsoft', { refreshToken: 'rt', fetchImpl, now: 0 });
    assert.equal(out.accessToken, 'at2');
    assert.equal(out.tokenExpiry.getTime(), 1800 * 1000);
  });

  test('isTokenFresh honours the skew', () => {
    assert.equal(oauth.isTokenFresh(new Date(1000 * 1000), 0), true);
    assert.equal(oauth.isTokenFresh(new Date(0), 1000 * 1000), false);
    assert.equal(oauth.isTokenFresh(null), false);
  });
});

describe('emailOAuth: send via the send-only APIs', () => {
  test('Google send posts a base64url raw MIME message to the Gmail API', async () => {
    let captured;
    const fetchImpl = async (url, opts) => { captured = { url, body: JSON.parse(opts.body), auth: opts.headers.authorization }; return resp({ id: 'm1' }); };
    await oauth.sendEmail('google', { accessToken: 'AT', from: 'me@acme.com', to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body', replyTo: 'r@z.com' }, { fetchImpl });
    assert.match(captured.url, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
    assert.equal(captured.auth, 'Bearer AT');
    const raw = Buffer.from(captured.body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(raw, /From: me@acme\.com/);
    assert.match(raw, /To: a@x\.com, b@y\.com/);
    assert.match(raw, /Reply-To: r@z\.com/);
    assert.match(raw, /Subject: Hi/);
  });

  test('Microsoft send posts a Graph sendMail payload with saveToSentItems off', async () => {
    let captured;
    const fetchImpl = async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return resp({}, 202); };
    await oauth.sendEmail('microsoft', { accessToken: 'AT', from: 'me@acme.com', to: 'a@x.com', subject: 'Hi', html: '<b>Body</b>' }, { fetchImpl });
    assert.match(captured.url, /graph\.microsoft\.com\/v1\.0\/me\/sendMail/);
    assert.equal(captured.body.saveToSentItems, false);
    assert.equal(captured.body.message.subject, 'Hi');
    assert.equal(captured.body.message.body.contentType, 'HTML');
    assert.deepEqual(captured.body.message.toRecipients, [{ emailAddress: { address: 'a@x.com' } }]);
  });

  test('a 401 from the send API is surfaced as a 401 EmailOAuthError', async () => {
    const fetchImpl = async () => resp('unauthorized', 401);
    await assert.rejects(() => oauth.sendEmail('google', { accessToken: 'bad', from: 'm@a.com', to: 'x@y.com', subject: 's', text: 't' }, { fetchImpl }),
      (e) => e instanceof oauth.EmailOAuthError && e.statusCode === 401);
  });

  test('a Hindi subject + body round-trip through the MIME builder (base64, not raw 8-bit)', () => {
    const mime = oauth.buildMimeMessage({ from: 'm@a.com', to: 'x@y.com', subject: 'नमस्ते', text: 'धन्यवाद' });
    assert.match(mime, /Subject: =\?UTF-8\?B\?/); // encoded-word header
    assert.match(mime, /Content-Transfer-Encoding: base64/);
  });
});

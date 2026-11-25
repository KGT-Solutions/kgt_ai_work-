const crypto = require('crypto');

// Google / Microsoft "send-only" email OAuth — the protocol layer for Feature
// 10. Pure, env-gated and network-injectable (fetchImpl): no database here, so
// services/emailConnection.js owns storage and this stays unit-testable without
// a DB or the network.
//
// Send-only by design:
//   - Google: scope https://www.googleapis.com/auth/gmail.send (cannot read
//     mail), sent via the Gmail API users.messages.send.
//   - Microsoft: scope Mail.Send, sent via Microsoft Graph /me/sendMail.
// Both also request `openid email` so we learn the connected mailbox address
// (used as the From) and `offline_access` / access_type=offline so we get a
// refresh token. OPENAI-style env gating: when a provider's client id/secret
// are unset the feature simply reports itself unconfigured and the UI disables
// the button — nothing throws on load.

const PROVIDERS = ['google', 'microsoft'];
const TIMEOUT_MS = 15000;
const EXPIRY_SKEW_MS = 60 * 1000;

const readKey = (name) => String(process.env[name] || '').trim();

class EmailOAuthError extends Error {
  constructor(message, statusCode = 502, { retryable = false } = {}) {
    super(message);
    this.name = 'EmailOAuthError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function isProvider(p) {
  return PROVIDERS.includes(String(p || '').trim().toLowerCase());
}

// Per-provider endpoints, scopes and client credentials (from env).
function providerMeta(provider) {
  if (provider === 'google') {
    return {
      label: 'Google',
      clientId: readKey('GOOGLE_OAUTH_CLIENT_ID'),
      clientSecret: readKey('GOOGLE_OAUTH_CLIENT_SECRET'),
      authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      // gmail.send is send-only (no read/list); openid+email identifies the mailbox.
      scope: readKey('GOOGLE_OAUTH_SCOPE') || 'https://www.googleapis.com/auth/gmail.send openid email',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' }
    };
  }
  if (provider === 'microsoft') {
    const tenant = readKey('MICROSOFT_OAUTH_TENANT') || 'common';
    return {
      label: 'Microsoft',
      clientId: readKey('MICROSOFT_OAUTH_CLIENT_ID'),
      clientSecret: readKey('MICROSOFT_OAUTH_CLIENT_SECRET'),
      authEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      // Mail.Send is send-only; offline_access yields a refresh token.
      scope: readKey('MICROSOFT_OAUTH_SCOPE') || 'openid email offline_access https://graph.microsoft.com/Mail.Send',
      extraAuthParams: { prompt: 'consent', response_mode: 'query' }
    };
  }
  throw new EmailOAuthError(`Unknown email provider: ${provider}`, 400);
}

/** Whether a provider's OAuth app credentials are configured on this server. */
function providerConfigured(provider) {
  if (!isProvider(provider)) return false;
  const m = providerMeta(provider);
  return !!(m.clientId && m.clientSecret);
}

/** Which providers are usable right now, for the dashboard. */
function configuredProviders() {
  return PROVIDERS.filter(providerConfigured);
}
function anyProviderConfigured() {
  return configuredProviders().length > 0;
}

/**
 * The consent URL to send the tenant's browser to. `state` is our signed token
 * binding the callback to a tenant+provider; `redirectUri` must match one
 * registered on the OAuth app.
 */
function authorizeUrl(provider, { state, redirectUri }) {
  const m = providerMeta(provider);
  if (!m.clientId) throw new EmailOAuthError(`${m.label} email is not configured on this server`, 503);
  const params = new URLSearchParams({
    client_id: m.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: m.scope,
    state,
    ...m.extraAuthParams
  });
  return `${m.authEndpoint}?${params.toString()}`;
}

// The mailbox address from an OIDC id_token, without verifying the signature —
// we only use it as a display/From hint and it arrives over TLS straight from
// the provider's token endpoint, never from the client.
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return payload.email || payload.preferred_username || payload.upn || null;
  } catch {
    return null;
  }
}

async function tokenRequest(provider, bodyParams, fetchImpl) {
  const m = providerMeta(provider);
  if (!m.clientId || !m.clientSecret) throw new EmailOAuthError(`${m.label} email is not configured on this server`, 503);
  const params = new URLSearchParams({ client_id: m.clientId, client_secret: m.clientSecret, ...bodyParams });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(m.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: params.toString(),
      signal: controller.signal
    });
    const retryable = res.status >= 500 || res.status === 429;
    data = await res.json().catch(() => null);
    if (!res.ok) throw new EmailOAuthError(`${m.label} token request failed (${res.status}): ${data?.error || ''}`.trim(), 502, { retryable });
  } catch (err) {
    if (err instanceof EmailOAuthError) throw err;
    throw new EmailOAuthError(`${m.label} token request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  if (!data || data.error || !data.access_token) {
    throw new EmailOAuthError(`${m.label} token request rejected: ${data?.error || 'no access_token returned'}`, 502);
  }
  return data;
}

/**
 * Exchange the authorization code for tokens. Returns the refresh token (a
 * connection with no refresh token is unusable, so that's an error), the
 * initial access token + expiry, the granted scope and the mailbox address.
 */
async function exchangeCode(provider, { code, redirectUri, fetchImpl = fetch, now = Date.now() }) {
  if (!code) throw new EmailOAuthError('missing authorization code', 400);
  const data = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, fetchImpl);
  if (!data.refresh_token) {
    throw new EmailOAuthError(`${providerMeta(provider).label} did not return a refresh token — re-authorize with offline access`, 502);
  }
  return {
    refreshToken: String(data.refresh_token),
    accessToken: String(data.access_token),
    tokenExpiry: new Date(now + (Number(data.expires_in) || 3600) * 1000),
    scope: data.scope ? String(data.scope) : null,
    email: emailFromIdToken(data.id_token)
  };
}

/** Mint a fresh access token from a refresh token. */
async function refreshAccessToken(provider, { refreshToken, fetchImpl = fetch, now = Date.now() }) {
  if (!refreshToken) throw new EmailOAuthError('no refresh token on file', 400);
  const data = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
  return {
    accessToken: String(data.access_token),
    tokenExpiry: new Date(now + (Number(data.expires_in) || 3600) * 1000),
    // Google does not return a new refresh token on refresh; Microsoft may rotate it.
    refreshToken: data.refresh_token ? String(data.refresh_token) : null
  };
}

function isTokenFresh(tokenExpiry, now = Date.now()) {
  return !!tokenExpiry && new Date(tokenExpiry).getTime() - EXPIRY_SKEW_MS > now;
}

// RFC 2047 encode a header value only when it carries non-ASCII (so ASCII
// subjects stay readable in logs and clients).
function encodeHeader(value) {
  const s = String(value || '');
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

const addrList = (to) => (Array.isArray(to) ? to : [to]).filter(Boolean);

// A base64-bodied RFC 822 message for the Gmail API. Bodies are base64 so
// non-ASCII (e.g. Hindi) survives intact; multipart/alternative when both text
// and HTML are present.
function buildMimeMessage({ from, to, subject, text, html, replyTo }) {
  const b64 = (s) => Buffer.from(String(s || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const headers = [
    `From: ${from}`,
    `To: ${addrList(to).join(', ')}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0'
  ];
  if (html && text) {
    const boundary = `kgt_${crypto.randomBytes(12).toString('hex')}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(text), '',
      `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(html), '',
      `--${boundary}--`, ''
    ].join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }
  const content = html || text || '';
  headers.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64');
  return `${headers.join('\r\n')}\r\n\r\n${b64(content)}`;
}

async function httpSend(url, { accessToken, body, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      // 401 = token rejected (mint a new one); 429/5xx = transient.
      throw new EmailOAuthError(`send failed (${res.status}) ${detail}`.trim(), res.status === 401 ? 401 : 502, { retryable: res.status >= 500 || res.status === 429 });
    }
  } catch (err) {
    if (err instanceof EmailOAuthError) throw err;
    throw new EmailOAuthError(`send request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one message with a valid access token, via the provider's send-only API.
 * @param {string} provider
 * @param {{ accessToken: string, from: string, to: string|string[], subject: string, text?: string, html?: string, replyTo?: string }} msg
 * @param {{ fetchImpl?: Function }} [opts]
 */
async function sendEmail(provider, { accessToken, from, to, subject, text, html, replyTo }, { fetchImpl = fetch } = {}) {
  if (!accessToken) throw new EmailOAuthError('no access token', 401);
  if (provider === 'google') {
    const raw = Buffer.from(buildMimeMessage({ from, to, subject, text, html, replyTo }), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return httpSend('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { accessToken, body: { raw }, fetchImpl });
  }
  if (provider === 'microsoft') {
    const body = {
      message: {
        subject: String(subject || ''),
        body: { contentType: html ? 'HTML' : 'Text', content: html || text || '' },
        toRecipients: addrList(to).map((address) => ({ emailAddress: { address } })),
        ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {})
      },
      saveToSentItems: false
    };
    return httpSend('https://graph.microsoft.com/v1.0/me/sendMail', { accessToken, body, fetchImpl });
  }
  throw new EmailOAuthError(`Unknown email provider: ${provider}`, 400);
}

module.exports = {
  PROVIDERS,
  EmailOAuthError,
  isProvider,
  providerMeta,
  providerConfigured,
  configuredProviders,
  anyProviderConfigured,
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  isTokenFresh,
  sendEmail,
  buildMimeMessage,
  emailFromIdToken
};

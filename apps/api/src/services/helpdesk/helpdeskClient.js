const { isZohoConfigured, resolveDomains, refreshAccessToken } = require('../crm/zohoAuth');

// Pure helpdesk protocol for the two providers a tenant can connect (Feature 5):
//
//   Freshdesk   Basic auth with the account API key over https://<domain>/api/v2.
//               No OAuth — the tenant pastes a domain + API key.
//   Zoho Desk   OAuth via the platform's Zoho app (ZOHO_CLIENT_ID/SECRET, reused
//               from the CRM) plus a per-tenant refresh token, org id and
//               department. The access token is minted from the refresh token
//               (services/crm/zohoAuth.refreshAccessToken) against the tenant's
//               data-centre region; the Desk API lives at desk.zoho.<tld>.
//
// Everything here is network-only and injectable (fetchImpl) so unit tests never
// touch a provider. It never stores or logs secrets. Errors are mapped to a
// HelpdeskError carrying a safe message + status; nothing from a raw provider
// body (which can echo request data) is surfaced.

const TIMEOUT_MS = 15000;

// Zoho Desk hosts per data centre. The accounts host (token minting) comes from
// zohoAuth.resolveDomains; only the Desk API host differs from the CRM's.
const DESK_DOMAINS = {
  com: 'https://desk.zoho.com',
  in: 'https://desk.zoho.in',
  eu: 'https://desk.zoho.eu',
  au: 'https://desk.zoho.com.au',
  jp: 'https://desk.zoho.jp',
  ca: 'https://desk.zohocloud.ca',
  sa: 'https://desk.zoho.sa'
};

class HelpdeskError extends Error {
  constructor(message, statusCode = 502, { retryable = false, authFailure = false } = {}) {
    super(message);
    this.name = 'HelpdeskError';
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.authFailure = authFailure;
  }
}

/** The platform Zoho OAuth app (shared with the CRM) is configured. */
function isZohoDeskConfigured() {
  return isZohoConfigured();
}

/** A Freshdesk account base URL. Accepts a bare subdomain ("acme") or a full host. */
function freshdeskBase(domain) {
  const raw = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!raw) throw new HelpdeskError('missing Freshdesk domain', 400);
  const host = raw.includes('.') ? raw : `${raw}.freshdesk.com`;
  // A domain with path/query or odd characters is rejected rather than used to
  // build a request to an arbitrary host.
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new HelpdeskError('invalid Freshdesk domain', 400);
  return `https://${host}`;
}

function deskApiBase(region) {
  const { region: r } = resolveDomains(region);
  return `${DESK_DOMAINS[r] || DESK_DOMAINS.com}/api/v1`;
}

const basicAuth = (apiKey) => `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;

/** One HTTP request with a timeout. Maps 429/5xx + network/timeout to retryable errors. */
async function request({ method, url, headers = {}, body = null, fetchImpl = fetch, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    if (res.status === 429 || res.status >= 500) {
      throw new HelpdeskError(`${label} failed (${res.status})`, 502, { retryable: true });
    }
    let data = null;
    try { data = await res.json(); } catch { /* some endpoints return no body */ }
    if (res.status >= 400) {
      const authFailure = res.status === 401 || res.status === 403;
      // The status is safe to surface; the raw body (which can echo the request) is not.
      throw new HelpdeskError(`${label} rejected (${res.status})`, res.status === 401 || res.status === 403 ? 502 : res.status, { authFailure });
    }
    return { status: res.status, data };
  } catch (err) {
    if (err instanceof HelpdeskError) throw err;
    throw new HelpdeskError(`${label} request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// ── Freshdesk ────────────────────────────────────────────────────────────────

/** Confirm a domain + API key work (used at connect time). Throws on bad creds. */
async function verifyFreshdesk({ domain, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new HelpdeskError('missing Freshdesk API key', 400);
  await request({
    method: 'GET', url: `${freshdeskBase(domain)}/api/v2/tickets?per_page=1`,
    headers: { authorization: basicAuth(apiKey) }, fetchImpl, label: 'Freshdesk auth check'
  });
  return true;
}

/**
 * Create a Freshdesk ticket. Freshdesk requires a requester, so a contact email
 * is mandatory here; callers skip the push when they have none yet.
 * @returns {Promise<{ externalId: string }>}
 */
async function createFreshdeskTicket({ domain, apiKey, ticket, fetchImpl = fetch }) {
  if (!ticket?.email) throw new HelpdeskError('Freshdesk needs a requester email', 400);
  const body = {
    subject: ticket.subject,
    description: ticket.description,
    email: ticket.email,
    priority: ticket.priority || 2, // 1 low … 4 urgent; 2 = medium
    status: 2, // open
    source: 7, // chat
    tags: ticket.tags || []
  };
  const { data } = await request({
    method: 'POST', url: `${freshdeskBase(domain)}/api/v2/tickets`,
    headers: { authorization: basicAuth(apiKey) }, body, fetchImpl, label: 'Freshdesk ticket create'
  });
  if (!data?.id) throw new HelpdeskError('Freshdesk did not return a ticket id', 502);
  return { externalId: String(data.id) };
}

// ── Zoho Desk ────────────────────────────────────────────────────────────────

/** A fresh Zoho Desk access token from the integration's refresh token. */
async function deskAccessToken({ integration, fetchImpl = fetch, now = Date.now() }) {
  // refreshAccessToken reads only region + (encrypted) refreshToken, so it works
  // for a helpdesk row exactly as for a CRM row; the apiDomain it returns is the
  // CRM host, which we ignore — Desk uses its own host (deskApiBase).
  const { accessToken } = await refreshAccessToken({ integration, fetchImpl, now });
  return accessToken;
}

/** Confirm a refresh token + org id work (used at connect time). Throws on bad creds. */
async function verifyZohoDesk({ integration, fetchImpl = fetch, now = Date.now() }) {
  if (!integration?.orgId) throw new HelpdeskError('missing Zoho Desk org id', 400);
  const token = await deskAccessToken({ integration, fetchImpl, now });
  await request({
    method: 'GET', url: `${deskApiBase(integration.region)}/tickets?limit=1`,
    headers: { authorization: `Zoho-oauthtoken ${token}`, orgId: String(integration.orgId) },
    fetchImpl, label: 'Zoho Desk auth check'
  });
  return true;
}

/**
 * Create a Zoho Desk ticket. Zoho Desk requires a department and a contact; the
 * contact is created from the visitor's email/name inline. Returns the ticket id.
 * @returns {Promise<{ externalId: string }>}
 */
async function createZohoDeskTicket({ integration, ticket, fetchImpl = fetch, now = Date.now() }) {
  if (!integration?.departmentId) throw new HelpdeskError('Zoho Desk needs a department id', 400);
  const token = await deskAccessToken({ integration, fetchImpl, now });
  const contact = { lastName: ticket.contactName || 'Website visitor' };
  if (ticket.email) contact.email = ticket.email;
  const body = {
    subject: ticket.subject,
    description: ticket.description,
    departmentId: String(integration.departmentId),
    channel: 'Chat',
    contact
  };
  const { data } = await request({
    method: 'POST', url: `${deskApiBase(integration.region)}/tickets`,
    headers: { authorization: `Zoho-oauthtoken ${token}`, orgId: String(integration.orgId) },
    body, fetchImpl, label: 'Zoho Desk ticket create'
  });
  if (!data?.id) throw new HelpdeskError('Zoho Desk did not return a ticket id', 502);
  return { externalId: String(data.id) };
}

module.exports = {
  HelpdeskError,
  isZohoDeskConfigured,
  freshdeskBase,
  deskApiBase,
  DESK_DOMAINS,
  verifyFreshdesk,
  createFreshdeskTicket,
  verifyZohoDesk,
  createZohoDeskTicket,
  deskAccessToken
};

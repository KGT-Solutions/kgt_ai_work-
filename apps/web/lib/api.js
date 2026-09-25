export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

// Operator console session (pages/login.js). The public signup wizard
// (pages/register.js) never has one — its calls go to unauthenticated routes.
const TOKEN_KEY = 'hubToken';

export function getToken() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSession(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked — the session simply won't survive a reload
  }
}

async function send(path, init) {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return send(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

function requestMultipart(path, formData) {
  return send(path, { method: 'POST', body: formData });
}

const tenant = (id) => `/api/v1/tenants/${encodeURIComponent(id)}`;

export const api = {
  // ── Operator session
  login: (email, password) => request('/api/v1/operator/login', { method: 'POST', body: { email, password } }),
  getMe: () => request('/api/v1/operator/me'),

  // ── Tenants (operator only)
  listTenants: () => request('/api/v1/tenants'),
  createTenant: (payload) => request('/api/v1/tenants', { method: 'POST', body: payload }),
  getTenant: (tenantId) => request(tenant(tenantId)),
  updateTenant: (tenantId, payload) => request(tenant(tenantId), { method: 'PATCH', body: payload }),
  getTenantDocuments: (tenantId) => request(`${tenant(tenantId)}/documents`),
  createTenantDocument: (tenantId, payload) =>
    request(`${tenant(tenantId)}/documents`, { method: 'POST', body: payload }),
  updateTenantDocument: (tenantId, documentId, payload) =>
    request(`${tenant(tenantId)}/documents/${encodeURIComponent(documentId)}`, { method: 'PATCH', body: payload }),
  deleteTenantDocument: (tenantId, documentId) =>
    request(`${tenant(tenantId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  scrapeTenantUrl: (tenantId, url) => request(`${tenant(tenantId)}/scrape`, { method: 'POST', body: { url } }),
  getTenantTickets: (tenantId) => request(`${tenant(tenantId)}/tickets`),
  getTenantUsage: (tenantId) => request(`${tenant(tenantId)}/usage`),

  // ── Tenant API keys (plaintext is returned only by createApiKey)
  listApiKeys: (tenantId) => request(`${tenant(tenantId)}/api-keys`),
  createApiKey: (tenantId, label) => request(`${tenant(tenantId)}/api-keys`, { method: 'POST', body: { label } }),
  revokeApiKey: (tenantId, keyId, { force = false } = {}) =>
    request(`${tenant(tenantId)}/api-keys/${encodeURIComponent(keyId)}${force ? '?force=true' : ''}`, { method: 'DELETE' }),

  // ── Public self-serve signup wizard (pages/register.js) — no auth;
  // see apps/api/src/routes/publicRegister.routes.js.
  // authorized: the visitor ticked the crawl-authorization box — the API refuses to crawl without it.
  analyzeCompanyUrl: (url, { authorized } = {}) =>
    request('/api/v1/public/register/analyze', { method: 'POST', body: { url, authorized: authorized === true } }),
  analyzeCompanyPdf: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestMultipart('/api/v1/public/register/analyze-pdf', formData);
  },
  completeRegistration: (payload) => request('/api/v1/public/register/complete', { method: 'POST', body: payload })
};

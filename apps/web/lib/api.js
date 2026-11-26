// The API for every browser call and every embed snippet the dashboard hands
// out, compiled into the bundle at build time (NEXT_PUBLIC_API_URL; Docker
// sets it from PUBLIC_API_URL). A production build without it points at the
// production API, never at a localhost no visitor's browser can reach;
// `npm run dev` keeps the local one.
const DEFAULT_API_URL = process.env.NODE_ENV === 'production' ? 'https://api.kgt.solutions' : 'http://localhost:4100';
export const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

// Two separate sessions, stored under separate keys:
//   operator — KGT staff, /admin pages   (typ "operator" JWT)
//   client   — a customer company, /dashboard (typ "client" JWT)
// The API rejects each token on the other's routes; keeping them apart here
// also means signing in as one never silently reuses the other.
const TOKEN_KEYS = { operator: 'kgtStaffToken', client: 'kgtClientToken' };

export function getToken(kind) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEYS[kind]);
  } catch {
    return null;
  }
}

export function setToken(kind, token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEYS[kind], token);
    else window.localStorage.removeItem(TOKEN_KEYS[kind]);
  } catch {
    // storage blocked — the session simply won't survive a reload
  }
}

// What to say when a failed response has no JSON { error } from the API:
// it came from something in between (a proxy or tunnel) or the API is down.
function fallbackMessage(status) {
  if (status === 413) return 'That upload is too large for the server to accept. Try a smaller file.';
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  if ([502, 503, 504, 522, 524].includes(status)) {
    return 'The server took too long to respond or is unavailable. Please try again in a moment.';
  }
  return `Something went wrong (HTTP ${status}). Please try again.`;
}

async function send(path, init) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    // The browser's own "Failed to fetch": no response could be read at all
    // (offline, server down or restarting, or a response blocked by CORS).
    const err = new Error("Couldn't reach the server. Check your connection and try again — if it keeps happening, the server may be restarting.");
    err.status = 0;
    throw err;
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || fallbackMessage(res.status));
    err.status = res.status;
    err.data = data; // the API's extra fields, e.g. { retryAfter, attemptsLeft, code }
    throw err;
  }
  return data;
}

function authHeaders(auth) {
  const token = auth ? getToken(auth) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// auth: 'operator' | 'client' | undefined (public)
function request(path, { method = 'GET', body, auth } = {}) {
  return send(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth) },
    body: body ? JSON.stringify(body) : undefined
  });
}

// No Content-Type header: the browser sets multipart/form-data with its boundary.
function requestMultipart(path, formData, auth) {
  return send(path, { method: 'POST', headers: authHeaders(auth), body: formData });
}

const enc = encodeURIComponent;

// Chat Logs filters (Feature 16) → query string. 'all'/empty values are omitted
// so the URL only carries the filters actually set.
function sessionQuery({ botType = 'all', status = 'all', escalated = 'all', q = '', from = '', to = '', cursor } = {}) {
  const p = new URLSearchParams();
  if (botType && botType !== 'all') p.set('botType', botType);
  if (status && status !== 'all') p.set('status', status);
  if (escalated && escalated !== 'all') p.set('escalated', escalated);
  if (q) p.set('q', q);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

// Fetch a CSV with the session's auth header and trigger a browser download. CSV
// can't go through send() (which parses JSON); on an error the API's JSON { error }
// is still surfaced. Returns the filename used.
async function downloadCsv(path, auth) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(auth) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || fallbackMessage(res.status));
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const filename = match ? match[1] : 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { filename };
}

export const api = {
  // ── KGT staff
  staffLogin: (email, password) => request('/api/v1/operator/login', { method: 'POST', body: { email, password } }),
  staffMe: () => request('/api/v1/operator/me', { auth: 'operator' }),
  listTenants: () => request('/api/v1/tenants', { auth: 'operator' }),
  createTenant: (payload) => request('/api/v1/tenants', { method: 'POST', body: payload, auth: 'operator' }),
  getTenant: (tenantId) => request(`/api/v1/tenants/${enc(tenantId)}`, { auth: 'operator' }),
  updateTenant: (tenantId, payload) =>
    request(`/api/v1/tenants/${enc(tenantId)}`, { method: 'PATCH', body: payload, auth: 'operator' }),

  // ── Client company
  clientLogin: (email, password) => request('/api/v1/client/login', { method: 'POST', body: { email, password } }),
  clientMe: () => request('/api/v1/client/me', { auth: 'client' }),
  // Forgot password: a 6-digit code to the account's email (404 EMAIL_NOT_FOUND
  // when there's no account), then the code + new password in one call.
  requestPasswordReset: (email) => request('/api/v1/public/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (email, otp, newPassword) => request('/api/v1/public/auth/reset-password', { method: 'POST', body: { email, otp, newPassword } }),

  // ── Public signup wizard (pages/register.js) — no auth
  // authorized: the visitor ticked the crawl-authorization box — the API refuses to crawl without it.
  analyzeCompanyUrl: (url, { authorized } = {}) =>
    request('/api/v1/public/register/analyze', { method: 'POST', body: { url, authorized: authorized === true } }),
  // Any supported file: PDF, Word (.docx), .txt, .md or a .zip of them -> { pages, files }
  analyzeCompanyFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestMultipart('/api/v1/public/register/analyze-file', formData);
  },
  analyzeCompanyPdf: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestMultipart('/api/v1/public/register/analyze-pdf', formData);
  },
  // Signup email verification: a 6-digit code to the address; verifying returns
  // the verificationToken /register/complete requires (as emailVerificationToken).
  sendSignupOtp: (email) => request('/api/v1/public/auth/send-otp', { method: 'POST', body: { email } }),
  verifySignupOtp: (email, otp) => request('/api/v1/public/auth/verify-otp', { method: 'POST', body: { email, otp } }),
  // Readiness audit of the wizard's pages before anything is created: { readinessScore, readinessLevel, pillarScores, ... }
  preflightAudit: (payload) => request('/api/v1/public/register/preflight-audit', { method: 'POST', body: payload }),
  completeRegistration: (payload) => request('/api/v1/public/register/complete', { method: 'POST', body: payload })
};

// One tenant's workspace (documents, keys, test chat, tickets, usage), with
// the same methods whoever is looking: a client sees its own tenant only
// (the API resolves it from the session), staff reach any tenant by id.
// components/workspace/* are written against this interface.
function workspace(base, auth) {
  const r = (path, opts = {}) => request(`${base}${path}`, { ...opts, auth });
  return {
    listDocuments: () => r('/documents'),
    createDocument: (payload) => r('/documents', { method: 'POST', body: payload }),
    updateDocument: (id, payload) => r(`/documents/${enc(id)}`, { method: 'PATCH', body: payload }),
    deleteDocument: (id) => r(`/documents/${enc(id)}`, { method: 'DELETE' }),
    // category: a DOC_CATEGORIES id to file every section under, or '' to auto-detect per section
    uploadPdf: (file, category) => {
      const formData = new FormData();
      if (category) formData.append('category', category);
      formData.append('file', file);
      return requestMultipart(`${base}/documents/pdf`, formData, auth);
    },
    // Any supported file (PDF, .docx, .txt, .md, .zip): { documentsCreated, files }
    uploadFile: (file, { category, botScope } = {}) => {
      const formData = new FormData();
      if (category) formData.append('category', category);
      if (botScope) formData.append('botScope', botScope);
      formData.append('file', file);
      return requestMultipart(`${base}/documents/file`, formData, auth);
    },
    importWebsite: (url, { authorized } = {}) => r('/scrape', { method: 'POST', body: { url, authorized: authorized === true } }),
    // Full-site sitemap sync + weekly auto-refresh + change reports (Feature 2).
    // getCrawlSource → { url, weeklyEnabled, lastRunAt, lastRunId, lastStatus }.
    getCrawlSource: () => r('/crawl-source'),
    saveCrawlSource: (payload) => r('/crawl-source', { method: 'PUT', body: payload }),
    // "Sync now": run a sitemap sync immediately → the finished run (counts + report).
    syncCrawlSource: ({ url, authorized } = {}) => r('/crawl-source/sync', { method: 'POST', body: { url, authorized: authorized === true } }),
    // Change-report history, and one run's full per-page detail.
    listCrawlRuns: () => r('/crawl-runs'),
    getCrawlRun: (id) => r(`/crawl-runs/${enc(id)}`),
    // Generic outbound webhooks (Feature 8). list → { webhooks, events, max }.
    // createWebhook/rotateWebhookSecret return the plaintext `secret` ONCE.
    listWebhooks: () => r('/webhooks'),
    createWebhook: (payload) => r('/webhooks', { method: 'POST', body: payload }),
    updateWebhook: (id, patch) => r(`/webhooks/${enc(id)}`, { method: 'PATCH', body: patch }),
    deleteWebhook: (id) => r(`/webhooks/${enc(id)}`, { method: 'DELETE' }),
    rotateWebhookSecret: (id) => r(`/webhooks/${enc(id)}/rotate-secret`, { method: 'POST' }),
    testWebhook: (id) => r(`/webhooks/${enc(id)}/test`, { method: 'POST' }),
    listWebhookDeliveries: (webhookId) => r(`/webhooks/deliveries${webhookId ? `?webhookId=${enc(webhookId)}` : ''}`),
    // Google Sheets sync (Feature 8). Status never includes tokens. connectSheets
    // returns { authUrl } — the page sends the browser there to grant consent.
    getSheetsSync: () => r('/sheets-sync'),
    connectSheets: () => r('/sheets-sync/connect', { method: 'POST' }),
    disconnectSheets: () => r('/sheets-sync/disconnect', { method: 'POST' }),
    saveSheetsSettings: (patch) => r('/sheets-sync/settings', { method: 'PUT', body: patch }),
    // Product catalog: structured rows + counts. Upload is multipart CSV.
    getCatalog: () => r('/catalog'),
    uploadCatalog: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return requestMultipart(`${base}/catalog`, formData, auth);
    },
    // Spreadsheet (.xlsx) catalog import (Feature 1): preview the workbook's
    // sheets/columns/sample rows, then import the chosen sheet + column→field
    // mapping. The file is re-uploaded with the mapping; nothing is stored between.
    previewCatalogXlsx: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return requestMultipart(`${base}/catalog/xlsx/preview`, formData, auth);
    },
    // selections: { sheets: [{ index, headerRow?, mapping: { name, sku?, price?, description?, category?, imageUrl?, productUrl? } }] }
    importCatalogXlsx: (file, selections) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('selections', JSON.stringify(selections));
      return requestMultipart(`${base}/catalog/xlsx/import`, formData, auth);
    },
    // Per-item catalog CRUD (name, sku, price, description, category, imageUrl).
    listProducts: () => r('/catalog/products'),
    addProduct: (product) => r('/catalog/products', { method: 'POST', body: product }),
    updateProduct: (id, patch) => r(`/catalog/products/${enc(id)}`, { method: 'PATCH', body: patch }),
    deleteProduct: (id) => r(`/catalog/products/${enc(id)}`, { method: 'DELETE' }),
    listApiKeys: () => r('/api-keys'),
    // Has the embed widget loaded on the customer's site yet?
    // { installed, seenAt, url, keyPrefix }.
    getInstallStatus: () => r('/install-status'),
    createApiKey: (label) => r('/api-keys', { method: 'POST', body: { label } }),
    revokeApiKey: (keyId, { force = false } = {}) => r(`/api-keys/${enc(keyId)}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
    // The websites allowed to use a key from a browser; [] allows any.
    setApiKeyOrigins: (keyId, allowedOrigins) => r(`/api-keys/${enc(keyId)}`, { method: 'PATCH', body: { allowedOrigins } }),
    chat: (payload) => r('/chat', { method: 'POST', body: payload }),
    // Voice input: POST an audio blob, get back { text, language } from Groq Whisper.
    transcribe: (blob, filename = 'voice.webm') => {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      return requestMultipart(`${base}/transcribe`, formData, auth);
    },
    // Speech-to-Speech: POST the visitor's spoken audio + chosen language and get
    // back the DB-grounded answer as text AND spoken audio (base64), in that
    // same language: { text, answer, audio, audioMimeType, language, sessionId, ... }.
    voiceChat: (blob, { botType = 'support', language = 'en', sessionId } = {}, filename = 'voice.webm') => {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      formData.append('botType', botType);
      formData.append('language', language);
      if (sessionId) formData.append('sessionId', sessionId);
      return requestMultipart(`${base}/voice-chat`, formData, auth);
    },
    // Custom outbound SMTP. The password is write-only: getSmtpConfig returns
    // it masked, and saving/testing with the mask reuses the stored one.
    getSmtpConfig: () => r('/smtp-config'),
    saveSmtpConfig: (payload) => r('/smtp-config', { method: 'PUT', body: payload }),
    testSmtpConfig: (payload) => r('/smtp-config/test', { method: 'POST', body: payload }),
    // Email Connection (Feature 10): Google/Microsoft send-only OAuth + per-email
    // toggles, alongside custom SMTP. Status never includes tokens. connectEmail
    // returns { authUrl } — the page sends the browser there to grant consent;
    // the backend callback finishes the link and redirects back here.
    getEmailConnection: () => r('/email-connection'),
    connectEmail: (provider) => r('/email-connection/connect', { method: 'POST', body: { provider } }),
    disconnectEmail: () => r('/email-connection/disconnect', { method: 'POST' }),
    saveEmailToggles: (patch) => r('/email-connection/toggles', { method: 'PUT', body: patch }),
    // CRM integrations (Zoho). Status never includes tokens. connectCrm returns
    // { authUrl } — the page sends the browser there to grant consent; the
    // backend callback finishes the link and redirects back here.
    getCrmStatus: () => r('/crm'),
    connectCrm: (region) => r('/crm/connect', { method: 'POST', body: { region } }),
    disconnectCrm: () => r('/crm/disconnect', { method: 'POST' }),
    // HubSpot CRM (Feature 9). Same contract as Zoho above — status never includes
    // tokens, connectHubspot returns { authUrl } for the consent redirect. One CRM
    // per tenant: connect is refused (409) while Zoho is connected.
    getHubspotStatus: () => r('/crm/hubspot'),
    connectHubspot: () => r('/crm/hubspot/connect', { method: 'POST' }),
    disconnectHubspot: () => r('/crm/hubspot/disconnect', { method: 'POST' }),
    // Bot Branding & Theme Studio: brand kit + three generated widget designs.
    // selectTheme(null) puts the widget back on its classic look.
    getBranding: () => r('/branding'),
    selectTheme: (themeId) => r('/branding/select', { method: 'POST', body: { themeId } }),
    scanBranding: (url) => r('/branding/scan', { method: 'POST', body: { url } }),
    updateBranding: (changes) => r('/branding', { method: 'PATCH', body: changes }),
    // A PNG / JPEG / WebP logo (≤ 2 MB) that becomes THE logo; remove clears any logo.
    uploadBrandLogo: (file) => {
      const formData = new FormData();
      formData.append('logo', file);
      return requestMultipart(`${base}/branding/logo`, formData, auth);
    },
    removeBrandLogo: () => r('/branding/logo', { method: 'DELETE' }),
    // Client-facing Instructions Editor (Feature 11): per-assistant tone/style/
    // length + guidance. The locked grounding/safety rules stay server-side and
    // can't be overridden. getInstructions returns the current settings plus the
    // preset catalog; every save is versioned and can be restored.
    getInstructions: (botType = 'support') => r(`/instructions?botType=${enc(botType)}`),
    saveInstructions: (payload) => r('/instructions', { method: 'PUT', body: payload }),
    listInstructionVersions: (botType = 'support') => r(`/instructions/versions?botType=${enc(botType)}`),
    restoreInstructionVersion: (botType, versionId) => r('/instructions/restore', { method: 'POST', body: { botType, versionId } }),
    // Starter questions written from this tenant's documents: { status, supportFaqs, salesFaqs, generatedAt }
    getFaqs: () => r('/faqs'),
    regenerateFaqs: () => r('/faqs/regenerate', { method: 'POST' }),
    listTickets: () => r('/tickets'),
    // "Add the answer": publish an answer to an unanswered ticket as a knowledge
    // document and mark the ticket resolved. { answer, category?='FAQ', botScope? }
    // → { ticket: { id, status: 'answered' }, document }.
    answerTicket: (id, payload) => r(`/tickets/${enc(id)}/answer`, { method: 'POST', body: payload }),
    // Visitors who left an email, with transcript and AI summary: { leads, counts, filters }.
    // botType: 'all' | 'sales' | 'support'; status: 'all' | 'NEW' | 'CONTACTED' — filtered by the API.
    listLeads: ({ botType = 'all', status = 'all' } = {}) => r(`/leads?botType=${enc(botType)}&status=${enc(status)}`),
    updateLeadStatus: (id, status) => r(`/leads/${enc(id)}`, { method: 'PATCH', body: { status } }),
    // Every conversation with its AI summary, leads and escalation flag:
    // { filters, sessions, nextCursor }, 30 per page. Chat Logs filters (Feature
    // 16): botType, status ('active'|'paused'), escalated ('yes'|'no'), q (search
    // text), from/to (ISO dates) — all optional, applied by the API.
    listSessions: (filters = {}) => {
      const qs = sessionQuery(filters);
      return r(`/sessions${qs ? `?${qs}` : ''}`);
    },
    // CSV export of the filtered chat logs (Feature 16), and of one transcript.
    // Each triggers a browser download; returns { filename }.
    exportSessionsCsv: (filters = {}) => {
      const qs = sessionQuery(filters);
      return downloadCsv(`${base}/sessions/export.csv${qs ? `?${qs}` : ''}`, auth);
    },
    exportSessionCsv: (id) => downloadCsv(`${base}/sessions/${enc(id)}/export.csv`, auth),
    // One conversation: its summary, leads and every message, oldest first.
    getSession: (id) => r(`/sessions/${enc(id)}`),
    summarizeSession: (id) => r(`/sessions/${enc(id)}/summarize`, { method: 'POST' }),
    // Pause / resume a conversation: a paused one gets no bot replies until resumed.
    pauseSession: (id) => r(`/sessions/${enc(id)}/pause`, { method: 'PATCH' }),
    resumeSession: (id) => r(`/sessions/${enc(id)}/resume`, { method: 'PATCH' }),
    // Human Escalation (Feature 5): trigger keywords + business hours + reply ETA.
    getEscalation: () => r('/escalation'),
    saveEscalation: (payload) => r('/escalation', { method: 'PUT', body: payload }),
    // Helpdesk (Feature 5): connect Zoho Desk / Freshdesk. Status never includes
    // secrets. connect verifies the credentials before storing them (encrypted).
    getHelpdesk: () => r('/helpdesk'),
    connectHelpdesk: (payload) => r('/helpdesk/connect', { method: 'POST', body: payload }),
    setHelpdeskEnabled: (isEnabled) => r('/helpdesk', { method: 'PATCH', body: { isEnabled } }),
    disconnectHelpdesk: () => r('/helpdesk/disconnect', { method: 'POST' }),
    // Chat-log retention (Feature 16): fixed 30-day server policy (read-only) +
    // a guarded purge (dry-run by default). No setter — the period isn't tenant-configurable.
    getRetention: () => r('/retention'),
    purgeSessions: ({ dryRun = true } = {}) => r('/retention/purge', { method: 'POST', body: { dryRun } }),
    // Conversations where a bot missed (under 25% confidence, or no knowledge-base answer), each with its question:
    // { below, totalSessions, totalWeakAnswers, sessions, nextPage }
    listImprovements: ({ botType = 'all', page = 0 } = {}) => r(`/improvements?botType=${enc(botType)}&page=${page}`),
    // Who gets lead and needs-attention alerts: { teamEmail, recipients, lowConfidenceBelow }
    getNotifications: () => r('/notifications'),
    updateNotifications: (teamEmail) => r('/notifications', { method: 'PATCH', body: { teamEmail } }),
    getUsage: () => r('/usage'),
    getDailyUsage: (days = 30) => r(`/usage/daily?days=${days}`),
    // Readiness audit: run now (saved), or read the saved one: { report, stale, running }
    runReadinessAudit: () => r('/preflight-audit', { method: 'POST' }),
    getReadiness: () => r('/readiness'),
    // Mark gap items "Optional / Not applicable" (keys like "sales:pricing") and
    // recompute the saved report's scores — no AI call. Returns the updated report.
    setIgnoredRequirements: (ignoredRequirements) => r('/readiness/ignored', { method: 'PATCH', body: { ignoredRequirements } }),
    // How the documents split between the bots: { totals, documents: [{ id, title, botScope, sections, counts }] }
    getKnowledgeDistribution: () => r('/knowledge/distribution'),
    // Which bots the company deploys: 'support' | 'sales' | 'both'
    setBotPreference: (botPreference) => r('/bot-preference', { method: 'PATCH', body: { botPreference } }),
    // Guardrails config (scaffold): { maxMessages, windowSeconds, limitMessage,
    // spamCheckEnabled, blockedCountries, imagesEnabled }.
    getGuardrails: () => r('/guardrails'),
    updateGuardrails: (patch) => r('/guardrails', { method: 'PATCH', body: patch })
  };
}

export const clientWorkspace = () => workspace('/api/v1/client/workspace', 'client');
export const staffWorkspace = (tenantId) => workspace(`/api/v1/tenants/${enc(tenantId)}`, 'operator');

// Stand-in for the key in snippets shown after the real key is gone (keys
// are stored hashed and can't be read back).
// Absolute URL for a visitor's uploaded chat image, served by the content-
// addressed public route (routes/chatImages.routes.js). The extension is
// cosmetic — the server sets the real type — so a key alone resolves.
export const chatImageUrl = (tenantId, key) => `${BASE_URL}/api/v1/public/chat-images/${enc(tenantId)}/${enc(key)}`;

export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY';

// bot: 'sales' | 'support' — the widget sends it as botType on every message
// (public/widgets/tenant-chat-widget.js). Without it the widget shows both bots.
export const embedSnippet = (slug, apiKey, bot) =>
  `<script src="${BASE_URL}/widgets/tenant-chat-widget.js"\n        data-tenant-id="${slug}"\n        data-api-key="${apiKey || API_KEY_PLACEHOLDER}"${bot ? `\n        data-bot="${bot}"` : ''}\n        defer></script>`;

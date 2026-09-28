// The authorization a company must give before its website is crawled. The
// text the web app shows (CRAWL_CONSENT_TEXT in apps/web/pages/register.js
// and components/TenantWorkspace.js) must match this — when the wording
// changes, change all copies and bump the version, so every TenantConsent
// row records exactly what was agreed to.
const CRAWL_CONSENT_STATEMENT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and ' +
  'extract content from this domain.';
const CRAWL_CONSENT_VERSION = '2026-09-24';

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Data for a TenantConsent row (the caller adds tenantId). */
function crawlConsentRecord({ url, email, req }) {
  return {
    kind: 'WEBSITE_CRAWL',
    domain: hostOf(url),
    statement: CRAWL_CONSENT_STATEMENT,
    statementVersion: CRAWL_CONSENT_VERSION,
    email,
    ipAddress: req.ip || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 512) || null
  };
}

module.exports = { CRAWL_CONSENT_STATEMENT, CRAWL_CONSENT_VERSION, hostOf, crawlConsentRecord };

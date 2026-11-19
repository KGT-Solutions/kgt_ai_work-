const defaultPrisma = require('../lib/prisma');
const { store, keys } = require('../lib/sharedStore');
const { scanBrand, analyzeLogoUrl, fetchLogoImage } = require('./shared/crawler');
const { normalizeHex } = require('./shared/color');
const { generateThemes, sanitizeTheme, sanitizeBrand, sanitizeLogoAppearance, logoBadgeFor, safeUrl } = require('./shared/themeGenerator');
const { prepareLogo, logoAssetPath, LOGO_PIPELINE_VERSION } = require('./shared/logoUpload');

// Bot Branding & Theme Studio: a tenant's brand kit (logo, colours, font
// hints), the three widget designs generated from it, and which design the
// embeddable widget renders (TenantBranding in schema.prisma).
//
// Selection — why null matters: selectedThemeId null keeps the classic widget
// look. Opening the Studio creates a brand kit for a tenant that has none, and
// that must never change a live widget by itself. A new signup whose website
// gave us a real brand colour gets the first design applied straight away
// (autoSelect); everyone else applies one from the Studio, and can go back to
// the classic look the same way.
//
// Design ids are stable (minimal | vibrant | corporate), so a rescan or a new
// brand colour re-colours the chosen design instead of unselecting it.

const MAX_BOT_NAME = 40;

// Invisible formatting characters: zero-width spaces/joiners, bidi marks and
// embeddings/overrides/isolates, word joiner, BOM. A right-to-left override
// (U+202E) makes "Support\u202Etroppus" render as something else entirely —
// header text that isn't what it says. Same set as the widget's applyBotName.
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** A display name with markup, control and invisible formatting characters and runs of spaces removed. */
function cleanBotName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}

class BrandingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BrandingError';
    this.statusCode = statusCode;
  }
}

// The stored designs, each with its logo badge re-derived from the logo in use
// right now. The badge is presentation policy (logoBadgeFor), not data: deriving
// it on read means a policy improvement reaches every tenant's live widget
// without a rescan, and can never disagree with the current logo.
function themesOf(row) {
  const appearance = effectiveLogo(row).appearance;
  return (Array.isArray(row?.generatedThemes) ? row.generatedThemes : [])
    .map(sanitizeTheme)
    .filter(Boolean)
    .map((t) => ({ ...t, logoBadge: sanitizeTheme({ ...t, logoBadge: logoBadgeFor(t, appearance) }).logoBadge }));
}

function tokensOf(row) {
  return row?.brandTokens && typeof row.brandTokens === 'object' && !Array.isArray(row.brandTokens) ? row.brandTokens : {};
}

// The brand kit a stored row represents, in sanitizeBrand's shape.
function kitOf(row) {
  const tokens = tokensOf(row);
  return {
    logoUrl: row?.logoUrl || null,
    logoAppearance: tokens.logoAppearance || null,
    faviconUrl: row?.faviconUrl || null,
    colors: Array.isArray(row?.scrapedColors) ? row.scrapedColors : [],
    primaryColor: tokens.primaryColor || null,
    secondaryColor: tokens.secondaryColor || null,
    accentColor: tokens.accentColor || null,
    fontHints: Array.isArray(tokens.fontHints) ? tokens.fontHints : [],
    siteName: tokens.siteName || null
  };
}

// The logo actually in use. A hosted logo (customLogoKey → TenantLogoAsset)
// wins over the linked URL. It is either the client's own upload, or — origin
// 'link' — our cleaned copy of a linked logo whose white box was knocked out
// (shared/logoUpload.js prepareLogo). A rescan may replace a cleaned copy, but
// never an upload. The hosted URL is a relative path on this API; the widget
// and the dashboard prefix their own API base.
function effectiveLogo(row) {
  const tokens = tokensOf(row);
  if (row?.tenantId && row.customLogoKey) {
    const reversedKey = typeof tokens.customLogoReversedKey === 'string' ? tokens.customLogoReversedKey : null;
    const appearance = sanitizeLogoAppearance(tokens.customLogoAppearance);
    return {
      url: logoAssetPath(row.tenantId, row.customLogoKey),
      reversedUrl: reversedKey ? logoAssetPath(row.tenantId, reversedKey) : null,
      appearance: appearance && reversedKey ? { ...appearance, reversible: true } : appearance,
      source: tokens.customLogoOrigin === 'link' ? 'link' : 'upload',
      cleaned: tokens.customLogoCleaned === true
    };
  }
  const kit = kitOf(row);
  return {
    url: safeUrl(kit.logoUrl),
    reversedUrl: null,
    appearance: sanitizeLogoAppearance(kit.logoAppearance),
    source: kit.logoUrl ? 'link' : null,
    cleaned: false
  };
}

/** The logo URL a design shows: the reversed variant when its badge asks for it. */
function logoUrlFor(theme, logo) {
  return theme?.logoBadge?.variant === 'reversed' && logo.reversedUrl ? logo.reversedUrl : logo.url;
}

/**
 * A cleaned, hosted copy of a linked logo when it sits on a white box, else
 * null (the logo is then shown from its own URL, as before). Never throws.
 */
async function cleanLinkedLogo(url, { fetchImage = fetchLogoImage, prepare = prepareLogo } = {}) {
  try {
    const bytes = await fetchImage(url);
    if (!bytes) return null;
    const logo = await prepare(bytes, { linked: true });
    // Hosted only when it helps: a box was removed, or a reversed variant exists.
    return logo.knockedOut || logo.reversed ? logo : null;
  } catch {
    return null;
  }
}

/**
 * A prepared logo as the customLogo saveBrandKit commits — including the image
 * row to insert. Nothing is written here: the image and the branding row that
 * points at it are written together, in one transaction (saveBrandKit).
 */
function hostedLogo(logo, origin) {
  return {
    key: logo.key,
    appearance: logo.appearance,
    origin,
    cleaned: logo.knockedOut === true,
    reversedKey: logo.reversed?.key || null,
    pipeline: LOGO_PIPELINE_VERSION,
    asset: {
      key: logo.key, data: logo.data, mimeType: logo.mimeType, width: logo.width, height: logo.height,
      reversedKey: logo.reversed?.key || null, reversedData: logo.reversed?.data || null
    }
  };
}

// "This linked logo was tried at this pipeline version and couldn't be
// cleaned": recorded so saves and rescans don't download it again and again.
const checkedMarker = (url) => `${LOGO_PIPELINE_VERSION}:${url}`;

/**
 * Bring the logo in use up to the current pipeline, so a tenant whose logo
 * predates a cleaning improvement gets it on their next rescan or save — no
 * re-upload. A hosted logo made by an older pipeline is re-processed from its
 * stored image; a linked logo still shown from its own URL is downloaded and
 * cleaned (hosted only when that changes something) — once per URL and
 * pipeline version: a failure is remembered (linkedLogoChecked), so a URL
 * that can't be cleaned isn't fetched on every save. Never throws.
 * @returns {Promise<{ customLogo?: object, linkedLogoChecked?: string }>} for saveBrandKit; {} when nothing changes
 */
async function refreshActiveLogo(tenant, row, prisma, { cleanLogo = cleanLinkedLogo, prepare = prepareLogo } = {}) {
  try {
    const tokens = tokensOf(row);
    if (row?.customLogoKey) {
      if (tokens.customLogoPipeline === LOGO_PIPELINE_VERSION) return {};
      const asset = await prisma.tenantLogoAsset.findUnique({
        where: { tenantId_key: { tenantId: tenant.id, key: row.customLogoKey } }, select: { data: true }
      });
      if (!asset?.data) return {};
      const logo = await prepare(Buffer.from(asset.data), { linked: true });
      const next = hostedLogo(logo, tokens.customLogoOrigin === 'link' ? 'link' : 'upload');
      return { customLogo: { ...next, cleaned: next.cleaned || tokens.customLogoCleaned === true } };
    }
    const url = kitOf(row).logoUrl;
    if (!url || tokens.linkedLogoChecked === checkedMarker(url)) return {};
    const cleaned = await cleanLogo(url);
    return cleaned ? { customLogo: hostedLogo(cleaned, 'link') } : { linkedLogoChecked: checkedMarker(url) };
  } catch (err) {
    console.warn(`[branding] logo refresh failed for tenant ${tenant.id}: ${err.message}`);
    return {};
  }
}

// Run `fn` in one database transaction. A client without $transaction — a
// transaction client already, or a test double — runs it directly.
function inTransaction(prisma, fn) {
  return typeof prisma.$transaction === 'function' ? prisma.$transaction(fn) : fn(prisma);
}

// Serialize writers of one tenant's branding: a row lock held to the end of
// the transaction, so two concurrent logo changes commit one after the other
// and each sees the other's result. No row yet: the upsert's unique index
// serializes the creates instead.
async function lockBranding(tx, tenantId) {
  if (typeof tx.$executeRaw === 'function') {
    await tx.$executeRaw`SELECT 1 FROM "TenantBranding" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
  }
}

/** What the dashboard's Studio renders. Never includes anything secret — there is nothing secret here. */
function toView(row, suggestedUrl = null) {
  const themes = themesOf(row);
  const kit = kitOf(row);
  const logo = effectiveLogo(row);
  const selected = row?.selectedThemeId && themes.some((t) => t.id === row.selectedThemeId) ? row.selectedThemeId : null;
  return {
    botName: row?.botName || null,
    logoUrl: logo.url,
    logoAppearance: logo.appearance,
    logoSource: logo.source, // 'upload' | 'link' | null
    logoCleaned: logo.cleaned, // its white box was removed so it sits on any header
    logoUrlReversed: logo.reversedUrl, // for designs whose badge has variant 'reversed'
    linkedLogoUrl: kit.logoUrl, // the scanned/pasted URL, shown in the URL field
    faviconUrl: kit.faviconUrl,
    colors: kit.colors,
    primaryColor: kit.primaryColor,
    fontHints: kit.fontHints,
    siteName: kit.siteName,
    themes,
    selectedThemeId: selected,
    source: row?.source || 'fallback',
    sourceUrl: row?.sourceUrl || suggestedUrl || null,
    scannedAt: row?.scannedAt || null
  };
}

/**
 * Store a brand kit and regenerate the three designs from it — and, when the
 * logo changes, its image — atomically. In ONE transaction, holding the
 * tenant's row lock: the new image row is inserted (content-keyed, beside the
 * old one), the branding row switched to it, and only then is every other
 * image row of the tenant deleted. So the live customLogoKey always has its
 * row: a failed save rolls back entirely (the old logo stays live), and two
 * concurrent logo changes commit one after the other (the last one wins, with
 * its image intact). Network work — downloads, image processing — is done by
 * the callers BEFORE this, never inside the transaction.
 * @param {{ id: string, name: string }} tenant
 * @param {{ brand: object|null, source: 'website'|'manual'|'fallback', sourceUrl?: string|null, autoSelect?: boolean,
 *   customLogo?: object|null, linkedLogoChecked?: string|null }} input
 *   brand is untrusted (a scan or a request body) and is validated here.
 *   autoSelect applies the first design only when the kit has a real brand colour.
 *   customLogo: the hosted logo to use (hostedLogo(): with its `asset` it is a
 *   new image to insert); null removes it; omitted keeps whatever is stored.
 *   linkedLogoChecked: refreshActiveLogo's "tried, couldn't clean" marker; omitted keeps it.
 */
async function saveBrandKit(tenant, { brand, source, sourceUrl = null, autoSelect = false, customLogo, linkedLogoChecked }, { prisma = defaultPrisma } = {}) {
  const kit = sanitizeBrand(brand);
  const saved = await inTransaction(prisma, async (tx) => {
    await lockBranding(tx, tenant.id);
    const existing = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    const keep = customLogo === undefined;
    const prev = tokensOf(existing);
    const customLogoKey = keep ? existing?.customLogoKey || null : customLogo?.key || null;
    const customLogoAppearance = customLogoKey ? sanitizeLogoAppearance(keep ? prev.customLogoAppearance : customLogo?.appearance) : null;
    const customLogoOrigin = customLogoKey ? ((keep ? prev.customLogoOrigin : customLogo?.origin) === 'link' ? 'link' : 'upload') : null;
    const customLogoCleaned = customLogoKey ? (keep ? prev.customLogoCleaned : customLogo?.cleaned) === true : false;
    const customLogoReversedKey = customLogoKey ? (keep ? prev.customLogoReversedKey : customLogo?.reversedKey) || null : null;
    const customLogoPipeline = customLogoKey ? (keep ? prev.customLogoPipeline : customLogo?.pipeline) || null : null;
    // Each design seats the logo actually shown: the hosted one when there is one.
    const themes = generateThemes(customLogoKey ? { ...kit, logoAppearance: customLogoAppearance } : kit);

    let selectedThemeId = existing?.selectedThemeId && themes.some((t) => t.id === existing.selectedThemeId)
      ? existing.selectedThemeId
      : null;
    if (!selectedThemeId && autoSelect && kit.primaryColor) selectedThemeId = themes[0].id;

    const data = {
      logoUrl: kit.logoUrl,
      customLogoKey,
      faviconUrl: kit.faviconUrl,
      scrapedColors: kit.colors,
      brandTokens: {
        logoAppearance: kit.logoAppearance,
        customLogoAppearance,
        customLogoOrigin,
        customLogoCleaned,
        customLogoReversedKey,
        customLogoPipeline,
        linkedLogoChecked: linkedLogoChecked !== undefined ? linkedLogoChecked : prev.linkedLogoChecked || null,
        primaryColor: kit.primaryColor,
        secondaryColor: kit.secondaryColor,
        accentColor: kit.accentColor,
        fontHints: kit.fontHints,
        siteName: kit.siteName
      },
      generatedThemes: themes,
      selectedThemeId,
      source,
      sourceUrl: safeUrl(sourceUrl) || existing?.sourceUrl || null,
      scannedAt: source === 'website' ? new Date() : existing?.scannedAt || null
    };

    const asset = customLogo?.asset;
    if (asset) {
      // Same key = same bytes (a content hash), so an existing row is already right.
      await tx.tenantLogoAsset.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: asset.key } },
        create: { tenantId: tenant.id, ...asset },
        update: {}
      });
    }
    const row = await tx.tenantBranding.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, ...data },
      update: data
    });
    // Purge only now, inside the transaction, after the switch: every image
    // row of this tenant except the live one.
    await tx.tenantLogoAsset.deleteMany({
      where: { tenantId: tenant.id, ...(row.customLogoKey ? { key: { not: row.customLogoKey } } : {}) }
    });
    return row;
  });
  await bumpBrandingGeneration(tenant.id);
  return saved;
}

// The site the tenant authorised us to crawl at signup, as a rescan suggestion.
async function suggestedWebsite(tenantId, prisma) {
  const consent = await prisma.tenantConsent
    .findFirst({ where: { tenantId, kind: 'WEBSITE_CRAWL' }, orderBy: { createdAt: 'desc' }, select: { domain: true } })
    .catch(() => null);
  return consent?.domain ? `https://${consent.domain}` : null;
}

// The tenant's row, creating a neutral brand kit (classic look kept) when it has none.
async function ensureRow(tenant, prisma) {
  const row = await prisma.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
  return row || saveBrandKit(tenant, { brand: null, source: 'fallback' }, { prisma });
}

/** The Studio view for a tenant; creates a neutral kit (and three designs) on first visit. */
async function getBranding(tenant, { prisma = defaultPrisma } = {}) {
  const row = await ensureRow(tenant, prisma);
  return toView(row, await suggestedWebsite(tenant.id, prisma));
}

/**
 * Apply a design to the live widget, or null to go back to the classic look.
 * @throws {BrandingError} for an id that isn't one of this tenant's designs
 */
async function selectTheme(tenant, themeId, { prisma = defaultPrisma } = {}) {
  if (themeId !== null && (typeof themeId !== 'string' || !themeId)) {
    throw new BrandingError('themeId must be one of the design ids, or null for the classic look');
  }
  const row = await ensureRow(tenant, prisma);
  if (themeId !== null && !themesOf(row).some((t) => t.id === themeId)) {
    throw new BrandingError('That design no longer exists — refresh the page and choose again.');
  }
  const updated = await prisma.tenantBranding.update({ where: { tenantId: tenant.id }, data: { selectedThemeId: themeId } });
  await bumpBrandingGeneration(tenant.id);
  return toView(updated, await suggestedWebsite(tenant.id, prisma));
}

/**
 * Re-read the logo and colours from a website and regenerate the designs.
 * Anything the scan doesn't find keeps its previous value, so a rescan of a
 * site that blocks us can't wipe a good brand kit.
 * @returns {Promise<object>} the Studio view plus { found: { logo, colors } }
 * @throws {CrawlerError} when the address is unsafe, unreachable or not a page
 */
async function rescanBranding(tenant, url, { prisma = defaultPrisma, scan = scanBrand, cleanLogo = cleanLinkedLogo } = {}) {
  const scanned = sanitizeBrand(await scan(url));
  const existing = await prisma.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
  const previous = kitOf(existing);
  const hasColors = !!scanned.primaryColor;
  const brand = {
    logoUrl: scanned.logoUrl || previous.logoUrl,
    // The analysis travels with the logo it describes.
    logoAppearance: scanned.logoUrl ? scanned.logoAppearance : previous.logoAppearance,
    faviconUrl: scanned.faviconUrl || previous.faviconUrl,
    siteName: scanned.siteName || previous.siteName,
    fontHints: scanned.fontHints.length ? scanned.fontHints : previous.fontHints,
    ...(hasColors
      ? { primaryColor: scanned.primaryColor, secondaryColor: scanned.secondaryColor, accentColor: scanned.accentColor, colors: scanned.colors }
      : { primaryColor: previous.primaryColor, secondaryColor: previous.secondaryColor, accentColor: previous.accentColor, colors: previous.colors })
  };
  // A newly found logo is cleaned (white box or plate removed) into a hosted
  // copy when that changes anything. A logo the client uploaded themselves is
  // never replaced by a scan — but it, or a kept logo, is brought up to the
  // current cleaning pipeline (refreshActiveLogo), so a rescan always leaves
  // a clean logo.
  let logoChange = {}; // { customLogo?, linkedLogoChecked? } for saveBrandKit; {} keeps what's stored
  const hasUpload = !!existing?.customLogoKey && tokensOf(existing).customLogoOrigin !== 'link';
  if (scanned.logoUrl && !hasUpload) {
    const cleaned = await cleanLogo(scanned.logoUrl);
    logoChange = cleaned
      ? { customLogo: hostedLogo(cleaned, 'link') }
      : { customLogo: null, linkedLogoChecked: checkedMarker(scanned.logoUrl) };
  } else if (existing) {
    logoChange = await refreshActiveLogo(tenant, existing, prisma, { cleanLogo });
  }
  // saveBrandKit swaps the image and purges the old one atomically.
  const row = await saveBrandKit(tenant, { brand, source: 'website', sourceUrl: url, ...logoChange }, { prisma });
  return { ...toView(row, await suggestedWebsite(tenant.id, prisma)), found: { logo: !!scanned.logoUrl, colors: hasColors } };
}

const blank = (v) => v === null || v === '';

/**
 * Manual edits from the Studio: a logo URL, a primary colour and/or the bot's
 * display name ('' or null clears any of them). Everything is validated before
 * anything is written. A new logo or colour regenerates the designs (a new
 * logo is downloaded and analysed so each design seats it cleanly); a name
 * change alone leaves the designs as they are.
 * @param {{ logoUrl?: string|null, primaryColor?: string|null, botName?: string|null }} changes
 * @param {{ prisma?: object, analyzeLogo?: (url: string) => Promise<object|null>,
 *   cleanLogo?: (url: string) => Promise<object|null> }} [deps]
 * @throws {BrandingError} for a malformed logo URL, colour or name, or an empty request
 */
async function updateBrandKit(tenant, { logoUrl, primaryColor, botName } = {}, { prisma = defaultPrisma, analyzeLogo = analyzeLogoUrl, cleanLogo = cleanLinkedLogo } = {}) {
  if (logoUrl === undefined && primaryColor === undefined && botName === undefined) {
    throw new BrandingError('Send a logoUrl, a primaryColor and/or a botName');
  }

  let nextLogo;
  if (logoUrl !== undefined && !blank(logoUrl)) {
    nextLogo = safeUrl(logoUrl);
    if (!nextLogo) throw new BrandingError('The logo must be an http(s) image address');
  }
  let nextColor;
  if (primaryColor !== undefined && !blank(primaryColor)) {
    nextColor = normalizeHex(primaryColor);
    if (!nextColor) throw new BrandingError('The brand colour must be a hex value such as #1a73e8');
  }
  let nextName;
  if (botName !== undefined && !blank(botName)) {
    nextName = cleanBotName(botName);
    if (!nextName) throw new BrandingError('The bot name needs at least one letter or number');
    if (nextName.length > MAX_BOT_NAME) throw new BrandingError(`Keep the bot name to ${MAX_BOT_NAME} characters or fewer`);
  }

  let row = await ensureRow(tenant, prisma);

  if (logoUrl !== undefined || primaryColor !== undefined) {
    const brand = kitOf(row);
    // Setting or clearing the logo URL is choosing the logo, so it replaces an
    // uploaded one; a colour-only edit leaves the logo alone. A new URL on a
    // white box gets a cleaned, hosted copy (cleanLinkedLogo).
    let logoChange = {}; // { customLogo?, linkedLogoChecked? } for saveBrandKit; {} keeps what's stored
    if (logoUrl !== undefined) {
      const changed = (nextLogo || null) !== brand.logoUrl;
      const hostedIsUpload = !!row.customLogoKey && tokensOf(row).customLogoOrigin !== 'link';
      brand.logoUrl = nextLogo || null;
      if (!brand.logoUrl) {
        brand.logoAppearance = null;
        logoChange = { customLogo: null };
      } else if (changed) {
        brand.logoAppearance = await analyzeLogo(brand.logoUrl).catch(() => null);
        const cleaned = await cleanLogo(brand.logoUrl);
        logoChange = cleaned
          ? { customLogo: hostedLogo(cleaned, 'link') }
          : { customLogo: null, linkedLogoChecked: checkedMarker(brand.logoUrl) };
      } else if (hostedIsUpload) {
        logoChange = { customLogo: null };
      }
    }
    // Any other brand-kit save brings the logo in use up to the current
    // cleaning pipeline, so existing tenants get clean logos just by saving.
    if (!('customLogo' in logoChange)) logoChange = { ...logoChange, ...(await refreshActiveLogo(tenant, row, prisma, { cleanLogo })) };
    if (primaryColor !== undefined) {
      brand.primaryColor = nextColor || null;
      if (nextColor) brand.colors = [nextColor, ...brand.colors.filter((c) => c !== nextColor)];
    }
    // saveBrandKit swaps (or drops) the image and purges the old one atomically.
    row = await saveBrandKit(tenant, { brand, source: 'manual', ...logoChange }, { prisma });
  }
  if (botName !== undefined) {
    row = await prisma.tenantBranding.update({ where: { tenantId: tenant.id }, data: { botName: nextName || null } });
    await bumpBrandingGeneration(tenant.id);
  }
  return toView(row, await suggestedWebsite(tenant.id, prisma));
}

/**
 * Make an uploaded image the logo. The file is validated, re-encoded, analysed
 * and a white box knocked out (shared/logoUpload.js prepareLogo), stored as the
 * tenant's one TenantLogoAsset, and takes over from any linked logo.
 * @param {Buffer} buffer the uploaded file
 * @throws {LogoUploadError} for anything that isn't a usable PNG/JPEG/WebP
 */
async function uploadLogo(tenant, buffer, { prisma = defaultPrisma, prepare = prepareLogo } = {}) {
  const logo = await prepare(buffer); // validation and image work: before any write

  const brand = kitOf(await ensureRow(tenant, prisma));
  // One logo slot: the upload replaces the linked logo rather than hiding it,
  // so removing the upload later shows the initial, not a stale scanned logo.
  brand.logoUrl = null;
  brand.logoAppearance = null;
  // The image row and the switch to it commit together (saveBrandKit).
  const row = await saveBrandKit(tenant, { brand, source: 'manual', customLogo: hostedLogo(logo, 'upload') }, { prisma });
  return toView(row, await suggestedWebsite(tenant.id, prisma));
}

/**
 * Remove the logo — uploaded or linked — so the widget shows the company's
 * initial. The designs are regenerated for a logo-less header; the image rows
 * are purged in the same transaction (saveBrandKit).
 */
async function removeLogo(tenant, { prisma = defaultPrisma } = {}) {
  const brand = kitOf(await ensureRow(tenant, prisma));
  brand.logoUrl = null;
  brand.logoAppearance = null;
  const row = await saveBrandKit(tenant, { brand, source: 'manual', customLogo: null }, { prisma });
  return toView(row, await suggestedWebsite(tenant.id, prisma));
}

const LOGO_KEY_RE = /^[0-9a-f]{24}$/;

/**
 * Which stored image a public logo URL names, WITHOUT reading any image bytes:
 * { column: 'data'|'reversedData', rowKey, mimeType }, or null when the key
 * isn't a live image of this tenant. Unauthenticated callers reach this (the
 * tenant id is public in every logo URL), so a guessed key costs one indexed
 * lookup of a few short columns — never megabytes of image data.
 */
async function resolveLogoKey(tenantId, key, { prisma = defaultPrisma } = {}) {
  if (typeof tenantId !== 'string' || typeof key !== 'string' || !LOGO_KEY_RE.test(key) || tenantId.length > 64) return null;
  const match = await prisma.tenantLogoAsset.findFirst({
    where: { tenantId, OR: [{ key }, { reversedKey: key }] },
    select: { key: true, reversedKey: true, mimeType: true }
  });
  if (!match) return null;
  return { column: match.key === key ? 'data' : 'reversedData', rowKey: match.key, mimeType: match.mimeType };
}

/**
 * A logo's bytes for the public asset route, or null. The key is checked
 * first (resolveLogoKey); then exactly ONE binary column of ONE row is read.
 * A replaced or removed logo's row is gone, so its URL stops working.
 */
async function getLogoAsset(tenantId, key, { prisma = defaultPrisma } = {}) {
  const hit = await resolveLogoKey(tenantId, key, { prisma });
  if (!hit) return null;
  const row = await prisma.tenantLogoAsset.findUnique({
    where: { tenantId_key: { tenantId, key: hit.rowKey } },
    select: { [hit.column]: true }
  });
  const data = row?.[hit.column];
  return data ? { data, mimeType: hit.mimeType } : null;
}

// ── Public theme cache. The widget fetches its theme on every page view of a
// customer's site — before anyone opens the chat — so uncached, each view cost
// a database query. An entry lives THEME_CACHE_TTL_MS and is tied to the
// tenant's branding generation (a shared-store counter every branding write
// bumps), so a change made on any replica is picked up on the next request,
// not after the TTL.
const THEME_CACHE_TTL_MS = 60 * 1000;
// With the shared store unreachable there's no generation to invalidate by, so
// an entry is trusted only this long — short enough that a change made on
// another replica shows within seconds, long enough that a Redis outage
// doesn't turn every widget page view on every customer site into a DB query.
const THEME_FALLBACK_TTL_MS = 5 * 1000;
const THEME_CACHE_MAX = 5000; // tenants; the oldest entry goes first
const themeCache = new Map(); // tenantId -> { at, generation, value }

// NaN when the shared store can't answer (Redis down) — which never equals a
// cached generation, so the cache is simply bypassed.
async function brandingGeneration(tenantId) {
  try {
    return await store().number(keys.brandingGeneration(tenantId));
  } catch {
    return NaN;
  }
}

/** Invalidate a tenant's cached widget theme on every replica. Best-effort: the TTL bounds staleness. */
async function bumpBrandingGeneration(tenantId) {
  themeCache.delete(tenantId);
  try {
    await store().incr(keys.brandingGeneration(tenantId));
  } catch { /* the TTL still bounds how stale another replica can be */ }
}

/** Empty this process's theme cache (tests). */
function clearThemeCache() {
  themeCache.clear();
}

async function loadPublicTheme(tenant, prisma) {
  const classic = { companyName: tenant.name, botName: null, logoUrl: null, theme: null };
  try {
    const row = await prisma.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    const botName = row?.botName ? cleanBotName(row.botName).slice(0, MAX_BOT_NAME) || null : null;
    const theme = row?.selectedThemeId ? themesOf(row).find((t) => t.id === row.selectedThemeId) : null;
    if (!theme) return { ok: true, value: { ...classic, botName } };
    return { ok: true, value: { companyName: tenant.name, botName, logoUrl: logoUrlFor(theme, effectiveLogo(row)), theme } };
  } catch (err) {
    console.warn(`[branding] theme lookup failed for tenant ${tenant.id}: ${err.message}`);
    return { ok: false, value: classic };
  }
}

/**
 * What the embeddable widget needs: the bot's display name, the applied
 * design and the logo. The name applies on its own; theme is null (classic
 * look) when no design is applied. Any error gives the plain classic widget,
 * so a branding problem can never stop a widget from loading.
 * @param {{ prisma?: object, clock?: () => number }} [deps]
 */
async function publicTheme(tenant, { prisma = defaultPrisma, clock = Date.now } = {}) {
  const generation = await brandingGeneration(tenant.id);
  const storeDown = Number.isNaN(generation);
  const hit = themeCache.get(tenant.id);
  const age = hit ? clock() - hit.at : Infinity;
  if (hit && !storeDown && hit.generation === generation && age < THEME_CACHE_TTL_MS) return hit.value;
  // Store unreachable: any entry younger than the fallback TTL will do (it
  // can't be checked against a generation, so it isn't trusted for longer).
  if (hit && storeDown && age < THEME_FALLBACK_TTL_MS) return hit.value;

  const { ok, value } = await loadPublicTheme(tenant, prisma);
  // Only a successful read is cached: a database error must not pin the
  // classic look. Read with the store down, the entry carries no generation
  // (NaN never equals one), so once the store is back it is refetched at once.
  if (ok) {
    if (themeCache.size >= THEME_CACHE_MAX && !themeCache.has(tenant.id)) themeCache.delete(themeCache.keys().next().value);
    themeCache.set(tenant.id, { at: clock(), generation, value });
  }
  return value;
}

module.exports = {
  BrandingError,
  saveBrandKit,
  getBranding,
  selectTheme,
  rescanBranding,
  updateBrandKit,
  uploadLogo,
  removeLogo,
  getLogoAsset,
  resolveLogoKey,
  cleanBotName,
  publicTheme,
  clearThemeCache,
  toView,
  MAX_BOT_NAME,
  THEME_CACHE_TTL_MS,
  THEME_FALLBACK_TTL_MS
};

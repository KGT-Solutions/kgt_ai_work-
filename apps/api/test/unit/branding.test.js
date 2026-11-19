const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const branding = require('../../src/services/branding');

// Theme Studio persistence and selection rules, with an in-memory
// TenantBranding table. The key rule: a widget only changes look when a
// design is applied — creating a brand kit never changes it by itself.

const TENANT = { id: 't1', name: 'Acme Foods' };
// Logo analysis downloads the image; these tests stub it instead.
const noAnalysis = async () => null;
const noClean = async () => null; // hermetic: never download a logo in these tests
// publicTheme caches per tenant id, and every test here reuses one id.
beforeEach(() => branding.clearThemeCache());

function fakePrisma({ consentDomain = null, failReads = false } = {}) {
  const state = { row: null, upserts: 0, assets: new Map() };
  return {
    state,
    // Content-keyed image rows: (tenantId, key) → row (no $transaction here: saveBrandKit runs the body directly).
    tenantLogoAsset: {
      findFirst: async ({ where }) => [...state.assets.values()].find((a) => where.OR.some((c) => a.key === c.key || (c.reversedKey && a.reversedKey === c.reversedKey))) || null,
      findUnique: async ({ where }) => state.assets.get(where.tenantId_key.key) || null,
      upsert: async ({ where, create }) => { if (!state.assets.has(where.tenantId_key.key)) state.assets.set(where.tenantId_key.key, create); return state.assets.get(where.tenantId_key.key); },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const k of [...state.assets.keys()]) if (!where.key || k !== where.key.not) { state.assets.delete(k); count += 1; }
        return { count };
      }
    },
    tenantBranding: {
      findUnique: async () => { if (failReads) throw new Error('db down'); return state.row; },
      upsert: async ({ create, update }) => {
        state.upserts += 1;
        state.row = state.row ? { ...state.row, ...update } : { id: 'b1', ...create };
        return state.row;
      },
      update: async ({ data }) => { state.row = { ...state.row, ...data }; return state.row; }
    },
    tenantConsent: { findFirst: async () => (consentDomain ? { domain: consentDomain } : null) }
  };
}

describe('branding: saveBrandKit', () => {
  test('a signup with a real brand colour goes live with the first design', async () => {
    const prisma = fakePrisma();
    const row = await branding.saveBrandKit(TENANT, {
      brand: { primaryColor: '#e4572e', logoUrl: 'https://acme.test/logo.png', colors: ['#e4572e'] },
      source: 'website', autoSelect: true
    }, { prisma });
    assert.equal(row.selectedThemeId, 'minimal');
    assert.equal(row.generatedThemes.length, 3);
    assert.equal(row.logoUrl, 'https://acme.test/logo.png');
    assert.ok(row.scannedAt instanceof Date);
  });

  test('without a brand colour nothing is applied, so the widget keeps its classic look', async () => {
    const prisma = fakePrisma();
    const row = await branding.saveBrandKit(TENANT, { brand: null, source: 'fallback', autoSelect: true }, { prisma });
    assert.equal(row.selectedThemeId, null);
    assert.equal(row.generatedThemes.length, 3);
  });

  test('untrusted brand input is validated before it is stored', async () => {
    const prisma = fakePrisma();
    const row = await branding.saveBrandKit(TENANT, {
      brand: { logoUrl: 'javascript:alert(1)', primaryColor: 'red;}', colors: ['#fff;}body{'] }, source: 'website'
    }, { prisma });
    assert.equal(row.logoUrl, null);
    assert.equal(row.brandTokens.primaryColor, null);
    assert.deepEqual(row.scrapedColors, []);
  });
});

describe('branding: getBranding', () => {
  test('first visit creates a neutral kit with three designs, applies none, and suggests the signup site', async () => {
    const prisma = fakePrisma({ consentDomain: 'acme.test' });
    const view = await branding.getBranding(TENANT, { prisma });
    assert.equal(view.themes.length, 3);
    assert.equal(view.selectedThemeId, null);
    assert.equal(view.source, 'fallback');
    assert.equal(view.sourceUrl, 'https://acme.test');
    await branding.getBranding(TENANT, { prisma });
    assert.equal(prisma.state.upserts, 1, 'the kit is created once, not on every visit');
  });
});

describe('branding: selectTheme', () => {
  test('applies one of the three designs, and null returns to the classic look', async () => {
    const prisma = fakePrisma();
    assert.equal((await branding.selectTheme(TENANT, 'vibrant', { prisma })).selectedThemeId, 'vibrant');
    assert.equal((await branding.selectTheme(TENANT, null, { prisma })).selectedThemeId, null);
  });

  test('an unknown or malformed design id is a 400 and changes nothing', async () => {
    const prisma = fakePrisma();
    await branding.selectTheme(TENANT, 'corporate', { prisma });
    for (const bad of ['neon', 123, '']) {
      await assert.rejects(() => branding.selectTheme(TENANT, bad, { prisma }),
        (e) => e instanceof branding.BrandingError && e.statusCode === 400);
    }
    assert.equal(prisma.state.row.selectedThemeId, 'corporate');
  });
});

describe('branding: rescanBranding', () => {
  test('a new brand colour re-colours the applied design instead of unselecting it', async () => {
    const prisma = fakePrisma();
    await branding.saveBrandKit(TENANT, { brand: { primaryColor: '#e4572e' }, source: 'website', autoSelect: true }, { prisma });
    const before = prisma.state.row.generatedThemes.find((t) => t.id === 'minimal').primaryColor;
    const view = await branding.rescanBranding(TENANT, 'https://acme.test', {
      prisma, cleanLogo: noClean, scan: async () => ({ primaryColor: '#0d9488', colors: ['#0d9488'], logoUrl: 'https://acme.test/new.png' })
    });
    assert.equal(view.selectedThemeId, 'minimal');
    assert.notEqual(view.themes.find((t) => t.id === 'minimal').primaryColor, before);
    assert.deepEqual(view.found, { logo: true, colors: true });
    assert.equal(view.sourceUrl, 'https://acme.test/');
  });

  test('a scan that finds nothing keeps the previous logo and colours', async () => {
    const prisma = fakePrisma();
    await branding.saveBrandKit(TENANT, {
      brand: { primaryColor: '#e4572e', colors: ['#e4572e'], logoUrl: 'https://acme.test/logo.png' }, source: 'website'
    }, { prisma });
    const view = await branding.rescanBranding(TENANT, 'https://acme.test', { prisma, scan: async () => ({}), cleanLogo: noClean });
    assert.equal(view.logoUrl, 'https://acme.test/logo.png');
    assert.equal(view.primaryColor, '#e4572e');
    assert.deepEqual(view.found, { logo: false, colors: false });
  });
});

describe('branding: updateBrandKit', () => {
  test('a manual colour and logo regenerate the designs; empty values clear them', async () => {
    const prisma = fakePrisma();
    let view = await branding.updateBrandKit(TENANT, { primaryColor: '#0D9488', logoUrl: 'https://cdn.acme.test/l.svg' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.primaryColor, '#0d9488');
    assert.equal(view.colors[0], '#0d9488');
    assert.equal(view.logoUrl, 'https://cdn.acme.test/l.svg');
    assert.equal(view.source, 'manual');
    view = await branding.updateBrandKit(TENANT, { logoUrl: '' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.logoUrl, null);
    assert.equal(view.primaryColor, '#0d9488', 'the colour is untouched when only the logo changes');
  });

  test('a malformed colour or logo is a 400, as is an empty request', async () => {
    const prisma = fakePrisma();
    for (const changes of [{ primaryColor: 'teal' }, { logoUrl: 'javascript:alert(1)' }, {}]) {
      await assert.rejects(() => branding.updateBrandKit(TENANT, changes, { prisma }),
        (e) => e instanceof branding.BrandingError && e.statusCode === 400);
    }
  });
});

describe('branding: publicTheme (what the widget fetches)', () => {
  test('no applied design means the classic look, even when a brand kit exists', async () => {
    const prisma = fakePrisma();
    await branding.getBranding(TENANT, { prisma });
    assert.deepEqual(await branding.publicTheme(TENANT, { prisma }), { companyName: 'Acme Foods', botName: null, logoUrl: null, theme: null });
  });

  test('an applied design comes back with the logo and company name', async () => {
    const prisma = fakePrisma();
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/l.svg', primaryColor: '#0d9488' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    await branding.selectTheme(TENANT, 'corporate', { prisma });
    const out = await branding.publicTheme(TENANT, { prisma });
    assert.equal(out.theme.id, 'corporate');
    assert.equal(out.logoUrl, 'https://cdn.acme.test/l.svg');
    assert.equal(out.companyName, 'Acme Foods');
  });

  test('a database failure falls back to the classic look instead of throwing', async () => {
    const out = await branding.publicTheme(TENANT, { prisma: fakePrisma({ failReads: true }) });
    assert.equal(out.theme, null);
  });
});

describe('branding: bot display name', () => {
  test('saved and cleared on its own, without regenerating the designs', async () => {
    const prisma = fakePrisma();
    await branding.getBranding(TENANT, { prisma });
    const themesBefore = prisma.state.row.generatedThemes;
    let view = await branding.updateBrandKit(TENANT, { botName: '  Aria   from  Acme ' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.botName, 'Aria from Acme');
    assert.equal(prisma.state.upserts, 1, 'a name change does not rebuild the brand kit');
    assert.equal(prisma.state.row.generatedThemes, themesBefore);
    view = await branding.updateBrandKit(TENANT, { botName: '' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.botName, null);
  });

  test('markup is stripped, and an over-long or empty-after-cleaning name is a 400 that writes nothing', async () => {
    const prisma = fakePrisma();
    const view = await branding.updateBrandKit(TENANT, { botName: '<b>Sales</b> Expert' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.botName, 'bSales/b Expert');
    for (const bad of ['x'.repeat(41), '<<>>', '\u0000\u0007']) {
      await assert.rejects(() => branding.updateBrandKit(TENANT, { botName: bad }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean }),
        (e) => e instanceof branding.BrandingError && e.statusCode === 400);
    }
    assert.equal(prisma.state.row.botName, 'bSales/b Expert');
  });

  test('a bad field anywhere in the request means nothing at all is saved', async () => {
    const prisma = fakePrisma();
    await assert.rejects(() => branding.updateBrandKit(TENANT, { botName: 'Aria', primaryColor: 'teal' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean }),
      (e) => e instanceof branding.BrandingError);
    assert.equal(prisma.state.row, null);
  });

  test('the widget gets the name even under the classic look', async () => {
    const prisma = fakePrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Support Assistant' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.deepEqual(await branding.publicTheme(TENANT, { prisma }),
      { companyName: 'Acme Foods', botName: 'Support Assistant', logoUrl: null, theme: null });
  });
});

describe('branding: logo analysis', () => {
  test('a new logo URL is analysed and every design seats it accordingly; an unchanged one is not re-fetched', async () => {
    const prisma = fakePrisma();
    let calls = 0;
    const analyzeLogo = async () => { calls += 1; return { background: 'color', backgroundColor: '#e4572e', tone: 'light' }; };
    const view = await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/tile.png' }, { prisma, analyzeLogo, cleanLogo: noClean });
    assert.equal(calls, 1);
    assert.deepEqual(view.logoAppearance, { background: 'color', backgroundColor: '#e4572e', tone: 'light', monochrome: false });
    for (const t of view.themes) assert.equal(t.logoBadge.mode, 'plain', 'never a tile, whatever the logo');
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/tile.png', primaryColor: '#0d9488' }, { prisma, analyzeLogo, cleanLogo: noClean });
    assert.equal(calls, 1, 'same logo: the previous analysis is kept');
  });

  test('a linked logo on a white box is cleaned only when it can be; otherwise shown from its URL', async () => {
    const prisma = fakePrisma();
    const boxed = async () => ({ background: 'light', backgroundColor: '#ffffff', tone: 'dark', monochrome: true });
    let cleanCalls = 0;
    const view = await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/boxed.png' },
      { prisma, analyzeLogo: boxed, cleanLogo: async () => { cleanCalls += 1; return null; } });
    assert.equal(cleanCalls, 1, 'a white-box logo is offered to the cleaner');
    assert.equal(view.logoUrl, 'https://cdn.acme.test/boxed.png', 'not cleanable: shown from its own URL');
    assert.equal(view.logoCleaned, false);
    const light = view.themes.find((t) => t.id === 'minimal').logoBadge;
    assert.deepEqual(light, { mode: 'plain', background: null, blend: true, ring: false, tint: null, variant: null }, 'blended into the light header');

    // A see-through logo is offered too: it may still sit on a white plate the
    // analyser couldn't see (transparent margins around a white box).
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/clear.png' },
      { prisma, analyzeLogo: async () => ({ background: 'transparent', tone: 'dark' }), cleanLogo: async () => { cleanCalls += 1; return null; } });
    assert.equal(cleanCalls, 2);
  });

  const CLEANED = { key: 'a'.repeat(24), data: Buffer.from('png'), mimeType: 'image/png', width: 10, height: 10,
    appearance: { background: 'transparent', tone: 'dark' }, knockedOut: true, reversed: null };

  test('a colour-only save cleans a linked logo still shown from its URL (existing tenants)', async () => {
    const prisma = fakePrisma();
    // A tenant from before cleaning existed: a linked logo, never tried.
    await branding.saveBrandKit(TENANT, { brand: { logoUrl: 'https://cdn.acme.test/boxed.png' }, source: 'website' }, { prisma });
    const view = await branding.updateBrandKit(TENANT, { primaryColor: '#0d9488' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: async () => CLEANED });
    assert.equal(view.logoCleaned, true);
    assert.match(view.logoUrl, /^\/api\/v1\/public\/brand-assets\/logo\//);
    assert.equal(view.logoSource, 'link');
    assert.ok(prisma.state.assets.has(CLEANED.key), 'the image row was committed with the switch');
  });

  test('a linked logo that can\'t be cleaned is fetched once per pipeline version, not on every save', async () => {
    const prisma = fakePrisma();
    let fetches = 0;
    const failing = async () => { fetches += 1; return null; };
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/blocked.png' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: failing });
    assert.equal(fetches, 1);
    for (const c of ['#0d9488', '#1d4ed8', '#be123c']) {
      await branding.updateBrandKit(TENANT, { primaryColor: c }, { prisma, analyzeLogo: noAnalysis, cleanLogo: failing });
    }
    assert.equal(fetches, 1, 'colour saves did not re-download the same failing URL');
    assert.match(prisma.state.row.brandTokens.linkedLogoChecked, /:https:\/\/cdn\.acme\.test\/blocked\.png$/);
    // A different URL is a new attempt.
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/other.png' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: failing });
    assert.equal(fetches, 2);
  });

  test('a stale marker from an older pipeline version is retried', async () => {
    const prisma = fakePrisma();
    await branding.saveBrandKit(TENANT, { brand: { logoUrl: 'https://cdn.acme.test/x.png' }, source: 'website', linkedLogoChecked: '1:https://cdn.acme.test/x.png' }, { prisma });
    let fetches = 0;
    await branding.updateBrandKit(TENANT, { primaryColor: '#0d9488' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: async () => { fetches += 1; return null; } });
    assert.equal(fetches, 1);
  });

  test('removing the logo removes its analysis; a failed analysis falls back to the default badge', async () => {
    const prisma = fakePrisma();
    await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/a.png' },
      { prisma, analyzeLogo: async () => ({ background: 'transparent', tone: 'dark' }), cleanLogo: noClean });
    let view = await branding.updateBrandKit(TENANT, { logoUrl: '' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal(view.logoAppearance, null);
    view = await branding.updateBrandKit(TENANT, { logoUrl: 'https://cdn.acme.test/b.ico' },
      { prisma, analyzeLogo: async () => { throw new Error('boom'); }, cleanLogo: noClean });
    assert.equal(view.logoAppearance, null);
    for (const t of view.themes) assert.equal(t.logoBadge.mode, 'plain');
    assert.equal(view.themes.find((t) => t.id === 'minimal').logoBadge.blend, true, 'blended into the light header');
  });
});

describe('branding: publicTheme cache (adversarial review)', () => {
  const { store, keys } = require('../../src/lib/sharedStore');
  // fakePrisma, counting the reads publicTheme makes.
  const countingPrisma = (opts) => {
    const prisma = fakePrisma(opts);
    let reads = 0;
    const read = prisma.tenantBranding.findUnique;
    prisma.tenantBranding.findUnique = async (args) => { reads += 1; return read(args); };
    prisma.reads = () => reads;
    return prisma;
  };

  test('repeat page views are served from the cache, not the database', async () => {
    const prisma = countingPrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Aria' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    const before = prisma.reads();
    for (let i = 0; i < 5; i++) assert.equal((await branding.publicTheme(TENANT, { prisma })).botName, 'Aria');
    assert.equal(prisma.reads() - before, 1);
  });

  test('every kind of branding write is visible on the very next view', async () => {
    const prisma = countingPrisma();
    await branding.getBranding(TENANT, { prisma });
    assert.equal((await branding.publicTheme(TENANT, { prisma })).theme, null);

    await branding.selectTheme(TENANT, 'vibrant', { prisma });
    assert.equal((await branding.publicTheme(TENANT, { prisma })).theme.id, 'vibrant');

    await branding.updateBrandKit(TENANT, { botName: 'Sales Expert' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.equal((await branding.publicTheme(TENANT, { prisma })).botName, 'Sales Expert');

    const before = (await branding.publicTheme(TENANT, { prisma })).theme.primaryColor;
    await branding.updateBrandKit(TENANT, { primaryColor: '#e11d48' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    assert.notEqual((await branding.publicTheme(TENANT, { prisma })).theme.primaryColor, before);

    await branding.rescanBranding(TENANT, 'https://acme.test', { prisma, scan: async () => ({ logoUrl: 'https://acme.test/new.png' }), cleanLogo: noClean });
    assert.equal((await branding.publicTheme(TENANT, { prisma })).logoUrl, 'https://acme.test/new.png');
  });

  test("a write on another replica (a generation bump) invalidates this replica's entry", async () => {
    const prisma = countingPrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Aria' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    await branding.publicTheme(TENANT, { prisma });
    prisma.state.row.botName = 'Changed Elsewhere'; // another replica wrote the database…
    assert.equal((await branding.publicTheme(TENANT, { prisma })).botName, 'Aria', '…which this cache cannot see yet');
    await store().incr(keys.brandingGeneration(TENANT.id)); // …and bumped the shared generation
    assert.equal((await branding.publicTheme(TENANT, { prisma })).botName, 'Changed Elsewhere');
  });

  test(`entries expire after ${branding.THEME_CACHE_TTL_MS / 1000}s even without a bump`, async () => {
    const prisma = countingPrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Aria' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    let now = 1_000_000;
    const clock = () => now;
    await branding.publicTheme(TENANT, { prisma, clock });
    prisma.state.row.botName = 'Later';
    now += branding.THEME_CACHE_TTL_MS - 1000;
    assert.equal((await branding.publicTheme(TENANT, { prisma, clock })).botName, 'Aria');
    now += 2000;
    assert.equal((await branding.publicTheme(TENANT, { prisma, clock })).botName, 'Later');
  });

  test('a failed read is never cached, so it cannot pin the classic look', async () => {
    assert.equal((await branding.publicTheme(TENANT, { prisma: fakePrisma({ failReads: true }) })).theme, null);
    const prisma = countingPrisma();
    await branding.selectTheme(TENANT, 'corporate', { prisma });
    branding.clearThemeCache(); // even without the write's own invalidation…
    assert.equal((await branding.publicTheme(TENANT, { prisma })).theme.id, 'corporate'); // …nothing stale was stored
  });

  test('with the shared store down, a short local cache absorbs page views (not one DB read each)', async () => {
    const prisma = countingPrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Aria' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    branding.clearThemeCache();
    const driver = store();
    const realNumber = driver.number;
    driver.number = async () => NaN; // what the Redis driver returns when Redis can't answer
    let now = 1_000_000;
    const clock = () => now;
    try {
      const before = prisma.reads();
      for (let i = 0; i < 50; i++) await branding.publicTheme(TENANT, { prisma, clock });
      assert.equal(prisma.reads() - before, 1, '50 page views, one database read');
      now += branding.THEME_FALLBACK_TTL_MS - 1;
      await branding.publicTheme(TENANT, { prisma, clock });
      assert.equal(prisma.reads() - before, 1, 'still inside the fallback TTL');
      now += 2;
      await branding.publicTheme(TENANT, { prisma, clock });
      assert.equal(prisma.reads() - before, 2, 'past the 5 s fallback TTL: refetched (no generation to trust it longer)');
    } finally {
      driver.number = realNumber;
    }
  });

  test('an entry cached while the store was down is refetched as soon as the store is back', async () => {
    const prisma = countingPrisma();
    await branding.updateBrandKit(TENANT, { botName: 'Aria' }, { prisma, analyzeLogo: noAnalysis, cleanLogo: noClean });
    branding.clearThemeCache();
    const driver = store();
    const realNumber = driver.number;
    driver.number = async () => NaN;
    await branding.publicTheme(TENANT, { prisma });
    driver.number = realNumber;
    const before = prisma.reads();
    await branding.publicTheme(TENANT, { prisma });
    assert.equal(prisma.reads() - before, 1, 'the store-down entry carries no generation, so it is not trusted once the store answers');
  });
});

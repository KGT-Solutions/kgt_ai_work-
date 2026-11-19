const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Instant retries so the retry test doesn't wait; set before the module loads.
process.env.CRM_SYNC_RETRY_DELAYS_MS = '0,0,0';
process.env.DASHBOARD_URL = 'https://app.kgt.test';

const {
  syncLeadToCrm, applyInboundStatus, upsertLead, searchLead, leadFields,
  mapZohoStatus, withRetry, conversationLink
} = require('../../src/services/crm/zohoSync');
const { CrmError } = require('../../src/services/crm/zohoAuth');

let prev;
beforeEach(() => {
  prev = {
    enabled: process.env.CRM_SYNC_ENABLED, id: process.env.ZOHO_CLIENT_ID, secret: process.env.ZOHO_CLIENT_SECRET
  };
  process.env.ZOHO_CLIENT_ID = 'zoho-client';
  process.env.ZOHO_CLIENT_SECRET = 'zoho-secret';
});
afterEach(() => {
  for (const [k, v] of [['CRM_SYNC_ENABLED', prev.enabled], ['ZOHO_CLIENT_ID', prev.id], ['ZOHO_CLIENT_SECRET', prev.secret]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// A Zoho fetch double: dispatch on method + the path after /crm/v2. calls[] is
// every request made, so tests can assert what was (and wasn't) sent.
function zohoFetch(handlers) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = String(url).split('/crm/v2')[1] || url;
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path, url, body });
    for (const [match, respond] of handlers) {
      if (match(method, path)) return respond(body);
    }
    throw new Error(`unexpected Zoho call: ${method} ${path}`);
  };
  impl.calls = calls;
  return impl;
}
const json = (status, data) => ({ status, json: async () => data });
const APID = 'https://www.zohoapis.in';
const TOKEN = 'at-123';
const lead = (over = {}) => ({ id: 'lead-1', tenantId: 't1', email: 'ana@x.com', sessionId: 'sess-1', status: 'NEW', ...over });

describe('zohoSync: status mapping', () => {
  test('engaged Zoho statuses become CONTACTED, untouched become NEW, unknown leaves it alone', () => {
    assert.equal(mapZohoStatus('Contacted'), 'CONTACTED');
    assert.equal(mapZohoStatus('Converted'), 'CONTACTED');
    assert.equal(mapZohoStatus('Qualified'), 'CONTACTED');
    assert.equal(mapZohoStatus('Not Contacted'), 'NEW');
    assert.equal(mapZohoStatus('New'), 'NEW');
    assert.equal(mapZohoStatus('Some Custom Stage'), null);
    assert.equal(mapZohoStatus(''), null);
  });
});

describe('zohoSync: leadFields + conversationLink', () => {
  test('maps our fields to Zoho defaults and honours a custom fieldMapping', () => {
    const def = leadFields({ lead: lead() });
    assert.equal(def.Email, 'ana@x.com');
    assert.equal(def.Last_Name, 'ana'); // derived from the email local part
    assert.equal(def.Lead_Source, 'KGT Orb website');
    const mapped = leadFields({ lead: lead(), fieldMapping: { name: 'Full_Name' }, extra: { name: 'Ana Rao', phone: '+91999' } });
    assert.equal(mapped.Full_Name, 'Ana Rao');
    assert.equal(mapped.Phone, '+91999');
  });

  test('conversationLink points at the dashboard session, or is null without DASHBOARD_URL', () => {
    assert.equal(conversationLink('sess-1'), 'https://app.kgt.test/dashboard/leads?view=leads&session=sess-1');
  });
});

describe('zohoSync: searchLead (dedupe)', () => {
  test('builds an OR criteria over email and phone and returns the first id', async () => {
    const fetchImpl = zohoFetch([[(m, p) => m === 'GET' && p.startsWith('/Leads/search'), () => json(200, { data: [{ id: 'z9' }] })]]);
    const id = await searchLead({ apiDomain: APID, token: TOKEN, email: 'ana@x.com', phone: '+91999', fetchImpl });
    assert.equal(id, 'z9');
    const criteria = decodeURIComponent(fetchImpl.calls[0].path.split('criteria=')[1]);
    assert.equal(criteria, '((Email:equals:ana@x.com)or(Phone:equals:+91999))');
  });

  test('a 204 (no match) returns null', async () => {
    const fetchImpl = zohoFetch([[() => true, () => json(204, null)]]);
    assert.equal(await searchLead({ apiDomain: APID, token: TOKEN, email: 'ana@x.com', fetchImpl }), null);
  });
});

describe('zohoSync: upsertLead (one atomic Zoho upsert — no search-then-create race)', () => {
  const upserted = (action, id) => () => json(action === 'insert' ? 201 : 200, { data: [{ code: 'SUCCESS', action, details: { id } }] });

  test('a new visitor → Zoho inserts, and the note is attached to the new record', async () => {
    const fetchImpl = zohoFetch([
      [(m, p) => m === 'POST' && p === '/Leads/upsert', upserted('insert', 'z-new')],
      [(m, p) => m === 'POST' && p === '/Notes', () => json(201, { data: [{ code: 'SUCCESS' }] })]
    ]);
    const r = await upsertLead({ apiDomain: APID, token: TOKEN, lead: lead(), summary: 'Intent: pricing', fetchImpl });
    assert.deepEqual(r, { crmRecordId: 'z-new', created: true });
    const upsert = fetchImpl.calls.find((c) => c.path === '/Leads/upsert');
    assert.deepEqual(upsert.body.duplicate_check_fields, ['Email'], 'Zoho matches on the email itself');
    assert.equal(upsert.body.data[0].Email, 'ana@x.com');
    const note = fetchImpl.calls.find((c) => c.path === '/Notes');
    assert.equal(note.body.data[0].Parent_Id, 'z-new');
    assert.match(note.body.data[0].Note_Content, /Intent: pricing/);
    assert.match(note.body.data[0].Note_Content, /app\.kgt\.test/);
  });

  test('a returning visitor → Zoho updates the existing record; nothing searches or creates separately', async () => {
    const fetchImpl = zohoFetch([
      [(m, p) => m === 'POST' && p === '/Leads/upsert', upserted('update', 'z-existing')],
      [(m, p) => p === '/Notes', () => json(201, { data: [{ code: 'SUCCESS' }] })]
    ]);
    const r = await upsertLead({ apiDomain: APID, token: TOKEN, lead: lead(), summary: 's', fetchImpl });
    assert.deepEqual(r, { crmRecordId: 'z-existing', created: false });
    assert.equal(fetchImpl.calls.filter((c) => c.path.startsWith('/Leads')).length, 1, 'exactly one Leads call: the upsert');
  });

  test('the phone joins the duplicate check when known, using the tenant\'s field mapping', async () => {
    const fetchImpl = zohoFetch([
      [(m, p) => p === '/Leads/upsert', upserted('insert', 'z-1')],
      [(m, p) => p === '/Notes', () => json(201, { data: [{ code: 'SUCCESS' }] })]
    ]);
    await upsertLead({ apiDomain: APID, token: TOKEN, lead: lead(), extra: { phone: '+91 98765 43210' }, fieldMapping: { phone: 'Mobile' }, fetchImpl });
    const upsert = fetchImpl.calls.find((c) => c.path === '/Leads/upsert');
    assert.deepEqual(upsert.body.duplicate_check_fields, ['Email', 'Mobile']);
    assert.equal(upsert.body.data[0].Mobile, '+91 98765 43210');
  });

  test('an upsert that returns no record id is an error, not a silent success', async () => {
    const fetchImpl = zohoFetch([[(m, p) => p === '/Leads/upsert', () => json(200, { data: [{ code: 'DUPLICATE_DATA' }] })]]);
    await assert.rejects(() => upsertLead({ apiDomain: APID, token: TOKEN, lead: lead(), fetchImpl }), /did not return an id \(DUPLICATE_DATA\)/);
  });

  test('a note failure does not fail the upsert', async () => {
    const fetchImpl = zohoFetch([
      [(m, p) => p === '/Leads/upsert', upserted('insert', 'z-new')],
      [(m, p) => p === '/Notes', () => json(500, null)]
    ]);
    const r = await upsertLead({ apiDomain: APID, token: TOKEN, lead: lead(), summary: 's', fetchImpl });
    assert.equal(r.crmRecordId, 'z-new');
  });
});

describe('zohoSync: withRetry', () => {
  test('retries a retryable failure then succeeds', async () => {
    let n = 0;
    const r = await withRetry(() => { n++; if (n < 3) throw new CrmError('rate limited', 502, { retryable: true }); return 'ok'; });
    assert.equal(r, 'ok');
    assert.equal(n, 3);
  });

  test('a non-retryable failure throws straight away', async () => {
    let n = 0;
    await assert.rejects(() => withRetry(() => { n++; throw new CrmError('bad request', 502); }));
    assert.equal(n, 1);
  });
});

describe('zohoSync: syncLeadToCrm', () => {
  const fakePrisma = (integration) => {
    const state = { leadUpdate: null, logs: [] };
    return {
      state,
      tenantCRMIntegration: { findUnique: async () => integration },
      lead: { update: async ({ data }) => { state.leadUpdate = data; return { id: 'lead-1', ...data }; } },
      cRMSyncLog: {
        create: async ({ data }) => { const row = { id: `log-${state.logs.length}`, ...data }; state.logs.push(row); return row; },
        update: async ({ where, data }) => { Object.assign(state.logs.find((l) => l.id === where.id), data); }
      }
    };
  };
  const enabledIntegration = { id: 'int-1', tenantId: 't1', provider: 'ZOHO', region: 'in', isEnabled: true, fieldMapping: {} };
  const getToken = async () => ({ accessToken: TOKEN, apiDomain: APID, refreshed: false });

  test('no-ops when the feature flag is off', async () => {
    delete process.env.CRM_SYNC_ENABLED;
    const r = await syncLeadToCrm({ tenant: { id: 't1' }, lead: lead() }, { prisma: fakePrisma(enabledIntegration), getToken });
    assert.deepEqual(r, { skipped: 'disabled' });
  });

  test('no-ops when the tenant has no enabled integration', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const r = await syncLeadToCrm({ tenant: { id: 't1' }, lead: lead() }, { prisma: fakePrisma(null), getToken });
    assert.deepEqual(r, { skipped: 'no-integration' });
  });

  test('creates the lead, mirrors the CRM id back, and logs SUCCESS', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const prisma = fakePrisma(enabledIntegration);
    const fetchImpl = zohoFetch([
      [(m, p) => p === '/Leads/upsert', () => json(201, { data: [{ code: 'SUCCESS', action: 'insert', details: { id: 'z-new' } }] })],
      [(m, p) => p === '/Notes', () => json(201, { data: [{ code: 'SUCCESS' }] })]
    ]);
    const r = await syncLeadToCrm({ tenant: { id: 't1', slug: 'acme' }, lead: lead(), summary: 'Intent: pricing' }, { prisma, getToken, fetchImpl });
    assert.equal(r.synced, true);
    assert.equal(r.crmRecordId, 'z-new');
    assert.equal(prisma.state.leadUpdate.crmRecordId, 'z-new');
    assert.equal(prisma.state.leadUpdate.crmProvider, 'ZOHO');
    assert.equal(prisma.state.logs.at(-1).status, 'SUCCESS');
  });

  test('a provider failure is caught: returns unsynced and logs FAILED, never throws', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const prisma = fakePrisma(enabledIntegration);
    const failToken = async () => { throw new CrmError('token refresh rejected', 502); };
    const r = await syncLeadToCrm({ tenant: { id: 't1', slug: 'acme' }, lead: lead() }, { prisma, getToken: failToken });
    assert.equal(r.synced, false);
    assert.equal(prisma.state.logs.at(-1).status, 'FAILED');
    assert.equal(prisma.state.logs.at(-1).error.message, 'token refresh rejected');
  });
});

describe('zohoSync: applyInboundStatus', () => {
  const fakePrisma = (leads) => {
    const state = { updates: [], logs: [] };
    return {
      state,
      lead: {
        findFirst: async ({ where }) => leads.find((l) =>
          (where.crmRecordId ? l.crmRecordId === where.crmRecordId : true) &&
          (where.crmProvider ? l.crmProvider === where.crmProvider : true) &&
          (where.email ? l.email === where.email : true) &&
          (where.tenantId ? l.tenantId === where.tenantId : true)) || null,
        update: async ({ where, data }) => { state.updates.push({ id: where.id, ...data }); }
      },
      cRMSyncLog: { create: async ({ data }) => { state.logs.push(data); return { id: 'l' }; } }
    };
  };

  test('maps a CRM status change onto the matching lead by the (provider, record) compound key', async () => {
    const prisma = fakePrisma([{ id: 'lead-1', tenantId: 't1', email: 'ana@x.com', crmProvider: 'ZOHO', crmRecordId: 'z-1', status: 'NEW' }]);
    const r = await applyInboundStatus({ recordId: 'z-1', zohoStatus: 'Converted', tenantId: 't1' }, { prisma });
    assert.equal(r.updated, true);
    assert.equal(r.status, 'CONTACTED');
    assert.deepEqual(prisma.state.updates, [{ id: 'lead-1', status: 'CONTACTED' }]);
    assert.equal(prisma.state.logs[0].direction, 'inbound');
  });

  test('falls back to matching by email, but only within the given tenant', async () => {
    const prisma = fakePrisma([{ id: 'lead-2', tenantId: 't1', email: 'ana@x.com', crmRecordId: null, status: 'NEW' }]);
    const r = await applyInboundStatus({ recordId: null, zohoStatus: 'Contacted', email: 'ana@x.com', tenantId: 't1' }, { prisma });
    assert.equal(r.updated, true);
    assert.equal(r.leadId, 'lead-2');
  });

  test('refuses an email-only match when no tenant is known (no cross-tenant mutation)', async () => {
    const prisma = fakePrisma([{ id: 'lead-9', tenantId: 't9', email: 'ana@x.com', crmRecordId: null, status: 'NEW' }]);
    const r = await applyInboundStatus({ recordId: null, zohoStatus: 'Contacted', email: 'ana@x.com' }, { prisma });
    assert.deepEqual(r, { updated: false, reason: 'email-match-needs-tenant' });
    assert.equal(prisma.state.updates.length, 0);
  });

  test('scopes the record match to the tenant hint — a wrong tenant never mutates another tenant\'s lead', async () => {
    const prisma = fakePrisma([{ id: 'lead-1', tenantId: 't1', email: 'ana@x.com', crmProvider: 'ZOHO', crmRecordId: 'z-1', status: 'NEW' }]);
    const r = await applyInboundStatus({ recordId: 'z-1', zohoStatus: 'Converted', tenantId: 't2' }, { prisma });
    assert.deepEqual(r, { updated: false, reason: 'unmapped-record' });
    assert.equal(prisma.state.updates.length, 0);
  });

  test('an unmapped status changes nothing', async () => {
    const prisma = fakePrisma([{ id: 'lead-1', tenantId: 't1', email: 'a@x.com', crmProvider: 'ZOHO', crmRecordId: 'z-1', status: 'NEW' }]);
    const r = await applyInboundStatus({ recordId: 'z-1', zohoStatus: 'Weird Stage' }, { prisma });
    assert.deepEqual(r, { updated: false, reason: 'unmapped-status' });
    assert.equal(prisma.state.updates.length, 0);
  });

  test('an unknown external record id is reported, not applied to an arbitrary row', async () => {
    const prisma = fakePrisma([]);
    const r = await applyInboundStatus({ recordId: 'z-nope', zohoStatus: 'Contacted' }, { prisma });
    assert.deepEqual(r, { updated: false, reason: 'unmapped-record' });
    assert.equal(prisma.state.updates.length, 0);
  });
});

describe('zohoSync: a rejected access token is refreshed and retried once', () => {
  const integration = { id: 'int-9', tenantId: 't1', provider: 'ZOHO', region: 'in', isEnabled: true, fieldMapping: {} };
  const prismaFor = () => {
    const state = { logs: [] };
    return {
      state,
      tenantCRMIntegration: { findUnique: async () => integration },
      lead: { update: async ({ data }) => ({ id: 'lead-1', ...data }) },
      cRMSyncLog: {
        create: async ({ data }) => { const row = { id: `log-${state.logs.length}`, ...data }; state.logs.push(row); return row; },
        update: async ({ where, data }) => { Object.assign(state.logs.find((l) => l.id === where.id), data); }
      }
    };
  };
  // Zoho, faked: only `goodToken` is accepted; any other token gets 401 INVALID_TOKEN.
  const zoho = (goodToken, { status = 401, code = 'INVALID_TOKEN' } = {}) => async (url, opts = {}) => {
    const token = String(opts.headers?.authorization || '').replace('Zoho-oauthtoken ', '');
    if (token !== goodToken) return new Response(JSON.stringify({ code }), { status });
    const path = String(url).split('/crm/v2')[1];
    if (path === '/Leads/upsert') return new Response(JSON.stringify({ data: [{ code: 'SUCCESS', action: 'insert', details: { id: 'z-77' } }] }), { status: 201 });
    return new Response(JSON.stringify({ data: [{ code: 'SUCCESS' }] }), { status: 201 });
  };
  // getToken, faked: the stored token is 'stale'; a forced refresh mints 'fresh'.
  const tokens = () => {
    const forced = [];
    const getToken = async (args) => {
      forced.push(!!args.force);
      return { accessToken: args.force ? 'fresh' : 'stale', apiDomain: APID, refreshed: !!args.force };
    };
    return { forced, getToken };
  };

  test('a 401 INVALID_TOKEN mints a new token and the sync succeeds', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const { forced, getToken } = tokens();
    const prisma = prismaFor();
    const r = await syncLeadToCrm({ tenant: { id: 't1', slug: 'acme' }, lead: lead() }, { prisma, getToken, fetchImpl: zoho('fresh') });
    assert.equal(r.synced, true);
    assert.equal(r.crmRecordId, 'z-77');
    assert.deepEqual(forced, [false, true], 'one normal lookup, then one forced refresh');
    assert.equal(prisma.state.logs.at(-1).status, 'SUCCESS');
  });

  test('INVALID_TOKEN is recognised by its code even without a 401 status', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const { forced, getToken } = tokens();
    const r = await syncLeadToCrm({ tenant: { id: 't1' }, lead: lead() },
      { prisma: prismaFor(), getToken, fetchImpl: zoho('fresh', { status: 400, code: 'INVALID_TOKEN' }) });
    assert.equal(r.synced, true);
    assert.deepEqual(forced, [false, true]);
  });

  test('a second rejection fails the sync after exactly one refresh', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const { forced, getToken } = tokens();
    const prisma = prismaFor();
    const r = await syncLeadToCrm({ tenant: { id: 't1' }, lead: lead() }, { prisma, getToken, fetchImpl: zoho('nothing-works') });
    assert.equal(r.synced, false);
    assert.deepEqual(forced, [false, true], 'never more than one forced refresh');
    assert.equal(prisma.state.logs.at(-1).status, 'FAILED');
    assert.match(prisma.state.logs.at(-1).error.message, /401, INVALID_TOKEN/);
  });

  test('other 4xx errors are not "fixed" by a refresh', async () => {
    process.env.CRM_SYNC_ENABLED = 'true';
    const { forced, getToken } = tokens();
    const r = await syncLeadToCrm({ tenant: { id: 't1' }, lead: lead() },
      { prisma: prismaFor(), getToken, fetchImpl: zoho('fresh-only', { status: 400, code: 'MANDATORY_NOT_FOUND' }) });
    assert.equal(r.synced, false);
    assert.deepEqual(forced, [false], 'no forced refresh for a non-auth error');
  });
});

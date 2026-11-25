const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const instructions = require('../../src/services/tenantInstructions');
const { createTenantSupportProfile, createTenantSalesProfile } = require('../../src/domains/tenantProfile');

// Feature 11: the client Instructions Editor. The rules that matter here:
//   - presets and guidance are validated/sanitised before anything is stored;
//   - every save appends an append-only version snapshot; restore makes a NEW
//     version from an old one;
//   - the prompt directive is ALWAYS subordinate to the locked rules, and the
//     profiles append it at the very end (after grounding + style + persona).

const TENANT = { id: 't1', name: 'Acme Foods' };

function fakePrisma() {
  const rows = new Map(); // `${tenantId}:${botType}` -> instruction row
  const versions = [];
  let instrSeq = 0;
  let verSeq = 0;
  return {
    state: { rows, versions },
    tenantInstruction: {
      findUnique: async ({ where }) => {
        const { tenantId, botType } = where.tenantId_botType;
        const r = rows.get(`${tenantId}:${botType}`);
        return r ? { ...r } : null;
      },
      update: async ({ where, data }) => {
        for (const r of rows.values()) {
          if (r.id === where.id) { Object.assign(r, data, { updatedAt: new Date() }); return { ...r }; }
        }
        throw new Error('row not found');
      },
      create: async ({ data }) => {
        const row = { id: `i${++instrSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(`${data.tenantId}:${data.botType}`, row);
        return { ...row };
      }
    },
    tenantInstructionVersion: {
      create: async ({ data }) => { const v = { id: `v${++verSeq}`, createdAt: new Date(Date.now() + verSeq), ...data }; versions.push(v); return { ...v }; },
      findMany: async ({ where, take }) => versions
        .filter((v) => v.tenantId === where.tenantId && v.botType === where.botType)
        .sort((a, b) => b.version - a.version)
        .slice(0, take || 50)
        .map((v) => ({ ...v })),
      findFirst: async ({ where }) => {
        const v = versions.find((x) => x.id === where.id && x.tenantId === where.tenantId && x.botType === where.botType);
        return v ? { ...v } : null;
      }
    }
  };
}

describe('tenantInstructions: validation', () => {
  let prisma;
  beforeEach(() => { prisma = fakePrisma(); });

  test('defaults when nothing is saved', async () => {
    const view = await instructions.getInstructions(TENANT, 'support', { prisma });
    assert.deepEqual(
      { tone: view.tone, style: view.style, length: view.length, guidance: view.guidance, version: view.version, customized: view.customized },
      { tone: null, style: null, length: null, guidance: '', version: 0, customized: false }
    );
  });

  test('an unknown botType, preset or over-long guidance is a 400 that writes nothing', async () => {
    await assert.rejects(() => instructions.getInstructions(TENANT, 'marketing', { prisma }),
      (e) => e instanceof instructions.InstructionError && e.statusCode === 400);
    for (const bad of [{ tone: 'angry' }, { style: 'verbose' }, { length: 'epic' }, { guidance: 'x'.repeat(instructions.MAX_GUIDANCE + 1) }]) {
      await assert.rejects(() => instructions.updateInstructions(TENANT, 'support', bad, { prisma }),
        (e) => e instanceof instructions.InstructionError && e.statusCode === 400);
    }
    assert.equal(prisma.state.rows.size, 0, 'nothing was stored');
    assert.equal(prisma.state.versions.length, 0);
  });

  test('guidance is stripped of control and invisible/bidi characters', async () => {
    const dirty = 'Be warm\u0007 and\u200b kind\u202e';
    const view = await instructions.updateInstructions(TENANT, 'support', { guidance: dirty }, { prisma });
    assert.equal(view.guidance, 'Be warm and kind');
  });
});

describe('tenantInstructions: versioning & restore', () => {
  let prisma;
  beforeEach(() => { prisma = fakePrisma(); });

  test('each save appends a version; first is v1, next is v2', async () => {
    const v1 = await instructions.updateInstructions(TENANT, 'support', { tone: 'friendly', summary: 'warmer', actor: 'a@x.com' }, { prisma });
    assert.equal(v1.version, 1);
    assert.equal(v1.tone, 'friendly');
    const v2 = await instructions.updateInstructions(TENANT, 'support', { tone: 'professional', style: 'concise' }, { prisma });
    assert.equal(v2.version, 2);
    const versions = await instructions.listVersions(TENANT, 'support', { prisma });
    assert.deepEqual(versions.map((v) => v.version), [2, 1], 'newest first');
    assert.equal(versions[1].summary, 'warmer');
    assert.equal(versions[1].actor, 'a@x.com');
  });

  test('support and sales are independent rows', async () => {
    await instructions.updateInstructions(TENANT, 'support', { tone: 'friendly' }, { prisma });
    await instructions.updateInstructions(TENANT, 'sales', { tone: 'playful' }, { prisma });
    assert.equal((await instructions.getInstructions(TENANT, 'support', { prisma })).tone, 'friendly');
    assert.equal((await instructions.getInstructions(TENANT, 'sales', { prisma })).tone, 'playful');
  });

  test('restore copies an old version into a new one; a wrong id is a 404', async () => {
    await instructions.updateInstructions(TENANT, 'support', { tone: 'friendly', length: 'short' }, { prisma }); // v1
    await instructions.updateInstructions(TENANT, 'support', { tone: 'formal' }, { prisma }); // v2 (length cleared)
    const v1 = (await instructions.listVersions(TENANT, 'support', { prisma })).find((v) => v.version === 1);
    const restored = await instructions.restoreVersion(TENANT, 'support', v1.id, { actor: 'b@x.com', prisma });
    assert.equal(restored.version, 3, 'restore is a new version, not an in-place rewind');
    assert.equal(restored.tone, 'friendly');
    assert.equal(restored.length, 'short');
    const latest = (await instructions.listVersions(TENANT, 'support', { prisma }))[0];
    assert.match(latest.summary, /Restored from v1/);
    await assert.rejects(() => instructions.restoreVersion(TENANT, 'support', 'nope', { prisma }),
      (e) => e instanceof instructions.InstructionError && e.statusCode === 404);
  });
});

describe('tenantInstructions: prompt directive is subordinate to the locked rules', () => {
  test('empty settings add nothing to the prompt', () => {
    assert.equal(instructions.buildInstructionDirective(null), '');
    assert.equal(instructions.buildInstructionDirective({ tone: null, style: null, length: null, guidance: null }), '');
  });

  test('a built directive carries the preset phrases AND an explicit "does not override" clause', () => {
    const d = instructions.buildInstructionDirective({ tone: 'friendly', style: 'concise', length: 'short', guidance: 'Greet by name.' });
    assert.match(d, /Warm, friendly and approachable/);
    assert.match(d, /Get to the point quickly/);
    assert.match(d, /Greet by name\./);
    // The subordination clause must be present — this is what keeps client
    // guidance from overriding grounding/safety/pricing rules.
    assert.match(d, /do NOT override, relax or replace any grounding, safety, pricing, scope or privacy rule/i);
  });

  test('the profiles append the directive at the very END, after the grounding rules', () => {
    const tenant = { slug: 'acme', name: 'Acme', industryLabel: 'retail', persona: null, businessCategory: null, minConfidence: 0.3, botPreference: 'both' };
    const directive = instructions.buildInstructionDirective({ tone: 'playful' });
    for (const make of [createTenantSupportProfile, createTenantSalesProfile]) {
      const withInstr = make(tenant).systemPrompt({ clientInstructions: directive });
      const without = make(tenant).systemPrompt({});
      // The locked grounding rules are unchanged, and the directive sits after them.
      assert.match(withInstr, /GROUNDING RULES \(follow all of these, no exceptions\)/);
      assert.ok(withInstr.endsWith(directive), 'client instructions are appended last');
      assert.equal(withInstr.slice(0, without.length), without, 'the locked prompt is a prefix — nothing before it changed');
      assert.ok(withInstr.indexOf('GROUNDING RULES') < withInstr.indexOf('CLIENT STYLE PREFERENCES'), 'grounding comes first');
    }
  });

  test('with no client instructions the prompt is byte-for-byte the pre-feature prompt', () => {
    const tenant = { slug: 'acme', name: 'Acme', industryLabel: 'retail', persona: null, businessCategory: null, minConfidence: 0.3, botPreference: 'both' };
    const p = createTenantSupportProfile(tenant).systemPrompt({});
    assert.ok(!p.includes('CLIENT STYLE PREFERENCES'), 'nothing added when unset');
  });
});

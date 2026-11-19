// Set before requiring the module — the cooldown is read once at load.
process.env.AUDIT_COOLDOWN_MS = '200';

const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const botAuditor = require('../../src/services/botAuditor');

// scheduleTenantAudit's policy: coalesce concurrent calls, run one trailing pass
// for a change that lands mid-audit, and skip fresh schedules inside the cooldown.
// We replace auditTenant with a controllable promise (the scheduler calls it via
// module.exports, so this mock intercepts it) to hold an audit "in flight".
let calls, resolvers;
const auditMock = mock.method(botAuditor, 'auditTenant', (tenantId) =>
  new Promise((resolve) => { calls.push(tenantId); resolvers.push(resolve); }));

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, { tries = 100, ms = 10 } = {}) => {
  for (let i = 0; i < tries; i++) { if (cond()) return; await tick(ms); }
  throw new Error('waitFor: condition not met in time');
};

beforeEach(() => { calls = []; resolvers = []; auditMock.mock.resetCalls(); });

describe('scheduleTenantAudit — coalescing, trailing pass, cooldown', () => {
  test('concurrent schedules while one audit runs do not start a second', async () => {
    const t = 'tenant-coalesce';
    botAuditor.scheduleTenantAudit(t);
    await waitFor(() => calls.length === 1);
    botAuditor.scheduleTenantAudit(t); // in flight → no new audit
    botAuditor.scheduleTenantAudit(t);
    await tick(20);
    assert.equal(calls.length, 1);
    resolvers.forEach((r) => r()); // let it (and its single trailing pass) finish
    await tick(20);
    resolvers.slice(1).forEach((r) => r());
    await tick(20);
  });

  test('a change that lands mid-audit triggers exactly one trailing pass', async () => {
    const t = 'tenant-dirty';
    botAuditor.scheduleTenantAudit(t);          // audit #1
    await waitFor(() => calls.length === 1);
    botAuditor.scheduleTenantAudit(t);          // dirty
    botAuditor.scheduleTenantAudit(t);          // still just dirty
    assert.equal(calls.length, 1, 'no second concurrent audit');
    resolvers[0]();                             // finish #1 → one trailing pass runs
    await waitFor(() => calls.length === 2);
    resolvers[1]();                             // finish the trailing pass
    await tick(30);
    assert.equal(calls.length, 2, 'only one trailing pass, not one per change');
  });

  test('a fresh schedule within the cooldown is skipped (saves LLM spend)', async () => {
    const t = 'tenant-cooldown';
    botAuditor.scheduleTenantAudit(t);
    await waitFor(() => calls.length === 1);
    resolvers[0]();                             // finish → lastAuditAt = now
    await tick(15);
    botAuditor.scheduleTenantAudit(t);          // well within the 200ms cooldown
    await tick(30);
    assert.equal(calls.length, 1, 'the second schedule was skipped');
  });

  test('after the cooldown elapses, a schedule runs again', async () => {
    const t = 'tenant-after-cooldown';
    botAuditor.scheduleTenantAudit(t);
    await waitFor(() => calls.length === 1);
    resolvers[0]();
    await tick(260);                            // > 200ms cooldown
    botAuditor.scheduleTenantAudit(t);
    await waitFor(() => calls.length === 2);
    resolvers[1]();
    await tick(20);
  });

  test('different tenants never block each other', async () => {
    botAuditor.scheduleTenantAudit('tenant-a');
    botAuditor.scheduleTenantAudit('tenant-b');
    await waitFor(() => calls.length === 2);
    assert.deepEqual([...calls].sort(), ['tenant-a', 'tenant-b']);
    resolvers.forEach((r) => r());
    await tick(20);
  });
});

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { store, resetStore } = require('../../src/lib/sharedStore');
const { deviceKey, isDeviceRateLimited, blockedCountry, DEFAULT_LIMIT_MESSAGE } = require('../../src/services/guardrails');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  resetStore();
  await store().reset();
});

describe('deviceKey — what the per-device rate limit counts against', () => {
  test('WhatsApp phone wins over everything, prefixed so it can never collide with a web id', () => {
    assert.equal(deviceKey({ body: { phone: '+15551234', browserId: 'b1' }, ip: '1.2.3.4' }), 'wa:+15551234');
  });

  test('web: a browserId is paired with the IP bucket, so clearing storage alone does not reset the count', () => {
    assert.equal(deviceKey({ body: { browserId: 'abc' }, ip: '1.2.3.4' }), 'web:abc:1.2.3.4');
  });

  test('an IPv6 visitor is bucketed to a /64 (which they cannot rotate through)', () => {
    const k = deviceKey({ body: { browserId: 'abc' }, ip: '2001:db8:1:2:3:4:5:6' });
    assert.match(k, /^web:abc:2001:db8:1:2::\/64$/);
  });

  test('with no browserId and no phone, the IP bucket alone is the device', () => {
    assert.equal(deviceKey({ body: {}, ip: '9.9.9.9' }), 'ip:9.9.9.9');
    assert.equal(deviceKey({ body: null, ip: undefined }), 'ip:unknown');
  });

  test('phone and browserId are length-capped (no unbounded key from a hostile client)', () => {
    assert.equal(deviceKey({ body: { phone: 'x'.repeat(100) }, ip: '1.1.1.1' }).length, 'wa:'.length + 32);
    assert.ok(deviceKey({ body: { browserId: 'y'.repeat(300) }, ip: '1.1.1.1' }).startsWith('web:' + 'y'.repeat(100) + ':'));
  });
});

describe('isDeviceRateLimited — dynamic window from the tenant config', () => {
  const dev = { tenantId: 't1', device: 'web:b1:1.2.3.4', maxMessages: 3, windowSeconds: 60 };

  test('allows up to max within the window, then limits the next', async () => {
    assert.equal(await isDeviceRateLimited(dev), false);
    assert.equal(await isDeviceRateLimited(dev), false);
    assert.equal(await isDeviceRateLimited(dev), false);
    assert.equal(await isDeviceRateLimited(dev), true); // the 4th
  });

  test('no cap is applied when the tenant set no maxMessages / windowSeconds', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal(await isDeviceRateLimited({ tenantId: 't1', device: 'd', maxMessages: null, windowSeconds: null }), false);
    }
    assert.equal(await isDeviceRateLimited({ tenantId: 't1', device: 'd', maxMessages: 5, windowSeconds: 0 }), false);
  });

  test('each (tenant, device) is counted independently', async () => {
    const a = { ...dev, maxMessages: 1 };
    const b = { ...dev, maxMessages: 1, device: 'web:b2:1.2.3.4' };
    const other = { ...dev, maxMessages: 1, tenantId: 't2' };
    assert.equal(await isDeviceRateLimited(a), false);
    assert.equal(await isDeviceRateLimited(b), false); // a different device is unaffected
    assert.equal(await isDeviceRateLimited(other), false); // a different tenant is unaffected
    assert.equal(await isDeviceRateLimited(a), true);
  });

  test('the count resets once the window has passed', async () => {
    const short = { tenantId: 't1', device: 'web:b1:1.2.3.4', maxMessages: 1, windowSeconds: 1 };
    assert.equal(await isDeviceRateLimited(short), false);
    assert.equal(await isDeviceRateLimited(short), true); // over, within the 1s window
    await sleep(1100); // window elapses
    assert.equal(await isDeviceRateLimited(short), false, 'a new window starts clean');
  });

  test('there is a sensible default message to show when limited', () => {
    assert.match(DEFAULT_LIMIT_MESSAGE, /\S/);
  });
});

describe('blockedCountry — CDN/proxy country header, fail-open', () => {
  const blocked = ['RU', 'CN'];

  test('blocks a listed country from either edge header', () => {
    assert.equal(blockedCountry({ 'cf-ipcountry': 'RU' }, blocked), 'RU');
    assert.equal(blockedCountry({ 'x-vercel-ip-country': 'cn' }, blocked), 'CN'); // case-insensitive
  });

  test('allows a country that is not on the list', () => {
    assert.equal(blockedCountry({ 'cf-ipcountry': 'US' }, blocked), null);
  });

  test('fails open when the header is absent, empty, unknown (XX) or Tor (T1)', () => {
    assert.equal(blockedCountry({}, blocked), null);
    assert.equal(blockedCountry({ 'cf-ipcountry': '' }, blocked), null);
    assert.equal(blockedCountry({ 'cf-ipcountry': 'XX' }, blocked), null);
    assert.equal(blockedCountry({ 'cf-ipcountry': 'T1' }, blocked), null);
  });

  test('an empty block list never blocks anyone', () => {
    assert.equal(blockedCountry({ 'cf-ipcountry': 'RU' }, []), null);
    assert.equal(blockedCountry({ 'cf-ipcountry': 'RU' }, undefined), null);
  });

  test('the Cloudflare header is read before the Vercel one', () => {
    // Only one edge is ever really present, but precedence must be defined.
    assert.equal(blockedCountry({ 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'RU' }, blocked), null);
  });
});

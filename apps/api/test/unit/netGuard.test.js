const { test, describe, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const dns = require('dns');
const {
  isPrivateIPv4, isPrivateIPv6, isPrivateAddress, expandIPv6, publicOnlyLookup, resolvePublicHost, ipBucket
} = require('../../src/services/shared/netGuard');
const { fetchSafe, CrawlerError } = require('../../src/services/shared/crawler');

// netGuard is the one place that decides "is this address internal?" for every
// outbound connection the server makes on a tenant's behalf (crawler, brand
// scan, logo/CSS downloads, the headless-browser proxy, tenant SMTP). Review #2
// showed a DNS-rebinding SSRF: the hostname was checked once, then fetch
// re-resolved it. publicOnlyLookup now runs at dial time, on the address the
// socket actually connects to.

afterEach(() => mock.restoreAll());

describe('netGuard: address classification', () => {
  test('private, reserved and metadata IPv4 ranges are internal', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '100.100.100.200', '127.0.0.1', '127.255.255.254',
      '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
      '198.51.100.7', '203.0.113.9', '224.0.0.1', '255.255.255.255']) {
      assert.equal(isPrivateIPv4(ip), true, ip);
    }
  });

  test('public IPv4 addresses are not', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1']) assert.equal(isPrivateIPv4(ip), false, ip);
  });

  test('IPv6 loopback, link-local, ULA, unspecified and documentation ranges are internal', () => {
    for (const ip of ['::', '::1', 'fe80::1', 'fe80::1%eth0', 'fd00::1', 'fc00::5', 'ff02::1', '2001:db8::1', '2001::1', '100::1']) {
      assert.equal(isPrivateIPv6(ip), true, ip);
    }
  });

  test('an IPv4 address smuggled inside IPv6 is judged as the IPv4 it embeds', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '2002:a9fe:a9fe::', '2002:7f00:1::1']) {
      assert.equal(isPrivateIPv6(ip), true, ip);
    }
    for (const ip of ['::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) assert.equal(isPrivateIPv6(ip), false, ip);
  });

  test('public IPv6 is not internal; malformed input is treated as internal', () => {
    for (const ip of ['2606:4700:4700::1111', '2607:f8b0:4004:800::200e', '2a00:1450::1']) assert.equal(isPrivateIPv6(ip), false, ip);
    for (const ip of ['not-an-ip', '1:2:3', '::g', '']) assert.equal(isPrivateIPv6(ip), true, JSON.stringify(ip));
  });

  test('isPrivateAddress dispatches on family (and on the literal when no family is given)', () => {
    assert.equal(isPrivateAddress('127.0.0.1', 4), true);
    assert.equal(isPrivateAddress('::1', 6), true);
    assert.equal(isPrivateAddress('::1'), true);
    assert.equal(isPrivateAddress('8.8.8.8'), false);
  });

  test('expandIPv6 normalises compressed forms', () => {
    assert.deepEqual(expandIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(expandIPv6('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    assert.equal(expandIPv6('1::2::3'), null);
  });
});

describe('netGuard: publicOnlyLookup (dial-time check)', () => {
  const lookup = (host, options = {}) => new Promise((resolve, reject) => {
    publicOnlyLookup(host, options, (err, address, family) => (err ? reject(err) : resolve({ address, family })));
  });
  let prevAllow;
  before(() => { prevAllow = process.env.CRAWLER_ALLOW_PRIVATE_HOSTS; delete process.env.CRAWLER_ALLOW_PRIVATE_HOSTS; });
  after(() => { if (prevAllow !== undefined) process.env.CRAWLER_ALLOW_PRIVATE_HOSTS = prevAllow; });

  test('a public answer is passed through', async () => {
    mock.method(dns, 'lookup', (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    assert.deepEqual(await lookup('example.com'), { address: '93.184.216.34', family: 4 });
  });

  test('any private answer refuses the whole lookup with EPRIVATE (no "pick the public one" games)', async () => {
    mock.method(dns, 'lookup', (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]));
    await assert.rejects(() => lookup('rebind.attacker.example'), (e) => e.code === 'EPRIVATE');
  });

  test('the all:true form (used by Node\'s happy-eyeballs) is honoured', async () => {
    mock.method(dns, 'lookup', (h, o, cb) => cb(null, [{ address: '2606:4700:4700::1111', family: 6 }]));
    const got = await new Promise((resolve, reject) => publicOnlyLookup('one.one', { all: true }, (e, a) => (e ? reject(e) : resolve(a))));
    assert.deepEqual(got, [{ address: '2606:4700:4700::1111', family: 6 }]);
  });

  test('a DNS failure is passed through unchanged', async () => {
    mock.method(dns, 'lookup', (h, o, cb) => cb(Object.assign(new Error('nope'), { code: 'ENOTFOUND' })));
    await assert.rejects(() => lookup('nope.example'), (e) => e.code === 'ENOTFOUND');
  });

  test('resolvePublicHost refuses private answers and returns the first public one', async () => {
    mock.method(dns.promises, 'lookup', async () => [{ address: '10.0.0.5', family: 4 }]);
    await assert.rejects(() => resolvePublicHost('db.corp'), (e) => e.code === 'EPRIVATE');
    mock.restoreAll();
    mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(await resolvePublicHost('example.com'), '93.184.216.34');
  });
});

describe('netGuard: DNS rebinding against the crawler (regression for review #2, Critical)', () => {
  let server;
  let port;
  let hits = 0;
  let prevAllow;
  before(async () => {
    prevAllow = process.env.CRAWLER_ALLOW_PRIVATE_HOSTS;
    delete process.env.CRAWLER_ALLOW_PRIVATE_HOSTS; // production behaviour
    server = http.createServer((req, res) => { hits += 1; res.setHeader('content-type', 'text/html'); res.end('<html><title>internal secret</title></html>'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  after(() => {
    server.close();
    if (prevAllow !== undefined) process.env.CRAWLER_ALLOW_PRIVATE_HOSTS = prevAllow;
  });

  test('the pre-check sees a public IP, the connection would reach loopback → refused at dial time, nothing fetched', async () => {
    // First resolution (the validation step) answers public; the resolution made
    // when the socket dials is the real one — "localhost" → 127.0.0.1. That is
    // exactly what a rebinding DNS server with TTL 0 does.
    mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    await assert.rejects(() => fetchSafe(`http://localhost:${port}/`, { timeoutMs: 3000 }),
      (e) => e instanceof CrawlerError && e.statusCode === 400 && /non-public address/.test(e.message));
    assert.equal(hits, 0, 'the internal server was never reached');
  });
});

describe('netGuard: ipBucket (rate-limit subject)', () => {
  test('IPv4 is unchanged; IPv4-mapped IPv6 collapses to the IPv4', () => {
    assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
    assert.equal(ipBucket('::ffff:203.0.113.7'), '203.0.113.7');
  });

  test('every address in one IPv6 /64 shares a bucket; different /64s do not', () => {
    const a = ipBucket('2001:470:1f0b:abcd:1111:2222:3333:4444');
    assert.equal(a, '2001:470:1f0b:abcd::/64');
    assert.equal(ipBucket('2001:470:1f0b:abcd::1'), a);
    assert.equal(ipBucket('2001:470:1f0b:abcd:ffff:ffff:ffff:ffff'), a);
    assert.notEqual(ipBucket('2001:470:1f0b:abce::1'), a);
  });

  test('non-IP subjects (emails, tenant ids) pass through', () => {
    assert.equal(ipBucket('ana@acme.com'), 'ana@acme.com');
    assert.equal(ipBucket('t1:abc'), 't1:abc');
  });
});

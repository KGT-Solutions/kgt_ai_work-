const net = require('net');
const dns = require('dns');
const { Agent } = require('undici');

// Outbound-request guard for anything fetched on a user's behalf: website
// crawls, stylesheets, logos, the headless browser's egress proxy, and a
// tenant's own SMTP server. One definition of "private", used everywhere.
//
// The core defence is publicOnlyLookup: it resolves a hostname AND rejects
// any non-public answer inside the connection attempt itself. A separate
// "check, then fetch" lets a hostile DNS server answer the check with a public
// address and the connection's own lookup with an internal one (DNS rebinding)
// — verified: the crawler fetched a loopback-only page that way. With the
// check inside the dial, the address checked is the address dialled.
//
// IP-literal URLs never reach a lookup (sockets dial literals directly), so
// callers still check literals up front — crawler.js assertPublicHost.

// Addresses no fetch on a user's behalf may reach. IPv4: this-network,
// RFC 1918, CGNAT (100.64/10 — Alibaba Cloud serves instance metadata at
// 100.100.100.200), loopback, link-local (169.254.169.254 metadata), IETF
// protocol assignments, documentation, benchmarking, multicast, reserved and
// broadcast. IPv6: unspecified, loopback, unique-local, link-local,
// multicast, documentation, discard-only and Teredo tunnelling.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) BLOCKED.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64], ['2001::', 32]
]) BLOCKED.addSubnet(address, prefix, 'ipv6');

/**
 * An IPv6 address as its eight 16-bit groups, or null when malformed. Handles
 * "::" compression, a zone id ("fe80::1%eth0") and a trailing dotted quad
 * ("::ffff:127.0.0.1").
 * @returns {number[]|null}
 */
function expandIPv6(address) {
  let s = String(address || '').toLowerCase().split('%')[0];
  if (!net.isIPv6(s)) return null;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    s = `${s.slice(0, -dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// The IPv4 address an IPv6 address carries, if any: IPv4-mapped/-compatible
// (::ffff:a.b.c.d, in dotted OR hex form — "::ffff:7f00:1" is 127.0.0.1),
// NAT64 (64:ff9b::/96 and 64:ff9b:1::/48) and 6to4 (2002::/16). Each can
// route to an internal IPv4 host, so it is judged as that IPv4 address.
function embeddedIPv4(g) {
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4(g[6], g[7]);
  if (g[0] === 0x2002) return v4(g[1], g[2]);
  return null;
}

/** True for any non-public IPv4 address — and for anything malformed (unsafe by default). */
function isPrivateIPv4(ip) {
  return !net.isIPv4(String(ip)) || BLOCKED.check(String(ip), 'ipv4');
}

/** True for any non-public IPv6 address, including ones that embed a private IPv4; malformed counts as private. */
function isPrivateIPv6(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return true;
  const v4 = embeddedIPv4(groups);
  if (v4) return isPrivateIPv4(v4);
  return BLOCKED.check(String(ip).split('%')[0], 'ipv6');
}

/** @param {string} address @param {number|string} [family] 4 / 6 (or 'IPv4'/'IPv6'); inferred when absent */
function isPrivateAddress(address, family) {
  const fam = family === 6 || family === 'IPv6' || (!family && net.isIPv6(String(address))) ? 6 : 4;
  return fam === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

// The sandboxed E2E stack crawls a fixture site on a private Docker network.
// It turns the guard off, so production refuses to start with it
// (utils/assertProdSafety.js).
function privateHostsAllowed() {
  return String(process.env.CRAWLER_ALLOW_PRIVATE_HOSTS || '').trim().toLowerCase() === 'true';
}

function privateAddressError(hostname) {
  const err = new Error(`"${hostname}" resolves to a non-public address`);
  err.code = 'EPRIVATE';
  err.hostname = hostname;
  return err;
}

/**
 * A dns.lookup-compatible resolver that refuses non-public answers — for
 * undici's connect.lookup, http.request({ lookup }) and net.connect({ lookup }).
 * Every resolved address must be public (one private answer taints the name).
 */
function publicOnlyLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const opts = typeof options === 'number' ? { family: options } : (options || {});
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!privateHostsAllowed() && addresses.some(({ address, family }) => isPrivateAddress(address, family))) {
      return callback(privateAddressError(hostname));
    }
    if (opts.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(Object.assign(new Error(`No address found for ${hostname}`), { code: 'ENOTFOUND' }));
    return callback(null, first.address, first.family);
  });
}

// The dispatcher every guarded fetch() uses: identical to the default except
// that each connection resolves through publicOnlyLookup. Verified on Node 18
// and Node 20 — the built-in fetch honours it (the same request reaches a
// loopback server without it, and is refused with EPRIVATE with it).
const publicAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

/**
 * Resolve a host and insist every answer is public; the address to connect to.
 * For clients that can't take a custom lookup (nodemailer): connect to the
 * returned IP, so nothing re-resolves the name between check and connect.
 * @returns {Promise<string>} the first resolved address
 * @throws {Error} code EPRIVATE for a non-public answer, ENOTFOUND when unresolvable
 */
async function resolvePublicHost(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw Object.assign(new Error(`Could not resolve ${hostname}`), { code: 'ENOTFOUND' });
  }
  if (!addresses.length) throw Object.assign(new Error(`Could not resolve ${hostname}`), { code: 'ENOTFOUND' });
  if (addresses.some(({ address, family }) => isPrivateAddress(address, family))) throw privateAddressError(hostname);
  return addresses[0].address;
}

/**
 * The rate-limit bucket for a client address. An IPv6 visitor usually holds a
 * whole /64 and can rotate through it at will, so IPv6 addresses are grouped
 * by /64; IPv4-mapped IPv6 collapses to its IPv4 address. Anything that isn't
 * an IP address is returned unchanged.
 */
function ipBucket(ip) {
  const s = String(ip || '');
  if (net.isIPv4(s)) return s;
  const groups = expandIPv6(s);
  if (!groups) return s;
  if (groups.slice(0, 5).every((x) => x === 0) && groups[5] === 0xffff) return embeddedIPv4(groups);
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

module.exports = {
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  expandIPv6,
  publicOnlyLookup,
  publicAgent,
  resolvePublicHost,
  privateHostsAllowed,
  ipBucket
};

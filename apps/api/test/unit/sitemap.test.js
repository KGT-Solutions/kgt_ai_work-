const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseSitemapXml, parseRobotsSitemaps, cleanLoc, collectSitemapUrls } = require('../../src/services/shared/sitemap');

describe('sitemap: parseSitemapXml', () => {
  test('a <urlset> yields page URLs; junk <loc>s are dropped', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://acme.com/a</loc></url>
      <url><loc>https://acme.com/b</loc></url>
      <url><loc>not-a-url</loc></url>
      <url><loc>ftp://acme.com/c</loc></url>
    </urlset>`;
    const { urls, sitemaps } = parseSitemapXml(xml);
    assert.deepEqual(urls, ['https://acme.com/a', 'https://acme.com/b']);
    assert.deepEqual(sitemaps, []);
  });

  test('a <sitemapindex> yields child sitemaps, not pages', () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/sitemap-1.xml</loc></sitemap>
      <sitemap><loc>https://acme.com/sitemap-2.xml</loc></sitemap></sitemapindex>`;
    const { urls, sitemaps } = parseSitemapXml(xml);
    assert.deepEqual(sitemaps, ['https://acme.com/sitemap-1.xml', 'https://acme.com/sitemap-2.xml']);
    assert.deepEqual(urls, []);
  });

  test('namespaced tags and CDATA/entities are handled', () => {
    const xml = `<ns:urlset><ns:url><ns:loc><![CDATA[https://acme.com/x?a=1&amp;b=2]]></ns:loc></ns:url></ns:urlset>`;
    const { urls } = parseSitemapXml(xml);
    assert.deepEqual(urls, ['https://acme.com/x?a=1&b=2']);
  });
});

describe('sitemap: parseRobotsSitemaps', () => {
  test('pulls Sitemap: directives case-insensitively', () => {
    const robots = 'User-agent: *\nDisallow: /admin\nSitemap: https://acme.com/sitemap.xml\nsitemap:https://acme.com/news.xml';
    assert.deepEqual(parseRobotsSitemaps(robots), ['https://acme.com/sitemap.xml', 'https://acme.com/news.xml']);
  });
  test('no directives → empty', () => {
    assert.deepEqual(parseRobotsSitemaps('User-agent: *\nDisallow:'), []);
  });
});

describe('sitemap: cleanLoc', () => {
  test('only http(s) absolute URLs survive', () => {
    assert.equal(cleanLoc('https://a.com/p'), 'https://a.com/p');
    assert.equal(cleanLoc('  http://a.com/p '), 'http://a.com/p');
    assert.equal(cleanLoc('javascript:alert(1)'), null);
    assert.equal(cleanLoc('/relative'), null);
  });
});

describe('sitemap: collectSitemapUrls (injected fetch)', () => {
  // A fake network: robots.txt points to an index, the index points to two
  // child sitemaps, and those list pages — including one off-site page that must
  // be dropped (same-domain scoping) and a www/apex equivalence.
  const makeFetch = (map) => async (url) => (url in map ? map[url] : null);

  test('follows robots → index → children and scopes to the same site', async () => {
    const fetchText = makeFetch({
      'https://acme.com/robots.txt': 'Sitemap: https://acme.com/sitemap_index.xml',
      'https://acme.com/sitemap_index.xml': `<sitemapindex>
        <sitemap><loc>https://acme.com/pages.xml</loc></sitemap>
        <sitemap><loc>https://www.acme.com/posts.xml</loc></sitemap>
      </sitemapindex>`,
      'https://acme.com/pages.xml': `<urlset><url><loc>https://acme.com/about</loc></url>
        <url><loc>https://evil.com/phishing</loc></url></urlset>`,
      'https://www.acme.com/posts.xml': `<urlset><url><loc>https://www.acme.com/blog/1</loc></url></urlset>`
    });
    const { urls, sitemaps, baseHost, truncated } = await collectSitemapUrls('https://acme.com', { fetchText });
    assert.deepEqual(urls.sort(), ['https://acme.com/about', 'https://www.acme.com/blog/1'].sort());
    assert.ok(sitemaps.includes('https://acme.com/sitemap_index.xml'));
    assert.equal(baseHost, 'acme.com');
    assert.equal(truncated, false);
  });

  test('falls back to /sitemap.xml when robots has no directive', async () => {
    const fetchText = makeFetch({
      'https://acme.com/robots.txt': 'User-agent: *\nDisallow:',
      'https://acme.com/sitemap.xml': `<urlset><url><loc>https://acme.com/home</loc></url></urlset>`
    });
    const { urls } = await collectSitemapUrls('https://acme.com/some/page', { fetchText });
    assert.deepEqual(urls, ['https://acme.com/home']);
  });

  test('caps the number of URLs (truncated flag)', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `<url><loc>https://acme.com/p${i}</loc></url>`).join('');
    const fetchText = makeFetch({
      'https://acme.com/robots.txt': null,
      'https://acme.com/sitemap.xml': `<urlset>${many}</urlset>`
    });
    const { urls, truncated } = await collectSitemapUrls('https://acme.com', { fetchText, maxUrls: 3 });
    assert.equal(urls.length, 3);
    assert.equal(truncated, true);
  });

  test('an invalid start URL is refused', async () => {
    await assert.rejects(() => collectSitemapUrls('not a url', { fetchText: async () => null }));
  });
});

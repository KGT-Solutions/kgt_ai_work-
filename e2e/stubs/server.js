// Stand-ins for the outside world in the sandboxed E2E stack — no
// dependencies, plain Node http:
//
//   :8080  a fake OpenAI-compatible LLM (the API's OPENAI_BASE_URL points here)
//   :8081  "Northwind Thermostats", a small company website for the crawler
//
// The fake LLM recognises the API's three kinds of prompt and answers each
// deterministically, so the E2E assertions can be exact:
//   - readiness audit  -> JSON report; the Support pillar scores low until the
//                         knowledge contains a refund / return policy, then high
//                         (drives the wizard's "Path to 100%" upload test);
//   - lead / session summary -> a fixed executive summary;
//   - anything else    -> a short bullet-point chat answer.
// GET /__calls lists every prompt received, for debugging a failed run.
const http = require('http');

const MODEL = process.env.OPENAI_MODEL || 'fake-model';
const calls = [];

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function auditReport(content) {
  const hasRefundPolicy = /\brefund policy\b|\breturns? (and|&) refunds?\b/i.test(content);
  const pillar = (score, summary, gaps = []) => ({ score, summary, gaps });
  return {
    pillars: {
      identity: pillar(85, 'Clear description of Northwind Thermostats.'),
      features: pillar(85, 'Product features and integrations are described.'),
      pricing: pillar(80, 'Plans and prices are listed.'),
      support: hasRefundPolicy
        ? pillar(90, 'Setup help, warranty and the refund policy are covered.')
        : pillar(30, 'Setup help exists, but there is no refund or returns policy.', ['No refund or returns policy']),
      sales: pillar(80, 'Benefits and customer results are described.')
    },
    criticalGaps: { support: hasRefundPolicy ? [] : ['No refund or returns policy'], sales: [] },
    requirements: {
      support: hasRefundPolicy ? [] : ['Upload your company Return & Refund Policy or FAQ document.'],
      sales: []
    }
  };
}

// The labelled format the API's summary prompt asks for (services/leads.js
// buildSummaryPrompt), which the dashboard lays out label by label.
const SUMMARY = [
  'Intent: Wants a product demo of the Northwind smart thermostat.',
  'Key questions:',
  '• Asked about plans before requesting a demo.',
  'Outcome: Handed to the team for a follow-up.',
  'Follow-up actions:',
  '• Schedule a demo call this week.'
].join('\n');

const STARTERS = {
  support: ['How do I install the thermostat?', 'What does the warranty cover?'],
  sales: ['What plans do you offer?', 'How much can I save on energy?']
};

function answerFor(system, user) {
  if (/You audit the knowledge base/.test(system)) return JSON.stringify(auditReport(user));
  if (/You write internal follow-up notes/.test(system)) return SUMMARY;
  if (/You write starter questions/.test(system)) return JSON.stringify(STARTERS); // dashboard suggested questions
  return '• Northwind thermostats learn your schedule and cut energy use.\n• Ask me about plans, setup or support.';
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] });
  if (req.method === 'GET' && req.url === '/__calls') return json(res, 200, calls);
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: 'not found' });
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
    const system = (data.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = (data.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const content = answerFor(system, user);
    calls.push({ at: new Date().toISOString(), kind: /"pillars"/.test(content) ? 'audit' : content === SUMMARY ? 'summary' : content.startsWith('{') ? 'starters' : 'chat', system: system.slice(0, 120) });
    json(res, 200, {
      id: `chatcmpl-${calls.length}`, object: 'chat.completion', model: data.model || MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: 0 }
    });
  });
}).listen(8080, () => console.log('[stubs] fake LLM on :8080'));

// ── The company website. Deliberately says nothing about refunds or returns,
// so the audit asks for that document.
const nav = '<nav><a href="/">Home</a> <a href="/features">Features</a> <a href="/pricing">Pricing</a> <a href="/support">Support</a></nav>';
const page = (title, body) => `<!doctype html><html><head><title>${title} | Northwind Thermostats</title></head><body>${nav}<main><h1>${title}</h1>${body}</main><footer>© Northwind Thermostats</footer></body></html>`;
const SITE = {
  '/': page('About Northwind Thermostats', `
    <p>We are Northwind Thermostats, founded in 2015 in Pune. We help homeowners and small offices cut heating and cooling costs with smart thermostats that learn daily routines.</p>
    <p>Our mission is simple: a comfortable home that never wastes energy. More than 40,000 customers across India trust Northwind to manage their climate every day.</p>
    <p>Contact us at hello@northwind.example or call +91 20 5555 0100, Monday to Saturday.</p>`),
  '/features': page('Features', `
    <p>The Northwind Smart Thermostat learns your schedule in one week and adjusts the temperature automatically. It includes geofencing, so it switches to eco mode when everyone leaves home.</p>
    <p>It integrates with Google Home, Amazon Alexa and Apple HomeKit, and supports most 24V heating and cooling systems. The mobile app shows energy reports and lets you control every room remotely.</p>
    <p>Each unit includes a two-year warranty, free over-the-air updates and a built-in humidity sensor.</p>`),
  '/pricing': page('Pricing and plans', `
    <p>Choose the plan that fits your home. Starter costs ₹6,999 per thermostat with the free mobile app.</p>
    <p>Plus costs ₹9,499 per thermostat and adds room sensors, energy reports and priority support. Business plans for offices start at ₹1,499 per month for up to ten thermostats, billed yearly, with a 30-day free trial.</p>
    <p>Why choose us: customers save up to 23% on energy bills, and our installers are trusted by over 300 builders. Compare us with any alternative: no subscription is required for home plans.</p>`),
  '/support': page('Setup and help', `
    <p>How do I set up my thermostat? Turn off power at the breaker, remove the old thermostat, connect the labelled wires to the Northwind base, then restore power and follow the steps in the app.</p>
    <p>The screen is blank: check the breaker and the C-wire connection. Wi-Fi not working: move the router closer or use the 2.4 GHz network. Our support team answers email within one business day.</p>`)
};

http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\n'); }
  const html = SITE[path];
  res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html || page('Not found', '<p>No such page.</p>'));
}).listen(8081, () => console.log('[stubs] company website on :8081'));

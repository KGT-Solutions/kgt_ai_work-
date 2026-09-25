/**
 * KGT Solutions tenant chat widget — drop-in loader for any resold tenant
 * (see routes/tenantChat.routes.js, routes/publicRegister.routes.js). Unlike
 * sales-chat-widget.js (hardcoded to FLATBRIZ's own sales bot via an
 * iframe), this one is generic: it reads which tenant and which bot to talk
 * to from the script tag's own attributes, so the exact same file works for
 * every tenant this platform ever provisions.
 *
 * Embed with:
 *   <script src="https://YOUR-API-HOST/widgets/tenant-chat-widget.js"
 *           data-tenant-id="acme-a1b2c3" data-api-key="tk_..." defer></script>
 *
 * data-tenant-id is the tenant's SLUG (returned as `slug` by
 * POST /api/v1/public/register/complete) — it addresses
 * /api/v1/tenant-chat/:slug/chat, which is the actual routing key; "tenant
 * id" here means "your public tenant identifier," not the internal DB id.
 *
 * Renders both bots with a Support/Sales toggle in one widget (a visitor
 * can start on Support and switch to Sales without leaving the panel) —
 * default bot on open is configurable via data-default-bot ("support" or
 * "sales", defaults to "support"). No iframe: the widget calls the API
 * directly with fetch(), which works cross-origin because the API's CORS
 * policy (app.js) is already open to any origin.
 */
(function () {
  if (window.__kgtTenantChatLoaded) return;
  window.__kgtTenantChatLoaded = true;

  var currentScript = document.currentScript;
  if (!currentScript) return;

  var tenantSlug = currentScript.getAttribute('data-tenant-id');
  var apiKey = currentScript.getAttribute('data-api-key');
  var defaultBot = currentScript.getAttribute('data-default-bot') === 'sales' ? 'sales' : 'support';
  var apiBase =
    currentScript.getAttribute('data-api-base') ||
    new URL(currentScript.src, window.location.href).origin;
  apiBase = apiBase.replace(/\/$/, '');

  if (!tenantSlug || !apiKey) {
    console.error('[kgt-chat-widget] data-tenant-id and data-api-key are both required.');
    return;
  }

  var ns = 'kgt-chat-' + tenantSlug.replace(/[^a-zA-Z0-9_-]/g, '');
  var botType = defaultBot;
  var sessionIds = {}; // botType -> sessionId, kept separate like the wizard's own test widget
  var open = false;
  var sending = false;

  var style = document.createElement('style');
  style.textContent =
    '#' + ns + '-launcher{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;' +
    'background:#0f172a;border:none;box-shadow:0 8px 24px rgba(15,23,42,.35);cursor:pointer;' +
    'z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s ease;}' +
    '#' + ns + '-launcher:hover{transform:scale(1.06);}' +
    '#' + ns + '-launcher svg{width:26px;height:26px;fill:#fff;}' +
    '#' + ns + '-panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 24px);' +
    'height:520px;max-height:calc(100vh - 120px);border-radius:18px;box-shadow:0 20px 48px rgba(6,10,26,.25);' +
    'z-index:2147483000;display:none;background:#fff;overflow:hidden;flex-direction:column;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;}' +
    '#' + ns + '-panel.open{display:flex;}' +
    '@media (max-width:480px){#' + ns + '-panel{right:12px;bottom:84px;width:calc(100vw - 24px);height:calc(100vh - 110px);}}' +
    '#' + ns + '-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;' +
    'border-bottom:1px solid #e2e8f0;flex-shrink:0;}' +
    '#' + ns + '-tabs{display:flex;background:#f1f5f9;border-radius:8px;padding:2px;gap:2px;}' +
    '#' + ns + '-tabs button{border:none;background:transparent;font-size:12px;font-weight:600;padding:5px 10px;' +
    'border-radius:6px;cursor:pointer;color:#64748b;text-transform:capitalize;}' +
    '#' + ns + '-tabs button.active{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(0,0,0,.08);}' +
    '#' + ns + '-close{border:none;background:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:2px 6px;}' +
    '#' + ns + '-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;}' +
    '#' + ns + '-body .msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.4;}' +
    '#' + ns + '-body .msg.user{align-self:flex-end;background:#0f172a;color:#fff;}' +
    '#' + ns + '-body .msg.bot{align-self:flex-start;background:#f1f5f9;color:#0f172a;}' +
    '#' + ns + '-body .msg.err{align-self:flex-start;background:#fef2f2;color:#b91c1c;}' +
    '#' + ns + '-body .empty{margin:auto;text-align:center;color:#94a3b8;font-size:12.5px;padding:0 10px;}' +
    '#' + ns + '-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;flex-shrink:0;}' +
    '#' + ns + '-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;}' +
    '#' + ns + '-input:focus{border-color:#0f172a;}' +
    '#' + ns + '-send{border:none;background:#0f172a;color:#fff;font-size:13px;font-weight:600;padding:0 14px;' +
    'border-radius:8px;cursor:pointer;}' +
    '#' + ns + '-send:disabled{opacity:.4;cursor:not-allowed;}';
  document.head.appendChild(style);

  var launcher = document.createElement('button');
  launcher.id = ns + '-launcher';
  launcher.setAttribute('aria-label', 'Chat with us');
  launcher.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M12 2C6.48 2 2 6.02 2 11c0 2.61 1.28 4.94 3.29 6.6L4 22l4.78-1.46C9.79 20.83 10.88 21 12 21c5.52 0 10-4.02 10-9s-4.48-10-10-10z"/></svg>';

  var panel = document.createElement('div');
  panel.id = ns + '-panel';
  panel.innerHTML =
    '<div id="' + ns + '-head">' +
    '<div id="' + ns + '-tabs">' +
    '<button type="button" data-bot="support">Support</button>' +
    '<button type="button" data-bot="sales">Sales</button>' +
    '</div>' +
    '<button type="button" id="' + ns + '-close" aria-label="Close">×</button>' +
    '</div>' +
    '<div id="' + ns + '-body"></div>' +
    '<form id="' + ns + '-form">' +
    '<input id="' + ns + '-input" type="text" placeholder="Ask a question…" autocomplete="off" />' +
    '<button id="' + ns + '-send" type="submit">Send</button>' +
    '</form>';

  var byBotMessages = { support: [], sales: [] };

  function renderTabs() {
    var buttons = panel.querySelectorAll('#' + ns + '-tabs button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].className = buttons[i].getAttribute('data-bot') === botType ? 'active' : '';
    }
  }

  function renderMessages() {
    var body = panel.querySelector('#' + ns + '-body');
    var msgs = byBotMessages[botType];
    body.innerHTML = '';
    if (!msgs.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Ask the ' + botType + ' bot anything — it only answers from this company’s own content.';
      body.appendChild(empty);
      return;
    }
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var el = document.createElement('div');
      el.className = 'msg ' + (m.role === 'user' ? 'user' : m.error ? 'err' : 'bot');
      el.textContent = m.text;
      body.appendChild(el);
    }
    body.scrollTop = body.scrollHeight;
  }

  function setOpen(next) {
    open = next;
    panel.className = open ? 'open' : '';
    if (open) renderMessages();
  }

  launcher.addEventListener('click', function () { setOpen(!open); });
  panel.querySelector('#' + ns + '-close').addEventListener('click', function () { setOpen(false); });

  var tabButtons = panel.querySelectorAll('#' + ns + '-tabs button');
  for (var t = 0; t < tabButtons.length; t++) {
    tabButtons[t].addEventListener('click', function (e) {
      botType = e.currentTarget.getAttribute('data-bot');
      renderTabs();
      renderMessages();
    });
  }

  panel.querySelector('#' + ns + '-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = panel.querySelector('#' + ns + '-input');
    var query = input.value.trim();
    if (!query || sending) return;
    input.value = '';
    sending = true;
    panel.querySelector('#' + ns + '-send').disabled = true;
    byBotMessages[botType].push({ role: 'user', text: query });
    renderMessages();

    fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
      body: JSON.stringify({ query: query, botType: botType, sessionId: sessionIds[botType] })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : 'The bot could not respond.');
        sessionIds[botType] = result.data.sessionId;
        byBotMessages[botType].push({ role: 'assistant', text: result.data.answer });
      })
      .catch(function (err) {
        byBotMessages[botType].push({ role: 'assistant', text: err.message, error: true });
      })
      .finally(function () {
        sending = false;
        panel.querySelector('#' + ns + '-send').disabled = false;
        renderMessages();
      });
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(launcher);
    renderTabs();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();

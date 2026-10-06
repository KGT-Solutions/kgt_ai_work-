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
 *           data-tenant-id="acme-a1b2c3" data-api-key="tk_..." data-bot="sales" defer></script>
 *
 * data-bot picks the bot this widget talks to, and is sent as botType on
 * every message so the API applies that bot's persona and knowledge weighting:
 *   "sales"   — public pages (landing, pricing, marketing)
 *   "support" — logged-in areas (dashboards, portals, help centers)
 * With data-bot set the widget is locked to that one bot (no toggle). An
 * unrecognised value falls back to support, with a console warning.
 *
 * data-tenant-id is the tenant's SLUG (returned as `slug` by
 * POST /api/v1/public/register/complete) — it addresses
 * /api/v1/tenant-chat/:slug/chat, which is the actual routing key; "tenant
 * id" here means "your public tenant identifier," not the internal DB id.
 *
 * Without data-bot (snippets issued before it existed), renders both bots
 * with a Support/Sales toggle in one widget (a visitor
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
  var BOT_LABELS = { support: 'Support', sales: 'Sales' };
  var botAttr = currentScript.getAttribute('data-bot');
  var lockedBot = null; // set when the snippet names one bot: no toggle, every message goes to it
  if (botAttr !== null) {
    lockedBot = String(botAttr).trim().toLowerCase();
    if (!BOT_LABELS[lockedBot]) {
      console.warn('[kgt-chat-widget] data-bot must be "sales" or "support" — got "' + botAttr + '", using support.');
      lockedBot = 'support';
    }
  }
  var defaultBot = lockedBot || (currentScript.getAttribute('data-default-bot') === 'sales' ? 'sales' : 'support');
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
    '#' + ns + '-title{font-size:13.5px;font-weight:600;color:#0f172a;}' +
    '#' + ns + '-close{border:none;background:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:2px 6px;}' +
    '#' + ns + '-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;}' +
    '#' + ns + '-body .msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.4;white-space:pre-line;}' +
    '#' + ns + '-body .msg.user{align-self:flex-end;background:#0f172a;color:#fff;}' +
    '#' + ns + '-body .msg.bot{align-self:flex-start;background:#f1f5f9;color:#0f172a;}' +
    '#' + ns + '-body .msg.bot p{margin:0 0 8px;}' +
    '#' + ns + '-body .msg.bot ul,#' + ns + '-body .msg.bot ol{margin:0 0 8px;padding-left:18px;}' +
    '#' + ns + '-body .msg.bot li{margin:0 0 4px;padding-left:2px;}' +
    '#' + ns + '-body .msg.bot > :last-child,#' + ns + '-body .msg.bot li:last-child{margin-bottom:0;}' +
    '#' + ns + '-body .msg.bot strong{font-weight:600;}' +
    '#' + ns + '-body .msg.err{align-self:flex-start;background:#fef2f2;color:#b91c1c;}' +
    '#' + ns + '-body .empty{margin:auto;text-align:center;color:#94a3b8;font-size:12.5px;padding:0 10px;}' +
    '#' + ns + '-body .chips{align-self:flex-start;display:flex;flex-wrap:wrap;gap:6px;max-width:92%;}' +
    '#' + ns + '-body .chip{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;' +
    'padding:5px 10px;font-size:12px;line-height:1.3;text-align:left;cursor:pointer;font-family:inherit;}' +
    '#' + ns + '-body .chip:hover{border-color:#0f172a;background:#f8fafc;}' +
    '#' + ns + '-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;flex-shrink:0;}' +
    '#' + ns + '-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;}' +
    '#' + ns + '-input:focus{border-color:#0f172a;}' +
    '#' + ns + '-send{border:none;background:#0f172a;color:#fff;font-size:13px;font-weight:600;padding:0 14px;' +
    'border-radius:8px;cursor:pointer;}' +
    '#' + ns + '-send:disabled{opacity:.4;cursor:not-allowed;}';
  document.head.appendChild(style);

  var launcher = document.createElement('button');
  launcher.id = ns + '-launcher';
  launcher.setAttribute('aria-label', lockedBot === 'sales' ? 'Chat with sales' : lockedBot === 'support' ? 'Get support' : 'Chat with us');
  launcher.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M12 2C6.48 2 2 6.02 2 11c0 2.61 1.28 4.94 3.29 6.6L4 22l4.78-1.46C9.79 20.83 10.88 21 12 21c5.52 0 10-4.02 10-9s-4.48-10-10-10z"/></svg>';

  var panel = document.createElement('div');
  panel.id = ns + '-panel';
  panel.innerHTML =
    '<div id="' + ns + '-head">' +
    (lockedBot
      ? '<div id="' + ns + '-title">' + (lockedBot === 'sales' ? 'Talk to sales' : 'Support') + '</div>'
      : '<div id="' + ns + '-tabs">' +
        '<button type="button" data-bot="support">Support</button>' +
        '<button type="button" data-bot="sales">Sales</button>' +
        '</div>') +
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
      empty.textContent = botType === 'sales'
        ? 'Questions about plans, pricing or features? Ask away — answers come from this company’s own content.'
        : 'Need help? Ask anything — answers come from this company’s own content.';
      body.appendChild(empty);
      return;
    }
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var el = document.createElement('div');
      el.className = 'msg ' + (m.role === 'user' ? 'user' : m.error ? 'err' : 'bot');
      if (m.role === 'assistant' && !m.error) renderRichText(el, m.text);
      else el.textContent = m.text;
      body.appendChild(el);
    }
    // Suggested follow-ups under the latest reply only; clicking one asks it.
    var last = msgs[msgs.length - 1];
    if (!sending && last.role === 'assistant' && !last.error && last.followUps && last.followUps.length) {
      var chips = document.createElement('div');
      chips.className = 'chips';
      chips.setAttribute('aria-label', 'Suggested questions');
      for (var j = 0; j < last.followUps.length; j++) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = last.followUps[j];
        chip.addEventListener('click', function (e) { sendQuery(e.currentTarget.textContent); });
        chips.appendChild(chip);
      }
      body.appendChild(chips);
    }
    body.scrollTop = body.scrollHeight;
  }

  // Bot replies use a small formatting subset (engine/promptBuilder.js "HOW
  // TO LAY IT OUT"): paragraphs split by blank lines, "- " / "* " / "• "
  // bullets, "1." steps and **bold**. Built with createElement + textContent
  // only, never innerHTML, so nothing in a reply can inject markup into the
  // host page. Anything else (a stray "#" heading) degrades to plain text.
  function appendInline(parent, text) {
    var parts = String(text).split(/\*\*(.+?)\*\*/g); // odd indexes are the bold runs
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (i % 2) {
        var b = document.createElement('strong');
        b.textContent = parts[i];
        parent.appendChild(b);
      } else {
        parent.appendChild(document.createTextNode(parts[i]));
      }
    }
  }

  function renderRichText(container, text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var para = null;
    var list = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s*#{1,6}\s+/, '').trim();
      var bullet = /^[-*•]\s+(.*)$/.exec(line);
      var step = bullet ? null : /^(\d+)[.)]\s+(.*)$/.exec(line);
      if (!line) {
        para = null;
        list = null;
      } else if (bullet || step) {
        var tag = bullet ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = document.createElement(tag);
          if (step && step[1] !== '1') list.setAttribute('start', step[1]);
          container.appendChild(list);
        }
        var li = document.createElement('li');
        appendInline(li, bullet ? bullet[1] : step[2]);
        list.appendChild(li);
        para = null;
      } else {
        if (!para) {
          para = document.createElement('p');
          container.appendChild(para);
        } else {
          para.appendChild(document.createElement('br'));
        }
        appendInline(para, line);
        list = null;
      }
    }
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
    if (sendQuery(input.value)) input.value = '';
  });

  // Sends one question to the current bot. Used by the form and the
  // follow-up chips. Returns false if there was nothing to send.
  function sendQuery(text) {
    var query = String(text || '').trim();
    if (!query || sending) return false;
    sending = true;
    panel.querySelector('#' + ns + '-send').disabled = true;
    // The bot this message went to. The visitor may switch tabs before the
    // reply arrives; the reply and its sessionId still belong to this bot.
    var sentBot = botType;
    byBotMessages[sentBot].push({ role: 'user', text: query });
    renderMessages();

    fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
      body: JSON.stringify({ query: query, botType: sentBot, sessionId: sessionIds[sentBot] })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : 'The bot could not respond.');
        sessionIds[sentBot] = result.data.sessionId;
        byBotMessages[sentBot].push({ role: 'assistant', text: result.data.answer, followUps: result.data.followUps || [] });
      })
      .catch(function (err) {
        byBotMessages[sentBot].push({ role: 'assistant', text: err.message, error: true });
      })
      .finally(function () {
        sending = false;
        panel.querySelector('#' + ns + '-send').disabled = false;
        renderMessages();
      });
    return true;
  }

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

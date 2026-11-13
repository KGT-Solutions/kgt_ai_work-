/**
 * KGT Solutions tenant chat widget — drop-in loader for any resold tenant
 * (see routes/tenantChat.routes.js, routes/publicRegister.routes.js). Unlike
 * sales-chat-widget.js (hardcoded to FLATBRIZ's own sales bot via an
 * iframe), this one is generic: it reads which tenant and which bot to talk
 * to from the script tag's own attributes, so the exact same file works for
 * every tenant this platform ever provisions.
 *
 * Embed with:
 *   <script src="https://api.kgt.solutions/widgets/tenant-chat-widget.js"
 *           data-tenant-id="acme-a1b2c3" data-api-key="tk_..." data-bot="sales" defer></script>
 * It talks to the host it was loaded from (see apiBase below for overrides).
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
  // The API: data-api-base, else window.KGTChatConfig.apiBase (for a site
  // that sets it before loading the widget), else the host this script was
  // served from — the API itself. A script with no src (inlined or bundled
  // into the site's own JS) has no host to go by, so production. A local API
  // on a site that isn't local (a dev snippet copied into production) can
  // never be reached by a visitor, and is blocked by CSP: the script's own
  // host, or production, instead.
  var DEFAULT_API_BASE = 'https://api.kgt.solutions';
  var isLocalUrl = function (u) {
    try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(u, window.location.href).hostname); } catch (e) { return false; }
  };
  var scriptOrigin = currentScript.src ? new URL(currentScript.src, window.location.href).origin : null;
  var config = window.KGTChatConfig || {};
  var apiBase = currentScript.getAttribute('data-api-base') || config.apiBase || scriptOrigin || DEFAULT_API_BASE;
  if (isLocalUrl(apiBase) && !isLocalUrl(window.location.href)) {
    var fallback = scriptOrigin && !isLocalUrl(scriptOrigin) ? scriptOrigin : DEFAULT_API_BASE;
    console.warn('[kgt-chat-widget] ' + apiBase + ' is a local address, unreachable from this site; using ' + fallback + '. Re-copy the embed snippet from the dashboard.');
    apiBase = fallback;
  }
  apiBase = String(apiBase).replace(/\/+$/, '');

  if (!tenantSlug || !apiKey) {
    console.error('[kgt-chat-widget] data-tenant-id and data-api-key are both required.');
    return;
  }

  var ns = 'kgt-chat-' + tenantSlug.replace(/[^a-zA-Z0-9_-]/g, '');
  var botType = defaultBot;
  var sessionIds = {}; // botType -> sessionId, kept separate like the wizard's own test widget
  var open = false;
  var sending = false;
  var customBotName = null; // the display name set in the Theme Studio; null = the default title

  // --- Language (English / Hindi) -------------------------------------
  // The widget's UI language: labels, the welcome greeting, placeholders. It
  // is NOT what the bot answers in — the backend answers in whatever language
  // the visitor actually typed (see engine/language.js) — but it is sent as a
  // hint so a too-short message ("ok") still comes back in the chosen one.
  // Remembered per browser (best-effort; private windows may throw).
  var LANG_KEY = ns + '-lang';
  var lang = 'en';
  try {
    var savedLang = window.localStorage.getItem(LANG_KEY);
    if (savedLang === 'en' || savedLang === 'hi') lang = savedLang;
  } catch (e) { /* storage unavailable: default to English */ }

  function setLang(next) {
    if (next !== 'en' && next !== 'hi') return;
    lang = next;
    try { window.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    applyStaticStrings();
    renderTabs();
    renderMessages();
  }

  // All visitor-facing copy, per language. Bot answers and backend-generated
  // follow-up chips are not here — those arrive already in the right language.
  var STRINGS = {
    en: {
      titleSupport: 'Support', titleSales: 'Talk to sales',
      tabSupport: 'Support', tabSales: 'Sales',
      placeholder: 'Ask a question…', send: 'Send', close: 'Close',
      emptySupport: 'Need help? Ask anything — answers come from this company’s own content.',
      emptySales: 'Questions about plans, pricing or features? Ask away — answers come from this company’s own content.',
      langPrompt: 'Choose your language', suggested: 'Suggested questions',
      products: 'Products', inquire: 'Inquire', inquirePrefix: 'Tell me more about ', view: 'View product',
      errorGeneric: 'The bot could not respond.',
      attach: 'Attach image', imageReady: 'Image attached', removeImage: 'Remove image',
      imageTooBig: 'That image is too large (max 5MB).',
      imageType: 'Please choose a PNG, JPEG, WebP or GIF image.',
      mic: 'Voice input', listening: 'Listening… tap to stop', transcribing: 'Transcribing…',
      micDenied: 'Microphone access was blocked.', voiceError: 'Could not transcribe that. Please try again.'
    },
    hi: {
      titleSupport: 'सहायता', titleSales: 'सेल्स से बात करें',
      tabSupport: 'सहायता', tabSales: 'सेल्स',
      placeholder: 'अपना सवाल पूछें…', send: 'भेजें', close: 'बंद करें',
      emptySupport: 'मदद चाहिए? कुछ भी पूछें — जवाब इसी कंपनी की अपनी जानकारी से आते हैं।',
      emptySales: 'प्लान, कीमत या फ़ीचर्स के बारे में सवाल हैं? बेझिझक पूछें — जवाब इसी कंपनी की अपनी जानकारी से आते हैं।',
      langPrompt: 'अपनी भाषा चुनें', suggested: 'सुझाए गए सवाल',
      products: 'उत्पाद', inquire: 'जानकारी लें', inquirePrefix: 'इसके बारे में और बताइए: ', view: 'उत्पाद देखें',
      errorGeneric: 'बॉट जवाब नहीं दे सका।',
      attach: 'तस्वीर जोड़ें', imageReady: 'तस्वीर जोड़ी गई', removeImage: 'तस्वीर हटाएँ',
      imageTooBig: 'यह तस्वीर बहुत बड़ी है (अधिकतम 5MB)।',
      imageType: 'कृपया PNG, JPEG, WebP या GIF तस्वीर चुनें।',
      mic: 'आवाज़ से बोलें', listening: 'सुन रहा हूँ… रोकने के लिए टैप करें', transcribing: 'लिखा जा रहा है…',
      micDenied: 'माइक्रोफ़ोन की अनुमति नहीं मिली।', voiceError: 'उसे समझ नहीं पाया। कृपया फिर कोशिश करें।'
    }
  };
  function t(key) { return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || ''; }

  var style = document.createElement('style');
  style.textContent =
    // Theme tokens (Theme Studio). These defaults ARE the classic look; an
    // applied design overrides them from a second <style> (applyTheme below).
    '#' + ns + '-launcher,#' + ns + '-panel{--kgt-primary:#0f172a;--kgt-on-primary:#ffffff;--kgt-secondary:#cbd5e1;' +
    '--kgt-bg:#ffffff;--kgt-text:#0f172a;--kgt-bot-bubble:#f1f5f9;--kgt-radius:12px;' +
    '--kgt-font:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;--kgt-head-bg:#ffffff;--kgt-head-text:#0f172a;' +
    '--kgt-head-muted:#64748b;--kgt-head-border:#e2e8f0;--kgt-head-chip:#f1f5f9;}' +
    '#' + ns + '-launcher{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;' +
    'background:var(--kgt-primary);border:none;box-shadow:0 8px 24px rgba(15,23,42,.35);cursor:pointer;' +
    'z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s ease;}' +
    '#' + ns + '-launcher:hover{transform:scale(1.06);}' +
    '#' + ns + '-launcher svg{width:26px;height:26px;fill:var(--kgt-on-primary);}' +
    '#' + ns + '-panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 24px);' +
    'height:520px;max-height:calc(100vh - 120px);border-radius:18px;box-shadow:0 20px 48px rgba(6,10,26,.25);' +
    'z-index:2147483000;display:none;background:var(--kgt-bg);overflow:hidden;flex-direction:column;' +
    'font-family:var(--kgt-font);color:var(--kgt-text);}' +
    '#' + ns + '-panel.open{display:flex;}' +
    '@media (max-width:480px){#' + ns + '-panel{right:12px;bottom:84px;width:calc(100vw - 24px);height:calc(100vh - 110px);}}' +
    '#' + ns + '-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;' +
    'border-bottom:1px solid var(--kgt-head-border);flex-shrink:0;gap:8px;background:var(--kgt-head-bg);color:var(--kgt-head-text);}' +
    '#' + ns + '-head-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1;}' +
    // Brand mark: the company logo in a badge chosen server-side for this
    // design's header (themeGenerator.js logoBadgeFor), so only the artwork
    // shows — never a pasted-on rectangle. A logo's white box is normally
    // removed from the image itself on the server (logoUpload.js); these rules
    // seat what's left:
    //   plain — straight on the header; .tint-light / .tint-dark recolour a
    //           single-colour mark to the header's ink; .blend (multiply) melts
    //           a remaining white box into a light header;
    //   pill  — a padded rounded chip for a mark that needs a contrasting plate;
    //           .blend melts a white image box into a white chip;
    //   tile  — a coloured/dark app-icon logo, edge to edge, rounded.
    // The image keeps its proportions (object-fit:contain, height-led, capped
    // width), so wide wordmarks and tall emblems both fit the 30px header slot.
    // The company's initial stands in when there's no logo or it fails to load.
    // Keep in step with BrandMark in apps/web/components/workspace/BrandingStudio.js.
    '#' + ns + '-brand{display:none;align-items:center;flex-shrink:0;}' +
    '#' + ns + '-brand.show{display:flex;}' +
    '#' + ns + '-brand .badge{display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'height:30px;max-width:112px;min-width:0;border-radius:9px;overflow:hidden;flex-shrink:0;}' +
    '#' + ns + '-brand .badge img{display:block;height:100%;width:auto;max-width:100%;object-fit:contain;object-position:center;' +
    'user-select:none;-webkit-user-drag:none;}' +
    '#' + ns + '-brand .badge.plain{height:28px;max-width:120px;padding:2px 0;border-radius:0;background:transparent;}' +
    '#' + ns + '-brand .badge.pill{padding:4px 10px;border-radius:10px;}' +
    '#' + ns + '-brand .badge.tile{padding:2px;border-radius:9px;}' +
    // multiply erases only PURE white; the 5% lift first pushes a near-white
    // box (#f3–#fe: JPEG noise, off-white exports) to exact white so it melts
    // away completely. Only reached by logos the server couldn't clean.
    '#' + ns + '-brand .badge.blend img{mix-blend-mode:multiply;filter:brightness(1.05);}' +
    '#' + ns + '-brand .badge.tint-light img{filter:brightness(0) invert(1);}' +
    '#' + ns + '-brand .badge.tint-dark img{filter:brightness(0);opacity:.86;}' +
    '#' + ns + '-brand .initial{width:26px;height:26px;border-radius:50%;background:var(--kgt-head-chip);color:var(--kgt-head-text);' +
    'font-size:12.5px;font-weight:700;display:flex;align-items:center;justify-content:center;}' +
    '#' + ns + '-tabs{display:flex;background:var(--kgt-head-chip);border-radius:8px;padding:2px;gap:2px;}' +
    '#' + ns + '-tabs button{border:none;background:transparent;font-size:12px;font-weight:600;padding:5px 10px;' +
    'border-radius:6px;cursor:pointer;color:var(--kgt-head-muted);text-transform:capitalize;font-family:inherit;}' +
    '#' + ns + '-tabs button.active{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(0,0,0,.08);}' +
    '#' + ns + '-title{font-size:13.5px;font-weight:600;color:var(--kgt-head-text);min-width:0;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    // With a custom bot name the header holds the name, so the Support/Sales
    // tabs move to a slim row of their own beneath it.
    '#' + ns + '-subhead{display:flex;justify-content:center;padding:8px 14px 2px;flex-shrink:0;background:var(--kgt-bg);}' +
    '#' + ns + '-subhead #' + ns + '-tabs{background:#f1f5f9;}' +
    '#' + ns + '-subhead #' + ns + '-tabs button{color:#64748b;}' +
    '#' + ns + '-subhead #' + ns + '-tabs button.active{color:#0f172a;}' +
    '#' + ns + '-close{border:none;background:none;cursor:pointer;color:var(--kgt-head-muted);font-size:18px;line-height:1;padding:2px 6px;}' +
    '#' + ns + '-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;}' +
    '#' + ns + '-body .msg{max-width:85%;padding:8px 11px;border-radius:var(--kgt-radius);font-size:13.5px;line-height:1.4;white-space:pre-line;}' +
    '#' + ns + '-body .msg.user{align-self:flex-end;background:var(--kgt-primary);color:var(--kgt-on-primary);}' +
    '#' + ns + '-body .msg.bot{align-self:flex-start;background:var(--kgt-bot-bubble);color:var(--kgt-text);}' +
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
    '#' + ns + '-body .chip:hover{border-color:var(--kgt-primary);background:#f8fafc;}' +
    '#' + ns + '-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;flex-shrink:0;}' +
    '#' + ns + '-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;}' +
    '#' + ns + '-input:focus{border-color:var(--kgt-primary);}' +
    '#' + ns + '-send{border:none;background:var(--kgt-primary);color:var(--kgt-on-primary);font-size:13px;font-weight:600;padding:0 14px;' +
    'border-radius:8px;cursor:pointer;}' +
    '#' + ns + '-send:disabled{opacity:.4;cursor:not-allowed;}' +
    // Product cards under a bot reply.
    '#' + ns + '-body .cards{align-self:flex-start;display:flex;flex-direction:column;gap:8px;max-width:92%;width:100%;}' +
    '#' + ns + '-body .pcard{display:flex;gap:10px;align-items:center;border:1px solid #e2e8f0;border-radius:12px;' +
    'padding:8px;background:#fff;}' +
    '#' + ns + '-body .pcard-img{width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#f1f5f9;}' +
    '#' + ns + '-body .pcard-body{min-width:0;flex:1;}' +
    '#' + ns + '-body .pcard-name{font-size:12.5px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '#' + ns + '-body .pcard-price{font-size:12px;color:#334155;margin-top:1px;}' +
    '#' + ns + '-body .pcard-btn{display:inline-flex;align-items:center;border:1px solid var(--kgt-primary);background:var(--kgt-primary);' +
    'color:var(--kgt-on-primary);border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;' +
    'font-family:inherit;flex-shrink:0;text-decoration:none;}' +
    '#' + ns + '-body .pcard-btn:hover{opacity:.9;}' +
    // Image upload: an attach button in the form, a preview bar, and a thumbnail
    // on the visitor's own message bubble.
    '#' + ns + '-attach{border:1px solid #cbd5e1;background:#fff;color:#64748b;border-radius:8px;cursor:pointer;' +
    'font-size:16px;line-height:1;padding:0 10px;flex-shrink:0;}' +
    '#' + ns + '-attach:hover{border-color:#0f172a;color:#0f172a;}' +
    '#' + ns + '-preview{display:none;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid #e2e8f0;}' +
    '#' + ns + '-preview img{width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;}' +
    '#' + ns + '-preview .pv-name{flex:1;min-width:0;font-size:12px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '#' + ns + '-preview .pv-remove{border:none;background:none;color:#94a3b8;font-size:17px;line-height:1;cursor:pointer;padding:2px 4px;}' +
    '#' + ns + '-body .msg.user img{display:block;max-width:160px;max-height:160px;border-radius:8px;margin-top:6px;}' +
    // Voice input: mic button + its recording (pulsing) state.
    '#' + ns + '-mic{border:1px solid #cbd5e1;background:#fff;color:#64748b;border-radius:8px;cursor:pointer;' +
    'font-size:15px;line-height:1;padding:0 10px;flex-shrink:0;}' +
    '#' + ns + '-mic:hover{border-color:#0f172a;color:#0f172a;}' +
    '#' + ns + '-mic.rec{border-color:#dc2626;color:#dc2626;background:#fef2f2;animation:' + ns + '-pulse 1.1s ease-in-out infinite;}' +
    '@keyframes ' + ns + '-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.45);}50%{box-shadow:0 0 0 5px rgba(220,38,38,0);}}' +
    // Header right side: the small EN/हिं language toggle beside the close button.
    '#' + ns + '-head-right{display:flex;align-items:center;gap:6px;}' +
    '#' + ns + '-lang{display:flex;gap:2px;background:var(--kgt-head-chip);border-radius:999px;padding:2px;}' +
    '#' + ns + '-lang button{border:none;background:transparent;font-size:11px;font-weight:700;' +
    'padding:3px 8px;border-radius:999px;cursor:pointer;color:var(--kgt-head-muted);font-family:inherit;line-height:1.4;}' +
    '#' + ns + '-lang button.active{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(0,0,0,.08);}' +
    // Prominent language picker shown on the welcome/FAQ (empty) view.
    '#' + ns + '-body .langpick{margin:auto;display:flex;flex-direction:column;gap:10px;align-items:center;' +
    'text-align:center;padding:0 10px;}' +
    '#' + ns + '-body .langpick .lp-title{color:#64748b;font-size:12.5px;font-weight:600;}' +
    '#' + ns + '-body .langpick .lp-row{display:flex;gap:8px;}' +
    '#' + ns + '-body .langpick button{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;' +
    'padding:8px 18px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;}' +
    '#' + ns + '-body .langpick button:hover{border-color:#0f172a;}' +
    '#' + ns + '-body .langpick button.active{background:var(--kgt-primary);color:var(--kgt-on-primary);border-color:var(--kgt-primary);}' +
    '#' + ns + '-body .langpick .lp-hint{color:#94a3b8;font-size:12px;line-height:1.4;}';
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
    '<div id="' + ns + '-head-left">' +
    '<div id="' + ns + '-brand"></div>' +
    (lockedBot
      ? '<div id="' + ns + '-title"></div>'
      : '<div id="' + ns + '-tabs">' +
        '<button type="button" data-bot="support"></button>' +
        '<button type="button" data-bot="sales"></button>' +
        '</div>') +
    '</div>' +
    '<div id="' + ns + '-head-right">' +
    '<div id="' + ns + '-lang" role="group" aria-label="Language">' +
    '<button type="button" data-lang="en">EN</button>' +
    '<button type="button" data-lang="hi">हिं</button>' +
    '</div>' +
    '<button type="button" id="' + ns + '-close">×</button>' +
    '</div>' +
    '</div>' +
    '<div id="' + ns + '-body"></div>' +
    '<div id="' + ns + '-preview"></div>' +
    '<form id="' + ns + '-form">' +
    '<button type="button" id="' + ns + '-attach">📎</button>' +
    '<button type="button" id="' + ns + '-mic" style="display:none">🎤</button>' +
    '<input id="' + ns + '-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />' +
    '<input id="' + ns + '-input" type="text" autocomplete="off" />' +
    '<button id="' + ns + '-send" type="submit"></button>' +
    '</form>';

  var byBotMessages = { support: [], sales: [] };
  // A single image staged for the next message (a base64 data URL), shared
  // across both bot tabs. Sent alongside the text and cleared once sent.
  var pendingImage = null;

  function renderTabs() {
    var buttons = panel.querySelectorAll('#' + ns + '-tabs button');
    for (var i = 0; i < buttons.length; i++) {
      var bot = buttons[i].getAttribute('data-bot');
      buttons[i].className = bot === botType ? 'active' : '';
      buttons[i].textContent = t(bot === 'sales' ? 'tabSales' : 'tabSupport');
    }
  }

  // Fills every fixed UI label from the current language and marks the active
  // language pill. Called on mount and whenever the language changes.
  function applyStaticStrings() {
    var title = panel.querySelector('#' + ns + '-title');
    if (title) title.textContent = customBotName || t(lockedBot === 'sales' ? 'titleSales' : 'titleSupport');
    var input = panel.querySelector('#' + ns + '-input');
    if (input) input.setAttribute('placeholder', t('placeholder'));
    var send = panel.querySelector('#' + ns + '-send');
    if (send) send.textContent = t('send');
    var close = panel.querySelector('#' + ns + '-close');
    if (close) close.setAttribute('aria-label', t('close'));
    var langButtons = panel.querySelectorAll('#' + ns + '-lang button');
    for (var i = 0; i < langButtons.length; i++) {
      langButtons[i].className = langButtons[i].getAttribute('data-lang') === lang ? 'active' : '';
    }
  }

  function renderMessages() {
    var body = panel.querySelector('#' + ns + '-body');
    var msgs = byBotMessages[botType];
    body.innerHTML = '';
    // Welcome / FAQ view: a prominent language picker above the greeting, so
    // the first thing a visitor can do is choose English or हिंदी.
    if (!msgs.length) {
      body.appendChild(buildLangPicker());
      return;
    }
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var el = document.createElement('div');
      el.className = 'msg ' + (m.role === 'user' ? 'user' : m.error ? 'err' : 'bot');
      if (m.role === 'assistant' && !m.error) {
        renderRichText(el, m.text);
      } else if (m.role === 'user') {
        if (m.text) el.textContent = m.text;
        // The visitor's attached image, shown as a thumbnail on their bubble.
        if (m.image) { var uim = document.createElement('img'); uim.src = m.image; uim.alt = ''; el.appendChild(uim); }
      } else {
        el.textContent = m.text;
      }
      body.appendChild(el);
      // Rich product cards the API matched to this reply.
      if (m.role === 'assistant' && !m.error && m.products && m.products.length) {
        body.appendChild(buildProductCards(m.products));
      }
    }
    // Suggested follow-ups under the latest reply only; clicking one asks it.
    var last = msgs[msgs.length - 1];
    if (!sending && last.role === 'assistant' && !last.error && last.followUps && last.followUps.length) {
      var chips = document.createElement('div');
      chips.className = 'chips';
      chips.setAttribute('aria-label', t('suggested'));
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

  // Rich product cards for the items the API matched to a reply. Built with
  // createElement/textContent only (never innerHTML), so catalog data can't
  // inject markup into the host page; the image is a plain src attribute and
  // hides itself if it fails to load.
  function buildProductCards(products) {
    var wrap = document.createElement('div');
    wrap.className = 'cards';
    wrap.setAttribute('aria-label', t('products'));
    for (var i = 0; i < products.length; i++) {
      var p = products[i] || {};
      var card = document.createElement('div');
      card.className = 'pcard';
      if (p.imageUrl) {
        var img = document.createElement('img');
        img.className = 'pcard-img';
        img.src = p.imageUrl;
        img.alt = p.name || '';
        img.addEventListener('error', function (e) { e.currentTarget.style.display = 'none'; });
        card.appendChild(img);
      }
      var info = document.createElement('div');
      info.className = 'pcard-body';
      var name = document.createElement('div');
      name.className = 'pcard-name';
      name.textContent = p.name || '';
      info.appendChild(name);
      if (p.price) {
        var price = document.createElement('div');
        price.className = 'pcard-price';
        price.textContent = p.price;
        info.appendChild(price);
      }
      card.appendChild(info);
      // A direct purchase/product link when we have a safe http(s) URL;
      // otherwise an "Inquire" button that asks the bot about the item.
      var url = p.productUrl && /^https?:\/\//i.test(p.productUrl) ? p.productUrl : '';
      if (url) {
        var link = document.createElement('a');
        link.className = 'pcard-btn';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('view');
        card.appendChild(link);
      } else {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pcard-btn';
        btn.textContent = t('inquire');
        (function (productName) {
          btn.addEventListener('click', function () { sendQuery(t('inquirePrefix') + productName); });
        })(p.name || '');
        card.appendChild(btn);
      }
      wrap.appendChild(card);
    }
    return wrap;
  }

  // The welcome/FAQ view's language picker: a label, the two language buttons
  // (active one highlighted), and the current bot's localized greeting below.
  function buildLangPicker() {
    var wrap = document.createElement('div');
    wrap.className = 'langpick';

    var title = document.createElement('div');
    title.className = 'lp-title';
    title.textContent = t('langPrompt');
    wrap.appendChild(title);

    var row = document.createElement('div');
    row.className = 'lp-row';
    [['en', 'English'], ['hi', 'हिंदी']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = pair[1];
      if (lang === pair[0]) b.className = 'active';
      b.addEventListener('click', function () { setLang(pair[0]); });
      row.appendChild(b);
    });
    wrap.appendChild(row);

    var hint = document.createElement('div');
    hint.className = 'lp-hint';
    hint.textContent = t(botType === 'sales' ? 'emptySales' : 'emptySupport');
    wrap.appendChild(hint);
    return wrap;
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
  for (var ti = 0; ti < tabButtons.length; ti++) {
    tabButtons[ti].addEventListener('click', function (e) {
      botType = e.currentTarget.getAttribute('data-bot');
      renderTabs();
      renderMessages();
    });
  }

  var langButtons = panel.querySelectorAll('#' + ns + '-lang button');
  for (var li = 0; li < langButtons.length; li++) {
    langButtons[li].addEventListener('click', function (e) {
      setLang(e.currentTarget.getAttribute('data-lang'));
    });
  }

  // Renders the staged-image preview bar (thumbnail + remove), or an inline
  // error, or nothing. Built with DOM nodes only (no innerHTML) so an image's
  // data URL can't inject markup.
  function renderPreview(errText) {
    var pv = panel.querySelector('#' + ns + '-preview');
    pv.textContent = '';
    if (errText) {
      pv.style.display = 'flex';
      var err = document.createElement('span');
      err.className = 'pv-name'; err.style.color = '#b91c1c'; err.textContent = errText;
      pv.appendChild(err);
      // Clear the error shortly, unless an image got staged meanwhile.
      setTimeout(function () { if (!pendingImage) renderPreview(); }, 4000);
      return;
    }
    if (!pendingImage) { pv.style.display = 'none'; return; }
    pv.style.display = 'flex';
    var img = document.createElement('img'); img.src = pendingImage; img.alt = ''; pv.appendChild(img);
    var name = document.createElement('span'); name.className = 'pv-name'; name.textContent = t('imageReady'); pv.appendChild(name);
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'pv-remove'; rm.textContent = '×';
    rm.setAttribute('aria-label', t('removeImage'));
    rm.addEventListener('click', function () { pendingImage = null; renderPreview(); });
    pv.appendChild(rm);
  }

  var attachBtn = panel.querySelector('#' + ns + '-attach');
  var fileInput = panel.querySelector('#' + ns + '-file');
  attachBtn.setAttribute('aria-label', t('attach'));
  attachBtn.setAttribute('title', t('attach'));
  attachBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(file.type) === -1) { renderPreview(t('imageType')); return; }
    if (file.size > 5 * 1024 * 1024) { renderPreview(t('imageTooBig')); return; }
    var reader = new FileReader();
    reader.onload = function () { pendingImage = String(reader.result || ''); renderPreview(); };
    reader.onerror = function () { renderPreview(t('imageType')); };
    reader.readAsDataURL(file);
  });

  // ── Voice input: MediaRecorder → POST /transcribe (Groq Whisper) → fill the
  // input with the transcript (editable) and switch the UI to the spoken
  // language so the bot replies in it. Hidden where the browser can't record.
  var micBtn = panel.querySelector('#' + ns + '-mic');
  var recording = false; var recorder = null; var recChunks = []; var recStream = null;
  var voiceSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  if (voiceSupported) {
    micBtn.style.display = '';
    micBtn.setAttribute('aria-label', t('mic'));
    micBtn.setAttribute('title', t('mic'));
    micBtn.addEventListener('click', function () { if (recording) stopRecording(); else startRecording(); });
  }

  function setComposerBusy(busy, placeholderKey) {
    var input = panel.querySelector('#' + ns + '-input');
    input.disabled = busy;
    input.setAttribute('placeholder', t(placeholderKey || 'placeholder'));
    panel.querySelector('#' + ns + '-send').disabled = busy;
    panel.querySelector('#' + ns + '-attach').disabled = busy;
  }
  function cleanupStream() {
    if (recStream) { recStream.getTracks().forEach(function (tr) { tr.stop(); }); recStream = null; }
    recorder = null;
  }
  function startRecording() {
    if (recording || sending) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream; recChunks = [];
      try { recorder = new MediaRecorder(stream); } catch (e) { cleanupStream(); renderPreview(t('voiceError')); return; }
      recorder.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) recChunks.push(e.data); });
      recorder.addEventListener('stop', onRecordingStop);
      recorder.start();
      recording = true;
      micBtn.className = 'rec'; micBtn.textContent = '⏹'; // stop square while recording
      setComposerBusy(true, 'listening');
    }).catch(function () { renderPreview(t('micDenied')); });
  }
  function stopRecording() {
    if (!recording || !recorder) return;
    recording = false;
    micBtn.className = ''; micBtn.textContent = '🎤';
    try { recorder.stop(); } catch (e) { cleanupStream(); setComposerBusy(false); }
  }
  function onRecordingStop() {
    var type = (recorder && recorder.mimeType) || 'audio/webm';
    cleanupStream();
    var blob = new Blob(recChunks, { type: type }); recChunks = [];
    if (!blob.size) { setComposerBusy(false); return; }
    setComposerBusy(true, 'transcribing');
    var ext = type.indexOf('ogg') >= 0 ? 'ogg' : type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var form = new FormData();
    form.append('audio', blob, 'voice.' + ext);
    fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/transcribe', {
      method: 'POST', headers: { 'x-tenant-api-key': apiKey }, body: form
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error((result.data && result.data.error) || t('voiceError'));
        var text = (result.data && result.data.text) || '';
        // Reply in the language actually spoken (detected server-side from the transcript).
        if (result.data && (result.data.language === 'en' || result.data.language === 'hi')) setLang(result.data.language);
        setComposerBusy(false);
        var input = panel.querySelector('#' + ns + '-input');
        input.value = input.value ? (input.value + ' ' + text) : text;
        input.focus();
      })
      .catch(function (err) { setComposerBusy(false); renderPreview(err.message || t('voiceError')); });
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
    // An image on its own is a valid message (the guardrail + bot handle it);
    // either text or an image is required.
    var image = pendingImage;
    if ((!query && !image) || sending) return false;
    sending = true;
    panel.querySelector('#' + ns + '-send').disabled = true;
    // The bot this message went to. The visitor may switch tabs before the
    // reply arrives; the reply and its sessionId still belong to this bot.
    var sentBot = botType;
    byBotMessages[sentBot].push({ role: 'user', text: query, image: image });
    pendingImage = null; renderPreview();
    renderMessages();

    // language: the selected UI language — authoritative, so the bot replies in
    // it whatever language the question is typed in. The image (if any) is a
    // base64 data URL; the backend runs its guardrail before the chat LLM.
    var payload = { botType: sentBot, sessionId: sessionIds[sentBot], language: lang };
    if (query) payload.query = query;
    if (image) payload.image = image;
    fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : t('errorGeneric'));
        sessionIds[sentBot] = result.data.sessionId;
        byBotMessages[sentBot].push({ role: 'assistant', text: result.data.answer, followUps: result.data.followUps || [], products: result.data.products || [] });
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

  // Leaving the page ends this widget's conversations (sessionIds live only
  // in memory), so tell the API: it summarizes them now instead of after the
  // idle delay. keepalive lets the request outlive the page; sendBeacon can't
  // carry the API key header. Best-effort: the idle sweep covers a miss, and
  // a page restored from the back/forward cache simply carries on chatting.
  window.addEventListener('pagehide', function () {
    for (var bot in sessionIds) {
      if (!sessionIds[bot]) continue;
      try {
        fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/session/end', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
          body: JSON.stringify({ sessionId: sessionIds[bot] })
        }).catch(function () {});
      } catch (e) { /* keepalive unsupported: the idle sweep summarizes it */ }
    }
  });

  // ── Brand theme (Theme Studio). The design the company applied in its
  // dashboard plus its logo, fetched once at start-up. The widget is already
  // usable in its classic look, so a slow or failed fetch changes nothing.
  // Every value is re-checked here before it reaches CSS — colours must be
  // #rrggbb, the radius a small number, the header style a known keyword, the
  // font stack plain characters — and the logo is set through the img's src
  // property, never as HTML.
  var themeStyle = document.createElement('style');
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var FONT_RE = /^[\w\s,"'-]{1,200}$/;
  function hexOr(value, fallback) { return typeof value === 'string' && HEX_RE.test(value) ? value : fallback; }
  function rgba(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  function isDark(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 150;
  }

  // badge: the design's logoBadge { mode, background, blend, ring, tint },
  // re-checked here; colours go in through the style property, never as CSS text.
  function renderBrand(logoUrl, companyName, badge, ringColor) {
    var brand = panel.querySelector('#' + ns + '-brand');
    if (!brand) return;
    brand.innerHTML = '';
    function showInitial() {
      brand.innerHTML = '';
      var initial = document.createElement('div');
      initial.className = 'initial';
      initial.textContent = String(companyName || tenantSlug || '?').trim().charAt(0).toUpperCase() || '?';
      brand.appendChild(initial);
    }
    // An uploaded logo comes as a path on this API (/api/v1/public/brand-assets/…),
    // resolved against apiBase; anything else must be an absolute http(s) URL.
    if (typeof logoUrl === 'string' && /^\/api\/v1\/public\/brand-assets\/[A-Za-z0-9._~%\/-]+$/.test(logoUrl)) {
      logoUrl = apiBase + logoUrl;
    }
    if (typeof logoUrl === 'string' && /^https?:\/\//i.test(logoUrl)) {
      var b = badge && typeof badge === 'object' ? badge : {};
      var mode = b.mode === 'plain' || b.mode === 'tile' ? b.mode : 'pill';
      var holder = document.createElement('span');
      var tint = mode === 'plain' && (b.tint === 'light' || b.tint === 'dark') ? b.tint : null;
      holder.className = 'badge ' + mode + (b.blend === true && !tint ? ' blend' : '') + (tint ? ' tint-' + tint : '');
      if (mode !== 'plain') holder.style.backgroundColor = hexOr(b.background, '#ffffff');
      // A chip gets a soft lift so it reads as a deliberate plate; the ring adds
      // a hairline where the plate is close to the header colour.
      var shadows = [];
      if (b.ring === true && ringColor && mode !== 'plain') shadows.push('0 0 0 1px ' + ringColor);
      if (mode === 'pill') shadows.push('0 1px 2px rgba(15,23,42,.12)');
      if (shadows.length) holder.style.boxShadow = shadows.join(',');
      var img = document.createElement('img');
      img.alt = companyName ? String(companyName) : '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = showInitial; // a broken or blocked logo falls back to the initial
      img.src = logoUrl;
      holder.appendChild(img);
      brand.appendChild(holder);
    } else {
      showInitial();
    }
    brand.className = 'show';
  }

  // The custom display name replaces the default title. With both bots shown,
  // the header has no title — so one is added, and the Support/Sales tabs move
  // to a row of their own beneath the header (their click handlers move too).
  function applyBotName(name) {
    // Control characters, markup and invisible formatting (zero-width, bidi
    // overrides/isolates, BOM — a right-to-left override would make the header
    // read as something it isn't). Same set as branding.js cleanBotName.
    var clean = typeof name === 'string'
      ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, 40)
      : '';
    if (!clean) return;
    customBotName = clean;
    if (!lockedBot) {
      var left = panel.querySelector('#' + ns + '-head-left');
      if (left && !panel.querySelector('#' + ns + '-title')) {
        var title = document.createElement('div');
        title.id = ns + '-title';
        left.appendChild(title);
      }
      var tabs = panel.querySelector('#' + ns + '-tabs');
      if (tabs && !panel.querySelector('#' + ns + '-subhead')) {
        var sub = document.createElement('div');
        sub.id = ns + '-subhead';
        sub.appendChild(tabs);
        panel.insertBefore(sub, panel.querySelector('#' + ns + '-body'));
      }
    }
    applyStaticStrings(); // writes the name (textContent — never HTML)
  }

  function applyTheme(data) {
    applyBotName(data && data.botName); // the name applies with or without a design
    var th = data && data.theme;
    if (!th || typeof th !== 'object') return; // no design applied: keep the classic look
    var primary = hexOr(th.primaryColor, '#0f172a');
    var accent = hexOr(th.accentColor, primary);
    var bg = hexOr(th.backgroundColor, '#ffffff');
    var text = hexOr(th.textColor, '#0f172a');
    var onPrimary = hexOr(th.onPrimaryColor, isDark(primary) ? '#ffffff' : '#0f172a');
    var radius = Math.max(0, Math.min(28, parseInt(th.borderRadius, 10) || 0));
    var font = typeof th.fontFamily === 'string' && FONT_RE.test(th.fontFamily) ? th.fontFamily : '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';

    var head = { bg: bg, text: text, muted: '#64748b', border: '#e2e8f0', chip: '#f1f5f9' };
    if (th.headerStyle === 'solid' || th.headerStyle === 'gradient') {
      head = {
        bg: th.headerStyle === 'gradient' ? 'linear-gradient(135deg,' + primary + ',' + accent + ')' : primary,
        text: onPrimary, muted: rgba(onPrimary, 0.75), border: 'transparent', chip: rgba(onPrimary, 0.18)
      };
    } else if (th.headerStyle === 'glass') {
      head = { bg: rgba(primary, 0.1), text: text, muted: rgba(text, 0.6), border: rgba(primary, 0.18), chip: rgba(primary, 0.12) };
    }
    // Inactive tabs, language chips and the close button: the server's
    // contrast-checked colour (4.5:1 on every header surface —
    // themeGenerator.js mutedHeaderColor); the faded ink only for an old payload.
    head.muted = hexOr(th.headerMutedColor, head.muted);

    themeStyle.textContent = '#' + ns + '-launcher,#' + ns + '-panel{' +
      '--kgt-primary:' + primary + ';--kgt-on-primary:' + onPrimary + ';' +
      '--kgt-secondary:' + hexOr(th.secondaryColor, '#cbd5e1') + ';' +
      '--kgt-bg:' + bg + ';--kgt-text:' + text + ';' +
      '--kgt-bot-bubble:' + hexOr(th.botBubbleColor, '#f1f5f9') + ';' +
      '--kgt-radius:' + radius + 'px;--kgt-font:' + font + ';' +
      '--kgt-head-bg:' + head.bg + ';--kgt-head-text:' + head.text + ';--kgt-head-muted:' + head.muted + ';' +
      '--kgt-head-border:' + head.border + ';--kgt-head-chip:' + head.chip + ';}';
    renderBrand(data.logoUrl, data.companyName, th.logoBadge, rgba(hexOr(head.text, '#0f172a'), 0.22));
  }

  function loadTheme() {
    if (typeof fetch !== 'function') return;
    fetch(apiBase + '/api/v1/tenant-chat/' + encodeURIComponent(tenantSlug) + '/theme', {
      headers: { 'x-tenant-api-key': apiKey }
    })
      .then(function (res) {
        if (res.status === 403) {
          // The key is restricted to other websites (dashboard → API keys → Websites).
          console.warn('[kgt-chat-widget] This API key is not enabled for ' + window.location.origin +
            '. Add this website to the key\'s allowed websites in your KGT dashboard.');
        }
        return res.ok ? res.json() : null;
      })
      .then(function (data) { if (data) applyTheme(data); })
      .catch(function () { /* keep the classic look */ });
  }

  function mount() {
    document.head.appendChild(themeStyle); // after the base <style>, so its tokens win
    document.body.appendChild(panel);
    document.body.appendChild(launcher);
    applyStaticStrings();
    renderTabs();
    loadTheme();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();

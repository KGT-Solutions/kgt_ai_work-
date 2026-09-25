/**
 * FLATBRIZ Sales Chat Widget — drop-in loader.
 *
 * Embed on any external site with:
 *   <script src="https://YOUR-API-HOST/widgets/sales-chat-widget.js" defer></script>
 *
 * Optionally pin the API host explicitly (useful if this script is ever
 * mirrored/proxied from a different domain than the API):
 *   <script src="..." data-api-base="https://api.flatbriz.com" defer></script>
 *
 * The chat UI itself lives in an iframe served by the API (sales-chat.html),
 * so it's fully style-isolated from the host page and its fetch() calls to
 * /api/v1/chat/sales are same-origin — no CORS configuration needed on the
 * host site.
 */
(function () {
  if (window.__flatbrizSalesChatLoaded) return;
  window.__flatbrizSalesChatLoaded = true;

  var currentScript = document.currentScript;
  var apiBase =
    (currentScript && currentScript.getAttribute('data-api-base')) ||
    (currentScript && new URL(currentScript.src, window.location.href).origin) ||
    window.location.origin;
  apiBase = apiBase.replace(/\/$/, '');

  var LAUNCHER_ID = 'flatbriz-sales-chat-launcher';
  var PANEL_ID = 'flatbriz-sales-chat-panel';

  var style = document.createElement('style');
  style.textContent =
    '#' + LAUNCHER_ID + '{position:fixed;bottom:20px;right:20px;width:56px;height:56px;' +
    'border-radius:50%;background:linear-gradient(180deg,#34d39a,#059669);border:none;' +
    'box-shadow:0 8px 24px rgba(5,150,105,0.35);cursor:pointer;z-index:2147483000;' +
    'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;}' +
    '#' + LAUNCHER_ID + ':hover{transform:scale(1.06);}' +
    '#' + LAUNCHER_ID + ' svg{width:26px;height:26px;fill:#fff;}' +
    '#' + PANEL_ID + '{position:fixed;bottom:88px;right:20px;width:380px;max-width:calc(100vw - 24px);' +
    'height:600px;max-height:calc(100vh - 120px);border:none;border-radius:20px;' +
    'box-shadow:0 20px 48px rgba(6,35,26,0.28);z-index:2147483000;display:none;' +
    'background:#fff;overflow:hidden;}' +
    '@media (max-width:480px){#' + PANEL_ID + '{right:12px;bottom:84px;width:calc(100vw - 24px);' +
    'height:calc(100vh - 110px);}}';
  document.head.appendChild(style);

  var launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.setAttribute('aria-label', 'Chat with FLATBRIZ Sales');
  launcher.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M12 2C6.48 2 2 6.02 2 11c0 2.61 1.28 4.94 3.29 6.6L4 22l4.78-1.46C9.79 20.83 10.88 21 12 21c5.52 0 10-4.02 10-9s-4.48-10-10-10z"/>' +
    '</svg>';

  var iframe = document.createElement('iframe');
  iframe.id = PANEL_ID;
  iframe.title = 'FLATBRIZ Sales Assistant';
  iframe.src = apiBase + '/widgets/sales-chat.html';

  var open = false;
  function setOpen(next) {
    open = next;
    iframe.style.display = open ? 'block' : 'none';
  }

  launcher.addEventListener('click', function () {
    setOpen(!open);
  });

  window.addEventListener('message', function (event) {
    if (event && event.data && event.data.type === 'flatbriz-sales-chat:close') {
      setOpen(false);
    }
  });

  function mount() {
    document.body.appendChild(iframe);
    document.body.appendChild(launcher);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();

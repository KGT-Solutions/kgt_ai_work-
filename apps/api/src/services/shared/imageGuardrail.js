// Image Guardrail & Similarity Pre-Check — a cheap pre-flight that runs BEFORE
// the heavy, KB-grounded chat generation whenever a visitor attaches an image.
//
// Tier 1 (relevance): one small, low-detail vision call classifies the image as
// relevant to the business (a product, its packaging/label, a receipt/order, or
// a damaged item) or irrelevant noise (memes, unrelated screenshots, personal
// photos). An irrelevant image is short-circuited with a polite fallback and
// NEVER reaches the main chat LLM — that is the token saving.
//
// Tier 2 (similarity) is handled by the caller, not here: the platform has no
// image-embedding/vector service, so instead of inventing one, this call also
// reads any product name / label / receipt text out of the image and returns it
// as plain text. The caller (services/tenantChat.js) feeds that text into the
// EXISTING catalog matcher (services/shared/productMatch.js) to attach the
// matching product card. So "visual similarity" is done as text the vision pass
// extracts, reusing all the matching the platform already has.
//
// Self-contained on purpose: it owns its single vision call (OpenAI-compatible,
// using the already-configured OPENAI_API_KEY) rather than going through the
// text-only engine/llmClient.js. The call is injectable (`classify`) so unit
// tests never hit the network. It NEVER throws: on any failure or when no vision
// key is configured it returns a degraded "treat as relevant" result, so a
// guardrail outage can slow a turn but never lock a visitor out.

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;          // ~5MB decoded; bounds request size and vision cost
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/]+=*)$/i;
const VISION_TIMEOUT_MS = 12000;

const envFlag = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const readKey = (name) => String(process.env[name] || '').trim(); // trim: CRLF-saved env files leave a trailing \r

// The polite short-circuit reply, per language (kept generic — this platform is
// multi-tenant, not only supplements/fitness).
const FALLBACK_MESSAGE = {
  en: "I can only help with photos related to our products or a support request — like a product, its label or packaging, or a receipt. Please upload a relevant image and I'll take a look!",
  hi: 'मैं केवल हमारे उत्पादों या सहायता से जुड़ी तस्वीरों में ही मदद कर सकता हूँ — जैसे कोई उत्पाद, उसका लेबल या पैकेजिंग, या रसीद। कृपया कोई प्रासंगिक तस्वीर भेजें, मैं देख लेता हूँ!'
};

function guardrailFallbackMessage(language) {
  return language === 'hi' ? FALLBACK_MESSAGE.hi : FALLBACK_MESSAGE.en;
}

/** Whether a vision provider is configured (currently an OpenAI-compatible key). */
function isGuardrailConfigured() {
  return !!readKey('OPENAI_API_KEY');
}

/**
 * Whether the guardrail should run. On by default when a vision key exists;
 * a hard kill switch (IMAGE_GUARDRAIL=false) disables it even when configured.
 * With no key it cannot classify, so it is off (images simply pass through).
 */
function isImageGuardrailEnabled() {
  const v = String(process.env.IMAGE_GUARDRAIL ?? '').trim();
  if (v !== '' && !envFlag(v)) return false; // explicit off
  return isGuardrailConfigured();
}

/**
 * Validate a `data:image/...;base64,...` URL and report its decoded size.
 * @returns {{ ok: true, mimeType: string, bytes: number } | { ok: false, error: string }}
 */
function parseImageDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = s.match(DATA_URL_RE);
  if (!m) return { ok: false, error: 'image must be a base64 data URL of type png, jpeg, webp or gif' };
  const mimeType = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!ALLOWED_MIME.has(mimeType)) return { ok: false, error: `unsupported image type ${mimeType}` };
  const bytes = Math.ceil((m[2].length * 3) / 4); // base64 → byte estimate
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: `image must be ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB or smaller` };
  return { ok: true, mimeType, bytes };
}

function systemPrompt(tenant) {
  const who = tenant?.name
    ? `The business is ${tenant.name}${tenant.industryLabel ? ` (${tenant.industryLabel})` : ''}. `
    : '';
  return `${who}You are a strict pre-flight filter for a business's customer support and sales chat. Decide whether an ` +
    'uploaded image is RELEVANT to this business — one of its products, product packaging or a label, a receipt or ' +
    'order confirmation, or a damaged/defective item a customer needs help with — or IRRELEVANT noise: memes, ' +
    'screenshots of unrelated content, or personal photos that are not about the business\'s products or a support issue.\n' +
    'Respond with ONLY a compact JSON object and nothing else: ' +
    '{"relevant": true|false, "kind": "product"|"label"|"receipt"|"damage"|"other"|"irrelevant", "product_name": "", "text": ""}. ' +
    'product_name: the product, brand or item name you can read or clearly recognise, else "". ' +
    'text: one factual sentence describing what is visible (product/brand names, label wording, receipt details), else "". ' +
    'Never invent anything you cannot actually see in the image.';
}

// Pull the JSON object out of the model's reply, tolerating ```json fences and
// stray prose. Returns a normalized shape or null if unparseable.
function parseClassification(raw) {
  const text = String(raw || '').replace(/```json\s*([\s\S]*?)```/gi, '$1').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const relevant = obj.relevant === true || /^(true|yes)$/i.test(String(obj.relevant));
  return {
    relevant,
    kind: String(obj.kind || (relevant ? 'other' : 'irrelevant')).toLowerCase(),
    productText: String(obj.product_name || '').trim(),
    text: String(obj.text || '').trim()
  };
}

// The one real vision call (OpenAI-compatible chat completions with an
// image_url part, detail:'low' to keep it cheap). Throws on any transport/API
// problem; evaluateImage turns that into a degraded pass.
async function defaultClassify({ dataUrl, sys, user }) {
  const apiKey = readKey('OPENAI_API_KEY');
  if (!apiKey) throw new Error('no vision key');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const model = readKey('IMAGE_GUARDRAIL_MODEL') || readKey('OPENAI_VISION_MODEL') || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 200,
        temperature: 0,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }
          ] }
        ]
      })
    });
    if (!res.ok) throw new Error(`vision provider error ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tier 1 relevance + text extraction for one uploaded image. Never throws.
 * @param {{ dataUrl: string, userText?: string, tenant?: object, classify?: Function }} args
 *   classify is injectable (tests); defaults to the real vision call.
 * @returns {Promise<{ relevant: boolean, kind: string, productText: string, text: string, degraded: boolean }>}
 *   degraded: true means the vision pass failed or was unavailable, so the image
 *   was passed through as relevant rather than blocking the visitor.
 */
async function evaluateImage({ dataUrl, userText = '', tenant = null, classify = defaultClassify }) {
  const user = `Classify this uploaded image.${userText ? ` The visitor also wrote: "${String(userText).slice(0, 300)}"` : ''}`;
  try {
    const raw = await classify({ dataUrl, sys: systemPrompt(tenant), user });
    const parsed = parseClassification(raw);
    if (!parsed) return { relevant: true, kind: 'other', productText: '', text: '', degraded: true };
    return { ...parsed, degraded: false };
  } catch (err) {
    console.warn(`[imageGuardrail] vision classify failed, passing image through: ${err.message}`);
    return { relevant: true, kind: 'other', productText: '', text: '', degraded: true };
  }
}

module.exports = {
  evaluateImage,
  parseImageDataUrl,
  parseClassification,
  guardrailFallbackMessage,
  isImageGuardrailEnabled,
  isGuardrailConfigured,
  MAX_IMAGE_BYTES
};

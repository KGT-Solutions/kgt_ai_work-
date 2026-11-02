// 3-Tier Image Processing & Guardrail Pipeline.
//
// Runs a chat image upload through cheap-first stages so the expensive vision
// call is the last resort, and malicious payloads are stopped before any
// model sees them:
//
//   Tier 1  — LOCAL integrity + blur/black (sharp; free, no network).
//   Security— scan embedded metadata, and later the vision-read text, for
//             prompt-injection / exploit strings; a hit is a hard refusal.
//   Tier 2  — catalog match: performed by the caller (tenantChat) on the text
//             this pipeline extracts, reusing the existing text productMatch —
//             the platform has no local OCR/vision-feature store, so the label
//             text comes from Tier 3 (see the chosen design) rather than a
//             local OCR pass.
//   Tier 3  — Groq vision fallback (GROQ_API_KEY) for relevance + label/issue
//             text, only when the local tiers are inconclusive.
//
// Nothing here throws to the caller: every tier degrades (Tier 1 skips, Tier 3
// returns "couldn't classify") so a tool/outage slows a turn but never blocks
// a visitor — except a security hit, which is a deliberate hard stop.

const { parseImageDataUrl, parseClassification, guardrailFallbackMessage } = require('./imageGuardrail');

let sharpLib = null;
try { sharpLib = require('sharp'); } catch { sharpLib = null; } // optional; Tier 1 degrades if absent

const envFlag = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const envNum = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) ? n : def; };
const readKey = (name) => String(process.env[name] || '').trim();

const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif']);
const MIN_DIM = envNum('IMAGE_MIN_DIM', 16);
const MAX_DIM = envNum('IMAGE_MAX_DIM', 10000);
const BLANK_STDEV = envNum('IMAGE_BLANK_STDEV', 3);     // grayscale stdev below this ⇒ near-uniform (black/blank)
const BLUR_VARIANCE = envNum('IMAGE_BLUR_VARIANCE', 2); // Laplacian variance below this ⇒ no detail (blurry)
const ANALYZE_DIM = 400;                                // downscale before the CV work, to bound cost
const GROQ_VISION_MODEL = readKey('GROQ_VISION_MODEL') || 'meta-llama/llama-4-scout-17b-16e-instruct';
const VISION_TIMEOUT_MS = envNum('IMAGE_VISION_TIMEOUT_MS', 12000);

// Prompt-injection / exploit signatures scanned in embedded metadata and in the
// text the vision pass reads out of the image. Deliberately high-signal so a
// benign label ("ignore the noise") doesn't trip a refusal.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|messages?)/i,
  /disregard\s+(all\s+)?(the\s+)?(previous|prior|system|above)/i,
  /\b(system\s*prompt|developer\s*prompt)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\s+(an?\s+)?(dan|jailbreak|unfiltered)\b/i,
  /\boverride\s+(the\s+)?(system|instructions?|guardrails?)/i,
  /\b(reveal|print|show|repeat|leak)\s+(your\s+)?(the\s+)?(system\s+)?(prompt|instructions?)\b/i,
  /<\s*script\b/i,
  /javascript\s*:/i,
  /\beval\s*\(|\bexec\s*\(|\bos\.system\b|subprocess/i,
  /\{\{.*?\}\}|\$\{.*?\}/,            // template / expression injection
  /\bprompt\s*injection\b/i
];

// A deliberately generic refusal: never reveal what was detected.
const SECURITY_REFUSAL = {
  en: "Sorry, I can't process that image. Please try a different photo of the product, label or receipt.",
  hi: 'माफ़ कीजिए, मैं यह तस्वीर प्रोसेस नहीं कर सकता। कृपया उत्पाद, लेबल या रसीद की कोई और तस्वीर भेजें।'
};
function securityRefusalMessage(language) {
  return language === 'hi' ? SECURITY_REFUSAL.hi : SECURITY_REFUSAL.en;
}

/** Pipeline on unless IMAGE_GUARDRAIL is explicitly falsey. Tier 1 is local, so this needs no API key. */
function isImagePipelineEnabled() {
  const v = String(process.env.IMAGE_GUARDRAIL ?? '').trim();
  return v === '' ? true : envFlag(v);
}
function isCvEnabled() {
  const v = String(process.env.IMAGE_PIPELINE_CV ?? '').trim();
  return (v === '' ? true : envFlag(v)) && !!sharpLib;
}
function isGroqVisionConfigured() {
  return !!readKey('GROQ_API_KEY');
}

/** Scan text for an injection/exploit signature. @returns {{hit:boolean, pattern?:string}} */
function scanForInjection(text) {
  const s = String(text || '');
  if (!s.trim()) return { hit: false };
  for (const re of INJECTION_PATTERNS) {
    if (re.test(s)) return { hit: true, pattern: re.source };
  }
  return { hit: false };
}

// Population variance of a raw single-channel buffer — the Laplacian-variance
// sharpness proxy (and the blank/black test reuses the stdev of the plain gray).
function variance(buf) {
  const n = buf.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i];
  const mean = sum / n;
  let acc = 0;
  for (let i = 0; i < n; i++) { const d = buf[i] - mean; acc += d * d; }
  return acc / n;
}

// Tier 1: local format + dimension + blank/black + blur, plus the metadata text
// to security-scan. Returns a rejection reason, or ok with that metadata text.
async function tier1Local(buffer, sharp) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const format = (meta.format || '').toLowerCase().replace('jpg', 'jpeg');
  if (!ALLOWED_FORMATS.has(format)) return { reject: 'format', reason: 'unsupported image format' };
  if (!meta.width || !meta.height) return { reject: 'dimensions', reason: 'unreadable image dimensions' };
  if (meta.width < MIN_DIM || meta.height < MIN_DIM) return { reject: 'too_small', reason: 'image is too small' };
  if (meta.width > MAX_DIM || meta.height > MAX_DIM) return { reject: 'too_large', reason: 'image dimensions are too large' };

  // Downscaled grayscale raster for the two detail checks.
  const gray = await sharp(buffer, { failOn: 'none', animated: false })
    .removeAlpha().greyscale().resize(ANALYZE_DIM, ANALYZE_DIM, { fit: 'inside', withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  if (Math.sqrt(variance(gray.data)) < BLANK_STDEV) return { reject: 'blank', reason: 'image is blank or a solid color' };

  const lap = await sharp(gray.data, { raw: { width: gray.info.width, height: gray.info.height, channels: 1 } })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw().toBuffer();
  if (variance(lap) < BLUR_VARIANCE) return { reject: 'blurry', reason: 'image is too blurry' };

  // Embedded metadata that could smuggle an injection payload.
  const metaText = [meta.exif, meta.xmp, meta.iptc].filter(Boolean).map((b) => b.toString('latin1')).join(' ');
  return { reject: null, metaText };
}

const VISION_SYSTEM = (tenant) => {
  const who = tenant?.name ? `The business is ${tenant.name}${tenant.industryLabel ? ` (${tenant.industryLabel})` : ''}. ` : '';
  return `${who}You are a vision pre-check for a business's support and sales chat. Look at the image and decide if it is ` +
    'RELEVANT (the business\'s product, its packaging/label, a receipt/order, or a damaged/defective item needing support) ' +
    'or IRRELEVANT (meme, unrelated screenshot, random personal photo). Respond with ONLY compact JSON: ' +
    '{"relevant":true|false,"kind":"product"|"label"|"receipt"|"damage"|"other"|"irrelevant","product_name":"","text":""}. ' +
    'product_name: a product/brand name you can read, else "". text: one factual sentence — any visible brand/label/receipt ' +
    'wording, or for a support photo a short description of the issue (e.g. "broken seal on the lid"). Never invent anything.';
};

// Tier 3: Groq's OpenAI-compatible vision endpoint. Throws on transport/API
// failure; the orchestrator turns that into a degraded pass.
async function groqVisionClassify({ dataUrl, sys, user }) {
  const key = readKey('GROQ_API_KEY');
  if (!key) throw new Error('no groq key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        max_tokens: 300,
        temperature: 0,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: dataUrl } }] }
        ]
      })
    });
    if (!res.ok) throw new Error(`groq vision error ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the full pipeline. NEVER throws.
 * @param {{ dataUrl: string, userText?: string, tenant?: object,
 *           deps?: { sharp?: any, visionClassify?: Function } }} args
 * @returns {Promise<{ outcome:'passed'|'rejected'|'degraded', reason?:string,
 *   security?:boolean, text:string, productText:string }>}
 */
async function runImageGuardrailPipeline({ dataUrl, userText = '', tenant = null, deps = {} }) {
  const sharp = deps.sharp || sharpLib;
  const visionClassify = deps.visionClassify || groqVisionClassify;

  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed.ok) return { outcome: 'rejected', reason: parsed.error, security: false, text: '', productText: '' };
  const buffer = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');

  // ── Tier 1 (local CV) + metadata security ──
  const useCv = (deps.sharp ? true : isCvEnabled()) && sharp;
  if (useCv) {
    try {
      const t1 = await tier1Local(buffer, sharp);
      if (t1.reject) return { outcome: 'rejected', reason: t1.reason, security: false, text: '', productText: '' };
      const metaScan = scanForInjection(t1.metaText);
      if (metaScan.hit) {
        console.warn(`[imageGuardrail][security] injection signature in image metadata (tenant=${tenant?.id || '-'}): ${metaScan.pattern}`);
        return { outcome: 'rejected', reason: 'security', security: true, text: '', productText: '' };
      }
    } catch (err) {
      console.warn(`[imageGuardrail] Tier 1 (sharp) degraded: ${err.message}`); // couldn't decode → let Tier 3 judge
    }
  }

  // ── Tier 3 (Groq vision) — only when configured ──
  if (!(deps.visionClassify || isGroqVisionConfigured())) {
    return { outcome: 'degraded', reason: 'no vision provider', text: '', productText: '' };
  }
  let cls;
  try {
    cls = parseClassification(await visionClassify({ dataUrl, sys: VISION_SYSTEM(tenant), user: visionUserPrompt(userText) }));
  } catch (err) {
    console.warn(`[imageGuardrail] Tier 3 (groq vision) degraded: ${err.message}`);
    return { outcome: 'degraded', reason: 'vision unavailable', text: '', productText: '' };
  }
  if (!cls) return { outcome: 'degraded', reason: 'unparseable vision reply', text: '', productText: '' };

  // Security-scan the text the model read out of the image (rendered prompt injection).
  const textScan = scanForInjection(`${cls.productText} ${cls.text}`);
  if (textScan.hit) {
    console.warn(`[imageGuardrail][security] injection signature in image text (tenant=${tenant?.id || '-'}): ${textScan.pattern}`);
    return { outcome: 'rejected', reason: 'security', security: true, text: '', productText: '' };
  }
  if (cls.relevant === false) return { outcome: 'rejected', reason: 'irrelevant', security: false, text: '', productText: '' };
  return { outcome: 'passed', text: cls.text, productText: cls.productText };
}

function visionUserPrompt(userText) {
  return `Analyze this uploaded image.${userText ? ` The visitor also wrote: "${String(userText).slice(0, 300)}"` : ''}`;
}

module.exports = {
  runImageGuardrailPipeline,
  isImagePipelineEnabled,
  isGroqVisionConfigured,
  scanForInjection,
  variance,
  securityRefusalMessage,
  // re-exported so callers import image helpers from one place
  parseImageDataUrl,
  guardrailFallbackMessage
};

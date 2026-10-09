// Thin LLM orchestration layer. Uses Node's built-in `fetch` (Node >= 18) so
// no SDK dependency is required. Supports Groq, OpenAI, and Anthropic
// (Claude). generateAnswer() tries LLM_PRIMARY first, then each provider in
// LLM_FALLBACK in order, moving on whenever a provider is unconfigured,
// rate-limited, or unreachable — this is the "missing API key / rate limit"
// fallback chain called for in the module's error-handling requirement.

class ChatConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatConfigError';
    this.statusCode = 503;
  }
}

class ChatRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatRateLimitError';
    this.statusCode = 429;
  }
}

class ChatUpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatUpstreamError';
    this.statusCode = 502;
  }
}

// Node's fetch has no default timeout: without this a hung provider holds
// the user's request open indefinitely instead of failing over to the next
// provider in the chain.
function getTimeoutMs() {
  const t = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(t) && t > 0 ? t : 20000;
}

async function fetchWithTimeout(url, options, providerLabel) {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ChatUpstreamError(`${providerLabel} did not respond within ${timeoutMs}ms`);
    }
    throw new ChatUpstreamError(`Could not reach ${providerLabel}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function getTemperature() {
  const t = Number(process.env.CHAT_TEMPERATURE);
  return Number.isFinite(t) ? t : 0.2;
}

// Reasoning models (gpt-oss on Groq, o-series on OpenAI) spend part of the
// completion budget on hidden reasoning before writing the answer, so the
// cap has to leave room for both or the visible answer comes back empty.
function getMaxTokens() {
  const n = Number(process.env.LLM_MAX_TOKENS);
  return Number.isInteger(n) && n > 0 ? n : 1024;
}

// Groq's gpt-oss models accept reasoning_effort; "low" keeps answers fast
// and is plenty for grounded Q&A over a few excerpts.
function groqReasoningParams(model) {
  if (!/^openai\/gpt-oss/i.test(model)) return {};
  const effort = String(process.env.LLM_REASONING_EFFORT || 'low').toLowerCase();
  return ['low', 'medium', 'high'].includes(effort) ? { reasoning_effort: effort } : {};
}

// Model defaults, kept in one place. Providers retire models regularly
// (Groq decommissioned llama3-70b-8192, and llama-3.3-70b-versatile is not
// available to every key), so verifyLlmModels() checks these at startup.
const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001'
};
const MODEL_ENV = { groq: 'GROQ_MODEL', openai: 'OPENAI_MODEL', anthropic: 'ANTHROPIC_MODEL' };

function modelFor(provider) {
  return String(process.env[MODEL_ENV[provider]] || '').trim() || DEFAULT_MODELS[provider];
}

// A 400/404 that names the model means configuration, not a transient
// outage: report it as ChatConfigError with the fix, instead of a raw body.
const MODEL_UNAVAILABLE = /model_decommissioned|model_not_found|does not exist|decommissioned|no longer supported|do not have access/i;

function getProviderChain() {
  const primary = String(process.env.LLM_PRIMARY || process.env.CHAT_LLM_PROVIDER || 'anthropic')
    .trim()
    .toLowerCase();
  const fallback = String(process.env.LLM_FALLBACK || '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  // De-duplicate while preserving order (primary first).
  return [primary, ...fallback].filter((p, i, arr) => p && arr.indexOf(p) === i);
}

function isLlmConfigured() {
  return getProviderChain().some((p) => providerHasKey(p));
}

const KEY_ENV = { groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

// Trimmed: an env file saved with CRLF line endings leaves a trailing "\r"
// on every value (Docker's env_file doesn't strip it), which the provider
// rejects as an invalid key — or fetch rejects as an invalid header.
function readKey(name) {
  return String(process.env[name] || '').trim();
}

function providerHasKey(provider) {
  return !!(KEY_ENV[provider] && readKey(KEY_ENV[provider]));
}

/**
 * Safe-to-log summary of the provider chain (names only, never key values)
 * — used for the startup warning in server.js.
 */
function describeLlmConfig() {
  const chain = getProviderChain();
  return {
    chain,
    configured: chain.filter(providerHasKey),
    missingKeys: chain.filter((p) => !providerHasKey(p)).map((p) => KEY_ENV[p] || `unsupported provider "${p}"`)
  };
}

// Free and low tiers (Groq especially) return 429 with a short Retry-After
// under bursty traffic. Waiting that long once is far better than failing
// the chat when it's only a few seconds; anything longer fails over now.
const MAX_RATE_LIMIT_WAIT_MS = 8000;

function retryAfterMs(res) {
  const seconds = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callChatCompletionsStyle({ url, apiKey, model, modelEnv, extraParams = {}, systemPrompt, userPrompt, maxTokens, providerLabel }) {
  const send = () => fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || getMaxTokens(),
        temperature: getTemperature(),
        ...extraParams,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    },
    providerLabel
  );

  let res = await send();
  if (res.status === 429) {
    const wait = retryAfterMs(res);
    if (wait !== null && wait <= MAX_RATE_LIMIT_WAIT_MS) {
      await sleep(wait);
      res = await send();
    }
  }

  if (res.status === 429) throw new ChatRateLimitError(`${providerLabel} rate limit exceeded.`);
  if (res.status === 401 || res.status === 403) {
    throw new ChatConfigError(`${providerLabel} rejected the configured API key.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if ((res.status === 400 || res.status === 404) && MODEL_UNAVAILABLE.test(body)) {
      throw new ChatConfigError(
        `${providerLabel} model "${model}" is unavailable (retired, or not enabled for this key). Set ${modelEnv} to a current model.`
      );
    }
    throw new ChatUpstreamError(`${providerLabel} error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    throw new ChatUpstreamError(
      choice?.finish_reason === 'length'
        ? `${providerLabel} used its whole token budget before answering — raise LLM_MAX_TOKENS.`
        : `${providerLabel} returned an empty response.`
    );
  }
  return {
    text,
    model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0
    }
  };
}

async function callGroq({ systemPrompt, userPrompt, maxTokens }) {
  const apiKey = readKey('GROQ_API_KEY');
  if (!apiKey) throw new ChatConfigError('GROQ_API_KEY is not configured.');
  const model = modelFor('groq');
  const result = await callChatCompletionsStyle({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
    modelEnv: 'GROQ_MODEL',
    extraParams: groqReasoningParams(model),
    systemPrompt,
    userPrompt,
    maxTokens,
    providerLabel: 'Groq'
  });
  return { ...result, provider: 'groq' };
}

async function callOpenAI({ systemPrompt, userPrompt, maxTokens }) {
  const apiKey = readKey('OPENAI_API_KEY');
  if (!apiKey) throw new ChatConfigError('OPENAI_API_KEY is not configured.');
  const model = modelFor('openai');
  const result = await callChatCompletionsStyle({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    modelEnv: 'OPENAI_MODEL',
    systemPrompt,
    userPrompt,
    maxTokens,
    providerLabel: 'OpenAI'
  });
  return { ...result, provider: 'openai' };
}

async function callAnthropic({ systemPrompt, userPrompt, maxTokens }) {
  const apiKey = readKey('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ChatConfigError('ANTHROPIC_API_KEY is not configured.');

  const model = modelFor('anthropic');

  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || getMaxTokens(),
        temperature: getTemperature(),
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    },
    'Anthropic'
  );

  if (res.status === 429) throw new ChatRateLimitError('Anthropic rate limit exceeded.');
  if (res.status === 401 || res.status === 403) {
    throw new ChatConfigError('Anthropic rejected the configured API key.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if ((res.status === 400 || res.status === 404) && /not_found_error|model/i.test(body) && MODEL_UNAVAILABLE.test(body)) {
      throw new ChatConfigError(`Anthropic model "${model}" is unavailable. Set ANTHROPIC_MODEL to a current model.`);
    }
    throw new ChatUpstreamError(`Anthropic error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  if (!text) throw new ChatUpstreamError('Anthropic returned an empty response.');
  return {
    text,
    model,
    provider: 'anthropic',
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0
    }
  };
}

const CALLERS = { groq: callGroq, openai: callOpenAI, anthropic: callAnthropic };

/**
 * Tries each provider in the LLM_PRIMARY -> LLM_FALLBACK chain in order,
 * moving to the next one on any ChatConfigError/ChatRateLimitError/
 * ChatUpstreamError. Throws the last error if every provider fails, with
 * `err.attempts` listing every provider's failure so the caller can log the
 * whole chain in one line (the last error alone hides why the primary failed).
 * @param {{ systemPrompt: string, userPrompt: string, maxTokens?: number }} args
 *   maxTokens: this call's completion budget, instead of LLM_MAX_TOKENS (e.g. a long JSON report)
 * @returns {Promise<{ text: string, provider: string, model: string, usage: { promptTokens: number, completionTokens: number } }>}
 */
async function generateAnswer({ systemPrompt, userPrompt, maxTokens }) {
  const chain = getProviderChain();
  let lastErr = new ChatConfigError('No LLM provider configured (set LLM_PRIMARY / LLM_FALLBACK).');
  const attempts = [];

  for (const provider of chain) {
    const caller = CALLERS[provider];
    if (!caller) {
      lastErr = new ChatConfigError(`Unsupported LLM provider "${provider}".`);
      attempts.push({ provider, error: lastErr.name, message: lastErr.message });
      continue;
    }
    try {
      const result = await caller({ systemPrompt, userPrompt, maxTokens });
      if (attempts.length) {
        // Answered, but not by the primary — worth knowing (a dead primary
        // key otherwise hides behind a working fallback indefinitely).
        console.warn(`[llm] answered by fallback "${provider}" after: ${formatAttempts(attempts)}`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      attempts.push({ provider, error: err.name, message: err.message });
      // fall through to the next provider in the chain
    }
  }

  lastErr.attempts = attempts;
  throw lastErr;
}

function formatAttempts(attempts) {
  return attempts.map((a) => `${a.provider}: ${a.error} (${a.message})`).join('; ');
}

const MODEL_LIST_URLS = {
  groq: 'https://api.groq.com/openai/v1/models',
  openai: 'https://api.openai.com/v1/models'
};

/**
 * Startup check: asks each configured OpenAI-compatible provider whether the
 * model it's set to actually exists for this key, so a retired or
 * inaccessible model shows up in the boot log instead of as degraded chat
 * answers later. Never throws; a provider that can't be reached is reported
 * as unverified, not as a failure.
 * @returns {Promise<Array<{ provider: string, model: string, status: 'ok'|'missing'|'unverified', suggestions?: string[], reason?: string }>>}
 */
async function verifyLlmModels() {
  const results = [];
  for (const provider of getProviderChain()) {
    const url = MODEL_LIST_URLS[provider];
    if (!url || !providerHasKey(provider)) continue;
    const model = modelFor(provider);
    try {
      const res = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${readKey(KEY_ENV[provider])}` } }, provider);
      if (!res.ok) {
        results.push({ provider, model, status: 'unverified', reason: `model list returned HTTP ${res.status}` });
        continue;
      }
      const ids = ((await res.json()).data || []).map((m) => m.id);
      if (ids.includes(model)) {
        results.push({ provider, model, status: 'ok' });
      } else {
        const chat = ids.filter((id) => !/whisper|tts|guard|embed|moderation|dall-e|image|audio|transcribe|realtime|search/i.test(id));
        results.push({ provider, model, status: 'missing', suggestions: chat.sort().slice(0, 8) });
      }
    } catch (err) {
      results.push({ provider, model, status: 'unverified', reason: err.message });
    }
  }
  return results;
}

module.exports = {
  generateAnswer,
  isLlmConfigured,
  describeLlmConfig,
  verifyLlmModels,
  DEFAULT_MODELS,
  formatAttempts,
  ChatConfigError,
  ChatRateLimitError,
  ChatUpstreamError
};

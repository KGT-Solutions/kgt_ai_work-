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

async function callChatCompletionsStyle({ url, apiKey, model, systemPrompt, userPrompt, providerLabel }) {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: getTemperature(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    },
    providerLabel
  );

  if (res.status === 429) throw new ChatRateLimitError(`${providerLabel} rate limit exceeded.`);
  if (res.status === 401 || res.status === 403) {
    throw new ChatConfigError(`${providerLabel} rejected the configured API key.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ChatUpstreamError(`${providerLabel} error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ChatUpstreamError(`${providerLabel} returned an empty response.`);
  return {
    text,
    model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0
    }
  };
}

async function callGroq({ systemPrompt, userPrompt }) {
  const apiKey = readKey('GROQ_API_KEY');
  if (!apiKey) throw new ChatConfigError('GROQ_API_KEY is not configured.');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const result = await callChatCompletionsStyle({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    providerLabel: 'Groq'
  });
  return { ...result, provider: 'groq' };
}

async function callOpenAI({ systemPrompt, userPrompt }) {
  const apiKey = readKey('OPENAI_API_KEY');
  if (!apiKey) throw new ChatConfigError('OPENAI_API_KEY is not configured.');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const result = await callChatCompletionsStyle({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    providerLabel: 'OpenAI'
  });
  return { ...result, provider: 'openai' };
}

async function callAnthropic({ systemPrompt, userPrompt }) {
  const apiKey = readKey('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ChatConfigError('ANTHROPIC_API_KEY is not configured.');

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

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
        max_tokens: 512,
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
 * @param {{ systemPrompt: string, userPrompt: string }} args
 * @returns {Promise<{ text: string, provider: string, model: string, usage: { promptTokens: number, completionTokens: number } }>}
 */
async function generateAnswer({ systemPrompt, userPrompt }) {
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
      const result = await caller({ systemPrompt, userPrompt });
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

module.exports = {
  generateAnswer,
  isLlmConfigured,
  describeLlmConfig,
  formatAttempts,
  ChatConfigError,
  ChatRateLimitError,
  ChatUpstreamError
};

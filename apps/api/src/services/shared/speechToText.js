// Speech-to-text for the chat widget's voice input. A thin, self-contained
// proxy to Groq's OpenAI-compatible audio transcription endpoint using the
// existing GROQ_API_KEY — no new provider or SDK.
//
// Multilingual by design: we send NO `language` parameter, so Whisper
// auto-detects and returns the spoken language's own script (Devanagari for
// Hindi, Latin for English). The caller then runs engine/language.js detection
// on that text so the bot replies in the language actually spoken.
//
// The HTTP call is injectable (`fetchImpl`) so unit tests never hit the network.
// Errors carry a statusCode the route maps to a response; it never leaks the
// provider's raw body to the client.

const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Groq's limit is 25MB; stay under it
const TIMEOUT_MS = 30000;                  // transcription can take a few seconds

const readKey = (name) => String(process.env[name] || '').trim(); // trim trailing CRLF from env files

/** Whether voice input can run (a Groq key is configured). */
function isSttConfigured() {
  return !!readKey('GROQ_API_KEY');
}

class TranscriptionError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'TranscriptionError';
    this.statusCode = statusCode;
  }
}

/**
 * Transcribe one audio blob via Groq Whisper. NEVER sends a language hint, so
 * transcription is multilingual and returns the spoken language's script.
 * @param {{ buffer: Buffer, filename?: string, mimeType?: string }} audio
 * @param {{ fetchImpl?: Function }} [opts]
 * @returns {Promise<{ text: string, model: string }>}
 * @throws {TranscriptionError} 503 if unconfigured, 502 on a provider failure
 */
async function transcribeAudio({ buffer, filename = 'audio.webm', mimeType = 'audio/webm' }, { fetchImpl = fetch } = {}) {
  const key = readKey('GROQ_API_KEY');
  if (!key) throw new TranscriptionError('speech-to-text is not configured', 503);
  if (!buffer || !buffer.length) throw new TranscriptionError('empty audio', 400);

  const model = readKey('GROQ_WHISPER_MODEL') || DEFAULT_MODEL;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('model', model);
  form.append('response_format', 'json');
  // Intentionally no 'language' field → Whisper auto-detects Hindi vs English.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal
    });
    if (!res.ok) throw new TranscriptionError(`transcription failed (${res.status})`, 502);
    const data = await res.json();
    return { text: String(data?.text || '').trim(), model };
  } catch (err) {
    if (err instanceof TranscriptionError) throw err;
    throw new TranscriptionError(`transcription request failed: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribeAudio, isSttConfigured, TranscriptionError, MAX_AUDIO_BYTES, DEFAULT_MODEL };

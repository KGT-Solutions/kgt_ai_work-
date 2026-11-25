// OpenAI voice for the Speech-to-Speech option: speech recognition locked to
// the chosen language, and natural spoken output generated from the ALREADY
// grounded answer (services/voiceChat.js produces the text through
// runTenantChat; this module never decides what to say).
//
// Everything that OpenAI revs — the base URL, the STT model, the TTS model, the
// voice and the audio format — is read from env on every call, so the TTS
// shutdown timeline (tts-1 / tts-1-hd / gpt-4o-mini-tts and the /v1/audio/speech
// endpoint are slated to retire ~Jan 2027, with the Realtime API as the
// successor) is a configuration change, not a code change. OPENAI_API_KEY stays
// strictly server-side. The HTTP call is injectable (`fetchImpl`) so tests never
// hit the network; errors carry a statusCode the route maps to a response and
// never leak the provider's raw body.

const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  sttModel: 'gpt-4o-transcribe',  // OpenAI's recommended transcription model; whisper-1 is a valid override
  ttsModel: 'gpt-4o-mini-tts',    // works today; repoint via OPENAI_TTS_MODEL before the 2027 retirement
  ttsVoice: 'alloy',
  ttsFormat: 'mp3'
});
const TIMEOUT_MS = 30000;
const MAX_TTS_CHARS = 4000; // grounded answers are short; bound the request regardless

const readKey = (name) => String(process.env[name] || '').trim(); // trim trailing CRLF from env files

function config() {
  return {
    key: readKey('OPENAI_API_KEY'),
    base: (readKey('OPENAI_BASE_URL') || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    sttModel: readKey('OPENAI_STT_MODEL') || DEFAULTS.sttModel,
    ttsModel: readKey('OPENAI_TTS_MODEL') || DEFAULTS.ttsModel,
    ttsVoice: readKey('OPENAI_TTS_VOICE') || DEFAULTS.ttsVoice,
    ttsFormat: readKey('OPENAI_TTS_FORMAT') || DEFAULTS.ttsFormat
  };
}

/** Whether speech-to-speech can run (an OpenAI key is configured). */
function isS2sConfigured() {
  return !!readKey('OPENAI_API_KEY');
}

const AUDIO_MIME = { mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/pcm' };

const LANGUAGE_NAME = { en: 'English', hi: 'Hindi' };
// Steering instruction that pins the SPOKEN language so the voice can't drift to
// the other language mid-utterance. Supported by the gpt-4o-* / gpt-realtime-*
// speech models; the legacy tts-1 / tts-1-hd models ignore (and reject) an
// `instructions` field, so it is omitted for those (detected by model name).
function spokenLanguageInstruction(language) {
  const name = LANGUAGE_NAME[language];
  return name ? `Speak entirely in ${name}. Do not switch to any other language.` : '';
}
function modelSupportsInstructions(model) {
  return !/^tts-1/i.test(String(model || ''));
}

class VoiceError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'VoiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Transcribe one audio blob via OpenAI, LOCKED to the chosen language (ISO-639-1
 * 'en' | 'hi') so recognition stays in English or Hindi as the visitor picked —
 * unlike the Groq /transcribe flow, which auto-detects.
 * @param {{ buffer: Buffer, filename?: string, mimeType?: string, language?: string }} audio
 * @param {{ fetchImpl?: Function }} [opts]
 * @returns {Promise<{ text: string, model: string }>}
 */
async function transcribeLocked({ buffer, filename = 'audio.webm', mimeType = 'audio/webm', language }, { fetchImpl = fetch } = {}) {
  const c = config();
  if (!c.key) throw new VoiceError('speech-to-speech is not configured', 503);
  if (!buffer || !buffer.length) throw new VoiceError('empty audio', 400);

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('model', c.sttModel);
  form.append('response_format', 'json');
  if (language) form.append('language', language); // ISO-639-1 lock (en | hi)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${c.base}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.key}` },
      body: form,
      signal: controller.signal
    });
    if (!res.ok) throw new VoiceError(`transcription failed (${res.status})`, 502);
    const data = await res.json();
    return { text: String(data?.text || '').trim(), model: c.sttModel };
  } catch (err) {
    if (err instanceof VoiceError) throw err;
    throw new VoiceError(`transcription request failed: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Speak a piece of text with OpenAI TTS. The text is the grounded answer, which
 * is already in the chosen language, so the voice speaks that language.
 * @param {{ text: string, voice?: string }} args
 * @param {{ fetchImpl?: Function }} [opts]
 * @returns {Promise<{ audio: Buffer, mimeType: string, model: string }>}
 */
async function synthesizeSpeech({ text, voice, language }, { fetchImpl = fetch } = {}) {
  const c = config();
  if (!c.key) throw new VoiceError('speech-to-speech is not configured', 503);
  const input = String(text || '').trim();
  if (!input) throw new VoiceError('empty text', 400);

  const payload = { model: c.ttsModel, voice: voice || c.ttsVoice, input: input.slice(0, MAX_TTS_CHARS), response_format: c.ttsFormat };
  // Pin the spoken language so the voice never drifts to the other language.
  const instruction = spokenLanguageInstruction(language);
  if (instruction && modelSupportsInstructions(c.ttsModel)) payload.instructions = instruction;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${c.base}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) throw new VoiceError(`speech synthesis failed (${res.status})`, 502);
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, mimeType: AUDIO_MIME[c.ttsFormat] || 'application/octet-stream', model: c.ttsModel };
  } catch (err) {
    if (err instanceof VoiceError) throw err;
    throw new VoiceError(`speech synthesis request failed: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribeLocked, synthesizeSpeech, isS2sConfigured, VoiceError, DEFAULTS, MAX_TTS_CHARS };

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SpeechService — server-side Speech-to-Text for Voice Inventory (Phase B).
 *
 * RECOVERY NOTE: adapted from the pre-"removed ai" implementation (commit
 * ecf6df6, services/SpeechService.ts, 747 lines) and trimmed to the providers
 * this deployment actually configures:
 *
 *   SpeechService → [Groq Whisper | Google Cloud STT]
 *
 *   - Groq Whisper is the primary (auto-detected when the LLM points at
 *     Groq's OpenAI-compatible endpoint — no extra env vars), honoring the
 *     explicit STT_PROVIDER override.
 *   - Google Cloud STT is the fallback (only when GOOGLE_API_KEY/STT_API_KEY
 *     is set).
 *   - The old browser/azure/custom providers were removed: browser STT never
 *     ran server-side (it threw by design), azure was never keyed, and
 *     Deepgram Flux streaming is unnecessary for push-to-talk clips.
 *
 * SECURITY: the API key travels only in the Authorization header to the
 * provider and is never logged, returned, or stored. Raw audio is processed
 * in-memory only — never persisted.
 */

import { config } from '../../../config';

// ─── Provider contract ─────────────────────────────────────────────

export interface STTResult {
  transcript: string;
  /** Provider confidence (0–1) when reported; 0 otherwise. */
  confidence: number;
  isFinal: boolean;
  /** End-to-end provider latency in ms. */
  durationMs: number;
  /** Language code requested/detected (e.g. 'en', 'hi', 'hi-en' → auto). */
  language?: string;
  /** 'groq' | 'google' — the provider that actually served the call. */
  provider: 'groq' | 'google';
}

export interface STTOptions {
  /** 'en' | 'hi' | 'hi-en' (auto-detect on the provider). */
  language?: string;
  timeoutMs?: number;
}

export interface ISTTProvider {
  name: string;
  key: STTResult['provider'];
  transcribe(audioBlob: Blob, options?: STTOptions): Promise<STTResult>;
}

export type STTProviderKind = 'groq' | 'google' | 'none';

export interface STTConfig {
  provider: STTProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  timeoutMs: number;
}

// ─── Configuration (env-driven, explicit override wins) ────────────

/** Map the app-level language hint to a Whisper language code. */
function mapLanguageToWhisper(language?: string): string {
  switch ((language || '').toLowerCase()) {
    case 'en': return 'en';
    case 'hi': return 'hi';
    case 'hi-en':
    default: return ''; // '' → provider auto-detect (best for code-mixed)
  }
}

/**
 * Resolve the STT provider from env. Explicit STT_PROVIDER wins; otherwise
 * auto-detect Groq Whisper when the LLM is pointed at Groq (the previous
 * deployment's zero-extra-config path — reused as-is).
 */
function resolveSttProvider(): STTProviderKind {
  const explicit = (process.env.STT_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'groq' || explicit === 'google') return explicit;
  if (explicit) return 'none';
  const aiProvider = (process.env.AI_PROVIDER || '').toLowerCase();
  const aiBaseUrl = (process.env.AI_BASE_URL || '').toLowerCase();
  if (aiProvider === 'custom' && aiBaseUrl.includes('groq')) return 'groq';
  return 'none';
}

/** Whether the active provider was explicitly configured (strict) vs auto-detected (fallback allowed). */
function isExplicitProvider(): boolean {
  const explicit = (process.env.STT_PROVIDER || '').trim().toLowerCase();
  return explicit === 'groq' || explicit === 'google';
}

let _sttConfig: STTConfig = {
  provider: resolveSttProvider(),
  apiKey: process.env.STT_API_KEY || '',
  baseUrl: process.env.STT_BASE_URL || '',
  model: process.env.STT_MODEL || 'whisper-large-v3-turbo',
  language: process.env.STT_LANGUAGE || 'hi-en', // Hinglish by default
  timeoutMs: parseInt(process.env.STT_TIMEOUT_MS || '10000', 10),
};

/** Test/ops hook — override configuration (resets cached providers). */
export function configureSTT(overrides: Partial<STTConfig>): void {
  _sttConfig = { ..._sttConfig, ...overrides };
  _groq = null;
  _google = null;
}

export function getSTTConfig(): Readonly<STTConfig> {
  return _sttConfig;
}

/** Which provider would serve right now (honest status reporting). */
export function getActiveProviderKind(): STTProviderKind {
  return _sttConfig.provider;
}

// ─── Groq Whisper provider (OpenAI-compatible /audio/transcriptions) ──

let _groq: ISTTProvider | null = null;

function groqProvider(): ISTTProvider | null {
  if (_groq) return _groq;
  const apiKey = _sttConfig.apiKey || config.ai.apiKey;
  if (!apiKey) return null;
  const aiBase = (config.ai.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const baseUrl = _sttConfig.baseUrl || `${aiBase}/audio/transcriptions`;
  _groq = {
    name: 'Groq Whisper STT',
    key: 'groq',
    async transcribe(audioBlob: Blob, options?: STTOptions): Promise<STTResult> {
      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';
      const languageCode = mapLanguageToWhisper(language);

      const fileExtension = audioBlob.type.includes('mp4')
        ? 'mp4'
        : audioBlob.type.includes('ogg')
          ? 'ogg'
          : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `audio.${fileExtension}`);
      formData.append('model', _sttConfig.model || 'whisper-large-v3-turbo');
      // Let Whisper auto-detect for code-mixed speech ('hi-en'/'' hint) —
      // forcing a language on Hinglish clips can empty the transcript.
      if (languageCode) formData.append('language', languageCode);
      formData.append('response_format', 'verbose_json');

      // Observability: endpoint shape + size + model — no key, no audio.
      console.log(
        `[SpeechService] Groq STT: POST ${baseUrl} | model=${_sttConfig.model} | audio=${Math.round((audioBlob.size || 0) / 1024)} KB | language=${languageCode || 'auto'}`,
      );

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: AbortSignal.timeout(options?.timeoutMs || _sttConfig.timeoutMs),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Groq STT error (${response.status}): ${errText.slice(0, 200)}`);
      }
      const json = (await response.json()) as {
        text?: string;
        confidence?: number;
        segments?: Array<{ confidence?: number }>;
      };
      return {
        transcript: json.text || '',
        confidence: json.segments?.[0]?.confidence ?? json.confidence ?? 0,
        isFinal: true,
        durationMs: Date.now() - startTime,
        language: languageCode || undefined,
        provider: 'groq',
      };
    },
  };
  return _groq;
}

// ─── Google Cloud STT provider (fallback) ───────────────────────────

let _google: ISTTProvider | null = null;

function googleProvider(): ISTTProvider | null {
  if (_google) return _google;
  const apiKey = _sttConfig.apiKey || process.env.GOOGLE_API_KEY || '';
  if (!apiKey) return null;
  const location = process.env.GOOGLE_STT_LOCATION || 'global';
  const model = process.env.GOOGLE_STT_MODEL || 'latest_short';
  const baseUrl =
    _sttConfig.baseUrl ||
    (location && location !== 'global'
      ? `https://${location}-speech.googleapis.com/v1/speech:recognize`
      : 'https://speech.googleapis.com/v1/speech:recognize');

  _google = {
    name: 'Google Cloud STT',
    key: 'google',
    async transcribe(audioBlob: Blob, options?: STTOptions): Promise<STTResult> {
      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';
      // Google needs concrete BCP-47 codes; 'hi-en' → auto list.
      const languageCodes =
        language === 'hi' ? ['hi-IN'] : language === 'en' ? ['en-IN'] : ['en-IN', 'hi-IN'];
      const buffer = Buffer.from(await audioBlob.arrayBuffer());
      const body = {
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCodes,
          model,
          enableAutomaticPunctuation: false,
        },
        audio: { content: buffer.toString('base64') },
      };
      console.log(
        `[SpeechService] Google STT: POST ${baseUrl} | model=${model} | audio=${Math.round(buffer.length / 1024)} KB | languages=${languageCodes.join(',')}`,
      );
      const response = await fetch(`${baseUrl}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options?.timeoutMs || _sttConfig.timeoutMs),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Google STT error (${response.status}): ${errText.slice(0, 200)}`);
      }
      const json = (await response.json()) as {
        results?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }>;
      };
      const alt = json.results?.[0]?.alternatives?.[0];
      return {
        transcript: alt?.transcript || '',
        confidence: alt?.confidence ?? 0,
        isFinal: true,
        durationMs: Date.now() - startTime,
        language: languageCodes[0],
        provider: 'google',
      };
    },
  };
  return _google;
}

// ─── Public entry: provider resolution + transcribe with fallback ────

function providerChain(): Array<{ kind: STTProviderKind; provider: ISTTProvider }> {
  // SECURITY/cost guard: 'none' means NO outbound STT calls — an unconfigured
  // deployment must never silently spend a provider's quota (live-data finding:
  // the LLM key alone used to activate Groq even when STT was disabled).
  const primary = getActiveProviderKind();
  if (primary === 'none') return [];
  const chain: Array<{ kind: STTProviderKind; provider: ISTTProvider }> = [];
  const primaryP = primary === 'groq' ? groqProvider() : primary === 'google' ? googleProvider() : null;
  if (primaryP) chain.push({ kind: primary, provider: primaryP });
  // Fallback to the other keyed provider ONLY when the primary was
  // auto-detected — an explicit STT_PROVIDER is honored strictly (§22:
  // preserve the existing behavior; no surprise provider switches).
  if (!isExplicitProvider()) {
    const other = primary === 'groq' ? googleProvider() : primary === 'google' ? groqProvider() : null;
    if (other) chain.push({ kind: primary === 'groq' ? 'google' : 'groq', provider: other });
  }
  return chain;
}

/**
 * Transcribe audio through the configured provider chain. The primary runs
 * first; if it fails the next keyed provider is attempted (recorded in
 * `attemptHistory`-style metadata by the caller via result.provider).
 * Throws a provider-agnostic error when nothing is configured or all fail.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options?: STTOptions,
): Promise<STTResult> {
  const chain = providerChain();
  if (chain.length === 0) {
    const e = new Error('No speech provider configured');
    e.name = 'STTNotConfigured';
    throw e;
  }
  let lastErr: unknown = null;
  for (const { provider } of chain) {
    try {
      const result = await provider.transcribe(audioBlob, options);
      if (result.transcript.trim().length > 0 || provider.key === chain[chain.length - 1].provider.key) {
        // Empty transcript from the primary → try the fallback once.
        if (result.transcript.trim().length > 0) return result;
        lastErr = new Error('Empty transcript');
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(`[SpeechService] provider ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All speech providers failed');
}

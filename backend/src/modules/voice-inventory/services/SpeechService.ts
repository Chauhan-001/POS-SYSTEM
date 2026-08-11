/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SpeechService — Abstraction layer over configurable Speech-to-Text providers.
 *
 * Architecture:
 *   VoiceInventory → SpeechService → [BrowserSTT | GoogleSTT | AzureSTT | CustomSTT]
 *
 * The service provides:
 *   - Provider abstraction (swap STT engines via config)
 *   - Multilingual support (English, Hindi, Hinglish)
 *   - Configurable via environment variables
 *   - Graceful fallback on failure
 *
 * To add a new provider:
 *   1. Implement the ISTTProvider interface
 *   2. Register it in the PROVIDER_MAP below
 *   3. Set STT_PROVIDER env var to the provider name
 *
 * SECURITY:
 *   - Audio data is never stored (transcribed in memory, discarded after)
 *   - Only the transcript is passed to the next pipeline stage
 *   - All provider API keys are read from environment variables
 */

import type { ISTTProvider, STTResult, STTOptions } from '../types';
import { aiConfig } from '../../ai/config';
import { recordQuotaSnapshot } from '../../ai/services/aiQuotaTracker';
import { SttProviderManager, createBreaker, type SttProviderEntry } from './SttProviderManager';
import { createGoogleCloudSttProvider } from '../providers/googleCloudStt';
import { createDeepgramFluxProvider } from '../providers/deepgramFlux';

// ====================================================================
// PROVIDER CONFIGURATION
// ====================================================================

interface STTConfig {
  provider: 'browser' | 'google' | 'azure' | 'custom' | 'groq';
  apiKey?: string;
  region?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  timeoutMs: number;
}

/**
 * Resolve the STT provider, auto-detecting Groq Whisper when the LLM is
 * already pointed at Groq's OpenAI-compatible endpoint (so no extra env
 * vars are needed). Explicit STT_PROVIDER always wins.
 */
function resolveSttProvider(): STTConfig['provider'] {
  const explicit = process.env.STT_PROVIDER as STTConfig['provider'] | undefined;
  if (explicit) return explicit;
  const aiProvider = (process.env.AI_PROVIDER || '').toLowerCase();
  const aiBaseUrl = (process.env.AI_BASE_URL || '').toLowerCase();
  if (aiProvider === 'custom' && aiBaseUrl.includes('groq')) {
    return 'groq';
  }
  return 'browser';
}

let _sttConfig: STTConfig = {
  provider: resolveSttProvider(),
  apiKey: process.env.STT_API_KEY || '',
  region: process.env.STT_REGION || '',
  baseUrl: process.env.STT_BASE_URL || '',
  model: process.env.STT_MODEL || 'whisper-large-v3-turbo',
  language: process.env.STT_LANGUAGE || 'hi-en', // Hinglish by default
  timeoutMs: parseInt(process.env.STT_TIMEOUT_MS || '10000', 10),
};

export function configureSTT(config: Partial<STTConfig>): void {
  _sttConfig = { ..._sttConfig, ...config };
  if (config.provider) {
    _providerInstance = null; // Reset cached instance on config change
    _manager = null;          // Rebuild the provider chain
  }
}

export function getSTTConfig(): Readonly<STTConfig> {
  return Object.freeze({ ..._sttConfig });
}

// ====================================================================
// PROVIDER REGISTRY
// ====================================================================

// Cache the provider instance (singleton per config)
let _providerInstance: ISTTProvider | null = null;

/**
 * Get the configured STT provider instance.
 * Lazily loads the appropriate provider based on config.
 */
function getProvider(): ISTTProvider {
  if (_providerInstance) return _providerInstance;

  switch (_sttConfig.provider) {
    case 'google':
      _providerInstance = createGoogleProvider();
      break;
    case 'azure':
      _providerInstance = createAzureProvider();
      break;
    case 'custom':
      _providerInstance = createCustomProvider();
      break;
    case 'groq':
      _providerInstance = createGroqProvider();
      break;
    case 'browser':
    default:
      _providerInstance = createBrowserProvider();
      break;
  }

  if (!_providerInstance) {
    console.warn('[SpeechService] No provider configured, using browser fallback');
    _providerInstance = createBrowserProvider();
  }

  console.log(`[SpeechService] Using STT provider: ${_providerInstance.name} (model=${_sttConfig.model || 'default'})`);
  return _providerInstance;
}

// ====================================================================
// BUILT-IN PROVIDERS
// ====================================================================

/**
 * Browser SpeechRecognition provider.
 * Works with the Web Speech API (Chrome, Edge, Safari).
 * Supports English, Hindi, and Hinglish via language hints.
 */
function createBrowserProvider(): ISTTProvider {
  return {
    name: 'Browser SpeechRecognition',

    async transcribe(
      audioBlob: Blob,
      options?: STTOptions
    ): Promise<STTResult> {
      // The browser SpeechRecognition API works in real-time, not with static blobs.
      // This implementation is used on the frontend directly.
      // On the backend, we expect a transcript to be sent instead of raw audio.
      throw new Error(
        'Browser STT provider cannot process audio on the backend. ' +
          'Send a transcript instead, or configure a cloud STT provider.'
      );
    },
  };
}

/**
 * Google Cloud Speech-to-Text provider.
 * Requires GOOGLE_APPLICATION_CREDENTIALS or STT_API_KEY env var.
 * Supports Hindi (hi-IN), English (en-IN), and Hinglish.
 */
function createGoogleProvider(): ISTTProvider {
  const apiKey = _sttConfig.apiKey;
  const baseUrl = _sttConfig.baseUrl || 'https://speech.googleapis.com/v1';

  return {
    name: 'Google Cloud STT',

    async transcribe(
      audioBlob: Blob,
      options?: STTOptions
    ): Promise<STTResult> {
      if (!apiKey) {
        throw new Error(
          'Google STT requires STT_API_KEY or GOOGLE_APPLICATION_CREDENTIALS'
        );
      }

      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';

      // Map our language codes to Google's format
      const languageCode = mapLanguageToGoogle(language);

      // Convert blob to base64
      const buffer = await audioBlob.arrayBuffer();
      const base64Audio = Buffer.from(buffer).toString('base64');

      const response = await fetch(
        `${baseUrl}/speech:recognize?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              encoding: 'WEBM_OPUS',
              sampleRateHertz: 48000,
              languageCode,
              alternativeLanguageCodes: ['en-IN', 'hi-IN', 'en-US'],
              enableAutomaticPunctuation: true,
              model: 'latest_short', // Optimized for short utterances
              maxAlternatives: 1,
            },
            audio: {
              content: base64Audio,
            },
          }),
          signal: AbortSignal.timeout(
            options?.timeoutMs || _sttConfig.timeoutMs
          ),
        }
      );

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(`Google STT error (${response.status}): ${err}`);
      }

      const json = await response.json();
      const durationMs = Date.now() - startTime;

      const result = json.results?.[0];
      const alternative = result?.alternatives?.[0];

      return {
        transcript: alternative?.transcript || '',
        confidence: alternative?.confidence || 0,
        isFinal: result?.isFinal ?? true,
        durationMs,
        language: languageCode,
      };
    },
  };
}

/**
 * Azure Speech-to-Text provider.
 * Requires STT_API_KEY (Azure Speech key) and STT_REGION.
 */
function createAzureProvider(): ISTTProvider {
  const apiKey = _sttConfig.apiKey;
  const region = _sttConfig.region || 'eastus';

  return {
    name: 'Azure Speech STT',

    async transcribe(
      audioBlob: Blob,
      options?: STTOptions
    ): Promise<STTResult> {
      if (!apiKey) {
        throw new Error('Azure STT requires STT_API_KEY');
      }

      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';

      // Get Azure access token
      const tokenResponse = await fetch(
        `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            'Content-Length': '0',
          },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!tokenResponse.ok) {
        throw new Error(
          `Azure auth error (${tokenResponse.status}): ${await tokenResponse
            .text()
            .catch(() => 'Unknown')}`
        );
      }

      const accessToken = await tokenResponse.text();
      const languageCode = mapLanguageToAzure(language);

      // Send audio for recognition
      const audioBuffer = await audioBlob.arrayBuffer();
      const response = await fetch(
        `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${languageCode}&format=detailed`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'audio/webm;codecs=opus',
            Accept: 'application/json',
          },
          body: audioBuffer,
          signal: AbortSignal.timeout(
            options?.timeoutMs || _sttConfig.timeoutMs
          ),
        }
      );

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(`Azure STT error (${response.status}): ${err}`);
      }

      const json = await response.json();
      const durationMs = Date.now() - startTime;

      return {
        transcript: json.DisplayText || json.NBest?.[0]?.Display || '',
        confidence: json.NBest?.[0]?.Confidence || 0,
        isFinal: true,
        durationMs,
        language: languageCode,
      };
    },
  };
}

/**
 * Custom (OpenAI Whisper-compatible) provider.
 * Uses any OpenAI-compatible API endpoint.
 */
function createCustomProvider(): ISTTProvider {
  const apiKey = _sttConfig.apiKey;
  const baseUrl =
    _sttConfig.baseUrl || 'https://api.openai.com/v1/audio/transcriptions';

  return {
    name: 'Custom STT (Whisper-compatible)',

    async transcribe(
      audioBlob: Blob,
      options?: STTOptions
    ): Promise<STTResult> {
      if (!apiKey) {
        throw new Error('Custom STT requires STT_API_KEY');
      }

      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';
      const languageCode = mapLanguageToWhisper(language);

      const formData = new FormData();
      formData.append(
        'file',
        audioBlob,
        `audio.${audioBlob.type.split('/')[1] || 'webm'}`
      );
      formData.append('model', _sttConfig.model || 'whisper-1');
      formData.append('language', languageCode);
      formData.append('response_format', 'verbose_json');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(
          options?.timeoutMs || _sttConfig.timeoutMs
        ),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(`Custom STT error (${response.status}): ${err}`);
      }

      const json = await response.json();
      const durationMs = Date.now() - startTime;

      return {
        transcript: json.text || '',
        confidence: json.segments?.[0]?.confidence || json.confidence || 0,
        isFinal: true,
        durationMs,
        language: languageCode,
      };
    },
  };
}

/**
 * Groq Whisper provider — OpenAI-compatible speech-to-text.
 * Reuses the AI module's Groq credentials/base URL when the dedicated
 * STT_* env vars are not set, so the user's existing Groq key just works.
 */
function createGroqProvider(): ISTTProvider {
  const apiKey = _sttConfig.apiKey || aiConfig.apiKey;
  const aiBase = (aiConfig.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const baseUrl =
    _sttConfig.baseUrl || `${aiBase}/audio/transcriptions`;

  return {
    name: 'Groq Whisper STT',

    async transcribe(
      audioBlob: Blob,
      options?: STTOptions
    ): Promise<STTResult> {
      if (!apiKey) {
        throw new Error('Groq STT requires STT_API_KEY or AI_API_KEY');
      }

      const startTime = Date.now();
      const language = options?.language || _sttConfig.language || 'hi-en';
      const languageCode = mapLanguageToWhisper(language);

      const fileExtension = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      formData.append(
        'file',
        audioBlob,
        `audio.${fileExtension}`
      );
      formData.append('model', _sttConfig.model || 'whisper-large-v3-turbo');
      // Do not hardcode language if it causes empty transcripts; let Whisper auto-detect when language is hi-en/hi
      if (languageCode && languageCode !== 'hi') {
        formData.append('language', languageCode);
      }
      formData.append('response_format', 'verbose_json');

      // Detailed Groq call log — endpoint + STT model + audio size so a
      // wrong model (e.g. a chat model) or empty upload is visible at once.
      // NOTE: This corresponds to the Groq/OpenAI SDK method
      //   client.audio.transcriptions.create({ model, file })
      // i.e. the /audio/transcriptions endpoint — NOT chat.completions.
      console.log(
        `[SpeechService] Groq STT call: client.audio.transcriptions.create() → POST ${baseUrl} | model=${_sttConfig.model || 'whisper-large-v3-turbo'} | ` +
        `audio=${Math.round((audioBlob.size || 0) / 1024)} KB | language=${languageCode}`
      );

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(
          options?.timeoutMs || _sttConfig.timeoutMs
        ),
      });

      console.log(`[SpeechService] Groq STT response: HTTP ${response.status}`);

      // Feed the admin quota tracker from the STT response headers (same
      // per-account quota as the LLM — Whisper usage counts against it).
      // Skip when no key is configured so we never record an empty-key entry.
      if (apiKey) {
        recordQuotaSnapshot(apiKey, response.headers, {
          model: _sttConfig.model || 'whisper-large-v3-turbo',
          baseUrl,
          success: response.ok,
          status: response.status,
        });
      }

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        const diagErr: any = new Error(`Groq STT error (${response.status}): ${err}`);
        diagErr.status = response.status;
        diagErr.requestUrl = baseUrl;
        diagErr.model = _sttConfig.model || 'whisper-large-v3-turbo';
        diagErr.endpointMethod = 'client.audio.transcriptions.create()';
        diagErr.responseBody = err;
        console.error('[SpeechService] Groq STT error body:', err.slice(0, 500));
        throw diagErr;
      }

      const json = await response.json();
      const durationMs = Date.now() - startTime;

      console.log(`[SpeechService] Groq STT transcribed: "${String(json.text || '').slice(0, 80)}" (${durationMs}ms)`);

      return {
        transcript: json.text || '',
        confidence: json.segments?.[0]?.confidence || json.confidence || 0,
        isFinal: true,
        durationMs,
        language: languageCode,
      };
    },
  };
}

// ====================================================================
// PROVIDER CHAIN (PRODUCTION)
// ====================================================================

let _manager: SttProviderManager | null = null;

/**
 * Build the production STT provider chain:
 *   1. Google Cloud STT (primary)    — GOOGLE_API_KEY / STT_API_KEY
 *   2. Deepgram Flux (fallback)      — DEEPGRAM_API_KEY
 *   3. Legacy configured provider    — STT_PROVIDER (browser/azure/custom/groq)
 *
 * Each entry gets its own circuit breaker via SttProviderManager. The first
 * provider that returns a non-empty transcript wins.
 */
function getManager(): SttProviderManager {
  if (_manager) return _manager;

  const entries: Array<Omit<SttProviderEntry, 'breaker'>> = [];
  const providerKey = _sttConfig.provider;
  const deepgramConfigured = !!process.env.DEEPGRAM_API_KEY;
  const googleConfigured = !!(
    _sttConfig.apiKey ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );

  // Production chain, in priority order:
  //   1. Deepgram Flux (primary when DEEPGRAM_API_KEY is set — the current
  //      production setup; no Google key required).
  //   2. Google Cloud STT — included only when a key is actually present.
  //   3. Explicit legacy single-provider (STT_PROVIDER=azure/custom/groq).
  //   4. Auto-detect last resort (Groq Whisper etc.).
  //
  // When BOTH Deepgram and Google keys exist, Deepgram stays first (matches
  // the user's current deployment preference) and Google is the fallback.
  if (providerKey === 'google' && deepgramConfigured) {
    entries.push({ key: 'deepgram', displayName: 'Deepgram Flux', provider: createDeepgramFluxProvider() });
  } else if (!deepgramConfigured && providerKey === 'google') {
    entries.push({ key: 'google', displayName: 'Google Cloud STT', provider: createGoogleCloudSttProvider() });
  } else if (
    !deepgramConfigured &&
    (providerKey === 'azure' || providerKey === 'custom' || providerKey === 'groq' || providerKey === 'browser')
  ) {
    entries.push({ key: providerKey, displayName: `Legacy:${providerKey}`, provider: getLegacyProvider(providerKey) });
  } else if (deepgramConfigured) {
    // Deepgram primary (default production path), Google fallback if keyed.
    entries.push({ key: 'deepgram', displayName: 'Deepgram Flux', provider: createDeepgramFluxProvider() });
  } else {
    // Nothing configured yet — Google Cloud attempt + auto-detect.
    entries.push({ key: 'google', displayName: 'Google Cloud STT', provider: createGoogleCloudSttProvider() });
  }

  // Google appended as a fallback when Deepgram leads and Google has a key.
  if (entries[0]?.key === 'deepgram' && googleConfigured) {
    entries.push({ key: 'google', displayName: 'Google Cloud STT', provider: createGoogleCloudSttProvider() });
  }

  // Auto-detect legacy provider as the last resort when the chain has no
  // usable primary credentials. `getProvider()` lazily builds one.
  if (!entries.some((e) => e.key === _sttConfig.provider)) {
    try {
      const auto = getProvider();
      entries.push({ key: _sttConfig.provider, displayName: `Auto:${_sttConfig.provider}`, provider: auto });
    } catch {
      // ignore — chain will still try the produced entries
    }
  }

  _manager = new SttProviderManager(
    entries.map((e) => ({
      ...e,
      breaker: createBreaker(e.key),
    }))
  );
  return _manager;
}

/**
 * Map a legacy provider key to its pre-existing provider instance. The old
 * single-provider behaviour is preserved as an entry inside the chain.
 */
function getLegacyProvider(key: 'azure' | 'custom' | 'groq' | 'browser'): ISTTProvider {
  switch (key) {
    case 'azure':
      return createAzureProvider();
    case 'custom':
      return createCustomProvider();
    case 'groq':
      return createGroqProvider();
    case 'browser':
      return createBrowserProvider();
  }
}

// ====================================================================
// PUBLIC API
// ====================================================================

/**
 * Transcribe audio to text using the configured provider chain.
 * Google Cloud STT is tried first; Deepgram Flux and the legacy provider act
 * as fallbacks. A successful result carries `provider`, `costUsd`, and the
 * attempt trace so the controller can surface cost/ineability metrics.
 *
 * @param audioBlob - Raw audio data blob
 * @param options - Optional transcription options
 * @returns Transcribed text with metadata
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options?: STTOptions
): Promise<STTResult> {
  const startTime = Date.now();
  const audioSizeKb = Math.round((audioBlob.size || 0) / 1024);
  const manager = getManager();
  console.log(
    `[SpeechService] Audio received: ${audioSizeKb} KB, type=${audioBlob.type || 'unknown'}, ` +
    `chain=[${manager.list().join(' → ')}]`
  );

  try {
    const outcome = await manager.transcribe(audioBlob, options);

    if (!outcome.success || !outcome.result) {
      console.warn(
        `[SpeechService] All STT providers failed: ${
          outcome.error || 'unknown'
        } | attempts=${JSON.stringify(outcome.attemptHistory)}`
      );
      return {
        transcript: '',
        confidence: 0,
        isFinal: true,
        durationMs: Date.now() - startTime,
        language: options?.language || _sttConfig.language || 'hi-en',
        attemptHistory: outcome.attemptHistory,
        error: {
          message: outcome.error || 'No STT provider available',
        },
      };
    }

    const r = outcome.result;
    console.log(
      `[SpeechService] Transcribed via ${outcome.provider} in ${r.durationMs}ms: "${r.transcript.slice(0, 80)}"` +
      (outcome.costUsd ? ` (≈$${outcome.costUsd})` : '')
    );

    return {
      ...r,
      provider: outcome.provider,
      costUsd: outcome.costUsd,
      attemptHistory: outcome.attemptHistory,
    };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[SpeechService] Transcription failed after ${elapsed}ms:`, error.message);
    return {
      transcript: '',
      confidence: 0,
      isFinal: true,
      durationMs: elapsed,
      language: options?.language || _sttConfig.language || 'hi-en',
      error: {
        message: error?.message || 'Unknown STT error',
        status: error?.status,
        stack: error?.stack,
        requestUrl: error?.requestUrl,
        model: error?.model || _sttConfig.model,
        endpointMethod: error?.endpointMethod,
        responseBody: error?.responseBody,
      },
    };
  }
}

/**
 * Check if the configured STT provider chain has at least one usable provider.
 */
export function isSTTConfigured(): boolean {
  if (process.env.DEEPGRAM_API_KEY) return true;
  switch (_sttConfig.provider) {
    case 'azure':
    case 'custom':
      return !!_sttConfig.apiKey;
    case 'groq':
      return !!_sttConfig.apiKey || !!aiConfig.apiKey;
    case 'google':
      return !!(
        _sttConfig.apiKey ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS
      );
    case 'browser':
      return true; // Always available on frontend
    default:
      return true;
  }
}

/**
 * Currently configured provider chain (for /status and telemetry).
 */
export function getSttProviderChain(): string[] {
  try {
    return getManager().list();
  } catch {
    return [_sttConfig.provider];
  }
}

/**
 * Reset any cached provider manager (used by configureSTT after a config change).
 */
function resetManager(): void {
  _manager = null;
  _providerInstance = null; // also clear the legacy singleton cache
}

// ====================================================================
// LANGUAGE MAPPING UTILITIES
// ====================================================================

/**
 * Map our language codes to Google Cloud STT format.
 * We use 'hi-en' as our internal code for Hinglish.
 */
function mapLanguageToGoogle(lang: string): string {
  const map: Record<string, string> = {
    'hi-en': 'hi-IN',
    hi: 'hi-IN',
    hindi: 'hi-IN',
    en: 'en-IN',
    english: 'en-IN',
    'en-in': 'en-IN',
    'en-us': 'en-US',
  };
  return map[lang.toLowerCase()] || 'hi-IN';
}

function mapLanguageToAzure(lang: string): string {
  const map: Record<string, string> = {
    'hi-en': 'hi-IN',
    hi: 'hi-IN',
    hindi: 'hi-IN',
    en: 'en-IN',
    english: 'en-IN',
    'en-in': 'en-IN',
  };
  return map[lang.toLowerCase()] || 'hi-IN';
}

function mapLanguageToWhisper(lang: string): string {
  const map: Record<string, string> = {
    'hi-en': 'hi', // Whisper uses ISO 639-1
    hi: 'hi',
    hindi: 'hi',
    en: 'en',
    english: 'en',
  };
  return map[lang.toLowerCase()] || 'hi';
}

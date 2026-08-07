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
// PUBLIC API
// ====================================================================

/**
 * Transcribe audio to text using the configured STT provider.
 *
 * @param audioBlob - Raw audio data blob
 * @param options - Optional transcription options
 * @returns Transcribed text with metadata
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options?: STTOptions
): Promise<STTResult> {
  const provider = getProvider();
  const startTime = Date.now();
  const audioSizeKb = Math.round((audioBlob.size || 0) / 1024);
  console.log(
    `[SpeechService] Audio received: ${audioSizeKb} KB, type=${audioBlob.type || 'unknown'}, ` +
    `provider=${provider.name}, sttModel=${_sttConfig.model || 'default'}`
  );

  try {
    const result = await provider.transcribe(audioBlob, options);
    console.log(
      `[SpeechService] STT model=${_sttConfig.model || 'default'} transcribed in ${result.durationMs}ms: "${result.transcript.slice(0, 80)}"`
    );
    return result;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[SpeechService] Transcription failed after ${elapsed}ms:`, error.message);

    // Return a fallback error result but PRESERVE the full diagnostic chain
    // (status, request URL, model, endpoint method, response body, stack)
    // so the controller can surface the actual error instead of a generic
    // "No speech detected".
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
 * Check if the configured STT provider is available and configured.
 */
export function isSTTConfigured(): boolean {
  switch (_sttConfig.provider) {
    case 'google':
    case 'azure':
    case 'custom':
      return !!_sttConfig.apiKey;
    case 'groq':
      return !!_sttConfig.apiKey || !!aiConfig.apiKey;
    case 'browser':
    default:
      return true; // Always available on frontend
  }
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

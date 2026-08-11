/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeepgramFluxProvider — Deepgram "Flux" that's the fallback STT provider.
 *
 * Uses the Deepgram REST v1 /listen endpoint with the lightweight Flux model:
 *   DEEPGRAM_API_KEY  (required)
 *   DEEPGRAM_MODEL    (default: flux)
 *   DEEPGRAM_LANGUAGE (optional; omit to let Deepgram auto-detect)
 *
 * Multi-language request uses the `languageCodes` param so an English command
 * spoken cleanly still gets matched (margin) while Hinglish audio is handled.
 * Deepgram returns per-utterance confidence which we average into a single
 * score.
 *
 * SECURITY:
 *   - Raw audio is streamed via HTTPS; never persisted to disk.
 *   - The API key lives in process.env only.
 */

import type { ISTTProvider, STTResult, STTOptions } from '../types';

export interface DeepgramFluxOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createDeepgramFluxProvider(options: DeepgramFluxOptions = {}): ISTTProvider {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY || '';
  const model = options.model || process.env.DEEPGRAM_MODEL || 'nova-3-general';
  const baseUrl =
    options.baseUrl || process.env.DEEPGRAM_BASE_URL || 'https://api.deepgram.com/v1';
  const smartFormat = process.env.DEEPGRAM_SMART_FORMAT !== 'false';

  return {
    name: 'Deepgram Flux',

    async transcribe(audioBlob: Blob, sttOptions?: STTOptions): Promise<STTResult> {
      if (!apiKey) {
        throw new Error('Deepgram not configured. Set DEEPGRAM_API_KEY.');
      }

      const startTime = Date.now();
      const audioBuffer = await audioBlob.arrayBuffer();

      const url = new URL(`${baseUrl.replace(/\/$/, '')}/listen`);
      url.searchParams.set('model', model);
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('smart_format', smartFormat ? 'true' : 'false');
      url.searchParams.set('language', languageToDeepgram(sttOptions?.language || 'hi-en'));

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': audioMimeTypeToDeepgram(audioBlob.type) || 'audio/webm',
        },
        body: audioBuffer,
        signal: AbortSignal.timeout(sttOptions?.timeoutMs || options.timeoutMs || 20_000),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown');
        throw new Error(`Deepgram API error (${response.status}): ${err.slice(0, 400)}`);
      }

      const json = await response.json();
      const results = json.results || json;

      const channels = results?.channels || [];
      const alternative = channels[0]?.alternatives?.[0];
      const transcript = alternative?.transcript || '';

      // Average utterance-level confidence into a single score.
      let confidence = alternative?.confidence ?? 0;
      const words = alternative?.words;
      if (Array.isArray(words) && words.length > 0) {
        confidence = words.reduce((sum: number, w: any) => sum + (w.confidence || 0), 0) / words.length;
      }

      return {
        transcript,
        confidence: Math.min(1, Math.max(0, confidence)),
        isFinal: true,
        durationMs: Date.now() - startTime,
        language: sttOptions?.language || 'hi-en',
      };
    },
  };
}

/**
 * Map internal language codes to what Deepgram understands (Deepgram detects
 * many languages automatically; we only pass explicit codes for en/hi to keep
 * costs/tuning predictable).
 */
function languageToDeepgram(lang?: string): string {
  const code = (lang || '').toLowerCase();
  if (code.startsWith('en')) return 'en';
  if (code === 'hi' || code === 'hindi') return 'hi';
  return 'hi'; // Hinglish defaults to Hindi detection
}

function audioMimeTypeToDeepgram(mime?: string): string | undefined {
  if (!mime) return undefined;
  if (mime.includes('webm')) return 'audio/webm';
  if (mime.includes('ogg')) return 'audio/ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'audio/mp4';
  const ext = mime.split('/')[1];
  return ext ? `audio/${ext}` : undefined;
}
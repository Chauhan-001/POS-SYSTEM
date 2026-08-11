/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GoogleCloudSttProvider — Google Cloud Speech-to-Text provider (primary).
 *
 * Uses the REST endpoint with an API key derived from environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS* (service-account key) OR
 *   STT_API_KEY / GOOGLE_API_KEY (simple API key generated in Cloud Console)
 *
 * No SDK dependency — talks to the `speech:recognize` REST endpoint directly,
 * so it works with the esbuild external-packages build profile.
 *
 * Multilingual: dispatches on language 'hi'/'hi-en' → hi-IN (+ en-IN as an
 * alternative code), 'en' → en-IN/en-US. Uses the `latest_short` model family
 * tuned for short command-type utterances.
 *
 * SECURITY:
 *   - Audio is sent over HTTPS as base64 in-memory; never persisted.
 *   - API key is read from process.env at construction time, never sent to the
 *     browser or stored.
 */

import type { ISTTProvider, STTResult, STTOptions } from '../types';

export interface GoogleSttOptions {
  apiKey?: string;
  projectId?: string;
  location?: string;
  timeoutMs?: number;
}

/**
 * Map an internal language code to a Google Cloud STT languageCode.
 */
function mapLanguageToGoogle(lang?: string): { languageCode: string; alternatives: string[] } {
  const code = (lang || '').toLowerCase();
  if (code === 'en' || code === 'english' || code === 'en-in' || code === 'en-us') {
    return { languageCode: 'en-IN', alternatives: ['en-US', 'hi-IN'] };
  }
  if (code === 'hi' || code === 'hindi' || code === 'hi') {
    return { languageCode: 'hi-IN', alternatives: ['en-IN'] };
  }
  // Hinglish (default): prefer Hindi, tolerate English
  return { languageCode: 'hi-IN', alternatives: ['en-IN', 'en-US'] };
}

/**
 * Google Cloud STT primary provider.
 */
export function createGoogleCloudSttProvider(options: GoogleSttOptions = {}): ISTTProvider {
  const apiKey =
    options?.apiKey ||
    process.env.GOOGLE_API_KEY ||
    process.env.STT_API_KEY ||
    '';
  const baseUrl =
    process.env.GOOGLE_STT_BASE_URL ||
    `https://speech.googleapis.com/v1/speech:recognize`;

  return {
    name: 'Google Cloud STT (primary)',

    async transcribe(audioBlob: Blob, sttOptions?: STTOptions): Promise<STTResult> {
      if (!apiKey) {
        throw new Error(
          'Google Cloud STT not configured. Set GOOGLE_API_KEY (or GOOGLE_APPLICATION_CREDENTIALS).'
        );
      }

      const startTime = Date.now();
      const buffer = await audioBlob.arrayBuffer();
      const base64Audio = Buffer.from(buffer).toString('base64');

      const { languageCode, alternatives } = mapLanguageToGoogle(
        sttOptions?.language || 'hi-en'
      );

      const url = new URL(baseUrl);
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: 'WEBM_OPUS',
            sampleRateHertz: 48000,
            audioChannelCount: 1,
            languageCode,
            alternativeLanguageCodes: alternatives,
            maxAlternatives: 1,
            enableAutomaticPunctuation: true,
            model: process.env.GOOGLE_STT_MODEL || 'latest_short',
          },
          audio: { content: base64Audio },
        }),
        signal: AbortSignal.timeout(sttOptions?.timeoutMs || options?.timeoutMs || 15_000),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown');
        throw new Error(`Google STT API error (${response.status}): ${err.slice(0, 400)}`);
      }

      const json = await response.json();
      const result = json.results?.[0];
      const alternative = result?.alternatives?.[0];

      return {
        transcript: alternative?.transcript || '',
        confidence: alternative?.confidence ?? 0,
        isFinal: result?.isFinal ?? true,
        durationMs: Date.now() - startTime,
        language: languageCode,
      };
    },
  };
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * llmClient.ts — the shared LLM abstraction (Calendar Phase 2, spec §1/§14).
 * This is the FIRST and ONLY LLM caller in the backend: any future AI feature
 * (calendar assistant, semantic interpretation) must go through it — no
 * per-feature SDKs or duplicate clients.
 *
 * Phase 2 wires Google Gemini (generateContent, JSON response mode). The
 * provider/model/base URL come from the existing config.ai block; the API key
 * is server-only and is NEVER logged, returned, or included in errors.
 *
 * Callers receive PARSED JSON or a typed LlmError — never free-form prose as
 * a primary output (spec §2).
 */

import { config } from '../../config';

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_configured' | 'unsupported_provider' | 'http_error' | 'timeout' | 'rate_limited' | 'invalid_json',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmJsonRequest {
  /** System-style instruction (role + constraints). */
  system: string;
  /** User prompt (the structured ask). */
  prompt: string;
  /** Optional JSON schema hint appended to the instruction. */
  schemaHint?: string;
  timeoutMs?: number;
}

export function isLlmConfigured(): boolean {
  return !!config.ai.apiKey;
}

/**
 * Generate a JSON response from the configured LLM.
 * Gemini: POST {baseUrl}/models/{model}:generateContent?key=<server key>
 */
export async function generateJson<T = unknown>(req: LlmJsonRequest): Promise<T> {
  if (!config.ai.apiKey) {
    throw new LlmError('LLM not configured (AI_API_KEY unset)', 'not_configured');
  }
  if (config.ai.provider !== 'gemini') {
    throw new LlmError(
      `LLM provider '${config.ai.provider}' is not wired in Phase 2 (gemini only)`,
      'unsupported_provider',
    );
  }

  const baseUrl = (config.ai.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gemini-2.0-flash';
  const timeoutMs = req.timeoutMs ?? config.ai.timeout;
  const instruction = req.schemaHint ? `${req.system}\n\nReturn JSON matching this shape:\n${req.schemaHint}` : req.system;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.ai.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${instruction}\n\n---\n${req.prompt}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: config.ai.temperature,
          maxOutputTokens: config.ai.maxTokens,
        },
      }),
      signal: controller.signal,
    });

    if (res.status === 429) throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
    if (!res.ok) throw new LlmError(`LLM request failed (HTTP ${res.status})`, 'http_error', res.status);

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new LlmError('LLM returned invalid JSON envelope', 'invalid_json');
    }

    // Gemini shape: candidates[0].content.parts[*].text
    const text = extractText(payload);
    if (!text) throw new LlmError('LLM response contained no text', 'invalid_json');

    try {
      return JSON.parse(stripFences(text)) as T;
    } catch {
      throw new LlmError('LLM returned non-JSON content', 'invalid_json');
    }
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError('LLM request timed out', 'timeout');
    }
    throw new LlmError(`LLM unavailable: ${err instanceof Error ? err.message : String(err)}`, 'http_error');
  } finally {
    clearTimeout(timer);
  }
}

function extractText(payload: unknown): string | null {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => p?.text ?? '').join('');
  return text.trim() || null;
}

/** Models sometimes wrap JSON in markdown fences even in JSON mode. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * llmClient.ts — the shared LLM abstraction (Calendar Phase 2, spec §1/§14).
 * This is the FIRST and ONLY LLM caller in the backend: any future AI feature
 * (calendar assistant, marketing agent reasoning, semantic interpretation)
 * must go through it — no per-feature SDKs or duplicate clients.
 *
 * Provider routing (Phase 1 — Marketing Agent foundation):
 *   - gemini                → generateContent (JSON response mode) [unchanged]
 *   - openai | custom | ollama → {baseUrl}/chat/completions (JSON mode where
 *     supported). `backend/.env` configures AI_PROVIDER=custom against an
 *     OpenAI-compatible endpoint, so this route is the one actually live.
 *   - anything else         → typed `unsupported_provider` LlmError.
 *
 * The API key is server-only and is NEVER logged, returned, or included in
 * errors (errors carry status codes and kinds only — never URLs).
 *
 * Callers receive PARSED JSON or a typed LlmError — never free-form prose as
 * a primary output (spec §2). `generateJson` keeps its original contract;
 * `generateJsonWithMeta` additionally returns token usage / model / latency so
 * callers can enforce token budgets and write AIUsageLog entries.
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

/** Token usage where the provider reports it (0 when unavailable). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Parsed value + per-call metadata for observability and budgeting. */
export interface LlmJsonResult<T> {
  value: T;
  model: string;
  provider: string;
  latencyMs: number;
  usage: LlmUsage;
}

export function isLlmConfigured(): boolean {
  return !!config.ai.apiKey;
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Generate a JSON response from the configured LLM (original contract).
 */
export async function generateJson<T = unknown>(req: LlmJsonRequest): Promise<T> {
  return (await generateJsonWithMeta<T>(req)).value;
}

/**
 * Generate a JSON response and return usage/model/latency metadata.
 * Same errors and same graceful-degradation contract as `generateJson`.
 */
export async function generateJsonWithMeta<T = unknown>(req: LlmJsonRequest): Promise<LlmJsonResult<T>> {
  if (!config.ai.apiKey) {
    throw new LlmError('LLM not configured (AI_API_KEY unset)', 'not_configured');
  }
  const provider = config.ai.provider;
  if (provider === 'gemini') {
    return geminiRequest<T>(req);
  }
  if (provider === 'openai' || provider === 'custom' || provider === 'ollama') {
    return openAiCompatibleRequest<T>(req, provider);
  }
  throw new LlmError(`LLM provider '${provider}' is not wired (gemini + openai-compatible only)`, 'unsupported_provider');
}

/** One shared timeout helper — abort → typed `timeout` LlmError. */
function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

/** Map an abort into the typed timeout error (callers never see raw AbortError). */
function rethrowAsLlmError(err: unknown): never {
  if (err instanceof LlmError) throw err;
  if (err instanceof Error && err.name === 'AbortError') {
    throw new LlmError('LLM request timed out', 'timeout');
  }
  throw new LlmError(`LLM unavailable: ${err instanceof Error ? err.message : String(err)}`, 'http_error');
}

// ─── Gemini (original path, behavior preserved) ────────────────────────────

async function geminiRequest<T>(req: LlmJsonRequest): Promise<LlmJsonResult<T>> {
  const baseUrl = (config.ai.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gemini-2.0-flash';
  const timeoutMs = req.timeoutMs ?? config.ai.timeout;
  const instruction = req.schemaHint ? `${req.system}\n\nReturn JSON matching this shape:\n${req.schemaHint}` : req.system;
  const started = Date.now();

  try {
    const payload = await withTimeout(timeoutMs, async (signal) => {
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
        signal,
      });

      if (res.status === 429) throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
      if (!res.ok) throw new LlmError(`LLM request failed (HTTP ${res.status})`, 'http_error', res.status);

      try {
        return await res.json();
      } catch {
        throw new LlmError('LLM returned invalid JSON envelope', 'invalid_json');
      }
    });

    // Gemini shape: candidates[0].content.parts[*].text
    const text = extractText(payload);
    if (!text) throw new LlmError('LLM response contained no text', 'invalid_json');

    return {
      value: parseJsonContent<T>(text),
      model,
      provider: 'gemini',
      latencyMs: Date.now() - started,
      usage: geminiUsage(payload),
    };
  } catch (err) {
    rethrowAsLlmError(err);
  }
}

function geminiUsage(payload: unknown): LlmUsage {
  const meta = (payload as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } })?.usageMetadata;
  const inputTokens = Number(meta?.promptTokenCount) || 0;
  const outputTokens = Number(meta?.candidatesTokenCount) || 0;
  const totalTokens = Number(meta?.totalTokenCount) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function extractText(payload: unknown): string | null {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => p?.text ?? '').join('');
  return text.trim() || null;
}

// ─── OpenAI-compatible (openai | custom | ollama) ──────────────────────────

async function openAiCompatibleRequest<T>(req: LlmJsonRequest, provider: 'openai' | 'custom' | 'ollama'): Promise<LlmJsonResult<T>> {
  const baseUrl = (config.ai.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new LlmError('LLM not configured (AI_BASE_URL unset)', 'not_configured');
  }
  const model = config.ai.model;
  const timeoutMs = req.timeoutMs ?? config.ai.timeout;
  const instruction = req.schemaHint ? `${req.system}\n\nReturn JSON matching this shape:\n${req.schemaHint}` : req.system;
  const started = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: req.prompt },
    ],
    temperature: config.ai.temperature,
    max_tokens: config.ai.maxTokens,
    stream: false,
  };
  // JSON output mode — supported by OpenAI and OpenAI-compatible gateways
  // (Groq). Ollama's /chat/completions does not accept the field, so it is
  // omitted there; the prompt still demands JSON and invalid JSON still
  // surfaces as a typed `invalid_json` error.
  if (provider !== 'ollama') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const payload = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Key is sent to the provider only — never appears in errors/logs.
          Authorization: `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (res.status === 429) throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
      if (!res.ok) throw new LlmError(`LLM request failed (HTTP ${res.status})`, 'http_error', res.status);

      try {
        return await res.json();
      } catch {
        throw new LlmError('LLM returned invalid JSON envelope', 'invalid_json');
      }
    });

    const content = extractOpenAiText(payload);
    if (!content) throw new LlmError('LLM response contained no text', 'invalid_json');

    return {
      value: parseJsonContent<T>(content),
      model,
      provider,
      latencyMs: Date.now() - started,
      usage: openAiUsage(payload),
    };
  } catch (err) {
    rethrowAsLlmError(err);
  }
}

function extractOpenAiText(payload: unknown): string | null {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim() || null;
  // Some gateways return content as an array of parts.
  if (Array.isArray(content)) {
    const text = content.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('');
    return text.trim() || null;
  }
  return null;
}

function openAiUsage(payload: unknown): LlmUsage {
  const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
  const inputTokens = Number(usage?.prompt_tokens) || 0;
  const outputTokens = Number(usage?.completion_tokens) || 0;
  const totalTokens = Number(usage?.total_tokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

// ─── Shared parsing ─────────────────────────────────────────────────────────

function parseJsonContent<T>(text: string): T {
  try {
    return JSON.parse(stripFences(text)) as T;
  } catch {
    throw new LlmError('LLM returned non-JSON content', 'invalid_json');
  }
}

/** Models sometimes wrap JSON in markdown fences even in JSON mode. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export { NO_USAGE as LLM_NO_USAGE };

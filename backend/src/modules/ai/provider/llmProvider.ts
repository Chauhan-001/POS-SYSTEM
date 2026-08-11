/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LLM Provider — Abstraction layer over multiple LLM providers.
 * Currently supports OpenAI, Anthropic, and Ollama.
 * All providers return structured JSON via the `complete()` method.
 *
 * KEY CHAIN: when AI_API_KEY_FALLBACK is configured, calls automatically
 * retry with the fallback key when the primary fails. On HTTP 429 (rate
 * limit / quota exhausted) the exhausted key is parked for a short cooldown
 * so the chain cycles between keys instead of hammering one quota.
 *
 * SECURITY: This module NEVER receives database credentials or secrets.
 * It only processes text prompts and returns text responses.
 */

import { aiConfig } from '../config';
import type { LLMConfig, LLMMessage, LLMResponse } from '../types';
import { CircuitBreaker } from '../../../utils/CircuitBreaker';
import { getFallbackAiData } from './fallbacks';
import { recordQuotaSnapshot, recordTokensUsed, setKeyParked } from '../services/aiQuotaTracker';

/** Quota metadata for a provider call — used by the admin quota tracker. */
interface QuotaMeta {
  model: string;
  baseUrl: string;
}

// ─── Key-chain rotation state ───────────────────────────────────────
// Tracks the next key to try (round-robin) and temporarily parks keys that
// returned HTTP 429 so a quota-exhausted key is retried only as a last
// resort. Parking is keyed by the actual key string so it stays correct even
// when callers build different chain shapes (e.g. explicit options.apiKey).
const KEY_COOLDOWN_MS = 60_000;
let rotationIndex = 0;
const parkedUntil: Record<string, number> = {}; // key -> epoch ms when reusable

/**
 * Order the chain so healthy (non-parked) keys are tried FIRST (round-robin)
 * and 429-parked keys are pushed to the END — only attempted when no healthy
 * key is left. This avoids burning a 429 round-trip on every request while a
 * key is cooling down.
 */
function healthyKeyOrder(keys: string[]): number[] {
  const now = Date.now();
  const healthy: number[] = [];
  const parked: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const parkedKey = keys[(rotationIndex + i) % keys.length];
    if (!parkedUntil[parkedKey] || parkedUntil[parkedKey] <= now) healthy.push((rotationIndex + i) % keys.length);
    else parked.push((rotationIndex + i) % keys.length);
  }
  rotationIndex = (rotationIndex + 1) % keys.length;
  return healthy.length > 0 ? healthy : parked;
}

function parkKey(key: string): void {
  parkedUntil[key] = Date.now() + KEY_COOLDOWN_MS;
}

/** Returns the HTTP status of the thrown error when it's a provider HTTP error. */
function httpStatusOf(err: unknown): number | null {
  if (err instanceof Error && /API error \((\d+)\)/.test(err.message)) {
    const m = err.message.match(/\((\d+)\)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// ─── AI Circuit Breaker ────────────────────────────────────────────
// Protects against cascading failures from external LLM APIs.
// If the AI provider is down or slow, fast-fails with algorithmic fallback.
const aiCircuitBreaker = new CircuitBreaker({
  name: 'AI-LLM',
  failureThreshold: 3,        // Trip after 3 consecutive failures
  cooldownMs: 30_000,         // Try again after 30 seconds
  timeoutMs: 15_000,          // 15 seconds max per LLM call
  maxConcurrency: 5,          // Max 5 concurrent LLM requests
});

/**
 * Call the configured LLM provider with the given messages.
 *
 * The whole key-chain attempt runs inside the circuit breaker: a success on
 * ANY key counts as success (breaker stays closed); only when every key in
 * the chain fails does the breaker count a failure and — once tripped —
 * serve the degraded fallback content instead of hammering the provider.
 */
export async function complete(
  messages: LLMMessage[],
  options?: Partial<LLMConfig>,
): Promise<LLMResponse> {
  const config: LLMConfig = {
    provider: options?.provider || aiConfig.provider,
    apiKey: options?.apiKey || aiConfig.apiKey,
    model: options?.model || aiConfig.model,
    baseUrl: options?.baseUrl || aiConfig.baseUrl,
    timeout: options?.timeout || aiConfig.timeout,
    maxTokens: options?.maxTokens || aiConfig.maxTokens,
    temperature: options?.temperature ?? aiConfig.temperature,
  };

  // Key chain: an explicit options.apiKey (STT/voice) is tried FIRST, then the
  // configured keys rotate behind it as fallbacks; otherwise just the chain.
  const configuredKeys = aiConfig.apiKeys.length > 0 ? aiConfig.apiKeys : [config.apiKey];
  const chain = options?.apiKey ? [options.apiKey, ...configuredKeys] : configuredKeys;
  const attempts = healthyKeyOrder(chain);
  console.log(`[LLM] Calling provider=${config.provider}, model=${config.model} (${attempts.length} key${attempts.length > 1 ? 's' : ''} in chain)`);

  const result = await aiCircuitBreaker.execute<LLMResponse>(
    async () => {
      let lastError: unknown = null;
      for (const keyIdx of attempts) {
        const attemptConfig: LLMConfig = { ...config, apiKey: chain[keyIdx] };
        const startTime = Date.now();
        try {
          switch (config.provider) {
            case 'openai':
              return await callOpenAI(messages, attemptConfig, startTime);
            case 'anthropic':
              return await callAnthropic(messages, attemptConfig, startTime);
            case 'ollama':
              return await callOllama(messages, attemptConfig, startTime);
            case 'custom':
              return await callCustom(messages, attemptConfig, startTime);
            default:
              throw new Error(`Unknown AI provider: ${config.provider}`);
          }
        } catch (err) {
          lastError = err;
          const status = httpStatusOf(err);
          if (status === 429) {
            // Quota/rate limit — park this key so the chain cycles to another.
            console.warn(`[LLM] Key ${keyIdx + 1}/${chain.length} rate-limited (429) — parking for ${KEY_COOLDOWN_MS / 1000}s, trying next key`);
            parkKey(chain[keyIdx]);
            setKeyParked(chain[keyIdx], true, quotaMetaOf(attemptConfig));
          } else if (attempts.length === 1) {
            // Single-key setups keep the historical behavior: throw immediately.
            throw err;
          } else {
            // Non-429 failure (network, 5xx, auth): fall through to the next key.
            console.warn(`[LLM] Key ${keyIdx + 1}/${chain.length} failed (${status ?? 'unknown'}) — trying next key`);
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error('All LLM API keys failed');
    },
    () => ({
      content: getFallbackAiData(),
      latency: 0,
      model: config.model,
      usage: undefined,
    }),
  );

  return result.data;
}

// ─── OPENAI ────────────────────────────────────────────────────────

/** Quota metadata helper (shares the URL-safe base for the tracker). */
function quotaMetaOf(config: LLMConfig): QuotaMeta {
  return {
    model: config.model,
    baseUrl: config.baseUrl || 'https://api.openai.com/v1',
  };
}

async function callOpenAI(
  messages: LLMMessage[],
  config: LLMConfig,
  startTime: number,
): Promise<LLMResponse> {
  const response = await fetch(
    `${config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
      signal: AbortSignal.timeout(config.timeout),
    },
  );

  // Feed the quota tracker from every provider response that carries
  // rate-limit headers (successful or 429) — powers the admin quota section.
  recordQuotaSnapshot(config.apiKey, response.headers, {
    ...quotaMetaOf(config),
    success: response.ok,
    status: response.status,
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  const latency = Date.now() - startTime;

  const totalTokens = json.usage?.total_tokens ?? 0;
  recordTokensUsed(config.apiKey, totalTokens, quotaMetaOf(config));

  return {
    content: json.choices[0]?.message?.content || '',
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens,
        }
      : undefined,
    latency,
    model: json.model || config.model,
  };
}

// ─── ANTHROPIC ─────────────────────────────────────────────────────

async function callAnthropic(
  messages: LLMMessage[],
  config: LLMConfig,
  startTime: number,
): Promise<LLMResponse> {
  // Convert to Anthropic's message format
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const msgs = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user' as const,
    content: m.content,
  }));

  const response = await fetch(
    `${config.baseUrl || 'https://api.anthropic.com/v1'}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        system: systemMsg,
        messages: msgs,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
      signal: AbortSignal.timeout(config.timeout),
    },
  );

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  const latency = Date.now() - startTime;

  return {
    content: json.content?.[0]?.text || '',
    usage: json.usage
      ? { promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens, totalTokens: json.usage.input_tokens + json.usage.output_tokens }
      : undefined,
    latency,
    model: json.model || config.model,
  };
}

// ─── OLLAMA ─────────────────────────────────────────────────────────

async function callOllama(
  messages: LLMMessage[],
  config: LLMConfig,
  startTime: number,
): Promise<LLMResponse> {
  const response = await fetch(
    `${config.baseUrl || 'http://localhost:11434'}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        options: {
          num_predict: config.maxTokens,
          temperature: config.temperature,
        },
        stream: false,
      }),
      signal: AbortSignal.timeout(config.timeout),
    },
  );

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  const latency = Date.now() - startTime;

  return {
    content: json.message?.content || '',
    latency,
    model: json.model || config.model,
  };
}

// ─── CUSTOM (OpenAI-compatible) ────────────────────────────────────

async function callCustom(
  messages: LLMMessage[],
  config: LLMConfig,
  startTime: number,
): Promise<LLMResponse> {
  // Assumes OpenAI-compatible API (e.g., Azure, Together, Groq)
  return callOpenAI(messages, config, startTime);
}

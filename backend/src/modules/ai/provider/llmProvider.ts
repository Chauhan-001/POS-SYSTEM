/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LLM Provider — Abstraction layer over multiple LLM providers.
 * Currently supports OpenAI, Anthropic, and Ollama.
 * All providers return structured JSON via the `complete()` method.
 *
 * SECURITY: This module NEVER receives database credentials or secrets.
 * It only processes text prompts and returns text responses.
 */

import { aiConfig } from '../config';
import type { LLMConfig, LLMMessage, LLMResponse } from '../types';
import { CircuitBreaker } from '../../../utils/CircuitBreaker';
import { getFallbackAiData } from './fallbacks';

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
 * Wrapped in a circuit breaker with timeout, concurrency limit, and fallback.
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

  console.log(`[LLM] Calling provider=${config.provider}, model=${config.model}`);

  const result = await aiCircuitBreaker.execute<LLMResponse>(
    async () => {
      const startTime = Date.now();
      switch (config.provider) {
        case 'openai':
          return callOpenAI(messages, config, startTime);
        case 'anthropic':
          return callAnthropic(messages, config, startTime);
        case 'ollama':
          return callOllama(messages, config, startTime);
        case 'custom':
          return callCustom(messages, config, startTime);
        default:
          throw new Error(`Unknown AI provider: ${config.provider}`);
      }
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

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  const latency = Date.now() - startTime;

  return {
    content: json.choices[0]?.message?.content || '',
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
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

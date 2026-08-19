/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Config — AI-specific environment configuration.
 * All values read from process.env with safe defaults where possible.
 *
 * Required in production:
 *   AI_PROVIDER  — 'openai' | 'anthropic' | 'ollama'
 *   AI_API_KEY   — API key for the LLM provider
 *
 * Optional:
 *   AI_MODEL       — Model name (default varies by provider)
 *   AI_BASE_URL    — Custom base URL (for self-hosted / Ollama)
 *   AI_TIMEOUT     — LLM request timeout in ms (default: 15000)
 *   AI_MAX_TOKENS  — Max tokens per response (default: 1024)
 *   AI_TEMPERATURE — LLM temperature (default: 0.3)
 *   WEATHER_API_KEY — API key for weather data (default: demo mode)
 *
 * The AI module NEVER has access to:
 *   - MongoDB credentials
 *   - JWT secrets
 *   - Employee passwords/PINs
 *   - Customer payment data
 *   - Authentication tables
 */

import { config as appConfig } from '../../config';

export const aiConfig = {
  /** LLM provider: 'openai' | 'anthropic' | 'ollama' | 'custom' */
  provider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic' | 'ollama' | 'custom',

  /** Primary API key for the LLM provider */
  apiKey: process.env.AI_API_KEY || '',

  /**
   * Ordered chain of API keys tried in sequence by the LLM provider.
   * The primary key is always first; fallback keys (extra Groq/OpenAI-compatible
   * accounts) are tried next when the primary fails — including on 429 rate
   * limits, which also park the exhausted key briefly so the chain cycles
   * instead of hammering one quota.
   *
   * Fallbacks come from either:
   *   - AI_API_KEY_FALLBACKS (comma-separated list, recommended), OR
   *   - AI_API_KEY_FALLBACK (legacy single fallback, still honoured)
   */
  apiKeys: Array.from(new Set([
    process.env.AI_API_KEY || '',
    ...(process.env.AI_API_KEY_FALLBACKS || '').split(',').map((s) => s.trim()).filter(Boolean),
    process.env.AI_API_KEY_FALLBACK || '',
  ].filter(Boolean))),

  /** Model identifier — default: GPT-OSS 20B via Groq */
  model: process.env.AI_MODEL || (() => {
    switch (process.env.AI_PROVIDER) {
      case 'anthropic': return 'claude-3-haiku-20240307';
      case 'ollama': return 'llama3.2';
      default: return 'openai/gpt-oss-20b';
    }
  })(),

  /**
   * High-reasoning model for complex tasks (restaurant strategy, multi-factor
   * analysis, etc.). Set via AI_REASONING_MODEL env var. Only used when
   * callers explicitly opt into complex reasoning via `options.model`.
   * Falls back to the primary model when unset.
   */
  reasoningModel: process.env.AI_REASONING_MODEL || 'openai/gpt-oss-120b',

  /** Custom base URL (for Ollama or proxy) */
  baseUrl: process.env.AI_BASE_URL || '',

  /** Request timeout in ms */
  timeout: parseInt(process.env.AI_TIMEOUT || '15000', 10),

  /** Max tokens per response */
  maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1024', 10),

  /** LLM temperature */
  temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),

  /** Weather API key (optional, demo mode if not set) */
  weatherApiKey: process.env.WEATHER_API_KEY || '',
};

/** Whether the AI module has a valid API key configured */
export function isAiEnabled(): boolean {
  return aiConfig.apiKeys.length > 0;
}

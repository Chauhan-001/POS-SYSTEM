/**
 * =============================================================================
 *  aiCostConfig.ts — AI Model Pricing Configuration (Phase 2.7)
 * =============================================================================
 *
 * Purpose:
 *   Defines per-model and per-provider pricing for AI cost calculations.
 *   All costs are calculated from actual token usage and these configured rates.
 *   No hardcoded values in analytics logic - prices are looked up here.
 *
 * Pricing Sources (as of Phase 2.7):
 *   - OpenAI: https://openai.com/pricing
 *   - Anthropic: https://anthropic.com/pricing
 *   - Ollama: self-hosted (approximate cost based on equivalent API pricing or $0)
 *
 * Extending:
 *   Add new models to the PRICING map with input/output cost per 1K tokens.
 */

export interface ModelPricing {
  /** Cost per 1,000 input tokens (USD) */
  inputPer1K: number;
  /** Cost per 1,000 output tokens (USD) */
  outputPer1K: number;
  /** Human-readable label for display */
  label: string;
  /** Provider name */
  provider: string;
}

/**
 * AI model pricing lookup table.
 * Keyed by model string as it appears in AIUsageLog.
 * Falls back to provider-level defaults if model not found.
 */
const PRICING: Record<string, ModelPricing> = {
  // ─── OpenAI Models ────────────────────────────────────────────
  'gpt-4o-mini': {
    inputPer1K: 0.00015,
    outputPer1K: 0.0006,
    label: 'GPT-4o Mini',
    provider: 'openai',
  },
  'gpt-4o': {
    inputPer1K: 0.0025,
    outputPer1K: 0.01,
    label: 'GPT-4o',
    provider: 'openai',
  },
  'gpt-4-turbo': {
    inputPer1K: 0.01,
    outputPer1K: 0.03,
    label: 'GPT-4 Turbo',
    provider: 'openai',
  },
  'gpt-4': {
    inputPer1K: 0.03,
    outputPer1K: 0.06,
    label: 'GPT-4',
    provider: 'openai',
  },
  'gpt-3.5-turbo': {
    inputPer1K: 0.0005,
    outputPer1K: 0.0015,
    label: 'GPT-3.5 Turbo',
    provider: 'openai',
  },

  // ─── Anthropic Models ─────────────────────────────────────────
  'claude-3-haiku-20240307': {
    inputPer1K: 0.00025,
    outputPer1K: 0.00125,
    label: 'Claude 3 Haiku',
    provider: 'anthropic',
  },
  'claude-3-sonnet-20240229': {
    inputPer1K: 0.003,
    outputPer1K: 0.015,
    label: 'Claude 3 Sonnet',
    provider: 'anthropic',
  },
  'claude-3-opus-20240229': {
    inputPer1K: 0.015,
    outputPer1K: 0.075,
    label: 'Claude 3 Opus',
    provider: 'anthropic',
  },
  'claude-3-5-haiku-20241022': {
    inputPer1K: 0.0008,
    outputPer1K: 0.004,
    label: 'Claude 3.5 Haiku',
    provider: 'anthropic',
  },
  'claude-3-5-sonnet-20241022': {
    inputPer1K: 0.003,
    outputPer1K: 0.015,
    label: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
  },

  // ─── Groq / GPT-OSS Models (OpenAI-compatible endpoint) ─────
  'openai/gpt-oss-20b': {
    inputPer1K: 0.0001,
    outputPer1K: 0.0004,
    label: 'GPT-OSS 20B (Groq)',
    provider: 'openai',
  },
  'openai/gpt-oss-120b': {
    inputPer1K: 0.0008,
    outputPer1K: 0.0032,
    label: 'GPT-OSS 120B (Groq)',
    provider: 'openai',
  },

  // ─── Ollama Models (self-hosted) ──────────────────────────────
  'llama3.2': {
    inputPer1K: 0,
    outputPer1K: 0,
    label: 'Llama 3.2 (Local)',
    provider: 'ollama',
  },
  'llama3.1': {
    inputPer1K: 0,
    outputPer1K: 0,
    label: 'Llama 3.1 (Local)',
    provider: 'ollama',
  },
  'mistral': {
    inputPer1K: 0,
    outputPer1K: 0,
    label: 'Mistral (Local)',
    provider: 'ollama',
  },

  // ─── Default per-provider fallbacks ───────────────────────────
  '__default_openai__': {
    inputPer1K: 0.001,
    outputPer1K: 0.002,
    label: 'OpenAI',
    provider: 'openai',
  },
  '__default_anthropic__': {
    inputPer1K: 0.003,
    outputPer1K: 0.015,
    label: 'Anthropic',
    provider: 'anthropic',
  },
  '__default_ollama__': {
    inputPer1K: 0,
    outputPer1K: 0,
    label: 'Ollama (Local)',
    provider: 'ollama',
  },
  '__default_custom__': {
    inputPer1K: 0.001,
    outputPer1K: 0.002,
    label: 'Custom Provider',
    provider: 'custom',
  },
};

/**
 * Get pricing for a specific model string.
 * Falls back to provider-level default if model not found.
 */
export function getModelPricing(model: string, provider?: string): ModelPricing {
  if (PRICING[model]) {
    return PRICING[model];
  }

  // Fallback by provider
  const providerKey = provider ? `__default_${provider.toLowerCase()}__` : null;
  if (providerKey && PRICING[providerKey]) {
    return PRICING[providerKey];
  }

  // Final fallback
  return PRICING['__default_openai__'];
}

/**
 * Calculate cost from token usage.
 * Returns cost in USD.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
  provider?: string
): number {
  const pricing = getModelPricing(model, provider);
  const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
  const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
  return parseFloat((inputCost + outputCost).toFixed(8));
}

/**
 * Get a human-readable label for a model string.
 */
export function getModelLabel(model: string): string {
  return PRICING[model]?.label || model;
}

/**
 * Get all known providers.
 */
export function getKnownProviders(): string[] {
  const providers = new Set<string>();
  for (const key of Object.keys(PRICING)) {
    if (!key.startsWith('__default__')) {
      providers.add(PRICING[key].provider);
    }
  }
  return Array.from(providers);
}

/**
 * Get all known models.
 */
export function getKnownModels(): ModelPricing[] {
  return Object.entries(PRICING)
    .filter(([key]) => !key.startsWith('__default__'))
    .map(([key, val]) => ({ ...val, model: key } as ModelPricing & { model: string }));
}

export default PRICING;
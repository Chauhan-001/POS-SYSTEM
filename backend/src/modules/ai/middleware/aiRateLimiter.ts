/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Rate Limiter — Stricter rate limits for AI endpoints.
 * AI calls are expensive (LLM API costs + latency), so we protect them
 * with tighter limits than regular API routes.
 *
 * Environment variable: RL_AI_MAX — max requests per window (default: 30)
 * Environment variable: RL_AI_WINDOW_MS — window in ms (default: 1 minute)
 */

import rateLimit from 'express-rate-limit';

const windowMs = parseInt(process.env.RL_AI_WINDOW_MS || (60 * 1000).toString(), 10);
const max = parseInt(process.env.RL_AI_MAX || '30', 10);

export const aiRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many AI requests. Please wait before making another request.',
  },
});

/**
 * Stricter limiter for voice parsing (can be abused with many short requests).
 */
export const voiceRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many voice requests. Please wait.',
  },
});

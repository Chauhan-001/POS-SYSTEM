/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingService.ts — LAYER: CORE (AI execution removed in Phase 3).
 *
 * Deterministic marketing plan + copy generation:
 *   - generateMarketingPlan: deterministic offerEngine plan + template copy
 *   - generateOfferCopy: tone/language-aware deterministic copy templates
 *
 * Same public API as the previous LLM-backed implementation, so the existing
 * controllers keep working unchanged. FUTURE AI INTEGRATION POINT: a future
 * AI layer may re-add LLM narrative generation on top — the deterministic
 * plan/copy below is and remains the source of truth.
 */

import type {
  MarketingRequestInput,
  OfferCopyInput,
} from './marketingCore';
import {
  buildMarketingContext,
  buildRuleBasedPlan,
  buildFallbackCopy,
} from './marketingCore';

export {
  buildMarketingContext,
  buildRuleBasedPlan,
  buildFallbackCopy,
} from './marketingCore';
export type { MarketingPlan } from './marketingCore';

/**
 * Generate a marketing plan for the restaurant. Fully deterministic:
 * the offer engine proposes the offer; copy templates render the messages.
 */
export async function generateMarketingPlan(
  restaurantId: string,
  input: MarketingRequestInput
): Promise<import('./marketingCore').MarketingPlan> {
  const ctx = await buildMarketingContext(restaurantId);
  return buildRuleBasedPlan(restaurantId, ctx, input);
}

/**
 * Generate customer-facing copy for an offer. Deterministic templates that
 * honour tone + language (same shape the LLM previously produced).
 */
export function generateOfferCopy(
  restaurantId: string,
  input: OfferCopyInput
): ReturnType<typeof buildFallbackCopy> {
  void restaurantId;
  return buildFallbackCopy(input);
}

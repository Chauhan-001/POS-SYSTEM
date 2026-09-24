/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * costIntelligenceService — LAYER: CORE (AI execution removed in Phase 3).
 *
 * Thin deterministic facade over costIntelligenceCore: metrics, margin
 * deterioration and owner-facing insights are ALL deterministic — computed
 * from real business data (recipes, purchases, sales, wastage). No LLM.
 *
 * FUTURE AI INTEGRATION POINT: a future AI layer may re-add an LLM narrative
 * over `costIntelligenceCore.deterministicInsights()` — the deterministic
 * bundle below is and remains the source of truth.
 */

import { costIntelligenceCore } from './costIntelligenceCore';

class CostIntelligenceService {
  /** Deterministic metrics bundle — delegated to the AI-free core. */
  async metrics(restaurantId: string, opts: { days?: number; branchId?: string } = {}) {
    return costIntelligenceCore.metrics(restaurantId, opts);
  }

  /** Deterministic margin-deterioration analysis — delegated to the core. */
  async marginDeterioration(
    restaurantId: string,
    opts: { days?: number; branchId?: string; minRiserPct?: number; minRecipeCostImpactPct?: number; maxProducts?: number } = {}
  ) {
    return costIntelligenceCore.marginDeterioration(restaurantId, opts);
  }

  /**
   * Owner-facing insights — fully deterministic (Phase 3). Previously the
   * bundle was narrated by an LLM with these deterministic insights as the
   * fallback; the deterministic list is now the only output, so the UI can
   * never show fabricated figures.
   */
  async insights(restaurantId: string, opts: { days?: number; branchId?: string } = {}) {
    const m = await costIntelligenceCore.metrics(restaurantId, opts);
    const deterministic = costIntelligenceCore.deterministicInsights(m);
    return { insights: deterministic, focus: 'mixed' as const, deterministic, aiGenerated: false };
  }
}

export const costIntelligenceService = new CostIntelligenceService();

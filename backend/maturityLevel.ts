/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MaturityLevel — Internal restaurant intelligence maturity state.
 *
 * Do not expose this as a gimmicky score.
 * Use it internally to determine which features should be active.
 *
 * LEVEL 1: Basic - Bare minimum data, rule-based recommendations
 * LEVEL 2: Data-aware - Some sales data, basic margin awareness
 * LEVEL 3: Predictive - Forecasts active, trend detection
 * LEVEL 4: Optimized - Promotion optimization active
 * LEVEL 5: Learning - Outcome learning active
 * LEVEL 6: Controlled automation - Policy-constrained automation
 */

export type MaturityLevel = 
  | 'level_1_basic'
  | 'level_2_data_aware'
  | 'level_3_predictive'
  | 'level_4_optimized'
  | 'level_5_learning'
  | 'level_6_controlled_automation';

/**
 * Maturity level descriptions
 */
export const MATURITY_LEVEL_DESCRIPTIONS: Record<MaturityLevel, string> = {
  level_1_basic: 'Basic - Bare minimum data, rule-based recommendations. Only basic basket analysis and rule-based offers active.',
  level_2_data_aware: 'Data-aware - Some sales data available, basic margin awareness. Recipe completeness affects confidence. Basic inventory tracking active.',
  level_3_predictive: 'Predictive - Demand forecasts active (7-day trends, seasonality). Trend detection for products. Promotion fatigue detection begins.',
  level_4_optimized: 'Optimized - Promotion optimization active (bounded discount search, constraint validation). AOV-increasing recommendations active. Combo opportunities detected.',
  level_5_learning: 'Learning - Outcome learning active (weekly cycle). Strategy profiles built. Fatigue detection active. Recommendations improve over time.',
  level_6_controlled_automation: 'Controlled automation - Policy-constrained automation active. Owner-approved strategies can auto-execute. Kill switches active. Full pipeline operational.',
};

/**
 * Feature gating by maturity level
 */
export const MATURITY_FEATURE_GATE: Record<MaturityLevel, string[]> = {
  level_1_basic: [
    'basic_offer_recommendations',
    'rule_based_promotions',
    'simple_inventory_tracking',
  ],
  level_2_data_aware: [
    ...(MATURITY_FEATURE_GATE.level_1_basic || []),
    'recipe_completeness_awareness',
    'basic_margin_warnings',
    'surplus_inventory_detection',
  ],
  level_3_predictive: [
    ...(MATURITY_FEATURE_GATE.level_2_data_aware || []),
    'demand_forecasts',
    'trend_detection',
    'seasonal_intelligence',
    'promotion_fatigue_detection',
  ],
  level_4_optimized: [
    ...(MATURITY_FEATURE_GATE.level_3_predictive || []),
    'promotion_optimization',
    'combo_opportunities',
    'AOV_increasing_recommendations',
    'price_advisory',
  ],
  level_5_learning: [
    ...(MATURITY_FEATURE_GATE.level_4_optimized || []),
    'weekly_learning_cycle',
    'strategy_profiles',
    'fatigue_detection',
    'recommendation_learning',
  ],
  level_6_controlled_automation: [
    ...(MATURITY_FEATURE_GATE.level_5_learning || []),
    'policy_constrained_automation',
    'kill_switches',
    'automated_campaign_execution',
    'full_intelligence_pipeline',
  ],
};

/**
 * Get features active for a maturity level
 */
export function getActiveFeatures(
  level: MaturityLevel
): string[] {
  return MATURITY_FEATURE_GATE[level] || [];
}

/**
 * Check if a feature is active at a given maturity level
 */
export function isFeatureActive(
  level: MaturityLevel,
  feature: string
): boolean {
  const activeFeatures = getActiveFeatures(level);
  return activeFeatures.includes(feature);
}

/**
 * Get maturity level from data quality and feature availability
 */
export function determineMaturityLevel(
  dataQuality: 'Excellent' | 'Good' | 'Limited' | 'Poor',
  featuresActive: string[]
): MaturityLevel {
  // Simple heuristic based on data quality and feature activation
  if (dataQuality === 'Poor') {
    return 'level_1_basic';
  }
  if (dataQuality === 'Limited') {
    return 'level_2_data_aware';
  }
  if (dataQuality === 'Good') {
    // Check if predictive features are active
    const hasPredictive = featuresActive.some(
      (f) => f.includes('forecast') || f.includes('trend') || f.includes('seasonal')
    );
    if (hasPredictive) {
      return 'level_3_predictive';
    }
    return 'level_2_data_aware';
  }
  // dataQuality === 'Excellent'
  // Check if optimization features are active
  const hasOptimization = featuresActive.some(
    (f) => f.includes('optimization') || f.includes('combo') || f.includes('AOV')
  );
  if (hasOptimization) {
    return 'level_4_optimized';
  }

  // Check if learning features are active
  const hasLearning = featuresActive.some(
    (f) => f.includes('learning') || f.includes('fatigue') || f.includes('profile')
  );
  if (hasLearning) {
    return 'level_5_learning';
  }

  return 'level_6_controlled_automation';
}
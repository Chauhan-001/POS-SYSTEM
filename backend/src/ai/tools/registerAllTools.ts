/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * registerAllTools.ts — Bootstrap for the shared tool registry (spec §5).
 * Every tool category registers exactly once, here. Agents never register
 * tools; their policies only reference names.
 */

import { toolRegistry } from './registry/toolRegistry';
import { registerSalesTools } from './sales/salesTools';
import { getInventoryStatusToolDefinition } from './inventory/getInventoryStatusTool';
import { getExpiryRiskToolDefinition } from './inventory/getExpiryRiskTool';
import { getWastageToolDefinition } from './inventory/getWastageTool';
import { getStockoutRiskToolDefinition } from './inventory/getStockoutRiskTool';
import { getCustomerSegmentsToolDefinition, getRetentionSignalsToolDefinition } from './customers/customerTools';
import { getMenuPerformanceToolDefinition } from './products/menuPerformanceTool';
import { getProductMarginsToolDefinition } from './products/getProductMarginsTool';
import { getProductCombinationsToolDefinition } from './products/getProductCombinationsTool';
import {
  getActiveOffersToolDefinition,
  getOfferPerformanceToolDefinition,
  getCampaignPerformanceToolDefinition,
} from './marketing/marketingTools';
import { getPromotionCandidatesToolDefinition } from './marketing/getPromotionCandidatesTool';
import { getRestaurantProfileToolDefinition, getBranchesToolDefinition } from './restaurant/restaurantTools';
import { getFestivalContextToolDefinition, getWeatherContextToolDefinition } from './context/contextTools';
import { getSportsContextToolDefinition } from './context/getSportsContextTool';
import { getNearbyCompetitionToolDefinition } from './context/getNearbyCompetitionTool';
import { getDemandForecastToolDefinition } from './ml/getDemandForecastTool';
import { getMarketBasketSignalsToolDefinition } from './ml/getMarketBasketSignalsTool';
import { getMLCustomerSegmentsToolDefinition } from './ml/getMLCustomerSegmentsTool';
import { getUpliftSignalsToolDefinition } from './ml/getUpliftSignalsTool';
import { getOfferResponsePredictionToolDefinition } from './ml/getOfferResponsePredictionTool';
import { getOfferResponseBatchScoresToolDefinition } from './ml/getOfferResponseBatchScoresTool';

function registerIfAbsent(definition: unknown): void {
  const tool = definition as { name: string };
  if (!toolRegistry.has(tool.name)) {
    toolRegistry.register(tool);
  }
}

let registered = false;

/** Idempotent — safe to call from multiple entry points. */
export function registerAllTools(): void {
  if (registered) return;

  registerSalesTools();

  registerIfAbsent(getInventoryStatusToolDefinition);
  registerIfAbsent(getExpiryRiskToolDefinition);
  registerIfAbsent(getWastageToolDefinition);
  registerIfAbsent(getStockoutRiskToolDefinition);

  registerIfAbsent(getCustomerSegmentsToolDefinition);
  registerIfAbsent(getRetentionSignalsToolDefinition);

  registerIfAbsent(getMenuPerformanceToolDefinition);
  registerIfAbsent(getProductMarginsToolDefinition);
  registerIfAbsent(getProductCombinationsToolDefinition);

  registerIfAbsent(getActiveOffersToolDefinition);
  registerIfAbsent(getOfferPerformanceToolDefinition);
  registerIfAbsent(getCampaignPerformanceToolDefinition);
  registerIfAbsent(getPromotionCandidatesToolDefinition);

  registerIfAbsent(getRestaurantProfileToolDefinition);
  registerIfAbsent(getBranchesToolDefinition);

  registerIfAbsent(getFestivalContextToolDefinition);
  registerIfAbsent(getWeatherContextToolDefinition);
  registerIfAbsent(getSportsContextToolDefinition);
  registerIfAbsent(getNearbyCompetitionToolDefinition);

  registerIfAbsent(getDemandForecastToolDefinition);
  registerIfAbsent(getMarketBasketSignalsToolDefinition);
  registerIfAbsent(getMLCustomerSegmentsToolDefinition);
  registerIfAbsent(getUpliftSignalsToolDefinition);
  registerIfAbsent(getOfferResponsePredictionToolDefinition);
  registerIfAbsent(getOfferResponseBatchScoresToolDefinition);

  registered = true;
}

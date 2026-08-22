/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IntelligenceScheduler — Scheduled jobs for signal generation and recommendation refresh
 */

import { CronJob } from 'cron';
import mongoose from 'mongoose';
import RestaurantModel from '../models/Restaurant';
import BranchModel from '../models/Branch';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

import {
  detectAllDemandAnomalies,
  persistAnomaliesAsSignals,
} from '../services/demandAnomalyService';
import {
  getProductAffinities,
  persistBasketAnalysisAsSignals,
} from '../services/basketAnalysisService';
import {
  detectComboOpportunities,
  persistComboOpportunitiesAsSignals,
} from '../services/comboOpportunityService';
import {
  detectAddOnOpportunities,
  persistAddOnOpportunitiesAsSignals,
} from '../services/addOnOpportunityService';
import {
  analyzeMenuEngineering,
  persistMenuEngineeringAsSignals,
} from '../services/menuEngineeringService';
import {
  generatePromotionCandidates,
  persistPromotionCandidatesAsSignals,
} from '../services/promotionCandidateService';
import {
  detectInventoryOpportunities,
  persistInventoryOpportunitiesAsSignals,
} from '../services/inventoryOpportunityService';
import {
  detectCustomerOpportunities,
  persistCustomerOpportunitiesAsSignals,
  CustomerOpportunityOptions,
} from '../services/customerOpportunityService';
import {
  generatePromotionCandidates,
  persistPromotionCandidatesAsSignals,
} from '../services/promotionCandidateService';
import {
  detectInventoryOpportunities,
  persistInventoryOpportunitiesAsSignals,
} from '../services/inventoryOpportunityService';
import {
  detectCustomerOpportunities,
  persistCustomerOpportunitiesAsSignals,
  CustomerOpportunityOptions,
} from '../services/customerOpportunityService';
import {
  detectMarginSignals,
  persistMarginSignals,
} from '../services/marginSignalsService';
import { reEvaluateCooldowns, expireOldRecommendations } from '../services/recommendationCandidateService';

interface SchedulerOptions {
  /** Run signal generation every N hours (default 6) */
  signalGenerationIntervalHours?: number;
  /** Run recommendation generation every N hours (default 12) */
  recommendationGenerationIntervalHours?: number;
  /** Run maintenance (cooldown re-eval, expiry) every N hours (default 24) */
  maintenanceIntervalHours?: number;
  /** Only process restaurants with this plan feature */
  requiredPlanFeature?: string;
}

const DEFAULT_SIGNAL_INTERVAL = 6;
const DEFAULT_RECOMMENDATION_INTERVAL = 12;
const DEFAULT_MAINTENANCE_INTERVAL = 24;

let signalJob: CronJob | null = null;
let recommendationJob: CronJob | null = null;
let maintenanceJob: CronJob | null = null;
let isRunning = false;

/**
 * Get active restaurants eligible for intelligence processing
 */
async function getEligibleRestaurants(requiredPlanFeature?: string): Promise<Array<{ _id: string; branchIds: string[] }>> {
  const filter: any = { isDeleted: { $ne: true }, status: 'active' };

  if (requiredPlanFeature) {
    filter.subscriptionFeatures = requiredPlanFeature;
  }

  const restaurants = await RestaurantModel.find(filter)
    .select('_id')
    .lean()
    .exec();

  // Get branch IDs for each restaurant
  const restaurantIds = restaurants.map(r => String(r._id));
  const branches = await BranchModel.find({
    restaurantId: { $in: restaurantIds.map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id restaurantId')
    .lean()
    .exec();

  const branchMap = new Map<string, string[]>();
  for (const b of branches) {
    const rid = String(b.restaurantId);
    if (!branchMap.has(rid)) branchMap.set(rid, []);
    branchMap.get(rid)!.push(String(b._id));
  }

  return restaurants.map(r => ({
    _id: String(r._id),
    branchIds: branchMap.get(String(r._id)) || [],
  }));
}

/**
 * Process signals for a single restaurant (and optionally its branches)
 */
async function processRestaurantSignals(restaurantId: string, branchIds: string[]): Promise<void> {
  console.log(`[IntelligenceScheduler] Processing signals for restaurant ${restaurantId}`);

  // Process tenant-level signals
  try {
    const [
      anomalies,
      affinities,
      comboOpps,
      addOnOpps,
      menuItems,
      marginSignals,
      inventoryOpps,
      customerOpps,
    ] = await Promise.all([
      detectAllDemandAnomalies({ restaurantId, lookbackDays: 90 }),
      getProductAffinities({ restaurantId, lookbackDays: 90 }),
      detectComboOpportunities({ restaurantId, lookbackDays: 90 }),
      detectAddOnOpportunities({ restaurantId, lookbackDays: 90 }),
      analyzeMenuEngineering({ restaurantId, lookbackDays: 90 }),
      detectMarginSignals({ restaurantId, lookbackDays: 90 }),
      detectInventoryOpportunities({ restaurantId, lookbackDays: 90 }),
      detectCustomerOpportunities({ restaurantId, lookbackDays: 90 }),
    ]);

    await Promise.all([
      persistAnomaliesAsSignals(restaurantId, undefined, anomalies),
      persistBasketAnalysisAsSignals(restaurantId, undefined, affinities),
      persistComboOpportunitiesAsSignals(restaurantId, undefined, comboOpps),
      persistAddOnOpportunitiesAsSignals(restaurantId, undefined, addOnOpps),
      persistMenuEngineeringAsSignals(restaurantId, undefined, menuItems),
      persistMarginSignals(restaurantId, undefined, marginSignals),
      persistInventoryOpportunitiesAsSignals(restaurantId, undefined, inventoryOpps),
      persistCustomerOpportunitiesAsSignals(restaurantId, undefined, customerOpps),
    ]);

    console.log(`[IntelligenceScheduler] Tenant signals persisted for ${restaurantId}: ${anomalies.length} anomalies, ${affinities.length} affinities, ${comboOpps.length} combos, ${addOnOpps.length} addons, ${menuItems.length} menu items, ${marginSignals.length} margin signals, ${inventoryOpps.length} inventory opps, ${customerOpps.length} customer opps`);
  } catch (error) {
    console.error(`[IntelligenceScheduler] Error processing tenant signals for ${restaurantId}:`, error);
  }

  // Process branch-level signals if multi-branch
  for (const branchId of branchIds) {
    try {
      const [
        anomalies,
        affinities,
        comboOpps,
        addOnOpps,
        menuItems,
        marginSignals,
        inventoryOpps,
        customerOpps,
      ] = await Promise.all([
detectAllDemandAnomalies({ restaurantId, branchId, lookbackDays: 90 }),
        getProductAffinities({ restaurantId, branchId, lookbackDays: 90 }),
        detectComboOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
        detectAddOnOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
        analyzeMenuEngineering({ restaurantId, branchId, lookbackDays: 90 }),
        detectMarginSignals({ restaurantId, branchId, lookbackDays: 90 }),
        detectInventoryOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
detectCustomerOpportunities({ restaurantId, branchId, lookbackDays: 90 } as CustomerOpportunityOptions),
      ]);

      await Promise.all([
        persistAnomaliesAsSignals(restaurantId, branchId, anomalies),
        persistBasketAnalysisAsSignals(restaurantId, branchId, affinities),
        persistComboOpportunitiesAsSignals(restaurantId, branchId, comboOpps),
        persistAddOnOpportunitiesAsSignals(restaurantId, branchId, addOnOpps),
        persistMenuEngineeringAsSignals(restaurantId, branchId, menuItems),
        persistMarginSignals(restaurantId, branchId, marginSignals),
        persistInventoryOpportunitiesAsSignals(restaurantId, branchId, inventoryOpps),
        persistCustomerOpportunitiesAsSignals(restaurantId, branchId, customerOpps),
      ]);

      console.log(`[IntelligenceScheduler] Branch signals persisted for ${restaurantId}/${branchId}`);
    } catch (error) {
      console.error(`[IntelligenceScheduler] Error processing branch signals for ${restaurantId}/${branchId}:`, error);
    }
  }
}

/**
 * Generate recommendations for a single restaurant
 */
async function processRestaurantRecommendations(restaurantId: string, branchIds: string[]): Promise<void> {
  console.log(`[IntelligenceScheduler] Generating recommendations for restaurant ${restaurantId}`);

  try {
    // Tenant-level
    const candidates = await generatePromotionCandidates({
      restaurantId,
      lookbackDays: 90,
      minScore: 40,
      minConfidence: 0.4,
    });

    await persistPromotionCandidatesAsSignals(restaurantId, undefined, candidates);
    console.log(`[IntelligenceScheduler] Generated ${candidates.length} tenant recommendations for ${restaurantId}`);
  } catch (error) {
    console.error(`[IntelligenceScheduler] Error generating tenant recommendations for ${restaurantId}:`, error);
  }

  // Branch-level
  for (const branchId of branchIds) {
    try {
      const candidates = await generatePromotionCandidates({
        restaurantId,
        branchId,
        lookbackDays: 90,
        minScore: 40,
        minConfidence: 0.4,
      });

      await persistPromotionCandidatesAsSignals(restaurantId, branchId, candidates);
      console.log(`[IntelligenceScheduler] Generated ${candidates.length} branch recommendations for ${restaurantId}/${branchId}`);
    } catch (error) {
      console.error(`[IntelligenceScheduler] Error generating branch recommendations for ${restaurantId}/${branchId}:`, error);
    }
  }
}

/**
 * Run maintenance tasks
 */
async function runMaintenance(): Promise<void> {
  console.log('[IntelligenceScheduler] Running maintenance...');

  try {
    const restaurants = await getEligibleRestaurants();

    for (const { _id: restaurantId } of restaurants) {
      const [reevaluated, expired] = await Promise.all([
        reEvaluateCooldowns(restaurantId),
        expireOldRecommendations(restaurantId),
      ]);

      if (reevaluated > 0 || expired > 0) {
        console.log(`[IntelligenceScheduler] Maintenance for ${restaurantId}: ${reevaluated} reevaluated, ${expired} expired`);
      }
    }
  } catch (error) {
    console.error('[IntelligenceScheduler] Maintenance error:', error);
  }
}

/**
 * Main signal generation job
 */
async function runSignalGeneration(): Promise<void> {
  if (isRunning) {
    console.log('[IntelligenceScheduler] Signal generation already running, skipping');
    return;
  }

  isRunning = true;
  console.log('[IntelligenceScheduler] Starting signal generation...');

  try {
    const restaurants = await getEligibleRestaurants('intelligence');

    for (const { _id: restaurantId, branchIds } of restaurants) {
      await processRestaurantSignals(restaurantId, branchIds);
    }

    console.log('[IntelligenceScheduler] Signal generation complete');
  } catch (error) {
    console.error('[IntelligenceScheduler] Signal generation error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Main recommendation generation job
 */
async function runRecommendationGeneration(): Promise<void> {
  if (isRunning) {
    console.log('[IntelligenceScheduler] Recommendation generation already running, skipping');
    return;
  }

  isRunning = true;
  console.log('[IntelligenceScheduler] Starting recommendation generation...');

  try {
    const restaurants = await getEligibleRestaurants('intelligence');

    for (const { _id: restaurantId, branchIds } of restaurants) {
      await processRestaurantRecommendations(restaurantId, branchIds);
    }

    console.log('[IntelligenceScheduler] Recommendation generation complete');
  } catch (error) {
    console.error('[IntelligenceScheduler] Recommendation generation error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize and start all scheduled jobs
 */
export function startIntelligenceScheduler(options: SchedulerOptions = {}): void {
  const {
    signalGenerationIntervalHours = DEFAULT_SIGNAL_INTERVAL,
    recommendationGenerationIntervalHours = DEFAULT_RECOMMENDATION_INTERVAL,
    maintenanceIntervalHours = DEFAULT_MAINTENANCE_INTERVAL,
    requiredPlanFeature = 'intelligence',
  } = options;

  // Signal generation: every N hours at minute 0
  const signalCron = `0 */${signalGenerationIntervalHours} * * *`;
  signalJob = new CronJob(signalCron, runSignalGeneration, null, true, 'UTC');
  console.log(`[IntelligenceScheduler] Signal generation scheduled: ${signalCron}`);

  // Recommendation generation: every N hours at minute 30 (offset from signals)
  const recoCron = `30 */${recommendationGenerationIntervalHours} * * *`;
  recommendationJob = new CronJob(recoCron, runRecommendationGeneration, null, true, 'UTC');
  console.log(`[IntelligenceScheduler] Recommendation generation scheduled: ${recoCron}`);

  // Maintenance: daily at 3 AM
  const maintenanceCron = `0 ${maintenanceIntervalHours === 24 ? '3' : `*/${maintenanceIntervalHours}`} * * *`;
  maintenanceJob = new CronJob(maintenanceCron, runMaintenance, null, true, 'UTC');
  console.log(`[IntelligenceScheduler] Maintenance scheduled: ${maintenanceCron}`);

  // Also run once on startup (with delay to let DB connections settle)
  setTimeout(() => {
    runSignalGeneration();
    setTimeout(() => runRecommendationGeneration(), 60000);
    setTimeout(() => runMaintenance(), 120000);
  }, 30000);
}

/**
 * Stop all scheduled jobs
 */
export function stopIntelligenceScheduler(): void {
  if (signalJob) {
    signalJob.stop();
    signalJob = null;
  }
  if (recommendationJob) {
    recommendationJob.stop();
    recommendationJob = null;
  }
  if (maintenanceJob) {
    maintenanceJob.stop();
    maintenanceJob = null;
  }
  console.log('[IntelligenceScheduler] All jobs stopped');
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  signalJob: { running: boolean; nextRun: Date | null };
  recommendationJob: { running: boolean; nextRun: Date | null };
  maintenanceJob: { running: boolean; nextRun: Date | null };
} {
  return {
    running: isRunning,
    signalJob: {
      running: signalJob?.running || false,
      nextRun: signalJob?.nextDate()?.toJSDate() || null,
    },
    recommendationJob: {
      running: recommendationJob?.running || false,
      nextRun: recommendationJob?.nextDate()?.toJSDate() || null,
    },
    maintenanceJob: {
      running: maintenanceJob?.running || false,
      nextRun: maintenanceJob?.nextDate()?.toJSDate() || null,
    },
  };
}

/**
 * Manually trigger signal generation for a restaurant (for testing/debugging)
 */
export async function triggerSignalGeneration(restaurantId: string, branchId?: string): Promise<void> {
  if (branchId) {
    const [
      anomalies,
      affinities,
      comboOpps,
      addOnOpps,
      menuItems,
      marginSignals,
      inventoryOpps,
      customerOpps,
    ] = await Promise.all([
      detectAllDemandAnomalies({ restaurantId, branchId, lookbackDays: 90 }),
      getProductAffinities({ restaurantId, branchId, lookbackDays: 90 }),
      detectComboOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
      detectAddOnOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
      analyzeMenuEngineering({ restaurantId, branchId, lookbackDays: 90 }),
      detectMarginSignals({ restaurantId, branchId, lookbackDays: 90 }),
      detectInventoryOpportunities({ restaurantId, branchId, lookbackDays: 90 }),
      detectCustomerOpportunities({ restaurantId, branchId, lookbackDays: 90 } as CustomerOpportunityOptions),
    ]);

    await Promise.all([
      persistAnomaliesAsSignals(restaurantId, branchId, anomalies),
      persistBasketAnalysisAsSignals(restaurantId, branchId, affinities),
      persistComboOpportunitiesAsSignals(restaurantId, branchId, comboOpps),
      persistAddOnOpportunitiesAsSignals(restaurantId, branchId, addOnOpps),
      persistMenuEngineeringAsSignals(restaurantId, branchId, menuItems),
      persistMarginSignals(restaurantId, branchId, marginSignals),
      persistInventoryOpportunitiesAsSignals(restaurantId, branchId, inventoryOpps),
      persistCustomerOpportunitiesAsSignals(restaurantId, branchId, customerOpps),
    ]);
  } else {
    await processRestaurantSignals(restaurantId, []);
  }
}

/**
 * Manually trigger recommendation generation for a restaurant
 */
export async function triggerRecommendationGeneration(restaurantId: string, branchId?: string): Promise<void> {
  if (branchId) {
    const candidates = await generatePromotionCandidates({
      restaurantId,
      branchId,
      lookbackDays: 90,
    });
    await persistPromotionCandidatesAsSignals(restaurantId, branchId, candidates);
  } else {
    await processRestaurantRecommendations(restaurantId, []);
  }
}
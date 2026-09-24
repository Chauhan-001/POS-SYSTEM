/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advisory Service — LAYER: CORE (AI execution removed in Phase 3).
 *
 * Previously an LLM-orchestration layer over the deterministic engines; now
 * fully deterministic. All financial facts come from the deterministic
 * candidate/signal engines; priority/rank classification and what-if break-even
 * math live in advisorCore; customer-facing copy is template-based.
 *
 * FUTURE AI INTEGRATION POINT: a future AI layer may re-add narrative
 * enrichment on top of these functions. The deterministic results below are
 * and remain the source of truth — AI must never compute financial truth.
 */

import mongoose from 'mongoose';
import { generatePromotionCandidates, type PromotionCandidate } from './promotionCandidateService';
import { getRecommendations, type RecommendationCandidate } from './recommendationCandidateService';
import { analyzeMenuEngineering } from './menuEngineeringService';
import { detectMarginSignals } from './marginSignalsService';
import { detectInventoryOpportunities } from './inventoryOpportunityService';
import { detectCustomerOpportunities } from './customerOpportunityService';
import { detectAllDemandAnomalies } from './demandAnomalyService';
import { getProductAffinities } from './basketAnalysisService';
import { classifyPriority, PRIORITY_RANK, runWhatIfMath } from './advisorCore';
import type { WhatIfSimulationRequest } from './advisorCore';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// ============================================================================
// TYPES
// ============================================================================

export interface AIExplanation {
  why: string;
  impact: string;
  risk: string;
}

export interface EnrichedRecommendation {
  candidate: PromotionCandidate | RecommendationCandidate;
  aiExplanation?: AIExplanation;
  priority: 'act_now' | 'consider' | 'maintain' | 'monitor';
  rank: number;
}

export interface DailyAdvisorSummary {
  restaurantId: string;
  branchId?: string;
  date: string;
  topOpportunity?: EnrichedRecommendation;
  opportunities: EnrichedRecommendation[];
  insights: string[];
  alerts: Array<{ type: string; message: string; severity: 'info' | 'warning' | 'critical' }>;
}

export interface AdvisoryQuestionResponse {
  answer: string;
  relevantRecommendations: string[];
  actionable: boolean;
}

export interface CampaignCopyRequest {
  recommendationId: string;
  tone: 'friendly' | 'premium' | 'exciting' | 'simple' | 'festive';
  language: 'en' | 'hi' | 'hi-en';
}

export interface CampaignCopyResponse {
  title: string;
  description: string;
  whatsapp: string;
  sms: string;
  push: string;
  emailSubject: string;
  emailBody: string;
}

export type { WhatIfSimulationRequest } from './advisorCore';

export interface WhatIfSimulationResponse {
  current: {
    price: number;
    contribution: number;
    marginPercent: number;
    aov: number;
  };
  proposed: {
    price: number;
    contribution: number;
    marginPercent: number;
    aov: number;
  };
  incrementalUnitsRequired: number;
  incrementalRevenueRequired: number;
  breakEvenPercent: number;
  confidence: number;
  explanation: string;
  viable: boolean;
}

export interface AdvisoryChatRequest {
  message: string;
  restaurantId: string;
  branchId?: string;
  context?: {
    recentRecommendations?: string[];
    activePromotions?: string[];
  };
}

export interface AdvisoryChatResponse {
  answer: string;
  relevantRecommendations: EnrichedRecommendation[];
  suggestedActions: string[];
  dataSources: string[];
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Enrich deterministic candidates with priority classification.
 * Fully deterministic: priority/rank come from advisorCore. `aiExplanation`
 * is left undefined (kept optional for API-shape compatibility).
 */
export async function enrichRecommendationsWithAI(
  restaurantId: string,
  branchId: string | undefined,
  candidates: PromotionCandidate[],
  goal?: string
): Promise<EnrichedRecommendation[]> {
  void restaurantId;
  void branchId;
  void goal;
  if (candidates.length === 0) return [];

  return candidates.map((c, i) => ({
    candidate: c,
    priority: classifyPriority(c),
    rank: i + 1,
  }));
}

/**
 * Generate daily advisor summary — deterministic insights/alerts + ranked
 * deterministic candidates.
 */
export async function generateDailyAdvisorSummary(
  restaurantId: string,
  branchId: string | undefined,
  restaurantName: string
): Promise<DailyAdvisorSummary> {
  void restaurantName;

  // Gather all signals in parallel
  const [
    candidates,
    menuItems,
    marginSignals,
    inventoryOpps,
    customerOpps,
    demandAnomalies,
    affinities,
  ] = await Promise.all([
    generatePromotionCandidates({ restaurantId, branchId, minScore: 40, minConfidence: 0.4 }),
    analyzeMenuEngineering({ restaurantId, branchId }),
    detectMarginSignals({ restaurantId, branchId }),
    detectInventoryOpportunities({ restaurantId, branchId }),
    detectCustomerOpportunities({ restaurantId, branchId }),
    detectAllDemandAnomalies({ restaurantId, branchId }),
    getProductAffinities({ restaurantId, branchId }),
  ]);

  // Deterministic enrichment (priority/rank via advisorCore)
  const enriched = await enrichRecommendationsWithAI(restaurantId, branchId, candidates);

  // Build insights
  const insights: string[] = [];
  const alerts: Array<{ type: string; message: string; severity: 'info' | 'warning' | 'critical' }> = [];

  // Menu insights
  const stars = menuItems.filter(m => m.classification === 'STAR').length;
  const dogs = menuItems.filter(m => m.classification === 'DOG').length;
  if (stars > 0) insights.push(`${stars} STAR items driving revenue — protect them`);
  if (dogs > 0) insights.push(`${dogs} DOG items — consider removing or revamping`);

  // Margin alerts
  const highRiskMargin = marginSignals.filter(m => m.severity === 'high').length;
  if (highRiskMargin > 0) {
    alerts.push({ type: 'margin', message: `${highRiskMargin} items with critical margin risk`, severity: 'critical' });
  }

  // Inventory alerts
  const expiryRisk = inventoryOpps.filter(i => i.ingredient.opportunityType === 'EXPIRY_RISK' && i.ingredient.severity === 'high').length;
  if (expiryRisk > 0) {
    alerts.push({ type: 'inventory', message: `${expiryRisk} items at expiry risk`, severity: 'critical' });
  }

  // Demand anomalies
  const criticalAnomalies = demandAnomalies.filter(a => a.severity === 'high').length;
  if (criticalAnomalies > 0) {
    alerts.push({ type: 'demand', message: `${criticalAnomalies} critical demand anomalies detected`, severity: 'warning' });
  }

  // Customer insights
  const inactiveCustomers = customerOpps.find(c => c.opportunityType === 'INACTIVE');
  if (inactiveCustomers && inactiveCustomers.customerCount > 50) {
    insights.push(`${inactiveCustomers.customerCount} inactive customers — reactivation opportunity`);
  }

  // Top opportunity
  const topOpp = enriched[0];
  const opportunities = enriched.slice(0, 5);

  return {
    restaurantId,
    branchId,
    date: new Date().toISOString().split('T')[0],
    topOpportunity: topOpp,
    opportunities,
    insights,
    alerts,
  };
}

/**
 * Generate campaign copy for a recommendation — deterministic template copy.
 */
export async function generateCampaignCopy(
  restaurantId: string,
  branchId: string | undefined,
  candidate: PromotionCandidate,
  tone: 'friendly' | 'premium' | 'exciting' | 'simple' | 'festive' = 'friendly',
  language: 'en' | 'hi' | 'hi-en' = 'en'
): Promise<CampaignCopyResponse> {
  void restaurantId;
  void branchId;
  void tone;
  void language;

  const price = candidate.financialModel?.proposedPrice || candidate.financialModel?.currentPrice || 0;
  const discount = candidate.financialModel?.discountPercent || 0;

  return {
    title: candidate.title,
    description: candidate.description,
    whatsapp: `🎉 ${candidate.title}! ${candidate.description} Just ${fmtMoney(price)}. Tap to order!`,
    sms: `🎁 ${candidate.title}: ${candidate.description} - ${fmtMoney(price)}. Reply to order.`,
    push: `🎉 ${candidate.title} for ${fmtMoney(price)}!`,
    emailSubject: `Special: ${candidate.title}`,
    emailBody: `Hi! We're excited to offer you ${candidate.title}. ${candidate.description} Available for just ${fmtMoney(price)}. Visit us today!`,
  };
}

/**
 * Run what-if simulation — deterministic math from advisorCore with the
 * deterministic explanation.
 */
export async function runWhatIfSimulation(
  request: WhatIfSimulationRequest
): Promise<WhatIfSimulationResponse> {
  const { restaurantId, branchId, type, currentPrice, proposedPrice, discountPercent, productIds, categoryIds, segmentIds } = request;

  // Gather current economics from deterministic engine
  const candidates = await generatePromotionCandidates({
    restaurantId,
    branchId,
    minScore: 0,
    minConfidence: 0,
  });

  // Find relevant candidates (deterministic filters)
  let relevantCandidates = candidates;
  if (productIds?.length) {
    relevantCandidates = candidates.filter(c => c.target.productIds.some(pid => productIds!.includes(pid)));
  }
  if (categoryIds?.length) {
    relevantCandidates = candidates.filter(c => c.target.categoryIds.some(cid => categoryIds!.includes(cid)));
  }
  if (segmentIds?.length) {
    relevantCandidates = candidates.filter(c => c.target.segmentIds.some(sid => segmentIds!.includes(sid)));
  }

  // Get baseline AOV from the deterministic sales-baseline engine
  const { computeAllBaselines } = await import('./salesBaselineService');
  const baselines = await computeAllBaselines({ restaurantId, branchId, lookbackDays: 90 });
  const aov = baselines.aov.value;

  // Current combo economics come from the deterministic candidate engine
  const comboCandidate = relevantCandidates[0];
  const comboCurrent = comboCandidate
    ? {
        price: comboCandidate.financialModel?.currentPrice || 0,
        contribution: comboCandidate.financialModel?.currentContribution || 0,
        marginPercent: comboCandidate.financialModel?.projectedContributionMargin || 0,
      }
    : {};

  // Pure break-even math — AI-free core.
  const math = runWhatIfMath(
    { type, currentPrice, proposedPrice, discountPercent },
    { aov, current: comboCurrent }
  );

  return {
    current: math.current,
    proposed: math.proposed,
    incrementalUnitsRequired: math.incrementalUnitsRequired,
    incrementalRevenueRequired: math.incrementalRevenueRequired,
    breakEvenPercent: math.breakEvenPercent,
    confidence: math.confidence,
    explanation: math.explanation,
    viable: math.viable,
  };
}

/**
 * Natural language advisory question — deterministic answer built from the
 * real recommendation context (no LLM).
 */
export async function answerAdvisoryQuestion(
  request: AdvisoryChatRequest
): Promise<AdvisoryChatResponse> {
  const { message, restaurantId, branchId, context } = request;

  // Get current recommendations for context
  const candidates = await generatePromotionCandidates({
    restaurantId,
    branchId,
    minScore: 40,
    minConfidence: 0.4,
  });

  const enriched = await enrichRecommendationsWithAI(restaurantId, branchId, candidates);

  // Build insights from deterministic signals
  const [menuItems, marginSignals, inventoryOpps, customerOpps] = await Promise.all([
    analyzeMenuEngineering({ restaurantId, branchId }),
    detectMarginSignals({ restaurantId, branchId }),
    detectInventoryOpportunities({ restaurantId, branchId }),
    detectCustomerOpportunities({ restaurantId, branchId }),
  ]);

  const insights: string[] = [];
  const stars = menuItems.filter(m => m.classification === 'STAR').length;
  const puzzles = menuItems.filter(m => m.classification === 'PUZZLE').length;
  if (stars) insights.push(`${stars} STAR items driving revenue`);
  if (puzzles) insights.push(`${puzzles} PUZZLE items with high margin but low sales`);

  const highRiskMargin = marginSignals.filter(m => m.severity === 'high').length;
  if (highRiskMargin) insights.push(`${highRiskMargin} items with critical margin risk`);

  const expiryRisk = inventoryOpps.filter(i => i.ingredient.opportunityType === 'EXPIRY_RISK' && i.ingredient.severity === 'high').length;
  if (expiryRisk) insights.push(`${expiryRisk} items at expiry risk`);

  const inactiveCustomers = customerOpps.find(c => c.opportunityType === 'INACTIVE');
  if (inactiveCustomers && inactiveCustomers.customerCount > 50) {
    insights.push(`${inactiveCustomers.customerCount} inactive customers`);
  }

  const relevantRecommendations = enriched.slice(0, 3);

  return {
    answer: relevantRecommendations.length > 0
      ? `Top action right now: ${relevantRecommendations[0].candidate.title} — ${relevantRecommendations[0].candidate.description}`
      : `No recommendations match "${message}" yet. Insights: ${insights.slice(0, 2).join('; ') || 'none'}.`,
    relevantRecommendations,
    suggestedActions: ['View Recommendations'],
    dataSources: ['deterministic engine', 'sales baselines', 'inventory', 'customer data'],
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  fmtMoney,
  objectId,
  classifyPriority,
  PRIORITY_RANK,
};

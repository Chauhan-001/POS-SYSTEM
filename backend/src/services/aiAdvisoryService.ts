/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Advisory Service — Enriches deterministic recommendation candidates
 * with AI-generated explanations, prioritization, and owner-friendly copy.
 *
 * The AI NEVER computes financial truth. It only:
 * - Explains WHY a recommendation makes sense in owner-friendly language
 * - Summarizes evidence in plain English
 * - Generates marketing copy for promotions/campaigns
 * - Ranks already-valid candidates
 * - Answers natural-language advisory questions
 *
 * All financial facts, evidence, and constraints come from the deterministic engine.
 */

import mongoose from 'mongoose';
import { executeAiCall, type AiFeature } from '../modules/ai/services/aiService';
import { generatePromotionCandidates, type PromotionCandidate, type PromotionCandidateOptions } from './promotionCandidateService';
import { getRecommendations, type RecommendationCandidate } from './recommendationCandidateService';
import { analyzeMenuEngineering } from './menuEngineeringService';
import { detectMarginSignals } from './marginSignalsService';
import { detectInventoryOpportunities } from './inventoryOpportunityService';
import { detectCustomerOpportunities } from './customerOpportunityService';
import { detectAllDemandAnomalies } from './demandAnomalyService';
import { getProductAffinities } from './basketAnalysisService';

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

export interface WhatIfSimulationRequest {
  type: 'discount' | 'combo_price' | 'promotion_budget';
  currentPrice?: number;
  proposedPrice?: number;
  discountPercent?: number;
  productIds?: string[];
  categoryIds?: string[];
  segmentIds?: string[];
  restaurantId: string;
  branchId?: string;
}

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
// AI PROMPTS
// ============================================================================

function buildAdvisorExplanationPrompt(
  goal: string,
  candidates: Array<{
    index: number;
    title: string;
    type: string;
    why: string;
    evidence: string[];
    economics: any;
    expectedImpact: string;
    risk: string;
    score: number;
    confidence: number;
  }>
): string {
  const facts = candidates.map(c => ({
    index: c.index,
    title: c.title,
    type: c.type,
    why: c.why,
    evidence: c.evidence,
    economics: c.economics,
    expectedImpact: c.expectedImpact,
    risk: c.risk,
    score: c.score,
    confidence: c.confidence,
  }));

  return `You are a restaurant business advisor. Below are deterministic recommendations already computed from the restaurant's OWN data (real sales, real inventory, real margins, real offer performance). All numbers are authoritative — never change them, never invent new ones.

Goal: ${goal}

Recommendations:
${JSON.stringify(facts, null, 2)}

For each recommendation, return valid JSON ONLY: {"explanations":[{"index":0,"why":"...","impact":"...","risk":"..."}]}

Rules:
- Keep each field under 140 characters
- Owner-friendly, specific to the listed evidence
- Do not mention "data", "analysis", "algorithm", "model", or "system"
- Reference specific numbers from the evidence (e.g. "42% attachment rate", "₹148 contribution")
- Explain tradeoffs honestly
- Tone: professional advisor, concise, actionable`;
}

function buildDailyAdvisorPrompt(
  restaurantName: string,
  opportunities: Array<{
    title: string;
    type: string;
    why: string;
    evidence: string[];
    score: number;
    confidence: number;
    expectedImpact: string;
  }>,
  insights: string[],
  alerts: Array<{ type: string; message: string }>
): string {
  return `You are a restaurant business advisor creating a daily morning briefing for "${restaurantName}".

Here are the top opportunities identified from the restaurant's data:

${opportunities.map((o, i) => `${i + 1}. ${o.title} (${o.type})
Why: ${o.why}
Evidence: ${o.evidence.join('; ')}
Score: ${o.score}/100 | Confidence: ${Math.round(o.confidence * 100)}%
Impact: ${o.expectedImpact}`).join('\n\n')}

Additional insights:
${insights.map(i => `- ${i}`).join('\n')}

System alerts:
${alerts.map(a => `- ${a.type}: ${a.message}`).join('\n')}

Create a concise morning briefing with:
1. Top 3 actionable opportunities (title, why, impact)
2. 1-2 key insights
3. Any urgent alerts

Respond with valid JSON ONLY:
{
  "briefing": "2-3 sentences summarizing today's focus",
  "topOpportunities": [
    { "title": "...", "why": "...", "impact": "...", "actionLabel": "Create Combo", "priority": "high" }
  ],
  "insights": ["..."],
  "urgentAlerts": ["..."]
}

Rules:
- Be concise, owner-friendly, specific
- Use only the facts provided
- Do not invent numbers
- Priority: "act_now" | "consider" | "maintain" | "monitor"
- ActionLabel: short button text like "Create Combo", "Run Promotion", "Review Cost"`;
}

function buildCampaignCopyPrompt(
  candidate: {
    title: string;
    description: string;
    type: string;
    target: any;
    financialModel: any;
    evidence: string[];
    expectedImpact: string;
  },
  tone: string,
  language: string
): string {
  return `You are a restaurant marketing copywriter. Generate customer-facing promotional copy for a validated offer.

Offer Details:
- Title: ${candidate.title}
- Description: ${candidate.description}
- Type: ${candidate.type}
- Target Products: ${JSON.stringify(candidate.target.productNames)}
- Target Categories: ${JSON.stringify(candidate.target.categoryIds)}
- Target Segments: ${JSON.stringify(candidate.target.segmentIds)}
- Price: ${candidate.financialModel?.proposedPrice || candidate.financialModel?.price}
- Discount: ${candidate.financialModel?.discountPercent}%
- Evidence: ${candidate.evidence.join('; ')}
- Expected Impact: ${candidate.expectedImpact}

Tone: ${tone}
Language: ${language === 'en' ? 'English' : language === 'hi' ? 'Hindi' : 'Hinglish (mix of Hindi and English)'}

Generate valid JSON ONLY with EXACTLY these fields (strings only, no markdown, no extra fields):
{
  "title": "max 6 words, catchy",
  "description": "1-2 sentences, warm and inviting",
  "whatsapp": "max 200 chars, include emoji, call to action",
  "sms": "max 120 chars, include emoji",
  "push": "max 100 chars, include emoji",
  "emailSubject": "max 60 chars",
  "emailBody": "2-3 short sentences with clear call to action"
}

Rules:
- Use the EXACT price/discount from the offer details
- Do NOT invent numbers, products, or conditions
- Include an emoji in whatsapp/sms/push
- Language: ${language === 'en' ? 'English' : language === 'hi' ? 'Hindi' : 'Hinglish (mix of Hindi and English)'}
- Tone: ${tone}
- No placeholders like [name] or <name> - write complete copy`;
}

function buildWhatIfPrompt(
  simulation: {
    type: string;
    current: any;
    proposed: any;
    incrementalUnitsRequired: number;
    incrementalRevenueRequired: number;
    breakEvenPercent: number;
    confidence: number;
    viable: boolean;
  }
): string {
  return `You are a restaurant business advisor explaining a "what-if" simulation result.

Simulation: ${simulation.type}

Current Economics:
- Price: ${fmtMoney(simulation.current.price)}
- Contribution per unit: ${fmtMoney(simulation.current.contribution)}
- Margin: ${simulation.current.marginPercent}%
- AOV: ${fmtMoney(simulation.current.aov)}

Proposed Economics:
- Price: ${fmtMoney(simulation.proposed.price)}
- Contribution per unit: ${fmtMoney(simulation.proposed.contribution)}
- Margin: ${simulation.proposed.marginPercent}%
- AOV: ${fmtMoney(simulation.proposed.aov)}

Key Metrics:
- Incremental units required to break even: ${simulation.incrementalUnitsRequired}
- Incremental revenue needed: ${fmtMoney(simulation.incrementalRevenueRequired)}
- Break-even volume increase: ${simulation.breakEvenPercent}%
- Confidence: ${Math.round(simulation.confidence * 100)}%
- Viable: ${simulation.viable ? 'Yes' : 'No'}

Provide a clear, concise explanation (max 160 chars) of what this means for the owner.
Focus on: Is it viable? What's the risk? What volume increase is needed?

Respond with valid JSON ONLY:
{
  "explanation": "Your explanation here (max 160 chars)"
}`;
}

function buildNaturalLanguageAdvisorPrompt(
  question: string,
  context: {
    restaurantName: string;
    topRecommendations: Array<{ title: string; why: string; type: string; score: number; expectedImpact: string }>;
    activePromotions: string[];
    insights: string[];
  }
): string {
  return `You are a restaurant business advisor. The owner asks: "${question}"

Restaurant: ${context.restaurantName}

Current top recommendations from the system:
${context.topRecommendations.map((r, i) => `${i + 1}. ${r.title} (${r.type}) - ${r.why} | Impact: ${r.expectedImpact} | Score: ${r.score}/100`).join('\n')}

Active promotions:
${context.activePromotions.length ? context.activePromotions.map(p => `- ${p}`).join('\n') : '(none)'}

Key insights from data:
${context.insights.map(i => `- ${i}`).join('\n')}

Answer the owner's question as their business advisor.

Rules:
- Use ONLY the facts above. Do not invent numbers, customers, or sales.
- If the question cannot be answered from available data, say so and suggest what data would help.
- Be concise (max 200 chars), specific, actionable.
- Reference specific numbers from the recommendations when relevant.
- Tone: professional advisor, concise, honest about uncertainty.

Respond with valid JSON ONLY:
{
  "answer": "Your answer here (max 200 chars)",
  "relevantRecommendationIndices": [0, 1],
  "suggestedActions": ["Create Combo", "Run Promotion"],
  "dataSources": ["sales baselines", "basket analysis", "inventory"]
}`;
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Enrich deterministic candidates with AI explanations
 */
export async function enrichRecommendationsWithAI(
  restaurantId: string,
  branchId: string | undefined,
  candidates: PromotionCandidate[],
  goal?: string
): Promise<EnrichedRecommendation[]> {
  if (candidates.length === 0) return [];

  const facts = candidates.map((c, i) => ({
    index: i,
    title: c.title,
    type: c.type,
    why: c.description,
    evidence: c.evidence.map(e => e.description),
    economics: c.financialModel,
    expectedImpact: `Expected impact: ${c.financialModel.incrementalContribution > 0 ? `+${fmtMoney(c.financialModel.incrementalContribution)} contribution` : 'Review recommended'}`,
    risk: c.risks.join('; ') || 'No specific risks identified',
    score: c.score,
    confidence: c.confidence,
  }));

  const prompt = buildAdvisorExplanationPrompt(goal || 'general', facts);

  try {
    const res = await executeAiCall({
      prompt,
      feature: 'advisor',
      tenantId: restaurantId,
      branchId,
      cacheKeyVariant: `advisor:${goal || 'general'}:${candidates.map(c => c.title).join('|')}`,
    });

    const explanations = res?.data?.explanations || [];

    return candidates.map((c, i) => {
      const exp = explanations.find((e: any) => e.index === i);
      return {
        candidate: c,
        aiExplanation: exp ? {
          why: exp.why?.trim() || c.description,
          impact: exp.impact?.trim() || `Expected impact: ${c.financialModel.incrementalContribution > 0 ? `+${fmtMoney(c.financialModel.incrementalContribution)} contribution` : 'Review recommended'}`,
          risk: exp.risk?.trim() || c.risks.join('; ') || 'No specific risks identified',
        } : undefined,
        priority: classifyPriority(c),
        rank: i + 1,
      };
    });
  } catch {
    // Deterministic fallback
    return candidates.map((c, i) => ({
      candidate: c,
      priority: classifyPriority(c),
      rank: i + 1,
    }));
  }
}

/**
 * Classify recommendation priority
 */
function classifyPriority(c: PromotionCandidate): 'act_now' | 'consider' | 'maintain' | 'monitor' {
  // Act Now: high score, high confidence, urgent condition (inventory expiry, demand anomaly)
  const isUrgent = c.sourceSignals.some(s =>
    s.includes('expiry') || s.includes('anomaly') || s.includes('stockout')
  );
  const highImpact = c.score >= 70 && c.confidence >= 0.7;
  const mediumImpact = c.score >= 50 && c.confidence >= 0.5;

  if (highImpact && (isUrgent || c.type === 'RUN_REACTIVATION')) return 'act_now';
  if (highImpact) return 'consider';
  if (mediumImpact) return 'consider';
  if (c.type === 'REVIEW_PRICE' || c.type === 'REVIEW_RECIPE_COST') return 'maintain';
  return 'monitor';
}

/**
 * Generate daily advisor summary
 */
export async function generateDailyAdvisorSummary(
  restaurantId: string,
  branchId: string | undefined,
  restaurantName: string
): Promise<DailyAdvisorSummary> {
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

  // Enrich with AI
  const enriched = await enrichRecommendationsWithAI(restaurantId, branchId, candidates);

  // Build insights
  const insights: string[] = [];
  const alerts: Array<{ type: string; message: string; severity: 'info' | 'warning' | 'critical' }> = [];

  // Menu insights
  const stars = menuItems.filter(m => m.classification === 'STAR').length;
  const dogs = menuItems.filter(m => m.classification === 'DOG').length;
  if (stars > 0) insights.push(`${stars} STAR items driving revenue — protect them`);
  if (dogs > 0) insights.push(`${dogs} DOG items — consider removing or revamping`);

  // Margin insights
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
 * Generate campaign copy for a recommendation
 */
export async function generateCampaignCopy(
  restaurantId: string,
  branchId: string | undefined,
  candidate: PromotionCandidate,
  tone: 'friendly' | 'premium' | 'exciting' | 'simple' | 'festive' = 'friendly',
  language: 'en' | 'hi' | 'hi-en' = 'en'
): Promise<CampaignCopyResponse> {
  // Build adapter object with expected properties for the prompt
  const promptCandidate = {
    title: candidate.title,
    description: candidate.description,
    type: candidate.type,
    target: candidate.target,
    financialModel: candidate.financialModel,
    evidence: candidate.evidence.map(e => e.description),
    expectedImpact: `Expected impact: ${candidate.financialModel.incrementalContribution > 0 ? `+${fmtMoney(candidate.financialModel.incrementalContribution)} contribution` : 'Review recommended'}`,
  };

  const prompt = buildCampaignCopyPrompt(promptCandidate, tone, language);

  try {
    const res = await executeAiCall({
      prompt,
      feature: 'promotion-copy',
      tenantId: restaurantId,
      branchId,
      cacheKeyVariant: `promo-copy:${candidate.id}:${tone}:${language}`,
    });

    if (res.success && !res.fallback && res.data) {
      return {
        title: res.data.title || candidate.title,
        description: res.data.description || candidate.description,
        whatsapp: res.data.whatsapp || '',
        sms: res.data.sms || '',
        push: res.data.push || '',
        emailSubject: res.data.emailSubject || '',
        emailBody: res.data.emailBody || '',
      };
    }
  } catch {
    // Fall through to deterministic copy
  }

  // Deterministic fallback copy
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
 * Run what-if simulation
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

  // Find relevant candidates
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

  // Get baseline AOV and margin
  const { computeAllBaselines } = await import('./salesBaselineService');
  const baselines = await computeAllBaselines({ restaurantId, branchId, lookbackDays: 90 });
  const aov = baselines.aov.value;

  // Calculate simulation
  let current = { price: currentPrice || 0, contribution: 0, marginPercent: 0, aov };
  let proposed = { price: proposedPrice || 0, contribution: 0, marginPercent: 0, aov };
  let incrementalUnitsRequired = 0;
  let incrementalRevenueRequired = 0;
  let breakEvenPercent = 0;
  let confidence = 0.5;
  let viable = false;

  if (type === 'discount' && currentPrice && discountPercent) {
    proposed.price = Math.round(currentPrice * (1 - discountPercent / 100));
    current.contribution = currentPrice * 0.3; // Estimate 30% margin
    current.marginPercent = 30;
    proposed.contribution = proposed.price - (currentPrice * 0.7);
    proposed.marginPercent = proposed.price > 0 ? Math.round((proposed.contribution / proposed.price) * 100) : 0;

    const marginLossPerUnit = currentPrice - proposed.price;
    const baseVolume = 10; // Estimated daily volume
    const totalMarginLoss = baseVolume * marginLossPerUnit;
    incrementalUnitsRequired = proposed.contribution > 0 ? Math.ceil(totalMarginLoss / proposed.contribution) : 999;
    incrementalRevenueRequired = incrementalUnitsRequired * proposed.price;
    breakEvenPercent = baseVolume > 0 ? (incrementalUnitsRequired / baseVolume) * 100 : 0;
    viable = proposed.marginPercent >= 15 && breakEvenPercent < 100;
    confidence = viable ? 0.7 : 0.4;
  } else if (type === 'combo_price' && proposedPrice && relevantCandidates.length > 0) {
    const candidate = relevantCandidates[0];
    current.price = candidate.financialModel?.currentPrice || 0;
    current.contribution = candidate.financialModel?.currentContribution || 0;
    current.marginPercent = candidate.financialModel?.projectedContributionMargin || 0;
    current.aov = baselines.aov.value;

    proposed.price = proposedPrice;
    proposed.contribution = proposedPrice - (current.price - current.contribution);
    proposed.marginPercent = proposed.price > 0 ? Math.round((proposed.contribution / proposed.price) * 100) : 0;
    proposed.aov = current.aov;

    const baseVolume = 5;
    const marginLossPerUnit = current.contribution - proposed.contribution;
    const totalMarginLoss = baseVolume * Math.max(0, marginLossPerUnit);
    incrementalUnitsRequired = proposed.contribution > 0 ? Math.ceil(totalMarginLoss / proposed.contribution) : 999;
    incrementalRevenueRequired = incrementalUnitsRequired * proposed.price;
    breakEvenPercent = baseVolume > 0 ? (incrementalUnitsRequired / baseVolume) * 100 : 0;
    viable = proposed.marginPercent >= 20 && breakEvenPercent < 50;
    confidence = viable ? 0.75 : 0.4;
  }

  // Get AI explanation
  let explanation = '';
  try {
    const simulationData = {
      type,
      current,
      proposed,
      incrementalUnitsRequired,
      incrementalRevenueRequired,
      breakEvenPercent,
      confidence,
      viable,
    };
    const prompt = buildWhatIfPrompt(simulationData);
    const res = await executeAiCall({
      prompt,
      feature: 'advisor',
      tenantId: restaurantId,
      branchId,
    });
    explanation = res.data?.explanation || '';
  } catch {
    explanation = viable
      ? `Viable: need ${incrementalUnitsRequired} extra units to break even (${Math.round(breakEvenPercent)}% volume increase).`
      : `Not viable: would need ${incrementalUnitsRequired} extra units (${Math.round(breakEvenPercent)}% volume increase) to break even.`;
  }

  return {
    current,
    proposed,
    incrementalUnitsRequired,
    incrementalRevenueRequired,
    breakEvenPercent,
    confidence,
    explanation,
    viable,
  };
}

/**
 * Natural language advisor chat
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

  const topRecs = enriched.slice(0, 5).map(e => ({
    title: e.candidate.title,
    why: e.candidate.description,
    type: e.candidate.type,
    score: e.candidate.score,
    expectedImpact: e.candidate.financialModel.incrementalContribution > 0 
      ? `+${fmtMoney(e.candidate.financialModel.incrementalContribution)} contribution` 
      : 'Review recommended',
  }));

  // Get restaurant name
  const RestaurantModel = mongoose.model('Restaurant');
  const restaurant = await RestaurantModel.findById(objectId(restaurantId)).select('name').lean().exec() as { name: string } | null;
  const restaurantName = restaurant?.name || 'Your Restaurant';

  const prompt = buildNaturalLanguageAdvisorPrompt(message, {
    restaurantName,
    topRecommendations: topRecs,
    activePromotions: context?.activePromotions || [],
    insights,
  });

  try {
    const res = await executeAiCall({
      prompt,
      feature: 'advisor',
      tenantId: restaurantId,
      branchId,
    });

    const response = res.data;
    const relevantIndices = response.relevantRecommendationIndices || [];

    return {
      answer: response.answer || "I don't have enough data to answer that yet. Try asking about specific recommendations.",
      relevantRecommendations: relevantIndices.map((i: number) => enriched[i]).filter(Boolean),
      suggestedActions: response.suggestedActions || [],
      dataSources: response.dataSources || ['recommendations', 'sales baselines', 'inventory', 'customer data'],
    };
  } catch {
    return {
      answer: "I'm having trouble connecting to the AI advisor. You can still view your recommendations below.",
      relevantRecommendations: enriched.slice(0, 3),
      suggestedActions: ['View Recommendations'],
      dataSources: ['deterministic engine'],
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  fmtMoney,
  objectId,
};
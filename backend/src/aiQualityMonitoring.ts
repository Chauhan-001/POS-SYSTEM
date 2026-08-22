/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIQualityMonitoring — Track AI performance and reliability.
 *
 * Tracks:
 *   - Hallucination incidents
 *   - Unsupported claims
 *   - Invalid actions
 *   - Failed tool calls
 *   - User corrections
 *   - AI fallback frequency
 *
 * Create evaluation cases for important advisor questions.
 */

import mongoose from 'mongoose';
import type { AdvisorChatResponse } from './advisorChat';
import type { ParsedIntent } from './advisorChat';

/**
 * AI quality incident types
 */
export type AIIncidentType =
  | 'hallucination'
  | 'unsupported_claim'
  | 'invalid_action'
  | 'failed_tool_call'
  | 'user_correction'
  | 'fallback';

/**
 * AI incident record
 */
export interface AIIncident {
  /** Unique incident ID */
  id: string;

  /** Type of incident */
  type: AIIncidentType;

  /** Timestamp */
  timestamp: Date;

  /** Restaurant ID (tenant-scoped) */
  restaurantId: string;

  /** Original user message */
  originalMessage: string;

  /** Parsed intent (if available) */
  parsedIntent?: ParsedIntent;

  /** AI response that caused the incident */
  aiResponse: string;

  /** Why the incident occurred */
  reason: string;

  /** Whether AI was corrected by user */
  userCorrected: boolean;

  /** Action taken */
  actionTaken: 'reverted' | 'adjusted' | 'logged' | 'escalated';

  /** Confidence score of AI at time of incident (0-1) */
  aiConfidence: number;

  /** Recommended fix/lesson */
  lesson?: string;
}

/**
 * AI quality metrics
 */
export interface AIQualityMetrics {
  /** Total incidents recorded */
  totalIncidents: number;

  /** Incidents by type */
  byType: Record<AIIncidentType, number>;

  /** Incidents by month (last 12 months) */
  byMonth: Array<{
    month: string;
    incidents: number;
    hallucinations: number;
    corrections: number;
  }>;

  /** Fallback frequency - how often deterministic fallback was used */
  fallbackFrequency: number;

  /** User correction rate */
  userCorrectionRate: number;

  /** Tool call success rate */
  toolCallSuccessRate: number;

  /** Hallucination rate */
  hallucinationRate: number;

  /** Invalid action rate */
  invalidActionRate: number;

  /** Average AI confidence across all calls */
  averageConfidence: number;

  /** Total AI calls made */
  totalCalls: number;
}

/**
 * Record an AI incident
 */
export function recordAIIncident(
  restaurantId: string,
  type: AIIncidentType,
  originalMessage: string,
  aiResponse: string,
  reason: string,
  userCorrected: boolean = false,
  actionTaken: 'reverted' | 'adjusted' | 'logged' | 'escalated' = 'logged',
  aiConfidence: number = 0.5
): AIIncident {
  const incident: AIIncident = {
    id: `incident_${new Date().getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date(),
    restaurantId,
    originalMessage,
    aiResponse,
    reason,
    userCorrected,
    actionTaken,
    aiConfidence,
  };

  // In production, this would be persisted to MongoDB
  // AIUsageLog.create({ ...incident, type });

  return incident;
}

/**
 * Record a user correction to an AI recommendation
 */
export function recordUserCorrection(
  restaurantId: string,
  originalMessage: string,
  aiResponse: string,
  correctedMessage: string,
  incidentType: AIIncidentType
): AIIncident {
  return recordAIIncident(
    restaurantId,
    incidentType,
    originalMessage,
    aiResponse,
    'User provided correction',
    true,
    'adjusted'
  );
}

/**
 * Record a failed tool call
 */
export function recordFailedToolCall(
  restaurantId: string,
  tool: string,
  message: string,
  error: string,
  aiConfidence: number
): AIIncident {
  return recordAIIncident(
    restaurantId,
    'failed_tool_call',
    message,
    '',
    `Tool "${tool}" failed: ${error}`,
    false,
    'logged',
    aiConfidence
  );
}

/**
 * Record AI fallback to deterministic logic
 */
export function recordAIFallback(
  restaurantId: string,
  originalMessage: string,
  aiResponse: string,
  deterministicResult: string
): AIIncident {
  return recordAIIncident(
    restaurantId,
    'fallback',
    originalMessage,
    aiResponse,
    'AI unavailable - using deterministic fallback',
    false,
    'reverted',
    0.1 // low confidence when falling back
  );
}

/**
 * Calculate AI quality metrics from incident history
 */
export function calculateAIQualityMetrics(
  incidents: AIIncident[]
): AIQualityMetrics {
  const totalIncidents = incidents.length;

  // Count by type
  const byType: Record<AIIncidentType, number> = {
    hallucination: 0,
    unsupported_claim: 0,
    invalid_action: 0,
    failed_tool_call: 0,
    user_correction: 0,
    fallback: 0,
  };

  // Count by month (simplified - last 12 months)
  const byMonth = Array(12)
    .fill(0)
    .map((_, i) => ({
      month: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      incidents: 0,
      hallucinations: 0,
      corrections: 0,
    }));

  let hallucinationCount = 0;
  let correctionCount = 0;
  let toolCallFailureCount = 0;
  let totalCalls = 0; // This would be tracked separately in production
  let totalConfidence = 0;

  for (const incident of incidents) {
    // Count by type
    if (byType[incident.type] !== undefined) {
      byType[incident.type]++;
    }

    // Count hallucinations and corrections
    if (incident.type === 'hallucination') hallucinationCount++;
    if (incident.userCorrected) correctionCount++;

    // Track tool call failures
    if (incident.type === 'failed_tool_call') {
      toolCallFailureCount++;
    }

    // Track confidence
    totalConfidence += incident.aiConfidence;
    totalCalls++;
  }

  // Calculate rates
  const hallucinationRate = totalCalls > 0 ? (hallucinationCount / totalCalls) * 100 : 0;
  const invalidActionRate = totalCalls > 0 ? (byType.invalid_action / totalCalls) * 100 : 0;
  const fallbackFrequency = totalCalls > 0 ? (byType.fallback / totalCalls) * 100 : 0;
  const userCorrectionRate = totalIncidents > 0 ? (correctionCount / totalIncidents) * 100 : 0;
  const toolCallSuccessRate = totalCalls > 0 ? ((totalCalls - toolCallFailureCount) / totalCalls) * 100 : 100;
  const averageConfidence = totalCalls > 0 ? totalConfidence / totalCalls : 0;

  // Simplify byMonth - in production would query actual dates
  for (let i = 0; i < byMonth.length; i++) {
    byMonth[i].incidents = Math.floor(Math.random() * 5); // placeholder
    byMonth[i].hallucinations = Math.floor(Math.random() * 2); // placeholder
    byMonth[i].corrections = Math.floor(Math.random() * 3); // placeholder
  }

  return {
    totalIncidents,
    byType,
    byMonth,
    fallbackFrequency: Math.round(fallbackFrequency),
    userCorrectionRate: Math.round(userCorrectionRate),
    toolCallSuccessRate: Math.round(toolCallSuccessRate),
    hallucinationRate: Math.round(hallucinationRate),
    invalidActionRate: Math.round(invalidActionRate),
    averageConfidence: Math.round(averageConfidence * 100) / 100,
    totalCalls,
  };
}

/**
 * Evaluation cases for important advisor questions
 * These are used to test AI consistency and accuracy
 */
export const EVALUATION_CASES = {
  // Case: "Why are sales down?"
  salesDown: {
    question: 'Why are sales down?',
    expectedElements: ['data_quality', 'trend_analysis', 'comparative'],
    minConfidence: 0.7,
    maxHallucinations: 0,
  },

  // Case: "What should I do today?"
  todayAction: {
    question: 'What should I do today?',
    expectedElements: ['recommendations', 'priority', 'objective_alignment'],
    minRecommendations: 1,
    maxRecommendations: 5,
  },

  // Case: "What is my most profitable product?"
  mostProfitable: {
    question: 'What is my most profitable product?',
    expectedElements: ['margin_data', 'sales_volume', 'ranking'],
    requiresRecipeData: true,
    minConfidence: 0.8,
  },

  // Case: "Which promotion should I run?"
  bestPromotion: {
    question: 'Which promotion should I run?',
    expectedElements: ['strategy_library', 'policy_compliance', 'financial_validation'],
    respectsPolicy: true,
    minConfidence: 0.7,
  },

  // Case: "Should I discount anything?"
  discountAdvice: {
    question: 'Should I discount anything?',
    expectedElements: ['policy_check', 'margin_analysis', 'alternatives'],
    respectsMaximumDiscount: true,
    suggestsAlternatives: true,
  },

  // Case: "Why did you recommend this?"
  recommendationWhy: {
    question: 'Why did you recommend this?',
    expectedElements: ['evidence', 'scoring', 'objective_alignment'],
    providesExplanation: true,
    evidenceBased: true,
  },

  // Case: "What worked last month?"
  lastMonthWorked: {
    question: 'What worked last month?',
    expectedElements: ['historical_performance', 'successful_promotions', 'metrics'],
    usesHistoricalData: true,
    requiresOutcomeTracking: true,
  },

  // Case: "What should I stop doing?"
  stopDoing: {
    question: 'What should I stop doing?',
    expectedElements: ['fatigue_detection', 'low_performance', 'risk_assessment'],
    detectsFatigue: true,
    considersRisk: true,
  },
};

/**
 * Validate AI response against evaluation cases
 */
export function validateAIGainstCases(
  response: string,
  question: string,
  context: {
    dataQuality?: 'Excellent' | 'Good' | 'Limited' | 'Poor';
    hasRecipeData?: boolean;
    policy?: AutomationPolicy;
    outcomesTracked?: boolean;
  }
): {
  valid: boolean;
  passedCases: string[];
  failedCases: string[];
  suggestions: string[];
} {
    const passedCases: string[] = [];
    const failedCases: string[] = [];
    const suggestions: string[] = [];

    // Check each evaluation case
    for (const [caseName, caseDef] of Object.entries(EVALUATION_CASES)) {
      const caseValid = validateCaseResponse(response, question, caseDef, context);

      if (caseValid) {
        passedCases.push(caseName);
      } else {
        failedCases.push(caseName);
        // Add suggestion based on failed case
        if (!caseDef.requiresRecipeData && context.dataQuality === 'Poor') {
          suggestions.push(`Case "${caseName}": data quality is poor - consider improving data before AI reasoning`);
        }
        if (caseDef.respectsPolicy && context.policy) {
          suggestions.push(`Case "${caseName}": verify AI response respects policy constraints (max ${context.policy.maximumDiscount}% discount, min ${context.policy.minimumMargin}% margin)`);
        }
      }
    }

    return {
      valid: failedCases.length === 0,
      passedCases,
      failedCases,
      suggestions,
    };
}

/**
 * Internal helper to validate a single case
 */
function validateCaseResponse(
  response: string,
  question: string,
  caseDef: any,
  context: any
): boolean {
    const lowerResponse = response.toLowerCase();
    const lowerQuestion = question.toLowerCase();

    // Check for required elements in response
    const hasRequiredElement = caseDef.expectedElements
      ? caseDef.expectedElements.some((el: string) =>
          lowerResponse.includes(el.toLowerCase())
        )
      : true;

    // Check for prohibited elements or constraints
    const violatesConstraint = caseDef.prohibitedElements
      ? caseDef.prohibitedElements.some((el: string) =>
          lowerResponse.includes(el.toLowerCase())
        )
      : false;

    // Check policy compliance
    const respectsPolicy = caseDef.respectsPolicy
      ? context.policy
        ? lowerResponse.includes(`max ${context.policy.maximumDiscount}%`) ||
          lowerResponse.includes(`min ${context.policy.minimumMargin}%`)
        : false
      : true;

    // Check data requirements
    const hasRequiredData = caseDef.requiresRecipeData
      ? context.hasRecipeData !== false
      : true;

    // Check outcome tracking
    const usesOutcomes = caseDef.usesHistoricalData
      ? context.outcomesTracked !== false
      : true;

    return (
      hasRequiredElement &&
      !violatesConstraint &&
      respectsPolicy &&
      hasRequiredData &&
      usesOutcomes
    );
}
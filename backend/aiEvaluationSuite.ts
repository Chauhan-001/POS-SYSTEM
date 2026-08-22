/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AISuite — Evaluation suite for common advisor questions.
 *
 * For each answer evaluate:
 *   Factual accuracy
 *   Evidence usage
 *   Financial correctness
 *   No hallucination
 *   Actionability
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { ParsedIntent } from './advisorChat';

/**
 * Evaluation case for an advisor question
 */
export interface EvaluationCase {
  id: string;
  question: string;
  expectedElements: string[]; // key elements that should appear in answer
  minConfidence?: number;
  maxHallucinations?: number;
  requiresRecipeData?: boolean;
  respectsPolicy?: boolean;
  outcomeTrackingRequired?: boolean;
}

/**
 * Evaluation result for a single case
 */
export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  score: number; // 0-100
  factualAccuracy: number; // 0-100
  evidenceUsage: number; // 0-100
  financialCorrectness: number; // 0-100
  hallucinationCount: number;
  actionability: number; // 0-100
  issues: string[];
}

/**
 * AI Answer Evaluation Suite
 * Creates evaluation cases for important advisor questions and evaluates AI responses.
 */

export const EVALUATION_SUITE: EvaluationCase[] = [
  {
    id: 'sales_down',
    question: 'Why are sales down?',
    expectedElements: ['data_quality', 'trend_analysis', 'comparative'],
    minConfidence: 0.7,
    maxHallucinations: 0,
    outcomeTrackingRequired: true,
  },
  {
    id: 'today_action',
    question: 'What should I do today?',
    expectedElements: ['recommendations', 'priority', 'objective_alignment'],
    minRecommendations: 1,
    maxRecommendations: 5,
    respectsPolicy: true,
  },
  {
    id: 'most_profitable',
    question: 'What is my most profitable product?',
    expectedElements: ['margin_data', 'sales_volume', 'ranking'],
    requiresRecipeData: true,
    minConfidence: 0.8,
  },
  {
    id: 'best_promotion',
    question: 'Which promotion should I run?',
    expectedElements: ['strategy_library', 'policy_compliance', 'financial_validation'],
    respectsPolicy: true,
    minConfidence: 0.7,
  },
  {
    id: 'discount_advice',
    question: 'Should I discount anything?',
    expectedElements: ['policy_check', 'margin_analysis', 'alternatives'],
    respectsMaximumDiscount: true,
    suggestsAlternatives: true,
  },
  {
    id: 'recommendation_why',
    question: 'Why did you recommend this?',
    expectedElements: ['evidence', 'scoring', 'objective_alignment'],
    providesExplanation: true,
    evidenceBased: true,
  },
  {
    id: 'last_month_worked',
    question: 'What worked last month?',
    expectedElements: ['historical_performance', 'successful_promotions', 'metrics'],
    usesHistoricalData: true,
    requiresOutcomeTracking: true,
  },
  {
    id: 'stop_doing',
    question: 'What should I stop doing?',
    expectedElements: ['fatigue_detection', 'low_performance', 'risk_assessment'],
    detectsFatigue: true,
    considersRisk: true,
  },
];

/**
 * Evaluate AI response against evaluation suite
 */
export function evaluateAIResponse(
  response: string,
  question: string,
  context: {
    dataQuality?: 'Excellent' | 'Good' | 'Limited' | 'Poor';
    hasRecipeData?: boolean;
    policy?: AutomationPolicy;
    outcomesTracked?: boolean;
  }
): EvaluationResult[] {
    const results: EvaluationResult[] = [];

    for (const caseDef of EVALUATION_SUITE) {
      // Check if this case applies to the question
      if (question.toLowerCase().includes(caseDef.question.toLowerCase())) {
        const result = evaluateCaseResponse(response, question, caseDef, context);
        results.push(result);
      }
    }

    // If no cases matched, add a generic evaluation
    if (results.length === 0) {
      results.push({
        caseId: 'generic',
        passed: false,
        score: 50,
        factualAccuracy: 50,
        evidenceUsage: 50,
        financialCorrectness: 50,
        hallucinationCount: 0,
        actionability: 50,
        issues: ['No matching evaluation case found'],
      });
    }

    return results;
  }

  /**
   * Evaluate a single case response
   */
  function evaluateCaseResponse(
    response: string,
    question: string,
    caseDef: EvaluationCase,
    context: {
      dataQuality?: 'Excellent' | 'Good' | 'Limited' | 'Poor';
      hasRecipeData?: boolean;
      policy?: AutomationPolicy;
      outcomesTracked?: boolean;
    }
  ): EvaluationResult {
    const lowerResponse = response.toLowerCase();
    const lowerQuestion = question.toLowerCase();

    // Initialize scores
    let factualAccuracy = 100;
    let evidenceUsage = 100;
    let financialCorrectness = 100;
    let hallucinationCount = 0;
    let actionability = 100;
    const issues: string[] = [];

    // Check for expected elements
    if (caseDef.expectedElements) {
      for (const element of caseDef.expectedElements) {
        if (!lowerResponse.includes(element.toLowerCase())) {
          factualAccuracy -= 15;
          evidenceUsage -= 15;
          issues.push(`Missing expected element: "${element}"`);
        }
      }
    }

    // Check for prohibited elements or constraints
    if (caseDef.prohibitedElements) {
      for (const el of caseDef.prohibitedElements) {
        if (lowerResponse.includes(el.toLowerCase())) {
          factualAccuracy -= 20;
          hallucinationCount++;
          issues.push(`Contains prohibited element: "${el}"`);
        }
      }
    }

    // Check policy compliance
    if (caseDef.respectsPolicy && context.policy) {
      // Check if response respects maximum discount
      if (context.policy.maximumDiscount) {
        if (!lowerResponse.includes(`max ${context.policy.maximumDiscount}%`)) {
          financialCorrectness -= 15;
          issues.push('May not respect maximum discount policy');
        }
      }
      // Check minimum margin
      if (context.policy.minimumMargin) {
        if (!lowerResponse.includes(`min ${context.policy.minimumMargin}%`)) {
          financialCorrectness -= 15;
          issues.push('May not respect minimum margin policy');
        }
      }
    }

    // Check data requirements
    if (caseDef.requiresRecipeData && context.hasRecipeData === false) {
      factualAccuracy -= 20;
      issues.push('Recipe data not available but answer assumes it is');
    }

    // Check outcome tracking
    if (caseDef.outcomeTrackingRequired && context.outcomesTracked === false) {
      factualAccuracy -= 15;
      issues.push('Outcome data not tracked but answer references historical results');
    }

    // Ensure scores are within 0-100
    factualAccuracy = Math.max(0, Math.min(100, factualAccuracy));
    evidenceUsage = Math.max(0, Math.min(100, evidenceUsage));
    financialCorrectness = Math.max(0, Math.min(100, financialCorrectness));
    actionability = Math.max(0, Math.min(100, actionability));

    // Calculate overall score
    const score = (factualAccuracy + evidenceUsage + financialCorrectness + actionability) / 4;

    const passed = factualAccuracy >= (caseDef.minConfidence * 100 || 70) &&
      financialCorrectness >= 70 && hallucinationCount === 0;

    return {
      caseId: caseDef.id,
      passed,
      score: Math.round(score * 100) / 100,
      factualAccuracy: Math.round(factualAccuracy * 100) / 100,
      evidenceUsage: Math.round(evidenceUsage * 100) / 100,
      financialCorrectness: Math.round(financialCorrectness * 100) / 100,
      hallucinationCount,
      actionability: Math.round(actionability * 100) / 100,
      issues: issues.length > 0 ? issues : [],
    };
  }
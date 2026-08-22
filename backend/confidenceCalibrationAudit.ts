/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConfidenceCalibrationAudit — Audit whether High confidence actually corresponds
 * to higher recommendation accuracy.
 *
 * If high-confidence predictions fail frequently, confidence is miscalibrated.
 * Calibrate confidence using historical outcomes.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * Confidence calibration result
 */
export interface ConfidenceCalibrationResult {
  confidenceLevel: 'Low' | 'Medium' | 'High';
  totalRecommendations: number;
  recommendationsByActualOutcome: {
    positive: number; // actual contribution > 0
    negative: number; // actual contribution < 0
    neutral: number; // actual contribution ≈ 0
  };
  accuracyByConfidence: {
    [key: string]: {
      total: number;
      positive: number;
      negative: number;
      accuracy: number; // positive / total
    };
  };
  isCalibrated: boolean;
  calibrationMessage: string;
}

/**
 * Audit confidence calibration using historical outcomes
 */
export function auditConfidenceCalibration(
  restaurantId: string,
  historicalRecommendations: Array<{
    recommendationId: string;
    title: string;
    confidence: 'Low' | 'Medium' | 'High';
    expectedContribution: number;
    actualContribution: number;
    outcome: 'positive' | 'negative' | 'neutral';
  }>
): ConfidenceCalibrationResult {
    const totalRecommendations = historicalRecommendations.length;

    // Count by actual outcome
    const outcomes = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    // Group by confidence level and outcome
    const byConfidenceAndOutcome: Record<string, { total: number; positive: number; negative: number }> = {
      Low: { total: 0, positive: 0, negative: 0 },
      Medium: { total: 0, positive: 0, negative: 0 },
      High: { total: 0, positive: 0, negative: 0 },
    };

    for (const rec of historicalRecommendations) {
      // Count outcomes
      outcomes[rec.outcome] = (outcomes[rec.outcome] || 0) + 1;

      // Group by confidence
      const confidenceKey = rec.confidence;
      if (byConfidenceAndOutcome[confidenceKey]) {
        byConfidenceAndOutcome[confidenceKey].total++;
        if (rec.outcome === 'positive') {
          byConfidenceAndOutcome[confidenceKey].positive++;
        } else if (rec.outcome === 'negative') {
          byConfidenceAndOutcome[confidenceKey].negative++;
        }
      }
    }

    // Calculate accuracy by confidence level
    const accuracyByConfidence: Record<string, { total: number; positive: number; accuracy: number }> = {};
    for (const [confidenceLevel, counts] of Object.entries(byConfidenceAndOutcome)) {
      const total = counts.total;
      const positive = counts.positive;
      const accuracy = total > 0 ? positive / total : 0;

      accuracyByConfidence[confidenceLevel] = {
        total: counts.total,
        positive: counts.positive,
        accuracy: Math.round(accuracy * 100) / 100,
      };
    }

    // Determine if calibrated
    // A simple calibration check: does High confidence have higher accuracy than Low?
    const highAccuracy = accuracyByConfidence.High?.accuracy || 0;
    const mediumAccuracy = accuracyByConfidence.Medium?.accuracy || 0;
    const lowAccuracy = accuracyByConfidence.Low?.accuracy || 0;

    const isCalibrated = highAccuracy >= mediumAccuracy && mediumAccuracy >= lowAccuracy;

    // Generate calibration message
    let calibrationMessage: string;
    if (isCalibrated) {
      calibrationMessage = `Confidence is well-calibrated: High (${highAccuracy * 100}% accuracy) > Medium (${mediumAccuracy * 100}%) > Low (${lowAccuracy * 100}%)`;
    } else {
      // Find the issue
      if (highAccuracy < mediumAccuracy) {
        calibrationMessage = `High confidence (${highAccuracy * 100}%) is less accurate than Medium (${mediumAccuracy * 100}%) - confidence needs recalibration`;
      } else if (mediumAccuracy < lowAccuracy) {
        calibrationMessage = `Medium confidence (${mediumAccuracy * 100}%) is less accurate than Low (${lowAccuracy * 100}%) - confidence inversion detected`;
      } else {
        calibrationMessage = `Confidence calibration inconsistent - accuracy does not monotonically increase with confidence level`;
      }
    }

    return {
      confidenceLevel: 'High', // placeholder - would be determined by analysis
      totalRecommendations,
      recommendationsByActualOutcome: outcomes,
      accuracyByConfidence,
      isCalibrated,
      calibrationMessage,
    };
  }

  /**
   * Format confidence calibration result
   */
  export function formatConfidenceCalibration(
    result: ConfidenceCalibrationResult
  ): string {
    const lines: string[] = [];

    lines.push('Confidence Calibration Audit');
    lines.push('=' .repeat(35));
    lines.push('');
    lines.push(`Total recommendations analyzed: ${result.totalRecommendations}`);
    lines.push('');
    lines.push('Accuracy by confidence level:');
    for (const [level, data] of Object.entries(result.accuracyByConfidence)) {
      lines.push(`  ${level}: ${data.accuracy * 100}% (${data.positive}/${data.total} positive)`);
    }
    lines.push('');
    lines.push(`Overall outcomes: ${result.recommendationsByActualOutcome.positive} positive, ${result.recommendationsByActualOutcome.negative} negative, ${result.recommendationsByActualOutcome.neutral} neutral`);
    lines.push('');
    lines.push(`Is calibrated: ${result.isCalibrated}`);
    lines.push(`: ${result.calibrationMessage}`);

    return lines.join('\n');
  }
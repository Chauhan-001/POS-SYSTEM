/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ForecastBenchmarking — Every forecasting model should compete against simple baselines.
 *
 * Examples:
 *   Naive previous period
 *   7-day average
 *   Same weekday average
 *   Moving average
 *   Current forecasting model
 *
 * Use the best-performing appropriate method.
 * Do not keep a complex model merely because it is more sophisticated.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * Forecast baseline methods for benchmarking
 */
export type ForecastBaselineMethod =
  | 'naive_previous_period'
  | 'seven_day_average'
  | 'same_weekday_average'
  | 'moving_average'
  | 'current_model';

/**
 * Benchmark result comparing multiple forecast methods
 */
export interface ForecastBenchmarkResult {
  method: ForecastBaselineMethod;
  forecastHorizon: number; // days
  meanAbsolutePercentageError: number; // MAPE %
  meanAbsoluteError: number; // MAE
  directionAccuracy: number; // % of times direction (up/down) correct
  bias: number; // average error sign (positive = over-forecast)
  rootMeanSquareError: number; // RMSE
}

/**
 * Run forecast benchmarking against simple baselines
 */
export function benchmarkForecasts(
  actualDemands: number[], // actual daily demands (last N days)
  modelForecasts: {
    [key in ForecastBaselineMethod]?: number[]; // forecast for same days
  }
): ForecastBenchmarkResult[] {
    const results: ForecastBenchmarkResult[] = [];

    // If no model forecasts provided, just compute baselines from actual data
    if (!modelForecasts) {
      results.push(computeBaselineOnly(actualDemands));
      return results;
    }

    // Compute baseline-only result
    results.push(computeBaselineOnly(actualDemands));

    // Compare each model forecast against actual
    for (const [method, forecast] of Object.entries(modelForecasts) as [string, number[]][]) {
      if (forecast) {
        results.push(compareForecastToActual(method as ForecastBaselineMethod, actualDemands, forecast));
      }
    }

    return results;
  }

  /**
   * Compute baseline-only result (all simple methods)
   */
  function computeBaselineOnly(actualDemands: number[]): ForecastBenchmarkResult {
    const n = actualDemands.length;

    // Naive previous period (use previous day's actual, or last available)
    let naiveError = 0;
    let naiveDirAcc = 0;
    let naiveCount = 0;
    for (let i = 1; i < n; i++) {
      const naiveForecast = actualDemands[i - 1];
      naiveError += Math.abs(naiveForecast - actualDemands[i]);
      if (i > 0) {
        const dirCorrect = (naiveForecast - actualDemands[i - 1]) * (actualDemands[i] - actualDemands[i - 1]) > 0
          ? 1 : 0;
        naiveDirAcc += dirCorrect;
        naiveCount++;
      }
    }
    naiveError = naiveError / Math.max(n - 1, 1);
    const naiveDirAccRate = naiveCount > 0 ? naiveDirAcc / naiveCount : 0;

    // 7-day average
    let sevenDayError = 0;
    let sevenDayDirAcc = 0;
    let sevenDayCount = 0;
    for (let i = 7; i < n; i++) {
      const sevenForecast = actualDemands.slice(i - 7, i).reduce((a, b) => a + b, 0) / 7;
      sevenError += Math.abs(sevenForecast - actualDemands[i]);
      if (i > 7) {
        const dirCorrect = (sevenForecast - actualDemands[i - 7]) * (actualDemands[i] - actualDemands[i - 7]) > 0
          ? 1 : 0;
        sevenDayDirAcc += dirCorrect;
        sevenDayCount++;
      }
    }
    sevenError = sevenError / Math.max(n - 7, 1);
    const sevenDayDirAccRate = sevenDayCount > 0 ? sevenDayDirAcc / sevenDayCount : 0;

    // Same weekday average
    let weekdayError = 0;
    let weekdayDirAcc = 0;
    let weekdayCount = 0;
    for (let i = 1; i < n; i++) {
      const weekdayIdx = i % 7; // 0=Mon..6=Sun (simplified)
      const sameWeekdayForecasts = [];
      for (let j = i - 7; j < i; j++) {
        if (j >= 0 && (j % 7 === weekdayIdx || (j % 7 === weekdayIdx && j !== i - 7))) {
          sameWeekdayForecasts.push(actualDemands[j]);
        }
      }
      if (sameWeekdayForecasts.length > 0) {
        const weekdayForecast = sameWeekdayForecasts.reduce((a, b) => a + b, 0) / sameWeekdayForecasts.length;
        weekdayError += Math.abs(weekdayForecast - actualDemands[i]);
        if (i > 0) {
          const dirCorrect = (weekdayForecast - actualDemands[i - 7]) * (actualDemands[i] - actualDemands[i - 7]) > 0
            ? 1 : 0;
          weekdayDirAcc += dirCorrect;
          weekdayCount++;
        }
      }
    }
    weekdayError = weekdayError / Math.max(n - 1, 1);
    const weekdayDirAccRate = weekdayCount > 0 ? weekdayDirAcc / weekdayCount : 0;

    // Moving average (7-period)
    let movingError = 0;
    let movingDirAcc = 0;
    let movingCount = 0;
    for (let i = 7; i < n; i++) {
      const movingForecast = actualDemands.slice(i - 7, i).reduce((a, b) => a + b, 0) / 7;
      movingError += Math.abs(movingForecast - actualDemands[i]);
      if (i > 0) {
        const dirCorrect = (movingForecast - actualDemands[i - 7]) * (actualDemands[i] - actualDemands[i - 7]) > 0
          ? 1 : 0;
        movingDirAcc += dirCorrect;
        movingCount++;
      }
    }
    movingError = movingError / Math.max(n - 7, 1);
    const movingDirAccRate = movingCount > 0 ? movingDirAcc / movingCount : 0;

    return {
      method: 'baseline_comparison',
      forecastHorizon: actualDemands.length,
      meanAbsolutePercentageError: 0, // will be calculated relative to actuals
      meanAbsoluteError: Math.min(naiveError, sevenDayError, weekdayError, movingError),
      directionAccuracy: Math.max(naiveDirAccRate, sevenDayDirAccRate, weekdayDirAccRate, movingDirAccRate),
      bias: 0, // placeholder
      rootMeanSquareError: 0, // placeholder
    };
  }

  /**
   * Compare a single forecast method against actuals
   */
  function compareForecastToActual(
    method: ForecastBaselineMethod,
    actualDemands: number[],
    forecast: number[]
  ): ForecastBenchmarkResult {
    const n = Math.min(actualDemands.length, forecast.length);
    if (n < 3) return {};

    let mae = 0;
    let mape = 0;
    let dirAcc = 0;
    let rMSE = 0;
    let bias = 0;

    for (let i = 0; i < n; i++) {
      const error = forecast[i] - actualDemands[i];
      mae += Math.abs(error);
      if (actualDemands[i] > 0) {
        mape += Math.abs(error / actualDemands[i]);
      }
      if (i > 0) {
        const dirCorrect = error * (actualDemands[i] - actualDemands[i - 1]) > 0 ? 1 : 0;
        dirAcc += dirCorrect;
      }
      bias += error;
      rMSE += error * error;
    }

    mae = mae / n;
    mape = (mape / n) * 100;
    dirAcc = (n > 1) ? dirAcc / (n - 1) : 0;
    rMSE = Math.sqrt(rMSE / n);
    bias = bias / n;

    return {
      method,
      forecastHorizon: n,
      meanAbsolutePercentageError: Math.round(mape * 100) / 100,
      meanAbsoluteError: Math.round(mae * 100) / 100,
      directionAccuracy: Math.round(dirAcc * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      rootMeanSquareError: Math.round(rMSE * 100) / 100,
    };
  }

  /**
   * Format benchmark result for display
   */
  export function formatBenchmarkResult(
    result: ForecastBenchmarkResult
  ): string {
    const lines: string[] = [];

    lines.push(`Forecast Method: ${result.method}`);
    lines.push(`MAPE: ${result.meanAbsolutePercentageError}%`);
    lines.push(`MAE: ₹${result.meanAbsoluteError.toLocaleString('en-IN')}/day`);
    lines.push(`Direction Accuracy: ${result.directionAccuracy}%`);
    lines.push(`Bias: ${result.bias > 0 ? '+' : ''}${result.bias} (over-forecast = over-predicting)`);
    lines.push(`RMSE: ₹${result.rootMeanSquareError.toLocaleString('en-IN')}`);

    return lines.join('\n');
  }

  /**
   * Determine the best method from benchmark results
   */
  export function determineBestMethod(
    results: ForecastBenchmarkResult[]
  ): ForecastBaselineMethod | undefined {
    if (results.length === 0) return undefined;

    // Use direction accuracy as primary criterion, then MAPE
    let best = results[0];
    for (const result of results) {
      if (result.directionAccuracy > best.directionAccuracy ||
        (result.directionAccuracy === best.directionAccuracy &&
          result.meanAbsolutePercentageError < best.meanAbsolutePercentageError)) {
        best = result;
      }
    }

    return best.method;
  }
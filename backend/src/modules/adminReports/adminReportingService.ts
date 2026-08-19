/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminReportingService.ts — Unified read path for all Admin Reports.
 *
 * Wraps the per-domain aggregation services behind a thin cache so each
 * endpoint can call one fluent method and rely on memoised aggregation.
 *
 * Every method that mutates (recording ledger events / history / export jobs)
 * lives in the aggregation services; this class is strictly read + cache.
 */

import {
  cachedReport,
  signatureOf,
  invalidateReportCache,
} from './cache/reportCache';
import { getGrowthReport, GrowthReport } from './aggregations/growth';
import { getRevenueReport, RevenueReport, recordRevenueEvent } from './aggregations/revenue';
import { getSubscriptionReport, SubscriptionReport, recordSubscriptionHistory } from './aggregations/subscriptions';
import { getAiRevenueReport, AiRevenueReport } from './aggregations/ai';
import { getAiUsageMetrics, AiUsageMetricsReport } from './aggregations/aiUsage';
import { getSupportReport, SupportReport } from './aggregations/support';
import { getDeviceReport, DeviceReport } from './aggregations/devices';
import { getUsageReport, UsageReport } from './aggregations/usage';
import { getOwnerReport, OwnerReport } from './aggregations/owners';
import { getInactiveReport, InactiveReport, computeInactiveSnapshot } from './aggregations/inactive';
import { getFeatureReport, FeatureReport } from './aggregations/features';

export interface ReportOptions {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  thresholdDays?: number;
  limit?: number;
  markup?: number;
  forecastSteps?: number;
  useSnapshot?: boolean;
}

export class AdminReportingService {
  async growth(options: ReportOptions = {}): Promise<GrowthReport> {
    return cachedReport('growth', signatureOf(options), () => getGrowthReport(options));
  }

  async revenue(options: ReportOptions = {}): Promise<RevenueReport> {
    return cachedReport('revenue', signatureOf(options), () => getRevenueReport(options));
  }

  async subscriptions(options: ReportOptions = {}): Promise<SubscriptionReport> {
    return cachedReport('subscriptions', signatureOf(options), () => getSubscriptionReport(options));
  }

  async aiRevenue(options: ReportOptions = {}): Promise<AiRevenueReport> {
    return cachedReport('ai-revenue', signatureOf(options), () => getAiRevenueReport(options));
  }

  /** Phase 8 — AI usage & reliability telemetry (cache/fallback/validation/latency/cost). */
  async aiUsageMetrics(options: ReportOptions = {}): Promise<AiUsageMetricsReport> {
    return cachedReport('ai-usage-metrics', signatureOf(options), () => getAiUsageMetrics(options));
  }

  async support(options: ReportOptions = {}): Promise<SupportReport> {
    return cachedReport('support', signatureOf(options), () => getSupportReport(options));
  }

  async devices(options: ReportOptions = {}): Promise<DeviceReport> {
    return cachedReport('devices', signatureOf(options), () => getDeviceReport(options));
  }

  async usage(options: ReportOptions = {}): Promise<UsageReport> {
    return cachedReport('usage', signatureOf(options), () => getUsageReport(options));
  }

  async owners(options: ReportOptions = {}): Promise<OwnerReport> {
    return cachedReport('owners', signatureOf(options), () => getOwnerReport(options));
  }

  async inactive(options: ReportOptions = {}): Promise<InactiveReport> {
    return cachedReport('inactive', signatureOf(options), () =>
      getInactiveReport({
        period: options.period,
        from: options.from,
        to: options.to,
        thresholdDays: options.thresholdDays,
        limit: options.limit,
        useSnapshot: options.useSnapshot,
      }));
  }

  async features(options: ReportOptions = {}): Promise<FeatureReport> {
    return cachedReport('features', signatureOf(options), () => getFeatureReport(options));
  }

  async summary(options: ReportOptions = {}): Promise<Record<string, unknown>> {
    return cachedReport('summary', signatureOf(options), async () => {
      const [growth, revenue, subs, ai, support, devices, usage] = await Promise.all([
        this.growth(options),
        this.revenue(options),
        this.subscriptions(options),
        this.aiRevenue(options),
        this.support(options),
        this.devices(options),
        this.usage(options),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        period: options.period ?? '30d',
        growth: growth.summary,
        revenue: revenue.summary,
        subscriptions: subs.summary,
        aiRevenue: ai.summary,
        support: support.summary,
        devices: devices.summary,
        usage: usage.summary,
      };
    });
  }

  async runInactiveSnapshot(): Promise<any> {
    const payload = await computeInactiveSnapshot();
    invalidateReportCache('inactive');
    return payload;
  }

  // ── Recording hooks exposed for wiring (non-blocking, testable) ──────────
  async recordRevenue(input: Parameters<typeof recordRevenueEvent>[0]): Promise<void> {
    return recordRevenueEvent(input);
  }

  async recordSubscriptionEvent(input: Parameters<typeof recordSubscriptionHistory>[0]): Promise<void> {
    return recordSubscriptionHistory(input);
  }
}

export const adminReportingService = new AdminReportingService();
export { invalidateReportCache };
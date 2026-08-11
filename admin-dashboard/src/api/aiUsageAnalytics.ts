/**
 * =============================================================================
 *  aiUsageAnalytics.ts — AI Usage Dashboard API Client (Phase 2.7)
 * =============================================================================
 *
 * All endpoints for querying and filtering AI usage analytics data.
 */

import api from './client';

export type TimeGroup = 'day' | 'week' | 'month' | 'year';

export interface AnalyticsFilter {
  restaurantId?: string;
  ownerId?: string;
  model?: string;
  provider?: string;
  feature?: string;
  success?: string;
  failed?: string;
  cached?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: TimeGroup;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

function buildQuery(filter?: AnalyticsFilter): string {
  const params = new URLSearchParams();
  if (!filter) return '';
  Object.entries(filter).forEach(([key, val]) => {
    if (val !== undefined && val !== '' && val !== null) {
      params.append(key, String(val));
    }
  });
  return params.toString();
}

// ─── Live API-Key Quota (per-key rate-limit snapshots) ────────

export const getAiQuota = () =>
  api.get('/api/admin/analytics/ai/quota').then(r => r.data);

// ─── Dashboard Summary ────────────────────────────────────────

export const getDashboardSummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/dashboard?${buildQuery(filter)}`).then(r => r.data);

// ─── Token Analytics ──────────────────────────────────────────

export const getTokenSummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/summary?${buildQuery(filter)}`).then(r => r.data);

export const getTokenTimeSeries = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/timeseries?${buildQuery(filter)}`).then(r => r.data);

export const getTokensByModel = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/by-model?${buildQuery(filter)}`).then(r => r.data);

export const getTokensByRestaurant = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/by-restaurant?${buildQuery(filter)}`).then(r => r.data);

export const getTokensByOwner = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/by-owner?${buildQuery(filter)}`).then(r => r.data);

export const getTokensByFeature = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/tokens/by-feature?${buildQuery(filter)}`).then(r => r.data);

// ─── Request Analytics ────────────────────────────────────────

export const getRequestSummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/requests/summary?${buildQuery(filter)}`).then(r => r.data);

export const getRequestTimeSeries = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/requests/timeseries?${buildQuery(filter)}`).then(r => r.data);

// ─── Cost Analytics ───────────────────────────────────────────

export const getCostSummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/summary?${buildQuery(filter)}`).then(r => r.data);

export const getCostTimeSeries = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/timeseries?${buildQuery(filter)}`).then(r => r.data);

export const getCostByModel = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/by-model?${buildQuery(filter)}`).then(r => r.data);

export const getCostByFeature = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/by-feature?${buildQuery(filter)}`).then(r => r.data);

export const getCostByRestaurant = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/by-restaurant?${buildQuery(filter)}`).then(r => r.data);

export const getCostByOwner = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/cost/by-owner?${buildQuery(filter)}`).then(r => r.data);

// ─── Latency Analytics ────────────────────────────────────────

export const getLatencySummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/latency/summary?${buildQuery(filter)}`).then(r => r.data);

export const getLatencyTimeSeries = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/latency/timeseries?${buildQuery(filter)}`).then(r => r.data);

export const getLatencyByModel = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/latency/by-model?${buildQuery(filter)}`).then(r => r.data);

export const getLatencyByFeature = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/latency/by-feature?${buildQuery(filter)}`).then(r => r.data);

// ─── Error Analytics ──────────────────────────────────────────

export const getErrorSummary = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/errors/summary?${buildQuery(filter)}`).then(r => r.data);

// ─── Model Analytics ──────────────────────────────────────────

export const getModelAnalytics = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/models?${buildQuery(filter)}`).then(r => r.data);

// ─── Restaurant Analytics ─────────────────────────────────────

export const getRestaurantAnalytics = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/restaurants?${buildQuery(filter)}`).then(r => r.data);

export const getRestaurantDetail = (restaurantId: string, filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/restaurants/${restaurantId}?${buildQuery(filter)}`).then(r => r.data);

// ─── Owner Analytics ──────────────────────────────────────────

export const getOwnerAnalytics = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/owners?${buildQuery(filter)}`).then(r => r.data);

export const getOwnerDetail = (ownerId: string, filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/owners/${ownerId}?${buildQuery(filter)}`).then(r => r.data);

// ─── Feature Analytics ────────────────────────────────────────

export const getFeatureAnalytics = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/features?${buildQuery(filter)}`).then(r => r.data);

// ─── Voice AI Analytics ───────────────────────────────────────

export const getVoiceAnalytics = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/voice?${buildQuery(filter)}`).then(r => r.data);

// ─── Search & Filters ─────────────────────────────────────────

export const searchAiAnalytics = (query: string, filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/ai/search?q=${encodeURIComponent(query)}&${buildQuery(filter)}`).then(r => r.data);

export const getAvailableFilters = () =>
  api.get('/api/admin/analytics/ai/filters').then(r => r.data);

// ─── Exports ──────────────────────────────────────────────────

export const exportAnalyticsCSV = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/export/csv?type=ai&${buildQuery(filter)}`, { responseType: 'blob' }).then(r => r.data);

export const exportAnalyticsExcel = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/export/excel?type=ai&${buildQuery(filter)}`, { responseType: 'blob' }).then(r => r.data);

export const exportAnalyticsPDF = (filter?: AnalyticsFilter) =>
  api.get(`/api/admin/analytics/export/pdf?type=ai&${buildQuery(filter)}`, { responseType: 'blob' }).then(r => r.data);

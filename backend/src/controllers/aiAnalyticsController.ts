/**
 * =============================================================================
 *  aiAnalyticsController.ts — AI Analytics Controller (Phase 2.7)
 * =============================================================================
 *
 * All endpoints for the AI Usage Dashboard.
 * Every response uses the standardized format from ../utils/responseFormatter.
 * Every endpoint requires authentication and RBAC (admin role).
 */

import { Request, Response } from 'express';
import * as aiAnalytics from '../services/aiAnalyticsService';
import { formatSuccess, formatError } from '../utils/responseFormatter';

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractFilter(req: Request): aiAnalytics.AnalyticsFilter {
  const filter: aiAnalytics.AnalyticsFilter = {};

  if (req.query.restaurantId) filter.restaurantId = req.query.restaurantId as string;
  if (req.query.ownerId) filter.ownerId = req.query.ownerId as string;
  if (req.query.model) filter.model = req.query.model as string;
  if (req.query.provider) filter.provider = req.query.provider as string;
  if (req.query.feature) filter.feature = req.query.feature as string;
  if (req.query.search) filter.search = req.query.search as string;

  if (req.query.success === 'true') filter.success = true;
  else if (req.query.success === 'false') filter.success = false;
  if (req.query.failed === 'true') filter.failed = true;
  if (req.query.cached === 'true') filter.cached = true;
  else if (req.query.cached === 'false') filter.cached = false;

  // Date range
  if (req.query.startDate || req.query.endDate) {
    const start = req.query.startDate ? new Date(req.query.startDate as string) : new Date(0);
    const end = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    filter.dateRange = { start, end };
  }

  return filter;
}

function extractPagination(req: Request): aiAnalytics.PaginationParams {
  return {
    page: parseInt(req.query.page as string) || 1,
    limit: parseInt(req.query.limit as string) || 20,
    sort: req.query.sort as string || undefined,
    order: (req.query.order as 'asc' | 'desc') || undefined,
  };
}

function extractTimeGroup(req: Request): aiAnalytics.TimeGroup {
  const groupBy = req.query.groupBy as string;
  if (['day', 'week', 'month', 'year'].includes(groupBy)) {
    return groupBy as aiAnalytics.TimeGroup;
  }
  return 'day';
}

// ─── Dashboard Summary ────────────────────────────────────────────────────

export async function getDashboardSummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getDashboardSummary(filter);
    res.json(formatSuccess(summary, 'Dashboard summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get dashboard summary'));
  }
}

// ─── Token Analytics ──────────────────────────────────────────────────────

export async function getTokenSummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getTokenSummary(filter);
    res.json(formatSuccess(summary, 'Token summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get token summary'));
  }
}

export async function getTokenTimeSeries(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const groupBy = extractTimeGroup(req);
    const data = await aiAnalytics.getTokenTimeSeries(groupBy, filter);
    res.json(formatSuccess(data, 'Token time series retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get token time series'));
  }
}

export async function getTokensByModel(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getTokensByModel(filter, pagination);
    res.json(formatSuccess(data, 'Tokens by model retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get tokens by model'));
  }
}

export async function getTokensByRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getTokensByRestaurant(filter, pagination);
    res.json(formatSuccess(data, 'Tokens by restaurant retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get tokens by restaurant'));
  }
}

export async function getTokensByOwner(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getTokensByOwner(filter, pagination);
    res.json(formatSuccess(data, 'Tokens by owner retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get tokens by owner'));
  }
}

export async function getTokensByFeature(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getTokensByFeature(filter, pagination);
    res.json(formatSuccess(data, 'Tokens by feature retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get tokens by feature'));
  }
}

// ─── Request Analytics ────────────────────────────────────────────────────

export async function getRequestSummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getRequestSummary(filter);
    res.json(formatSuccess(summary, 'Request summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get request summary'));
  }
}

export async function getRequestTimeSeries(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const groupBy = extractTimeGroup(req);
    const data = await aiAnalytics.getRequestTimeSeries(groupBy, filter);
    res.json(formatSuccess(data, 'Request time series retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get request time series'));
  }
}

// ─── Cost Analytics ───────────────────────────────────────────────────────

export async function getCostSummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getCostSummary(filter);
    res.json(formatSuccess(summary, 'Cost summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost summary'));
  }
}

export async function getCostTimeSeries(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const groupBy = extractTimeGroup(req);
    const data = await aiAnalytics.getCostTimeSeries(groupBy, filter);
    res.json(formatSuccess(data, 'Cost time series retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost time series'));
  }
}

export async function getCostByModel(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getCostByModel(filter);
    res.json(formatSuccess(data, 'Cost by model retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost by model'));
  }
}

export async function getCostByFeature(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getCostByFeature(filter);
    res.json(formatSuccess(data, 'Cost by feature retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost by feature'));
  }
}

export async function getCostByRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getCostByRestaurant(filter, pagination);
    res.json(formatSuccess(data, 'Cost by restaurant retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost by restaurant'));
  }
}

export async function getCostByOwner(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getCostByOwner(filter, pagination);
    res.json(formatSuccess(data, 'Cost by owner retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get cost by owner'));
  }
}

// ─── Latency Analytics ────────────────────────────────────────────────────

export async function getLatencySummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getLatencySummary(filter);
    res.json(formatSuccess(summary, 'Latency summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get latency summary'));
  }
}

export async function getLatencyTimeSeries(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const groupBy = extractTimeGroup(req);
    const data = await aiAnalytics.getLatencyTimeSeries(groupBy, filter);
    res.json(formatSuccess(data, 'Latency time series retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get latency time series'));
  }
}

export async function getLatencyByModel(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getLatencyByModel(filter);
    res.json(formatSuccess(data, 'Latency by model retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get latency by model'));
  }
}

export async function getLatencyByFeature(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getLatencyByFeature(filter);
    res.json(formatSuccess(data, 'Latency by feature retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get latency by feature'));
  }
}

// ─── Error Analytics ──────────────────────────────────────────────────────

export async function getErrorSummary(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const summary = await aiAnalytics.getErrorSummary(filter);
    res.json(formatSuccess(summary, 'Error summary retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get error summary'));
  }
}

// ─── Model Analytics ──────────────────────────────────────────────────────

export async function getModelAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getModelAnalytics(filter);
    res.json(formatSuccess(data, 'Model analytics retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get model analytics'));
  }
}

// ─── Restaurant Analytics ─────────────────────────────────────────────────

export async function getRestaurantAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getRestaurantAnalytics(filter, pagination);
    res.json(formatSuccess(data, 'Restaurant analytics retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get restaurant analytics'));
  }
}

export async function getRestaurantDetail(req: Request, res: Response): Promise<void> {
  try {
    const { restaurantId } = req.params;
    const filter = extractFilter(req);
    const data = await aiAnalytics.getRestaurantDetail(restaurantId, filter);
    res.json(formatSuccess(data, 'Restaurant detail retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get restaurant detail'));
  }
}

// ─── Owner Analytics ──────────────────────────────────────────────────────

export async function getOwnerAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getOwnerAnalytics(filter, pagination);
    res.json(formatSuccess(data, 'Owner analytics retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get owner analytics'));
  }
}

export async function getOwnerDetail(req: Request, res: Response): Promise<void> {
  try {
    const { ownerId } = req.params;
    const filter = extractFilter(req);
    const data = await aiAnalytics.getOwnerDetail(ownerId, filter);
    res.json(formatSuccess(data, 'Owner detail retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get owner detail'));
  }
}

// ─── Feature Analytics ────────────────────────────────────────────────────

export async function getFeatureAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.getFeatureAnalytics(filter, pagination);
    res.json(formatSuccess(data, 'Feature analytics retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get feature analytics'));
  }
}

// ─── Voice AI Analytics ───────────────────────────────────────────────────

export async function getVoiceAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const filter = extractFilter(req);
    const data = await aiAnalytics.getVoiceAnalyticsSummary(filter);
    res.json(formatSuccess(data, 'Voice analytics retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get voice analytics'));
  }
}

// ─── Search ───────────────────────────────────────────────────────────────

export async function searchAiAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json(formatError('Search query is required'));
      return;
    }
    const filter = extractFilter(req);
    const pagination = extractPagination(req);
    const data = await aiAnalytics.searchAnalytics(query, filter, pagination);
    res.json(formatSuccess(data, 'Search results retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to search analytics'));
  }
}

// ─── Available Filters (for UI dropdowns) ─────────────────────────────────

export async function getAvailableFilters(req: Request, res: Response): Promise<void> {
  try {
    const features = await aiAnalytics.getFeatureAnalytics({}, { page: 1, limit: 100 });

    const distinctProviders = await aiAnalytics.getCostByModel({});
    const providersList = [...new Set(distinctProviders.map((p: any) => p.model ? p.model.split('/')[0] || 'unknown' : 'unknown'))].filter(Boolean);

    res.json(formatSuccess({
      features: features.data.map((f: any) => f.feature).filter(Boolean),
      models: distinctProviders.map((p: any) => p.model).filter(Boolean),
      providers: providersList,
      errorTypes: [], // Populated on request
    }, 'Available filters retrieved'));
  } catch (err: any) {
    res.status(500).json(formatError(err.message || 'Failed to get available filters'));
  }
}

export default {
  getDashboardSummary,
  getTokenSummary,
  getTokenTimeSeries,
  getTokensByModel,
  getTokensByRestaurant,
  getTokensByOwner,
  getTokensByFeature,
  getRequestSummary,
  getRequestTimeSeries,
  getCostSummary,
  getCostTimeSeries,
  getCostByModel,
  getCostByFeature,
  getCostByRestaurant,
  getCostByOwner,
  getLatencySummary,
  getLatencyTimeSeries,
  getLatencyByModel,
  getLatencyByFeature,
  getErrorSummary,
  getModelAnalytics,
  getRestaurantAnalytics,
  getRestaurantDetail,
  getOwnerAnalytics,
  getOwnerDetail,
  getFeatureAnalytics,
  getVoiceAnalytics,
  searchAiAnalytics,
  getAvailableFilters,
};
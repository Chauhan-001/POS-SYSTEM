/**
 * adminAnalyticsController.ts — Phase 2.6: Delegates to analyticsService
 *
 * Controllers remain thin; all aggregation logic lives in analyticsService.
 * This preserves backward compatibility - existing API consumers see the same responses.
 */

import { Request, Response } from 'express';
import * as analyticsService from '../services/analyticsService';

export async function getDashboardStats(_req: Request, res: Response): Promise<void> {
  try {
    const stats = await analyticsService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('[AdminAnalytics] Dashboard stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getAnalytics(_req: Request, res: Response): Promise<void> {
  try {
    const data = await analyticsService.getAnalyticsData();
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Analytics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getRecentActivity(_req: Request, res: Response): Promise<void> {
  try {
    const AuditLog = (await import('../models/AuditLog')).default;
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(20).exec();
    const data = logs.map((l: any) => ({
      id: l._id.toString(),
      action: l.action,
      timestamp: l.createdAt.toISOString(),
      details: l.details ? JSON.stringify(l.details) : l.performedBy || 'System',
    }));
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Recent activity error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSubscriptionRevenue(req: Request, res: Response): Promise<void> {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const data = await analyticsService.getSubscriptionRevenue(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Subscription revenue error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getLatestRestaurants(_req: Request, res: Response): Promise<void> {
  try {
    const Restaurant = (await import('../models/Restaurant')).default;
    const restaurants = await Restaurant.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 }).limit(10).exec();
    const data = restaurants.map((r: any) => ({
      id: r._id.toString(),
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      status: r.isActive ? 'active' as const : 'inactive' as const,
    }));
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Latest restaurants error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// ─── Phase 2.6 New Endpoints ─────────────────────────────────

export async function getAIAnalyticsEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await analyticsService.getAIAnalytics(days);
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] AI analytics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getDeviceAnalyticsEndpoint(_req: Request, res: Response): Promise<void> {
  try {
    const data = await analyticsService.getDeviceAnalytics();
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Device analytics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getGrowthMetricsEndpoint(_req: Request, res: Response): Promise<void> {
  try {
    const data = await analyticsService.getGrowthMetrics();
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Growth metrics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getChurnMetricsEndpoint(_req: Request, res: Response): Promise<void> {
  try {
    const data = await analyticsService.getChurnMetrics();
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Churn metrics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getActivityMetricsEndpoint(_req: Request, res: Response): Promise<void> {
  try {
    const data = await analyticsService.getActivityMetrics();
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] Activity metrics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getApiRequestAnalyticsEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await analyticsService.getApiRequestAnalytics(days);
    res.json(data);
  } catch (error) {
    console.error('[AdminAnalytics] API request analytics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
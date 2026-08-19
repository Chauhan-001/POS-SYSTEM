/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * helpAnalyticsController — HTTP layer for help-content usage tracking.
 *
 * - POST /api/help-analytics/events  (requireAuth) — record a view/search.
 *   Fire-and-forget from the POS; failures never fail the UI action.
 * - GET  /api/help-analytics/stats   (Owner/Manager) — per-content counts so
 *   the owner can see which FAQ questions and legal documents are actually
 *   read, plus unanswered searches (the content-improvement signal).
 *
 * Every query is scoped to req.user.restaurantId from the JWT — a client can
 * never record or read events for another tenant.
 */

import { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import mongoose from 'mongoose';
import HelpView from '../models/HelpView';

const HELP_TYPES = new Set(['faq', 'legal']);
const EVENT_TYPES = new Set(['view', 'search']);

/** Build the event record from a request. Returns null when invalid. */
function parseEvent(req: Request): {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  viewerId?: string;
  viewerName?: string;
  eventType: 'view' | 'search';
  contentType: 'faq' | 'legal';
  contentKey: string;
  contentTitle: string;
  query?: string;
  resultCount?: number;
  viewedAt: Date;
} | null {
  const auth = req as AuthenticatedRequest;
  const rid = auth.user?.restaurantId;
  if (!rid || !mongoose.Types.ObjectId.isValid(String(rid))) return null;

  const { eventType, contentType, contentKey, contentTitle, branchId, query, resultCount } = req.body || {};
  if (!EVENT_TYPES.has(eventType) || !HELP_TYPES.has(contentType)) return null;
  const key = typeof contentKey === 'string' && contentKey.trim() ? contentKey.trim().slice(0, 200) : '';
  if (!key) return null;

  return {
    restaurantId: new mongoose.Types.ObjectId(String(rid)),
    branchId: branchId && mongoose.Types.ObjectId.isValid(String(branchId)) ? new mongoose.Types.ObjectId(String(branchId)) : undefined,
    viewerId: auth.user?.employeeId ? String(auth.user.employeeId) : auth.user?.userId ? String(auth.user.userId) : undefined,
    viewerName: typeof auth.user?.name === 'string' && auth.user.name.trim() ? auth.user.name.trim() : undefined,
    eventType,
    contentType,
    contentKey: key,
    contentTitle: typeof contentTitle === 'string' && contentTitle.trim() ? contentTitle.trim().slice(0, 500) : key,
    query: typeof query === 'string' && query.trim() ? query.trim().slice(0, 300) : undefined,
    resultCount: typeof resultCount === 'number' && Number.isFinite(resultCount) ? Math.max(0, Math.floor(resultCount)) : undefined,
    viewedAt: new Date(),
  };
}

/** POST /api/help-analytics/events — record one view/search. Best-effort. */
export async function recordHelpEvent(req: Request, res: Response): Promise<void> {
  try {
    const event = parseEvent(req);
    if (!event) {
      res.status(400).json({ error: 'Valid eventType, contentType and contentKey are required' });
      return;
    }
    await HelpView.create(event);
    res.status(201).json({ success: true });
  } catch (error: any) {
    console.error('[HelpAnalytics] record error:', error?.message);
    res.status(500).json({ error: 'Failed to record help event' });
  }
}

/** GET /api/help-analytics/stats — per-content view counts + unanswered searches. */
export async function getHelpStats(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const rid = auth.user?.restaurantId;
    if (!rid || !mongoose.Types.ObjectId.isValid(String(rid))) {
      res.status(400).json({ error: 'Restaurant context missing' });
      return;
    }
    const oid = new mongoose.Types.ObjectId(String(rid));

    const [views, searches] = await Promise.all([
      // Top viewed content (faq questions + legal documents), newest views first.
      HelpView.aggregate([
        { $match: { restaurantId: oid, eventType: 'view' } },
        { $sort: { viewedAt: -1 } },
        {
          $group: {
            _id: { contentType: '$contentType', contentKey: '$contentKey' },
            contentType: { $first: '$contentType' },
            contentKey: { $first: '$contentKey' },
            contentTitle: { $first: '$contentTitle' },
            count: { $sum: 1 },
            lastViewedAt: { $first: '$viewedAt' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      // Search history, newest first — zero-result queries are the signal that
      // help content is missing.
      HelpView.aggregate([
        { $match: { restaurantId: oid, eventType: 'search' } },
        { $sort: { viewedAt: -1 } },
        {
          $group: {
            _id: { contentType: '$contentType', query: '$query' },
            contentType: { $first: '$contentType' },
            query: { $first: '$query' },
            resultCount: { $last: '$resultCount' },
            count: { $sum: 1 },
            lastSearchedAt: { $first: '$viewedAt' },
          },
        },
        { $sort: { lastSearchedAt: -1 } },
        { $limit: 50 },
      ]),
    ]);

    res.json({
      success: true,
      views,
      searches,
      totalViews: await HelpView.countDocuments({ restaurantId: oid, eventType: 'view' }),
      totalSearches: await HelpView.countDocuments({ restaurantId: oid, eventType: 'search' }),
    });
  } catch (error: any) {
    console.error('[HelpAnalytics] stats error:', error?.message);
    res.status(500).json({ error: 'Failed to load help analytics' });
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * feedbackIntelligenceRoutes — deterministic intelligence over receipt-QR
 * feedback: analytics and recurring issues. Owner/Manager only (same gate as
 * /api/marketing). No LLM, RAG or external AI service is involved.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import {
  ensureFeedbackAnalyzed,
  reanalyzeAll,
  getAnalytics,
  getIssues,
} from '../services/feedbackIntelligenceService';

const router = Router();

const restaurantIdOf = (req: Request): string | null => (req as any).user?.restaurantId ?? null;

// ─── POST /api/feedback/analyze ──────────────────────────────────
// Analyze pending feedback rows (lazy ingestion — called when the panel opens
// or the user hits refresh). Bounded per call so the request stays fast.
router.post('/analyze', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const restaurantId = restaurantIdOf(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required' });

    const force = req.body?.force === true;
    const analyzed = force ? await reanalyzeAll(restaurantId) : await ensureFeedbackAnalyzed(restaurantId, 25);
    res.json({ success: true, analyzed });
  } catch (err: any) {
    console.error('[FeedbackIntel] analyze failed:', err.message);
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

// ─── GET /api/feedback/analytics ─────────────────────────────────
router.get('/analytics', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const restaurantId = restaurantIdOf(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required' });

    await ensureFeedbackAnalyzed(restaurantId, 25);
    const analytics = await getAnalytics(restaurantId);
    res.json({ success: true, analytics });
  } catch (err: any) {
    console.error('[FeedbackIntel] analytics failed:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load analytics' });
  }
});

// ─── GET /api/feedback/issues ────────────────────────────────────
router.get('/issues', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const restaurantId = restaurantIdOf(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required' });

    await ensureFeedbackAnalyzed(restaurantId, 25);
    const issues = await getIssues(restaurantId);
    res.json({ success: true, issues });
  } catch (err: any) {
    console.error('[FeedbackIntel] issues failed:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load issues' });
  }
});

export default router;

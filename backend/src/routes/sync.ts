/**
 * =============================================================================
 *  sync.ts — Data Sync API Routes
 * =============================================================================
 *
 * Routes: Pull sync between POS frontend and backend
 * Access: All staff (pull)
 * Path:   /api/sync
 * Note:   Blocked if subscription is suspended. Push was removed (destructive
 *         full-replace semantics) — writes go through per-resource CRUD routes.
 */

import { Router } from 'express';
import { pullSync } from '../controllers/syncController';
import { requireAuth } from '../middleware/authMiddleware';
import { requireSubscription } from '../middleware/subscriptionMiddleware';

const router = Router();

// All staff can pull sync (read data) — blocked if subscription suspended
router.get('/', requireAuth, requireSubscription, pullSync);

export default router;

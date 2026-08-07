/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync Controller — Handles data synchronization between frontend and backend.
 * Delegates business logic to syncService.
 * Pull (GET) returns the latest data from all collections. Push was removed:
 * its full-replace (delete-then-bulk-insert) semantics were too destructive —
 * a stale device could wipe cloud data. Mutations flow through the per-resource
 * CRUD endpoints instead.
 */

import { Request, Response } from 'express';
import { syncService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

/** GET /api/sync — Pull latest data from all syncable collections */
export async function pullSync(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const data = await syncService.pull(auth?.restaurantId);
    res.json({ data, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[SyncController] pull error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

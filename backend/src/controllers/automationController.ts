/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automation Controller — Marketing automation recipe endpoints (Phase 19).
 */

import { Request, Response } from 'express';
import { listAutomations, updateAutomation, deleteAutomation } from '../services/automationService';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

function restaurantId(req: Request): string {
  return String((req as AuthenticatedRequest).user?.restaurantId || '');
}

export async function getAutomations(req: Request, res: Response): Promise<void> {
  try {
    const data = await listAutomations(restaurantId(req));
    res.json({ data });
  } catch (error: any) {
    console.error('[Automations] list error:', error?.message);
    res.status(500).json({ error: 'Failed to list automations' });
  }
}

export async function patchAutomation(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const result = await updateAutomation(restaurantId(req), req.params.id, req.body, auth?.name);
    if (!result) {
      res.status(404).json({ error: 'Automation not found' });
      return;
    }
    res.json({ data: result });
  } catch (error: any) {
    console.error('[Automations] update error:', error?.message);
    res.status(500).json({ error: 'Failed to update automation' });
  }
}

export async function removeAutomation(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const ok = await deleteAutomation(restaurantId(req), req.params.id, auth?.name);
    if (!ok) {
      res.status(404).json({ error: 'Automation not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Automations] delete error:', error?.message);
    res.status(500).json({ error: 'Failed to delete automation' });
  }
}

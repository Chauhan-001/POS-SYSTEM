/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rewards Controller — CRUD for loyalty rewards catalog.
 * Delegates business logic to rewardService.
 */

import { Request, Response } from 'express';
import { rewardService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/**
 * GET /api/rewards — List active rewards (tenant-scoped; legacy global rewards stay visible).
 */
export async function listRewards(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { isActive } = req.query;
    const filter: any = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    const result = await rewardService.list(filter, auth?.restaurantId);
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[RewardsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/rewards/:id — Get a single reward.
 */
export async function getReward(req: Request, res: Response): Promise<void> {
  try {
    const reward = await rewardService.getById(req.params.id);
    if (!reward) {
      res.status(404).json({ error: 'Reward not found' });
      return;
    }
    res.json({ data: reward });
  } catch (error) {
    console.error('[RewardsController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/rewards — Create a new reward tier.
 */
export async function createReward(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const reward = await rewardService.create(req.body, auth?.restaurantId);
    res.status(201).json({ data: reward });
  } catch (error) {
    console.error('[RewardsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/rewards/:id — Update a reward tier.
 */
export async function updateReward(req: Request, res: Response): Promise<void> {
  try {
    const reward = await rewardService.update(req.params.id, req.body);
    if (!reward) {
      res.status(404).json({ error: 'Reward not found' });
      return;
    }
    res.json({ data: reward });
  } catch (error) {
    console.error('[RewardsController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/rewards/:id — Soft-delete a reward tier.
 */
export async function deleteReward(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await rewardService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Reward not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[RewardsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

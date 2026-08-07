/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rewards API routes — delegates to rewardsController.
 */

import { Router } from 'express';
import {
  listRewards,
  getReward,
  createReward,
  updateReward,
  deleteReward,
} from '../controllers/rewardsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createRewardSchema, updateRewardSchema, rewardQuerySchema, rewardParamsSchema } from '../validation';

const router = Router();

// All staff can view rewards catalog (only if plan includes loyalty)
router.get('/', requireAuth, requireFeature('loyalty'), validate({ query: rewardQuerySchema }), listRewards);
router.get('/:id', requireAuth, requireFeature('loyalty'), validate({ params: rewardParamsSchema }), getReward);

// Only Owner and Manager can modify reward tiers
router.post('/', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createRewardSchema }), createReward);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: updateRewardSchema, params: rewardParamsSchema }), updateReward);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: rewardParamsSchema }), deleteReward);

export default router;

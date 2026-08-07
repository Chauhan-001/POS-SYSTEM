/**
 * =============================================================================
 *  branches.ts — Branches API Routes
 * =============================================================================
 *
 * Routes: CRUD for branches + branch settings
 * Access: Owner/Manager (view), Owner (create/update/delete)
 * Path:   /api/branches
 */

import { Router } from 'express';
import {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch,
  getBranchSettings,
  updateBranchSettings,
} from '../controllers/branchesController';
import { requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createBranchSchema, updateBranchSchema, branchParamsSchema, updateBranchSettingsSchema } from '../validation';

const router = Router();

// Only Owner and Manager can view branch management (only if plan includes multi_branch)
router.get('/', requireRole('Owner', 'Manager'), requireFeature('multi_branch'), listBranches);
router.get('/:id', requireRole('Owner', 'Manager'), requireFeature('multi_branch'), validate({ params: branchParamsSchema }), getBranch);

// Only Owner can create, update, or delete branches
router.post('/', requireRole('Owner'), requireFeature('multi_branch'), validate({ body: createBranchSchema }), createBranch);
router.put('/:id', requireRole('Owner'), requireFeature('multi_branch'), validate({ body: updateBranchSchema, params: branchParamsSchema }), updateBranch);
router.delete('/:id', requireRole('Owner'), requireFeature('multi_branch'), validate({ params: branchParamsSchema }), deleteBranch);

// Branch settings (read by Manager, write by Owner)
router.get('/:id/settings', requireRole('Owner', 'Manager'), requireFeature('multi_branch'), validate({ params: branchParamsSchema }), getBranchSettings);
router.put('/:id/settings', requireRole('Owner'), requireFeature('multi_branch'), validate({ body: updateBranchSettingsSchema, params: branchParamsSchema }), updateBranchSettings);

export default router;

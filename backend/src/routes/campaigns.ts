/**
 * =============================================================================
 *  campaigns.ts — Campaign API Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: CRM campaign builder — list, create, update, preview audience,
 *         schedule/status, send, delete.
 * Access: All staff (read/preview), Owner/Manager (write/send).
 * Path:   /api/campaigns
 */

import { Router } from 'express';
import {
  listCampaigns, getCampaign, previewCampaign, createCampaign,
  updateCampaign, deleteCampaign, setCampaignStatus, sendCampaign,
} from '../controllers/campaignController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createCampaignSchema, updateCampaignSchema, campaignParamsSchema, campaignQuerySchema, campaignStatusSchema,
} from '../validation';

const router = Router();

// Read + preview (all staff)
router.get('/', requireAuth, requireFeature('loyalty'), validate({ query: campaignQuerySchema }), listCampaigns);
router.post('/preview', requireAuth, requireFeature('loyalty'), previewCampaign);
router.get('/:id', requireAuth, requireFeature('loyalty'), validate({ params: campaignParamsSchema }), getCampaign);

// Write (Owner/Manager)
router.post('/', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignSchema }), createCampaign);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: updateCampaignSchema, params: campaignParamsSchema }), updateCampaign);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: campaignParamsSchema }), deleteCampaign);
router.patch('/:id/status', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: campaignStatusSchema, params: campaignParamsSchema }), setCampaignStatus);
router.post('/:id/send', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: campaignParamsSchema }), sendCampaign);

export default router;

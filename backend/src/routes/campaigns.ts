/**
 * =============================================================================
 *  campaigns.ts — Campaign API Routes (Phase 1.6 + Phase 6)
 * =============================================================================
 *
 * Routes: CRM campaign builder — list, create, update, preview audience,
 *         schedule/status, send, delete, validate proposal, conflict detection,
 *         frequency check, economics calculation, natural language commands,
 *         automation modes, stop conditions, and monitoring.
 * Access: All staff (read/preview), Owner/Manager (write/send/validate).
 * Path:   /api/campaigns
 */

import { Router } from 'express';
import {
  listCampaigns, getCampaign, previewCampaign, createCampaign,
  updateCampaign, deleteCampaign, setCampaignStatus, sendCampaign,
  validateCampaignProposal, detectConflicts, checkCustomerFrequency,
  calculateCampaignEconomics, isQuietPeriod, checkConsent,
  createProposalFromCommand,
} from '../controllers/campaignController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createCampaignSchema, updateCampaignSchema, campaignParamsSchema, campaignQuerySchema, campaignStatusSchema,
  createCampaignProposalSchema, updateCampaignProposalSchema, campaignProposalParamsSchema,
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

// Phase 6: Campaign Proposal routes
router.post('/proposal/validate', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), validateCampaignProposal);
router.post('/proposal/detect-conflicts', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), detectConflicts);
router.post('/proposal/check-frequency', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), checkCustomerFrequency);
router.post('/proposal/calculate-economics', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), calculateCampaignEconomics);
router.post('/proposal/check-quiet-period', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), isQuietPeriod);
router.post('/proposal/check-consent', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), checkConsent);
router.post('/proposal/from-command', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createCampaignProposalSchema }), createProposalFromCommand);

export default router;

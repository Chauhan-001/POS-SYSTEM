/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Controller — CRM campaign builder endpoints (Phase 1.6) plus Phase 6
 * Promotion Orchestration: CampaignProposal validation, conflict detection,
 * frequency check, economics, quiet periods, consent/opt-out, natural language
 * commands, automation modes, stop conditions, and monitoring.
 *
 * Lifecycle: DRAFT → VALIDATING → READY_FOR_APPROVAL → APPROVED → SCHEDULED → ACTIVE → COMPLETED → MEASURED
 * Failure states: REJECTED | CANCELLED | FAILED | EXPIRED
 */

import { Request, Response } from 'express';
import { campaignService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/** List campaigns - unchanged */
export async function listCampaigns(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { page, limit, status } = req.query;
    const result = await campaignService.list(auth?.restaurantId || '', {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(result);
  } catch (error) {
    console.error('[CampaignController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Get campaign - unchanged */
export async function getCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const campaign = await campaignService.getById(auth?.restaurantId || '', req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ data: campaign });
  } catch (error) {
    console.error('[CampaignController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/campaigns/preview - unchanged */
export async function previewCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await campaignService.previewAudience(auth?.restaurantId || '', req.body.audience || {});
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/campaigns - unchanged */
export async function createCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const campaign = await campaignService.create(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.status(201).json({ data: campaign });
  } catch (error) {
    console.error('[CampaignController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/campaigns/:id - unchanged */
export async function updateCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const campaign = await campaignService.update(auth?.restaurantId || '', req.params.id, req.body, { operator: auth?.name });
    res.json({ data: campaign });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[CampaignController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/campaigns/:id - unchanged */
export async function deleteCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const deleted = await campaignService.delete(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!deleted) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[CampaignController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PATCH /api/campaigns/:id/status - unchanged */
export async function setCampaignStatus(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const campaign = await campaignService.setStatus(auth?.restaurantId || '', req.params.id, req.body.status, { operator: auth?.name });
    res.json({ data: campaign });
  } catch (error) {
    console.error('[CampaignController] status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/campaigns/:id/send - unchanged */
export async function sendCampaign(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await campaignService.send(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[CampaignController] send error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Validate a campaign proposal */
export async function validateCampaignProposal(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const proposalData = req.body;
    const result = await campaignService.validateCampaignProposal(auth?.restaurantId || '', proposalData, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] validate proposal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Detect conflicts with existing campaigns */
export async function detectConflicts(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const proposalData = req.body;
    const result = await campaignService.detectConflicts(auth?.restaurantId || '', proposalData, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] detect conflicts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Check customer contact frequency */
export async function checkCustomerFrequency(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const proposalData = req.body;
    const result = await campaignService.checkCustomerFrequency(auth?.restaurantId || '', proposalData.audience || {}, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] check frequency error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Calculate campaign economics */
export async function calculateCampaignEconomics(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const proposalData = req.body;
    const result = await campaignService.calculateCampaignEconomics(auth?.restaurantId || '', proposalData, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] calculate economics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Check if current time is within quiet period */
export async function isQuietPeriod(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const schedule = req.body.schedule;
    const result = await campaignService.isQuietPeriod(schedule);
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] check quiet period error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Check consent/opt-out status */
export async function checkConsent(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const audience = req.body.audience;
    const result = await campaignService.checkConsent(auth?.restaurantId || '', audience || {}, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] check consent error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Phase 6: Create proposal from natural language command */
export async function createProposalFromCommand(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const command = req.body.command;
    const result = await campaignService.createProposalFromCommand(auth?.restaurantId || '', command, { operator: auth?.name });
    res.json({ data: result });
  } catch (error) {
    console.error('[CampaignController] create proposal from command error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Controller — CRM campaign builder endpoints (Phase 1.6).
 */

import { Request, Response } from 'express';
import { campaignService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

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

/** POST /api/campaigns/preview — Estimate audience size for the builder. */
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

/** POST /api/campaigns/:id/send — Send the campaign now. */
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

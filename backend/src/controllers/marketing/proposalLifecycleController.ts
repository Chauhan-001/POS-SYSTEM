/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proposal lifecycle controller — HTTP surface for the CampaignProposal
 * state machine (submit → approve/reject → schedule → measure).
 *
 * Tenant identity always from req.user.restaurantId; branch-free; role
 * enforcement lives in the route definitions (Owner for approve/schedule).
 */

import { Request, Response } from 'express';
import {
  submitProposal,
  approveProposal,
  rejectProposal,
  scheduleProposal,
  measureProposal,
  listProposals,
} from '../../ai/services/proposalLifecycle';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware';

function userOf(req: Request): { restaurantId?: string; name?: string; id?: string } {
  return (req as AuthenticatedRequest).user as any;
}

function operatorOf(req: Request): { operator?: string } {
  const u = userOf(req);
  return { operator: u?.name || u?.id };
}

/** GET /api/campaigns/proposals — inbox (filterable by status/source). */
export async function listProposalInbox(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const items = await listProposals(restaurantId, {
      approvalStatus: req.query.approvalStatus as string | undefined,
      executionStatus: req.query.executionStatus as string | undefined,
      source: req.query.source as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ proposals: items });
  } catch (error: any) {
    console.error('[ProposalLifecycle] list error:', error.message);
    res.status(500).json({ error: 'Failed to list proposals' });
  }
}

/** POST /api/campaigns/proposals/:id/submit — validate + ready for approval. */
export async function submit(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const out = await submitProposal(restaurantId, req.params.id, operatorOf(req));
    res.json({ success: true, ...out });
  } catch (error: any) {
    respondError(res, error, 'submit');
  }
}

/** POST /api/campaigns/proposals/:id/approve — owner approval. */
export async function approve(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const out = await approveProposal(restaurantId, req.params.id, operatorOf(req));
    res.json({ success: true, ...out });
  } catch (error: any) {
    respondError(res, error, 'approve');
  }
}

/** POST /api/campaigns/proposals/:id/reject — with optional owner feedback. */
export async function reject(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const body = (req.body || {}) as { rating?: 'positive' | 'neutral' | 'negative'; comment?: string; categories?: string[] };
    const out = await rejectProposal(restaurantId, req.params.id, body, operatorOf(req));
    res.json({ success: true, ...out });
  } catch (error: any) {
    respondError(res, error, 'reject');
  }
}

/** POST /api/campaigns/proposals/:id/schedule — materialize the real campaign. */
export async function schedule(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const body = (req.body || {}) as { sendNow?: boolean; scheduledAt?: string };
    const out = await scheduleProposal(restaurantId, req.params.id, body, operatorOf(req));
    res.json({ success: true, ...out });
  } catch (error: any) {
    respondError(res, error, 'schedule');
  }
}

/** POST /api/campaigns/proposals/:id/measure — close the learning loop. */
export async function measure(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(userOf(req)?.restaurantId || '');
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const out = await measureProposal(restaurantId, req.params.id, operatorOf(req));
    res.json({ success: true, ...out });
  } catch (error: any) {
    respondError(res, error, 'measure');
  }
}

function respondError(res: Response, error: any, op: string): void {
  if (error?.name === 'AppError') {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[ProposalLifecycle] ${op} error:`, error?.message);
  res.status(500).json({ error: `Failed to ${op} proposal` });
}

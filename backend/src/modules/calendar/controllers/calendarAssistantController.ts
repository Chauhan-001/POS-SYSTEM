/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * calendarAssistantController.ts — Phase 2 AI-assist endpoints. Admin-only
 * (requireAdminAuth). The LLM output is never persisted directly: generate
 * returns reviewed candidates; approve re-validates and inserts explicitly.
 */

import { Request, Response, NextFunction } from 'express';
import CalendarEvent from '../models/CalendarEvent';
import {
  calendarService,
  CalendarValidationError,
  CalendarNotFoundError,
} from '../services/calendarService';
import {
  calendarAssistantService,
  type GenerateResult,
  type ApproveResult,
} from '../services/calendarAssistantService';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';

type AdminRequest = Request & { admin?: { id?: string; sub?: string } };

function adminUserId(req: AdminRequest): string | null {
  const a = (req as unknown as { admin?: { id?: string; sub?: string } }).admin;
  return a?.id ?? a?.sub ?? null;
}

export async function generateEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body || {}) as { request: string; startDate?: string; endDate?: string };
    const existing = await CalendarEvent.find({})
      .select('_id name startDate endDate scope state region city')
      .lean()
      .exec();
    const result: GenerateResult = await calendarAssistantService.generateCandidates({
      request: body.request,
      startDate: body.startDate,
      endDate: body.endDate,
      existingEvents: existing as never[],
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function approveGenerated(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body || {}) as { candidates: unknown[]; force?: boolean };
    const result: ApproveResult = await calendarAssistantService.approveCandidates(body.candidates, {
      userId: adminUserId(req as AdminRequest),
      force: body.force === true,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function approveDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.approveEvent((req.params as { id: string }).id);
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export function calendarAssistantErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof CalendarValidationError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }
  if (err instanceof CalendarNotFoundError) {
    res.status(404).json({ success: false, error: err.message });
    return;
  }
  next(err);
}

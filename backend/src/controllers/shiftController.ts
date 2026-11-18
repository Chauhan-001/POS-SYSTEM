/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift Controller — Cash drawer shift endpoints (Phase 2).
 *
 * Routes:
 *   POST   /api/shifts/open         — Open a shift (Cashier/Owner/Manager)
 *   POST   /api/shifts/close        — Close a shift (Opener or Manager/Owner)
 *   GET    /api/shifts              — List shifts (tenant-scoped)
 *   GET    /api/shifts/:id          — Get a single shift
 *   GET    /api/shifts/open         — Get current open shift for a register
 *
 * Path: /api/shifts
 */

import { Request, Response } from 'express';
import { shiftService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[ShiftController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** POST /api/shifts/open — Open a shift for a register. */
export async function openShift(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, registerId, openingCash, assignedStaff } = req.body;
    const shift = await shiftService.openShift(auth?.restaurantId || '', {
      branchId: branchId as string,
      registerId: registerId as string,
      openingCash: Number(openingCash),
      assignedStaff: assignedStaff as string,
      operatorId: String(auth?.employeeId || auth?.userId || ''),
      operatorRole: String(auth?.role || ''),
      operatorName: String(auth?.name || ''),
    });
    res.status(201).json({ data: shift });
  } catch (error) { handleError(res, error, 'openShift'); }
}

/** POST /api/shifts/close — Close the current shift for a register. */
export async function closeShift(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, registerId, closingCash, approvedBy, approvalNotes } = req.body;
    const result = await shiftService.closeShift(auth?.restaurantId || '', {
      branchId: branchId as string,
      registerId: registerId as string,
      closingCash: Number(closingCash),
      operatorId: String(auth?.employeeId || auth?.userId || ''),
      operatorRole: String(auth?.role || ''),
      operatorName: String(auth?.name || ''),
      approvedBy,
      approvalNotes,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'closeShift'); }
}

/** GET /api/shifts — List shifts (paged, filterable). */
export async function listShifts(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, registerId, status, startDate, endDate, page, limit } = req.query;
    const result = await shiftService.listShifts(auth?.restaurantId || '', {
      branchId: branchId as string,
      registerId: registerId as string,
      status: status as any,
      startDate: startDate as string,
      endDate: endDate as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'listShifts'); }
}

/** GET /api/shifts/:id — Get a single shift. */
export async function getShift(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const shift = await shiftService.getShift(auth?.restaurantId || '', req.params.id);
    res.json({ data: shift });
  } catch (error) { handleError(res, error, 'getShift'); }
}

/** GET /api/shifts/open — Get the currently open shift for a register. */
export async function getOpenShift(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { registerId } = req.query;
    const shift = await shiftService.getOpenShift(auth?.restaurantId || '', registerId as string);
    res.json({ data: shift });
  } catch (error) { handleError(res, error, 'getOpenShift'); }
}

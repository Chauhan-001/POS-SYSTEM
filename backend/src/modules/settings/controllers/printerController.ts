/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * printerController — REST handlers for the tenant-scoped printer registry (Phase 1.9).
 *
 * Every handler catches its own errors and responds with the proper status code —
 * async throws must never become unhandled rejections (the server exits on those).
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { AppError } from '../../../utils/AppError';
import { printerService, PrinterService } from '../services/printerService';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function actorOf(req: AuthenticatedRequest) {
  const user = req.user!;
  return {
    performedBy: user.name || user.role || 'unknown',
    performedById: user.employeeId || undefined,
    restaurantId: user.restaurantId,
    branchId: (req as any).branchId || undefined,
    ipAddress: req.ip,
  };
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[PrinterController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** Only pass branchId through when it is a valid Mongo ObjectId. The POS sends
 *  client-side branch identifiers (e.g. "branch_main") that would otherwise
 *  throw a CastError against the ObjectId-typed Printer.branchId field. */
function safeBranchId(v: unknown): string | undefined {
  return typeof v === 'string' && OBJECT_ID_RE.test(v) ? v : undefined;
}

export function makePrinterController(service: PrinterService = printerService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const q = req.query as { branchId?: string; deviceId?: string; type?: string; enabled?: string };
        const printers = await service.list(restaurantId, {
          branchId: safeBranchId(q.branchId),
          deviceId: q.deviceId,
          type: q.type,
          enabled: q.enabled === undefined ? undefined : q.enabled === 'true',
        });
        res.json({ data: printers, total: printers.length });
      } catch (error) { handleError(res, error, 'list'); }
    },

    async create(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const printer = await service.create(restaurantId, req.body, actorOf(req as AuthenticatedRequest));
        res.status(201).json(printer);
      } catch (error) { handleError(res, error, 'create'); }
    },

    async update(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const printer = await service.update(restaurantId, req.params.id, req.body, actorOf(req as AuthenticatedRequest));
        res.json(printer);
      } catch (error) { handleError(res, error, 'update'); }
    },

    async remove(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const result = await service.remove(restaurantId, req.params.id, actorOf(req as AuthenticatedRequest));
        res.json(result);
      } catch (error) { handleError(res, error, 'remove'); }
    },

    async test(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const result = await service.test(restaurantId, req.params.id, actorOf(req as AuthenticatedRequest));
        res.json(result);
      } catch (error) { handleError(res, error, 'test'); }
    },
  };
}

export const printerController = makePrinterController();

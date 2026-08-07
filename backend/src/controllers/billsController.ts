/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bills Controller — CRUD for finalized payment bills (immutable records).
 * Delegates business logic to billService.
 * Supports filtering by date, branch, and payment method for reporting.
 */

import { Request, Response } from 'express';
import { billService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

/** GET /api/bills — List bills with optional date/branch/paymentMethod filters */
export async function listBills(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const { date, branchId, paymentMethod, startDate, endDate } = req.query;
    const result = await billService.list({
      date: date as string,
      branchId: branchId as string,
      paymentMethod: paymentMethod as string,
      startDate: startDate as string,
      endDate: endDate as string,
      restaurantId: auth?.restaurantId,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[BillsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/bills/:id — Get single bill with line items */
export async function getBill(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const bill = await billService.getById(req.params.id, { restaurantId: auth?.restaurantId });
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    res.json({ data: bill });
  } catch (error) {
    console.error('[BillsController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/bills — Record a completed payment as a bill */
export async function createBill(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const bill = await billService.create(req.body, {
      restaurantId: auth?.restaurantId,
      branchId: req.body?.branchId,
      operator: req.body?.cashierName || auth?.name,
    });
    res.status(201).json({ data: bill });
  } catch (error) {
    console.error('[BillsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/bills/next-invoice — Get the next atomic invoice number from server */
export async function getNextInvoice(req: Request, res: Response): Promise<void> {
  try {
    const startingNumber = req.query.startingNumber ? parseInt(req.query.startingNumber as string, 10) : undefined;
    const invoiceNumber = await billService.getNextInvoiceNumber(startingNumber);
    res.json({ invoiceNumber });
  } catch (error) {
    console.error('[BillsController] getNextInvoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/bills/:id — Void a bill (soft-delete with reason) */
export async function deleteBill(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const bill = await billService.voidBill(
      req.params.id,
      {
        reason: req.body?.reason || 'Cashier void',
        voidedBy: req.body?.voidedBy || auth?.name || 'Unknown',
        managerPin: req.body?.managerPin,
      },
      { restaurantId: auth?.restaurantId, branchId: req.body?.branchId }
    );
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[BillsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/bills/:id/refund — Refund a bill (full or partial, manager PIN required) */
export async function refundBill(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const bill = await billService.refundBill(
      req.params.id,
      {
        items: req.body?.items,
        reason: req.body?.reason || 'Refund',
        refundedBy: req.body?.refundedBy || auth?.name || 'Unknown',
        managerPin: req.body?.managerPin || '',
      },
      { restaurantId: auth?.restaurantId, branchId: auth?.branchIds?.[0] }
    );
    res.json({ success: true, data: bill });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[BillsController] refund error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customers Controller — Production-grade customer management (Phase 1.6).
 * Every handler derives restaurantId from req.user.restaurantId (multi-tenant
 * isolation) and delegates business logic to customerService. All loyalty
 * numbers are server-authoritative — client payloads are never trusted.
 */

import { Request, Response } from 'express';
import { customerService, loyaltyService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/** GET /api/customers — Paginated list with multi-field search */
export async function listCustomers(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { search, phone, email, gstNumber, referralCode, tag, tier, status, isVip, page, limit, sortBy, sortDir, includeDeleted } = req.query;
    const result = await customerService.list(auth?.restaurantId || '', {
      search: search as string,
      phone: phone as string,
      email: email as string,
      gstNumber: gstNumber as string,
      referralCode: referralCode as string,
      tag: tag as string,
      tier: tier as string,
      status: status as string,
      isVip: isVip as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string,
      sortDir: sortDir as string,
      includeDeleted: includeDeleted as string,
    });
    res.json(result);
  } catch (error) {
    console.error('[CustomersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customers/:id — Get single customer profile */
export async function getCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const customer = await customerService.getById(auth?.restaurantId || '', req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    console.error('[CustomersController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customers/:id/profile — Full CRM profile (orders, rewards, timeline, offers, segments, audit) */
export async function getCustomerProfile(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const profile = await customerService.getProfile(auth?.restaurantId || '', req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: profile });
  } catch (error) {
    console.error('[CustomersController] profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers — Create a new customer (server-authoritative loyalty) */
export async function createCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await customerService.create(auth?.restaurantId || '', req.body, {
      operator: auth?.name,
      branchId: req.body?.branchId || auth?.branchIds?.[0],
    });
    if ('conflict' in result && result.conflict) {
      res.status(409).json({
        error: 'Customer with this phone already exists',
        existing: result.existing,
      });
      return;
    }
    res.status(201).json({ data: result.customer });
  } catch (error) {
    console.error('[CustomersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/customers/:id — Update customer details (loyalty fields ignored) */
export async function updateCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const customer = await customerService.update(auth?.restaurantId || '', req.params.id, req.body, {
      operator: auth?.name,
    });
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    console.error('[CustomersController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/customers/:id — Soft-delete a customer */
export async function deleteCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const deleted = await customerService.delete(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!deleted) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[CustomersController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers/:id/restore — Restore a soft-deleted customer */
export async function restoreCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const customer = await customerService.restore(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!customer) {
      res.status(404).json({ error: 'Customer not found or not deleted' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    console.error('[CustomersController] restore error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers/merge — Merge duplicate customers */
export async function mergeCustomers(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { primaryId, duplicateId } = req.body;
    const customer = await customerService.merge(auth?.restaurantId || '', primaryId, duplicateId, { operator: auth?.name });
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[CustomersController] merge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers/import — Bulk import customers (JSON rows) */
export async function importCustomers(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { customers, mode } = req.body;
    const result = await customerService.importCustomers(auth?.restaurantId || '', customers, mode, {
      operator: auth?.name,
      branchId: auth?.branchIds?.[0],
    });
    res.json({ data: result });
  } catch (error) {
    console.error('[CustomersController] import error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customers/export — Export customers as CSV (or JSON) */
export async function exportCustomers(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { search, tier, segment, format, limit } = req.query;
    const result = await customerService.exportCustomers(auth?.restaurantId || '', {
      search: search as string,
      tier: tier as string,
      segment: segment as string,
      format: (format as 'csv' | 'json') || 'csv',
      limit: limit ? Number(limit) : undefined,
    });
    if (result.csv !== undefined && (format || 'csv') === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
      res.send(result.csv);
      return;
    }
    res.json(result);
  } catch (error) {
    console.error('[CustomersController] export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customers/:id/timeline — Customer activity feed */
export async function getCustomerTimeline(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { page, limit } = req.query;
    const timeline = await customerService.getTimeline(auth?.restaurantId || '', req.params.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(timeline);
  } catch (error) {
    console.error('[CustomersController] timeline error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers/:id/block — Block/unblock a customer with reason */
export async function blockCustomer(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { block, reason } = req.body;
    const customer = await customerService.setBlocked(auth?.restaurantId || '', req.params.id, block === true, reason, {
      operator: auth?.name,
    });
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    console.error('[CustomersController] block error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customers/:id/transactions — Loyalty ledger for a customer */
export async function getCustomerTransactions(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { page, limit, type } = req.query;
    const result = await loyaltyService.getTransactions(auth?.restaurantId || '', req.params.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as string,
    });
    res.json(result);
  } catch (error) {
    console.error('[CustomersController] transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/customers/:id/referral-code — Generate a fresh referral code */
export async function generateReferralCode(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const customer = await customerService.regenerateReferralCode(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ data: customer });
  } catch (error) {
    console.error('[CustomersController] referral-code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

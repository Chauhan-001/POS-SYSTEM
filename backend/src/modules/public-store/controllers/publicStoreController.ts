/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PublicStoreController — lean handlers for the public loyalty store API.
 * No auth on purpose: the public store is a read-only storefront keyed by an
 * opaque per-restaurant token (it must never expose POS/admin data).
 */

import { Request, Response } from 'express';
import { publicStoreService } from '../services/publicStoreService';
import { publicStoreOrderService } from '../services/publicStoreOrderService';
import { AppError } from '../../../utils/AppError';

/** GET /api/public-store/:token → public store config (cached up to 60s). */
export async function getPublicConfig(req: Request, res: Response): Promise<void> {
  try {
    const config = await publicStoreService.getSiteConfig(String(req.params.token || ''));
    res.set('Cache-Control', 'public, max-age=60');
    res.json(config);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[PublicStore] getSiteConfig error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/public-store/:token/menu — customer menu with online availability. */
export async function getPublicMenu(req: Request, res: Response): Promise<void> {
  try {
    const branchId = req.query.branchId as string | undefined;
    const availableOnly = req.query.availableOnly === '1' || req.query.availableOnly === 'true';
    const menu = await publicStoreOrderService.getMenu(String(req.params.token || ''), { branchId, availableOnly });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(menu);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] getMenu error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/public-store/:token/orders/precheck — validate a cart, no side effects. */
export async function precheckOrder(req: Request, res: Response): Promise<void> {
  try {
    const branchId = (req.body as any)?.branchId as string | undefined;
    const result = await publicStoreOrderService.precheck(String(req.params.token || ''), (req.body as any)?.items || [], { branchId });
    res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] precheck error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/public-store/:token/orders — create an online order (authoritative). */
export async function createPublicOrder(req: Request, res: Response): Promise<void> {
  try {
    const result = await publicStoreOrderService.createOrder(String(req.params.token || ''), req.body || {});
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: (error as any).code,
        unavailableItems: (error as any).unavailableItems,
      });
      return;
    }
    console.error('[PublicStore] createOrder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/public-store/:token/orders/:clientRef — live order tracking for
 * the customer site (status, items, timeline). Scoped to the restaurant and
 * the order's own idempotency key; no auth needed (capability URL).
 */
export async function trackPublicOrder(req: Request, res: Response): Promise<void> {
  try {
    const result = await publicStoreOrderService.trackOrder(
      String(req.params.token || ''),
      String(req.params.clientRef || '')
    );
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] trackOrder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/public-store/:token/requests — customer service request from the
 * QR ordering site (call waiter / water / bill / assistance).
 */
export async function createPublicRequest(req: Request, res: Response): Promise<void> {
  try {
    const result = await publicStoreOrderService.createWaiterRequest(String(req.params.token || ''), req.body || {});
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] createRequest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
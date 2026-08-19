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
import { resolveFromCandidates } from '../../voice-inventory/services/ProductResolver';

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

/**
 * GET /api/public-store/:token/search?q= — customer menu search (Phase 11).
 * Resolves the query against the SANITIZED menu (id/name/category/price only —
 * never costs, margins or inventory) using the deterministic-first cascade;
 * the LLM semantic stage is allowed but its product ids are validated against
 * that exact sanitized set, so the site can never surface an invented product.
 */
export async function searchPublicMenu(req: Request, res: Response): Promise<void> {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) { res.json({ results: [], totalItems: 0 }); return; }
    const branchId = req.query.branchId as string | undefined;
    const menu = await publicStoreOrderService.getMenu(String(req.params.token || ''), { branchId });
    const candidates = (menu.categories || [])
      .flatMap((cat: any) => (cat.items || []).map((it: any) => ({
        id: it.id,
        name: it.name,
        category: it.category,
        price: it.price,
        available: it.available,
      })));
    const resolved = await resolveFromCandidates(q, candidates, { allowSemantic: true });
    // Only return the sanitized item for the winner (no costs/inventory leak).
    const winner = resolved.productId ? candidates.find((c: any) => c.id === resolved.productId) : undefined;
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      query: q,
      resolved,
      result: winner ? { id: winner.id, name: winner.name, category: winner.category, price: winner.price, available: winner.available } : null,
      totalItems: candidates.length,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[PublicStore] search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/public-store/:token/offers — customer-facing offer discovery
 * (only active, in-schedule, branch-eligible offers; safe public projection).
 */
export async function getPublicOffers(req: Request, res: Response): Promise<void> {
  try {
    const branchId = req.query.branchId as string | undefined;
    const result = await publicStoreOrderService.getOffers(String(req.params.token || ''), { branchId });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] getOffers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/public-store/:token/promotions — published Promotion Studio
 * creatives (safe presentation fields only; linked offer must be live).
 */
export async function getPublicPromotions(req: Request, res: Response): Promise<void> {
  try {
    const branchId = req.query.branchId as string | undefined;
    const result = await publicStoreOrderService.getPromotions(String(req.params.token || ''), { branchId });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] getPromotions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/public-store/:token/offers/check — validate an offer against the
 * server-computed cart totals (no order side effects). Returns the
 * authoritative discount + adjusted totals; the customer site renders these.
 */
export async function checkPublicOffer(req: Request, res: Response): Promise<void> {
  try {
    const result = await publicStoreOrderService.checkOffer(String(req.params.token || ''), req.body || {});
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code, unavailableItems: (error as any).unavailableItems });
      return;
    }
    console.error('[PublicStore] checkOffer error:', error);
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
 * POST /api/public-store/:token/table/claim — atomically reserve a table for
 * a QR seating (the customer's scan). First seating to claim wins; an
 * abandoned scan expires after the TTL; a table with a live order is never
 * handed out. Returns the claim (expiry) or a 409 with a clear code.
 */
export async function claimPublicTable(req: Request, res: Response): Promise<void> {
  try {
    const result = await publicStoreOrderService.claimForCustomer(
      String(req.params.token || ''),
      String(req.body?.sessionId || ''),
      req.body?.tableId,
      req.body?.tableNumber,
    );
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
      return;
    }
    console.error('[PublicStore] claimTable error:', error);
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
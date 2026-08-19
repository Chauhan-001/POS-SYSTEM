/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * promotionsController.ts — HTTP handlers for the Promotion Studio API.
 * Tenant identity is always derived from the JWT (req.user), never the body.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { promotionsService, resolveOfferProductImages, CreativeCopyInput } from '../services/promotionsService';
import { mediaService } from '../../media/mediaService';
import { audit } from '../../../utils/audit';

interface PromoActor {
  id?: string;
  name: string;
  restaurantId?: string;
  ipAddress?: string;
}

function actorOf(req: Request): PromoActor {
  const user = (req as any).user;
  return {
    id: user?.userId || user?._id?.toString() || user?.id,
    name: user?.name || 'Staff',
    restaurantId: user?.restaurantId ? String(user.restaurantId) : undefined,
    ipAddress: req.ip || undefined,
  };
}

function restaurantIdOf(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

function handleError(res: Response, error: any, prefix: string) {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[${prefix}]`, error?.message || error);
  res.status(500).json({ error: 'Internal server error' });
}

// ─── CRUD ─────────────────────────────────────────────────────────

export async function listPromotions(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const { status, limit, page } = (req as any).query;
    const result = await promotionsService.list(rid, { status, limit, page });
    res.json(result);
  } catch (error) { handleError(res, error, 'Promotions List'); }
}

export async function getPromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.get(rid, req.params.id));
  } catch (error) { handleError(res, error, 'Promotions Get'); }
}

export async function createPromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const promo = await promotionsService.create(rid, req.body, actorOf(req));
    res.status(201).json(promo);
  } catch (error) { handleError(res, error, 'Promotions Create'); }
}

export async function updatePromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.update(rid, req.params.id, req.body, actorOf(req)));
  } catch (error) { handleError(res, error, 'Promotions Update'); }
}

// ─── Status transitions ───────────────────────────────────────────

export async function publishPromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.publish(rid, req.params.id, actorOf(req)));
  } catch (error) { handleError(res, error, 'Promotions Publish'); }
}

export async function archivePromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.archive(rid, req.params.id, actorOf(req)));
  } catch (error) { handleError(res, error, 'Promotions Archive'); }
}

export async function restorePromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.restore(rid, req.params.id, actorOf(req)));
  } catch (error) { handleError(res, error, 'Promotions Restore'); }
}

export async function duplicatePromotion(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.status(201).json(await promotionsService.duplicate(rid, req.params.id, actorOf(req)));
  } catch (error) { handleError(res, error, 'Promotions Duplicate'); }
}

export async function checkPromotionMismatch(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    res.json(await promotionsService.checkMismatch(rid, req.params.id));
  } catch (error) { handleError(res, error, 'Promotions Mismatch'); }
}

// ─── AI copy ──────────────────────────────────────────────────────

export async function generateCopy(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const input: CreativeCopyInput = req.body;
    const result = await promotionsService.generateCreativeCopy(rid, input);
    await audit(req, {
      action: 'PROMOTION_AI_COPY_GENERATED',
      entityType: 'promotion',
      entityId: input.offerId,
      details: { offerId: input.offerId, language: input.language, tone: input.tone, fallback: result.fallback },
    }).catch(() => {});
    res.json(result);
  } catch (error) { handleError(res, error, 'Promotions AiCopy'); }
}

// ─── Restaurant branding for the studio ───────────────────────────

import Restaurant from '../../../models/Restaurant';

export async function getRestaurantBranding(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const restaurant = await Restaurant.findOne({
      _id: new mongoose.Types.ObjectId(rid),
      isDeleted: { $ne: true },
    }).select('name brandName logoUrl coverImageUrl media').lean().exec();
    if (!restaurant) { res.status(404).json({ error: 'Restaurant not found' }); return; }
    res.json({
      name: (restaurant as any).brandName || (restaurant as any).name || '',
      logoUrl: (restaurant as any).logoUrl || null,
      coverImageUrl: (restaurant as any).coverImageUrl || null,
      logoMeta: (restaurant as any).media?.logo || null,
      coverMeta: (restaurant as any).media?.cover || null,
    });
  } catch (error) { handleError(res, error, 'Promotions Branding'); }
}

// ─── Offer helpers for the studio ─────────────────────────────────

export async function getOfferProductImages(req: Request, res: Response): Promise<void> {
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const images = await resolveOfferProductImages(rid, req.params.offerId);
    res.json({ images });
  } catch (error) { handleError(res, error, 'Promotions ProductImages'); }
}

// ─── Media upload (reuses the existing media module + multer config) ──

export async function uploadPromotionMedia(req: Request, res: Response): Promise<void> {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded — expected a single image under the "file" field' });
    return;
  }
  try {
    const rid = restaurantIdOf(req);
    if (!rid) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const actor = actorOf(req);
    const { url } = await mediaService.saveStandalone({
      restaurantId: rid,
      standaloneKind: 'promotion',
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname || '',
      actor,
    });
    const meta = {
      key: url,
      source: (req.body.source as string) || 'uploaded',
      originalName: file.originalname?.slice(0, 255) || '',
      mimetype: file.mimetype,
      size: file.size,
      productId: req.body.productId || undefined,
      offerId: req.body.offerId || undefined,
    };
    await audit(req, {
      action: 'PROMOTION_MEDIA_UPLOADED',
      entityType: 'promotion',
      entityId: meta.offerId || rid,
      details: { key: url, size: file.size, source: meta.source },
    }).catch(() => {});
    res.status(201).json({ url, meta });
  } catch (error) {
    handleError(res, error, 'Promotions Media');
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Promotion Validation — Zod schemas for all promotion API requests.
 *
 * Every referenced offer/media/promotion must belong to the current restaurant
 * (validated in the service layer, never here — the schemas only shape input).
 * Text length caps keep AI-generated copy bounded; status transitions are
 * enforced by the service state machine, not accepted from the client.
 */

import { z } from 'zod';

export const PROMOTION_TEMPLATE_IDS = [
  'hero-banner',
  'offer-card',
  'square-creative',
  'mobile-banner',
] as const;

export const promotionChannelEnum = z.enum(['website', 'qr']);
export const promotionStatusEnum = z.enum(['draft', 'published', 'archived']);

const mediaRefSchema = z.object({
  key: z.string().min(1).max(500),
  source: z.enum(['product', 'restaurant', 'uploaded', 'generated', 'template']),
  originalName: z.string().max(255).optional(),
  mimetype: z.string().max(120).optional(),
  size: z.number().int().min(0).max(100 * 1024 * 1024).optional(),
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  offerId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
}).strict();

const creativeSchema = z.object({
  title: z.string().max(80).optional().default(''),
  subtitle: z.string().max(140).optional().default(''),
  description: z.string().max(400).optional().default(''),
  cta: z.string().max(40).optional().default('Order Now'),
  language: z.enum(['en', 'hi', 'hinglish']).optional().default('en'),
  tone: z.string().max(30).optional().default('friendly'),
  templateId: z.string().max(60).optional().default(''),
  colors: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#0b2a5b'),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#ffffff'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#f59e0b'),
  }).optional(),
  image: mediaRefSchema.nullable().optional(),
  // Per-screen image overrides (template/screen id → media ref). Absent key
  // = that screen uses the primary `image`. Presentation-only data.
  // Partial object (not z.record over the enum): only the four known screen
  // ids are allowed, and none are required.
  screenImages: z.object({
    'hero-banner': mediaRefSchema.optional(),
    'offer-card': mediaRefSchema.optional(),
    'square-creative': mediaRefSchema.optional(),
    'mobile-banner': mediaRefSchema.optional(),
  }).optional(),
  logoKey: z.string().max(500).nullable().optional(),
  productImageKeys: z.array(z.string().max(500)).max(12).optional().default([]),
  layout: z.string().max(30).optional().default('hero'),
}).strict();

export const createPromotionSchema = z.object({
  offerId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'A valid offer is required'),
  name: z.string().min(1).max(120),
  channels: z.array(promotionChannelEnum).min(1).max(4).optional().default(['website']),
  templateId: z.enum(PROMOTION_TEMPLATE_IDS),
  creative: creativeSchema,
  generatedBy: z.enum(['ai', 'template', 'manual']).optional().default('manual'),
}).strict();

export const updatePromotionSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  channels: z.array(promotionChannelEnum).min(1).max(4).optional(),
  templateId: z.enum(PROMOTION_TEMPLATE_IDS).optional(),
  creative: creativeSchema.partial().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const promotionParamsSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid promotion id'),
}).strict();

export const promotionQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'archived', 'all']).optional().default('all'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  page: z.coerce.number().int().min(1).optional().default(1),
}).strict();

/** POST /api/promotions/ai/copy — sanitized creative context only. */
export const promotionAiCopySchema = z.object({
  offerId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  restaurantName: z.string().max(100).optional(),
  offerTitle: z.string().max(120).optional(),
  offerType: z.string().max(30).optional(),
  discountValue: z.string().max(60).optional(),
  minOrderValue: z.number().min(0).optional(),
  productNames: z.array(z.string().max(80)).max(20).optional(),
  validFrom: z.string().max(30).optional(),
  validUntil: z.string().max(30).optional(),
  language: z.enum(['en', 'hi', 'hinglish']).optional().default('en'),
  tone: z.string().max(30).optional().default('friendly'),
  length: z.enum(['short', 'medium']).optional().default('short'),
}).strict();

/** POST /api/promotions/media — multipart image upload (metadata from file). */
export const promotionMediaSchema = z.object({
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  offerId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  source: z.enum(['product', 'restaurant', 'uploaded', 'generated', 'template']).optional().default('uploaded'),
}).strict();

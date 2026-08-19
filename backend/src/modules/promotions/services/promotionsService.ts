/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * promotionsService.ts — Business logic for the Phase C Promotion Studio.
 *
 * The Offer is the financial source of truth. Promotions are presentation:
 *   - create/update validate that offerId belongs to the JWT restaurant.
 *   - publish requires the linked offer to be active/scheduled (never expired)
 *     and stamps publishedAt (idempotent — re-publishing returns the same doc).
 *   - duplicate copies the creative configuration, never financial offer data;
 *     the copy stays a draft connected to the SAME offer by default.
 *   - checkMismatch compares offerSnapshot (taken at creative generation time)
 *     against the live offer so stale creatives are surfaced, never silently
 *     displayed with outdated pricing.
 *
 * AI copy (generateCreativeCopy) uses the existing AI provider abstraction via
 * executeAiText with feature 'promotion-copy' — the same cache/quota/fallback
 * pipeline as every other LLM feature. Only sanitized creative context is sent
 * (restaurant name, offer title/type/value, product names) — never PII, costs,
 * margins, stock, or supplier data.
 */

import mongoose from 'mongoose';
import Promotion, { IPromotion, IOfferSnapshot, PromotionCreativeContent } from '../models/Promotion';
import Offer from '../../../models/Offer';
import Product from '../../../models/Product';
import { AppError } from '../../../utils/AppError';
import { auditLogRepo } from '../../../repositories';
import { executeAiText } from '../../ai/services/aiService';

export interface PromotionActor {
  id?: string;
  name: string;
  restaurantId?: string;
  ipAddress?: string;
}

export interface CreativeCopyInput {
  offerId: string;
  restaurantName?: string;
  offerTitle?: string;
  offerType?: string;
  discountValue?: string;
  minOrderValue?: number;
  productNames?: string[];
  validFrom?: string;
  validUntil?: string;
  language?: 'en' | 'hi' | 'hinglish';
  tone?: string;
  length?: 'short' | 'medium';
}

/** Short, concrete style guides — mirrors the offer-copy prompt (modules/ai/prompts/offerCopy.ts). */
const CREATIVE_TONE_GUIDES: Record<string, string> = {
  friendly: 'warm, casual and welcoming, like a neighbourhood restaurant talking to a regular customer',
  funky: 'bold, playful and full of energy — punchy words, mild slang and personality, like a young street-food brand',
  zomato: 'Zomato/Swiggy style — short, quirky, witty and appetite-driven; foodie humour and playful emoji',
  professional: 'polished, clear and trustworthy — professional restaurant marketing copy, no slang',
  premium: 'elegant and exclusive — refined wording that makes the offer feel like a privilege',
  festive: 'celebration energy — festival framing, joyful words, light festive emoji',
  genz: 'modern Gen-Z voice — casual, punchy one-liners, current slang used naturally',
  minimal: 'very short and clean — fewest words possible while staying clear and friendly',
};

function creativeLanguageInstruction(language: string): string {
  switch (language) {
    case 'hi':
      return 'Write in HINDI (Devanagari or clear Roman Hindi). Keep brand words like OFF, Combo and the discount value in English where it reads naturally.';
    case 'hinglish':
      return 'Write in HINGLISH — a natural mix of Hindi and English like young Indian food brands use on WhatsApp and Zomato (e.g. "Craving hai? 20% OFF mil raha hai!"). Hindi can be Roman script; keep it fun and authentic.';
    default:
      return 'Write in clear, natural English.';
  }
}

export interface CreativeCopyResult {
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  fallback: boolean;
  cached: boolean;
  latency: number;
}

/** Human-friendly discount label (mirrors the public store's projection). */
export function discountDisplay(offer: any): string {
  const v = Number(offer.value) || 0;
  switch (offer.type) {
    case 'percentage': return `${v}% OFF`;
    case 'flat': case 'cashback': case 'coupon': return `₹${v} OFF`;
    case 'bogo': return 'Buy 1 Get 1';
    case 'free_item': return offer.freeItemName ? `Free ${offer.freeItemName}` : 'Free item';
    case 'combo': return `Combo · ₹${Number(offer.comboPrice) || v}`;
    case 'reward_points': return `${v} reward points`;
    case 'festival': return `${v}% OFF`;
    default: return `${v}% OFF`;
  }
}

async function loadOffer(restaurantId: string, offerId: string): Promise<any> {
  const offer = await Offer.findOne({
    _id: new mongoose.Types.ObjectId(offerId),
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    isDeleted: { $ne: true },
  }).lean().exec();
  if (!offer) throw new AppError(404, 'Offer not found for this restaurant');
  return offer;
}

function snapshotFrom(offer: any): IOfferSnapshot {
  return {
    offerId: String(offer._id),
    offerTitle: offer.title || '',
    type: offer.type || '',
    value: Number(offer.value) || 0,
    minOrderValue: offer.minOrderValue || undefined,
    discountDisplay: discountDisplay(offer),
    startDate: offer.startDate || undefined,
    endDate: offer.endDate || undefined,
    offerUpdatedAt: offer.updatedAt || offer.createdAt || undefined,
  };
}

/** Default creative generated from an offer (used when the owner skips AI). */
export function defaultCreative(offer: any, templateId: string): PromotionCreativeContent {
  return {
    title: offer.title || `${discountDisplay(offer)} promotion`,
    subtitle: offer.shortDescription || (offer.minOrderValue ? `On orders above ₹${Math.round(offer.minOrderValue)}` : 'Limited time offer'),
    description: offer.description || '',
    cta: offer.type === 'combo' ? 'Order Combo' : 'Order Now',
    language: 'en',
    tone: 'friendly',
    templateId,
    colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
    image: null,
    logoKey: null,
    productImageKeys: [],
    layout: templateId,
  };
}

export class PromotionsService {
  async list(restaurantId: string, opts: { status?: string; limit?: number; page?: number } = {}) {
    const limit = opts.limit || 50;
    const page = opts.page || 1;
    const filter: any = { restaurantId: new mongoose.Types.ObjectId(restaurantId), isDeleted: { $ne: true } };
    if (opts.status && opts.status !== 'all') filter.status = opts.status;
    const [rows, total] = await Promise.all([
      Promotion.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      Promotion.countDocuments(filter).exec(),
    ]);
    const offerIds = [...new Set(rows.map((r) => String(r.offerId)))];
    const offers = offerIds.length
      ? await Offer.find({ _id: { $in: offerIds.map((id) => new mongoose.Types.ObjectId(id)) }, restaurantId: new mongoose.Types.ObjectId(restaurantId) })
        .select('_id title type value status startDate endDate updatedAt').lean().exec()
      : [];
    const offerById = new Map(offers.map((o) => [String(o._id), o]));
    return {
      promotions: rows.map((r) => ({ ...r, offer: offerById.get(String(r.offerId)) || null })),
      total,
      page,
      limit,
    };
  }

  async get(restaurantId: string, id: string) {
    const promo = await Promotion.findOne({
      _id: new mongoose.Types.ObjectId(id),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!promo) throw new AppError(404, 'Promotion not found');
    const offer = await Offer.findOne({ _id: promo.offerId, restaurantId: new mongoose.Types.ObjectId(restaurantId) })
      .select('_id title type value status startDate endDate updatedAt').lean().exec();
    return { ...promo, offer: offer || null };
  }

  async create(
    restaurantId: string,
    input: {
      offerId: string;
      name: string;
      channels: string[];
      templateId: string;
      creative: PromotionCreativeContent;
      generatedBy?: string;
    },
    actor: PromotionActor,
  ) {
    const offer = await loadOffer(restaurantId, input.offerId);
    const creative: PromotionCreativeContent = {
      ...defaultCreative(offer, input.templateId),
      ...input.creative,
      templateId: input.templateId,
    };
    const promo = await Promotion.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      offerId: offer._id,
      name: input.name,
      status: 'draft',
      channels: (input.channels.length ? input.channels : ['website']) as any,
      templateId: input.templateId,
      creative,
      offerSnapshot: snapshotFrom(offer),
      generatedBy: input.generatedBy === 'ai' ? 'ai' : input.generatedBy === 'template' ? 'template' : 'manual',
    });
    await this.audit(restaurantId, actor, 'PROMOTION_CREATED', String(promo._id), { name: promo.name, offerId: String(offer._id) });
    return this.get(restaurantId, String(promo._id));
  }

  async update(
    restaurantId: string,
    id: string,
    patch: { name?: string; channels?: string[]; templateId?: string; creative?: Partial<PromotionCreativeContent> },
    actor: PromotionActor,
  ) {
    const promo = await Promotion.findOne({
      _id: new mongoose.Types.ObjectId(id),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    });
    if (!promo) throw new AppError(404, 'Promotion not found');
    if (patch.name !== undefined) promo.name = patch.name;
    if (patch.channels !== undefined) promo.channels = patch.channels as any;
    if (patch.templateId !== undefined) {
      promo.templateId = patch.templateId;
      promo.creative.templateId = patch.templateId;
      promo.creative.layout = patch.templateId;
    }
    if (patch.creative !== undefined) {
      promo.creative = {
        ...JSON.parse(JSON.stringify(promo.creative)),
        ...patch.creative,
      } as any;
    }
    await promo.save();
    await this.audit(restaurantId, actor, 'PROMOTION_UPDATED', String(promo._id), { name: promo.name });
    return this.get(restaurantId, id);
  }

  /**
   * Publish — idempotent. Requires the linked offer to be active or scheduled
   * (never expired/cancelled/draft). Re-publishing a published promotion simply
   * refreshes publishedAt.
   */
  async publish(restaurantId: string, id: string, actor: PromotionActor) {
    const promo = await Promotion.findOne({
      _id: new mongoose.Types.ObjectId(id),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    });
    if (!promo) throw new AppError(404, 'Promotion not found');
    if (promo.status === 'archived') {
      throw new AppError(400, 'This promotion is archived. Duplicate it or restore it before publishing.');
    }
    const offer = await Offer.findOne({ _id: promo.offerId, restaurantId: new mongoose.Types.ObjectId(restaurantId) })
      .select('_id title type value minOrderValue startDate endDate updatedAt status').lean().exec();
    if (!offer) throw new AppError(404, 'Linked offer no longer exists');
    if (offer.status !== 'active' && offer.status !== 'scheduled') {
      throw new AppError(400, `Cannot publish — the linked offer is ${offer.status}. Activate the offer first.`);
    }
    promo.status = 'published';
    promo.publishedAt = new Date();
    // Refresh the snapshot (full offer fields) so a freshly published creative
    // is never flagged stale, and the studio can detect later offer edits.
    promo.offerSnapshot = snapshotFrom(offer);
    await promo.save();
    await this.audit(restaurantId, actor, 'PROMOTION_PUBLISHED', String(promo._id), { name: promo.name });
    return this.get(restaurantId, id);
  }

  async archive(restaurantId: string, id: string, actor: PromotionActor) {
    const promo = (await Promotion.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), restaurantId: new mongoose.Types.ObjectId(restaurantId), isDeleted: { $ne: true } },
      { $set: { status: 'archived' } },
      { new: true },
    )) as any;
    if (!promo) throw new AppError(404, 'Promotion not found');
    await this.audit(restaurantId, actor, 'PROMOTION_ARCHIVED', String(promo._id), { name: promo.name });
    return this.get(restaurantId, id);
  }

  /** Restore an archived promotion back to draft so it can be edited/published. */
  async restore(restaurantId: string, id: string, actor: PromotionActor) {
    const promo = (await Promotion.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), restaurantId: new mongoose.Types.ObjectId(restaurantId), status: 'archived', isDeleted: { $ne: true } },
      { $set: { status: 'draft', publishedAt: null } },
      { new: true },
    )) as any;
    if (!promo) throw new AppError(404, 'Archived promotion not found');
    await this.audit(restaurantId, actor, 'PROMOTION_RESTORED', String(promo._id), { name: promo.name });
    return this.get(restaurantId, String(promo._id));
  }

  /**
   * Duplicate — copies the CREATIVE CONFIGURATION only. The copy is a draft,
   * linked to the same offer by default (the owner can re-point it later).
   * Financial offer data is never copied.
   */
  async duplicate(restaurantId: string, id: string, actor: PromotionActor) {
    const promo = (await Promotion.findOne({
      _id: new mongoose.Types.ObjectId(id),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).lean().exec()) as any;
    if (!promo) throw new AppError(404, 'Promotion not found');
    const copy = (await Promotion.create({
      restaurantId: promo.restaurantId,
      offerId: promo.offerId,
      name: `${promo.name} — Copy`,
      status: 'draft',
      channels: [...promo.channels],
      templateId: promo.templateId,
      creative: JSON.parse(JSON.stringify(promo.creative)),
      offerSnapshot: promo.offerSnapshot,
      generatedBy: promo.generatedBy,
      publishedAt: null as any,
    })) as any;
    await this.audit(restaurantId, actor, 'PROMOTION_DUPLICATED', String(copy._id), { from: String(promo._id), name: copy.name });
    return this.get(restaurantId, String(copy._id));
  }

  /**
   * Offer/creative consistency check. Returns true when the live offer no
   * longer matches the snapshot the creative was built from (title, discount,
   * min order, or validity changed since).
   */
  async checkMismatch(restaurantId: string, id: string): Promise<{ mismatched: boolean; reason?: string }> {
    const promo = await Promotion.findOne({
      _id: new mongoose.Types.ObjectId(id),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!promo) throw new AppError(404, 'Promotion not found');
    const offer = await Offer.findOne({ _id: promo.offerId, restaurantId: new mongoose.Types.ObjectId(restaurantId) })
      .select('_id title type value minOrderValue startDate endDate updatedAt status').lean().exec();
    if (!offer) return { mismatched: true, reason: 'Linked offer no longer exists' };
    const snap = promo.offerSnapshot as IOfferSnapshot;
    const diffs: string[] = [];
    if (snap.offerTitle && snap.offerTitle !== offer.title) diffs.push('offer title');
    if (snap.discountDisplay && snap.discountDisplay !== discountDisplay(offer)) diffs.push('discount');
    if ((snap.minOrderValue || 0) !== (Number(offer.minOrderValue) || 0)) diffs.push('minimum order');
    if ((snap.startDate || '') !== (offer.startDate || '')) diffs.push('start date');
    if ((snap.endDate || '') !== (offer.endDate || '')) diffs.push('end date');
    if (offer.status === 'expired' || offer.status === 'cancelled') diffs.push(`offer is ${offer.status}`);
    if (diffs.length === 0) return { mismatched: false };
    return { mismatched: true, reason: `The linked offer changed: ${diffs.join(', ')}. Refresh the creative before publishing.` };
  }

  /**
   * AI creative copy — sanitized context only. Falls back to a deterministic
   * template when the LLM is unavailable (executeAiText already handles this).
   */
  async generateCreativeCopy(restaurantId: string, input: CreativeCopyInput): Promise<CreativeCopyResult> {
    const offer = await loadOffer(restaurantId, input.offerId);
    const restaurantName = input.restaurantName || 'Our restaurant';
    const offerTitle = input.offerTitle || offer.title || 'this offer';
    const discount = input.discountValue || discountDisplay(offer);
    const products = (input.productNames && input.productNames.length ? input.productNames.slice(0, 8).join(', ') : '')
      || (Array.isArray(offer.applicableCategories) && offer.applicableCategories.length ? offer.applicableCategories.join(', ') : '');
    const minOrder = input.minOrderValue ?? offer.minOrderValue;
    const validity = input.validUntil || offer.endDate ? `valid until ${input.validUntil || offer.endDate}` : '';
    const language = input.language || 'en';
    const tone = input.tone || 'friendly';
    const lengthMode = input.length || 'short';
    const toneGuide = CREATIVE_TONE_GUIDES[tone] || CREATIVE_TONE_GUIDES.friendly;

    const context = [
      `Restaurant: ${restaurantName}`,
      `Offer title: ${offerTitle}`,
      `Discount: ${discount}`,
      products ? `Applicable on: ${products}` : '',
      minOrder ? `Minimum order: ₹${Math.round(minOrder)}` : '',
      validity,
      `Tone: ${tone} — ${toneGuide}`,
      `Language: ${creativeLanguageInstruction(language)}`,
      lengthMode === 'short' ? 'Keep it SHORT (max 6 words for title, 1 line for subtitle).' : 'Medium length.',
    ].filter(Boolean).join('\n');

    const prompt = `You are a restaurant marketing copywriter. Write promotion creative copy for the restaurant below. Respond with EXACTLY 4 lines, one per field, with NO labels, NO quotes, NO numbering:
Line 1: a catchy promotion title
Line 2: a short subtitle
Line 3: a one-sentence description with a call to action
Line 4: a short CTA button label (2-3 words)

${context}

Rules:
- Never invent discounts, prices, or dates that are not listed above.
- Never mention internal costs, margins, stock, or customer data.
- Plain text only.`;

    const start = Date.now();
    const result = await executeAiText({ prompt, feature: 'promotion-copy', cacheKeyVariant: String(input.offerId), tenantId: restaurantId });
    const text = String(result.text || '').trim();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4);

    const funky = ['funky', 'genz', 'zomato'].includes(tone);
    const fallbackTitle = `${discount} · ${offerTitle}`;
    const fallbackSubtitle = minOrder
      ? language === 'hinglish' ? `₹${Math.round(minOrder)} se upar ke orders pe`
        : language === 'hi' ? `₹${Math.round(minOrder)} से ऊपर के ऑर्डर पर`
          : `On orders above ₹${Math.round(minOrder)}`
      : language === 'hinglish' ? 'Limited time offer' : language === 'hi' ? 'सीमित समय का ऑफर' : 'Limited time offer';
    const fallbackDesc = language === 'hinglish'
      ? `Get ${discount}${products ? ` on ${products}` : ''}${validity ? ` — ${validity}` : ''}. Order karo aur treat lo!`
      : language === 'hi'
        ? `${discount}${products ? ` on ${products}` : ''}${validity ? ` — ${validity}` : ''}. अभी ऑर्डर करें और ट्रीट लें!`
        : `Get ${discount}${products ? ` on ${products}` : ''}${validity ? ` — ${validity}` : ''}. Order now and treat yourself!`;
    const fallbackCta = language === 'hinglish' ? 'Order Karo' : language === 'hi' ? 'ऑर्डर करें' : funky ? 'Order Now 🔥' : 'Order Now';

    const out: CreativeCopyResult = {
      title: lines[0] || fallbackTitle,
      subtitle: lines[1] || fallbackSubtitle,
      description: lines[2] || fallbackDesc,
      cta: lines[3] || fallbackCta,
      fallback: result.fallback || lines.length < 4,
      cached: result.cached,
      latency: Date.now() - start,
    };
    return out;
  }

  private async audit(restaurantId: string, actor: PromotionActor, action: string, entityId: string, details: Record<string, any>) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'Promotion',
        entityId,
        performedBy: actor.name,
        performedById: actor.id,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        ipAddress: actor.ipAddress,
        details,
      } as any);
    } catch (e) {
      console.warn('[Promotions] audit write failed:', (e as Error).message);
    }
  }
}

export const promotionsService = new PromotionsService();

/** Resolve product image keys for an offer (tenant-scoped) — used by the studio. */
export async function resolveOfferProductImages(restaurantId: string, offerId: string) {
  const offer = await loadOffer(restaurantId, offerId);
  const ids = [...new Set([...(offer.applicableProductIds || []), ...(offer.comboProductIds || [])] as string[])]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (ids.length === 0) return [];
  const products = await Product.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    $or: [{ restaurantId: new mongoose.Types.ObjectId(restaurantId) }, { restaurantId: null }],
    isDeleted: { $ne: true },
  }).select('_id name image variants price').lean().exec();
  return products.map((p) => ({ id: String(p._id), name: p.name, image: p.image || null }));
}

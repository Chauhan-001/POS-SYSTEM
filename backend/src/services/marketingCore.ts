/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingCore — LAYER: CORE
 *
 * Deterministic marketing business logic, fully independent of AI/ML:
 *   - buildMarketingContext: trusted, aggregate-only, tenant-scoped context
 *     (customer counts, segments, inventory signals, festivals)
 *   - buildRuleBasedPlan: rule-based plan from the deterministic offerEngine
 *   - buildFallbackCopy: tone/language-aware deterministic copy templates
 *
 * FUTURE AI INTEGRATION POINT: AI may CONSUME the context produced here
 * (and the plan/copy shapes) later. This module must never import from
 * modules/ai or call any LLM — the core works with zero AI configured.
 */

import mongoose from 'mongoose';
import Restaurant from '../models/Restaurant';
import Customer from '../models/Customer';
import CustomerSegment from '../models/CustomerSegment';
import Product from '../models/Product';
import Offer from '../models/Offer';
import Campaign from '../models/Campaign';
import { getUpcomingFestivals } from './festivalService';
import { generateRecommendations } from './offerEngine';
import { deriveSurplusItems } from './recommendationContext';

// ─── SHARED CORE TYPES (inlined in Phase 3 — previously from modules/ai/prompts) ───

export type CopyLanguage = 'en' | 'hi' | 'hinglish';
export type CopyTone = 'friendly' | 'funky' | 'zomato' | 'professional' | 'premium' | 'festive' | 'genz' | 'minimal';

export interface MarketingContext {
  restaurantName: string;
  city?: string;
  customerCount: number;
  activeCustomers: number;
  newCustomersToday: number;
  dormant30d: number;
  birthdaysThisWeek: number;
  vipCount: number;
  segments: Array<{ name: string; customerCount: number }>;
  topCategories: string[];
  lowStockItems: string[];
  /**
   * Deterministic surplus inventory (same rule as the offer prompt): ONLY
   * these products may be proposed as excess-stock/clearance promotions — the
   * model must never infer surplus on its own, and never clear a low-stock
   * item. Empty/undefined means the deterministic layer found nothing.
   */
  surplusStockItems?: Array<{
    productName: string;
    category?: string;
    currentStock: number;
    maxStock: number;
    surplusQuantity: number;
    unit?: string;
    expiryRisk: boolean;
  }>;
  activeOffers: string[];
  recentCampaigns: number;
  festivals: string[];
}

export interface MarketingRequestInput {
  request: string;
  tone?: 'friendly' | 'premium' | 'exciting' | 'simple' | 'festive';
  language?: 'en' | 'hi' | 'hi-en';
}

export interface OfferCopyInput {
  type: string;
  value: number;
  discountValue?: string;
  applicableCategories: string[];
  targetAudience: string;
  reason: string;
  minOrderValue?: number;
  durationDays: number;
  language?: CopyLanguage;
  /** The copy style the owner picked. Defaults to a warm, friendly tone. */
  tone?: CopyTone;
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Normalized plan shape returned to the UI (mirrors marketingPlanSchema). */
export interface MarketingPlan {
  objective: string;
  summaryInsight: string;
  offer: {
    title: string;
    description: string;
    type: string;
    value: number;
    minOrderValue?: number | null;
    maxDiscount?: number | null;
  };
  audience: { type: string; segmentNames: string[] };
  messages: {
    whatsapp: string;
    sms: string;
    push: string;
    emailSubject: string;
    emailBody: string;
  };
  schedule: { type: string };
  reason: string;
  estimatedImpact: string;
}

// ─── TRUSTED CONTEXT BUILDER ─────────────────────────────────────────

/**
 * Gather aggregate marketing context for the authenticated restaurant.
 * Every query is tenant-scoped. Only counts and names leave this function.
 */
export async function buildMarketingContext(restaurantId: string): Promise<MarketingContext & { segmentsFull: Array<{ id: string; name: string; customerCount: number }> }> {
  const oid = objectId(restaurantId);
  const today = new Date();
  const cutoff30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  // MM-DD values for the next 7 days (birthday matching).
  const weekMonthDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    weekMonthDays.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  const [restaurant, customerCount, activeCustomers, newCustomersToday, dormant30d, vipCount, products, offers, campaignCount, segments] =
    await Promise.all([
      Restaurant.findById(oid).lean().exec(),
      Customer.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }),
      Customer.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, visits: { $gte: 1 } }),
      Customer.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, createdAt: { $gte: new Date(fmtDate(today)) } }),
      Customer.countDocuments({
        restaurantId: oid,
        isDeleted: { $ne: true },
        $or: [{ lastVisit: { $lt: cutoff30 } }, { lastVisit: null }, { lastVisit: { $exists: false } }],
      }),
      Customer.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, visits: { $gte: 20 }, points: { $gte: 500 } }),
      Product.find({ type: 'inventory', restaurantId: oid, isDeleted: { $ne: true } })
        .select('name category currentStock minStock maxStock unit expiryDate')
        .lean()
        .exec(),
      Offer.find({ restaurantId: oid, isDeleted: { $ne: true }, status: 'active' }).select('title').limit(10).lean().exec(),
      Campaign.countDocuments({ restaurantId: oid }),
      CustomerSegment.find({ restaurantId: oid, isDeleted: { $ne: true } })
        .select('name customerCount')
        .sort({ customerCount: -1 })
        .limit(10)
        .lean()
        .exec(),
    ]);

  // Birthdays in the next 7 days (from the birthday field, tenant-scoped).
  const birthdayRe = weekMonthDays.map((md) => new RegExp(md + '$'));
  const birthdaysThisWeek = await Customer.countDocuments({
    restaurantId: oid,
    isDeleted: { $ne: true },
    birthday: { $exists: true, $nin: [null, ''] },
    $or: birthdayRe.map((re) => ({ birthday: re })),
  });

  const catCounts = new Map<string, number>();
  for (const p of products) {
    if (p.category) catCounts.set(p.category, (catCounts.get(p.category) || 0) + 1);
  }
  const topCategories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  const lowStockItems = products
    .filter((p) => p.minStock > 0 && p.currentStock <= p.minStock)
    .slice(0, 5)
    .map((p) => p.name);
  // Same deterministic surplus rule as the offer-recommendation context — the
  // AI marketing planner may only propose clearance for these exact products
  // (never inferred, never low-stock items).
  const surplusStockItems = (deriveSurplusItems(products) || []).slice(0, 5);

  const segmentsFull = segments.map((s: any) => ({ id: s._id.toString(), name: s.name, customerCount: s.customerCount || 0 }));

  return {
    restaurantName: (restaurant as any)?.name || 'Our Restaurant',
    city: (restaurant as any)?.city || (restaurant as any)?.address?.city,
    customerCount: customerCount || 0,
    activeCustomers: activeCustomers || 0,
    newCustomersToday: newCustomersToday || 0,
    dormant30d: dormant30d || 0,
    birthdaysThisWeek,
    vipCount: vipCount || 0,
    segments: segmentsFull.map(({ name, customerCount }) => ({ name, customerCount })),
    topCategories,
    lowStockItems,
    surplusStockItems,
    activeOffers: offers.map((o: any) => o.title),
    recentCampaigns: campaignCount || 0,
    festivals: getUpcomingFestivals(30).slice(0, 3).map((f) => f.name),
    segmentsFull,
  };
}

// ─── RULE-BASED PLAN (deterministic fallback via the offer engine) ────

/** Deterministic plan from the offerEngine (Phases 11/29/30 fallback). */
export async function buildRuleBasedPlan(
  restaurantId: string,
  ctx: MarketingContext & { segmentsFull: Array<{ id: string; name: string; customerCount: number }> },
  input: MarketingRequestInput,
): Promise<MarketingPlan> {
  try {
    const suggestions = await generateRecommendations({
      restaurantId,
      customerCount: ctx.customerCount,
      activeCustomers: ctx.activeCustomers,
      newCustomersToday: ctx.newCustomersToday,
      repeatCustomersToday: Math.max(ctx.activeCustomers - ctx.newCustomersToday, 0),
    });
    const s = suggestions[0];
    if (s) {
      const copy = buildFallbackCopy({
        type: s.type,
        value: s.value,
        applicableCategories: s.applicableCategories || [],
        minOrderValue: s.minOrderValue,
        durationDays: s.defaultDurationDays || 7,
      });
      return {
        objective: input.request,
        summaryInsight: 'Based on your restaurant’s current data, here is a recommended offer.',
        offer: {
          title: s.title,
          description: s.description,
          type: s.type,
          value: s.value,
          minOrderValue: s.minOrderValue ?? null,
          maxDiscount: s.maxDiscount ?? null,
        },
        audience: { type: 'segment', segmentNames: [] },
        messages: copy,
        schedule: { type: 'now' },
        reason: s.recommendationReason,
        estimatedImpact: s.expectedImpact,
      };
    }
  } catch (err: any) {
    console.warn('[Marketing] rule-based plan failed:', err?.message);
  }

  // Final generic fallback — the UI stays usable with zero AI and no data.
  const copy = buildFallbackCopy({ type: 'percentage', value: 10, applicableCategories: [], minOrderValue: 300, durationDays: 7 });
  return {
    objective: input.request,
    summaryInsight: 'Create a simple offer to grow repeat customers.',
    offer: {
      title: 'Special Offer',
      description: 'Enjoy 10% off on your next order above ₹300. A thank you from our team!',
      type: 'percentage',
      value: 10,
      minOrderValue: 300,
      maxDiscount: null,
    },
    audience: { type: 'segment', segmentNames: [] },
    messages: copy,
    schedule: { type: 'now' },
    reason: 'A simple, safe promotion that works for any restaurant.',
    estimatedImpact: 'More orders and repeat visits.',
  };
}

/**
 * Deterministic copy templates — used when the LLM is unavailable (Phase 11).
 * Phase 4: the fallback honours the owner's chosen tone + language so even a
 * no-AI moment returns copy in the style they asked for (never English-only).
 */
export function buildFallbackCopy(
  input: Partial<OfferCopyInput>,
): MarketingPlan['messages'] & { title: string; description: string } {
  const type = input.type || 'percentage';
  const value = input.value || 0;
  const offerText =
    type === 'percentage' ? `${value}% OFF` : type === 'flat' ? `Rs.${value} OFF` : type === 'reward_points' ? `${value} points` : String(value);
  const on = input.applicableCategories && input.applicableCategories.length > 0 ? ` on ${input.applicableCategories.slice(0, 3).join(', ')}` : '';
  const min = input.minOrderValue ? ` above Rs.${input.minOrderValue}` : '';
  const tone = input.tone || 'friendly';
  const language = input.language || 'en';
  const funky = tone === 'funky' || tone === 'genz' || tone === 'zomato';

  // Hinglish / Hindi fallbacks — same offer facts, local voice.
  if (language === 'hinglish') {
    const emoji = funky ? '🔥' : '🎉';
    return {
      title: `${offerText}${on ? ` · ${input.applicableCategories![0]}` : ''}`.slice(0, 60),
      description: `Craving ho ya nahi, ${offerText}${on}${min} hai aapke liye. Treat yourself — order karo aur miss mat karo!`,
      whatsapp: `${emoji} ${offerText}${on}${min}! Counter pe message dikhao aur offer lo. Jaldi aao, bhookh ka intezaar nahi hota!`,
      sms: `Offer: ${offerText}${on}${min}. Ye SMS counter pe dikhao.`,
      push: `${offerText}${on} aaj hi! ${emoji}`,
      emailSubject: `${offerText}${on ? ' ' + on : ''} — bas aapke liye`,
      emailBody: `Hi! Aapke liye khaas offer hai: ${offerText}${on}${min}. Ye email counter pe dikhate hi claim ho jayega. Hum aapka intezaar karenge!`,
    };
  }
  if (language === 'hi') {
    const emoji = funky ? '🔥' : '🎉';
    return {
      title: `${offerText}${on ? ` · ${input.applicableCategories![0]}` : ''}`.slice(0, 60),
      description: `आपके लिए खास ऑफर: ${offerText}${on}${min}। जल्दी करें, यह ऑफर सीमित समय के लिए है!`,
      whatsapp: `${emoji} ${offerText}${on}${min}! काउंटर पर यह मैसेज दिखाएं और ऑफर पाएं। जल्दी आएं!`,
      sms: `ऑफर: ${offerText}${on}${min}। काउंटर पर यह SMS दिखाएं।`,
      push: `${offerText}${on} आज ही! ${emoji}`,
      emailSubject: `${offerText}${on ? ' ' + on : ''} — सिर्फ आपके लिए`,
      emailBody: `नमस्ते! आपके लिए खास ऑफर है: ${offerText}${on}${min}। यह ईमेल काउंटर पर दिखाते ही क्लेम करें। हम आपका इंतज़ार करेंगे!`,
    };
  }

  const emoji = funky ? '🔥' : '🎉';
  const opener = funky
    ? `Big news! ${offerText}${on}${min} — yes, for real.`
    : `Enjoy ${offerText}${on}${min} at our restaurant. A limited-time treat for you — don't miss it!`;
  const wa = funky
    ? `${emoji} ${offerText}${on}${min}! Show this at the counter and thank us later. See you soon!`
    : `${emoji} ${offerText}${on}${min}! Show this message at the counter to claim your treat. See you soon!`;
  return {
    title: `${offerText}${on ? ` · ${input.applicableCategories![0]}` : ''}`.slice(0, 60),
    description: opener,
    whatsapp: wa,
    sms: `Special offer: ${offerText}${on}${min}. Show this SMS at the counter.`,
    push: `${offerText}${on} today! ${emoji}`,
    emailSubject: `${offerText}${on ? ' ' + on : ''} — just for you`,
    emailBody: `Hi! We have a special offer for you: ${offerText}${on}${min}. Show this email at the counter to claim it. We can't wait to serve you!`,
  };
}

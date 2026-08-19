/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingService.ts — Orchestrates the unified Marketing (Offers + Campaigns)
 * experience: Create-with-AI plan generation, offer-copy generation, and the
 * rule-based fallback chain.
 *
 * SECURITY MODEL (Phase 8):
 *   - The frontend NEVER supplies business metrics. The backend gathers trusted
 *     context from MongoDB, scoped to the authenticated restaurant only.
 *   - The LLM NEVER receives customer phone numbers, emails, ids or secrets —
 *     only aggregate counts and names.
 *   - LLM output is UNTRUSTED: it is validated against marketingPlanSchema and
 *     anything invalid is replaced by the deterministic rule-based plan.
 *   - AI never sends anything: the owner reviews the plan in the UI and
 *     explicitly confirms before an Offer/Campaign is created.
 *
 * FALLBACK CHAIN (Phase 29): LLM → offerEngine (rule-based) → copy templates.
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
import { executeAiCall } from '../modules/ai/services/aiService';
import { deriveSurplusItems } from './recommendationContext';
import { buildMarketingPrompt, type MarketingContext, type MarketingRequestInput } from '../modules/ai/prompts/marketing';
import { marketingPlanSchema, offerCopyOutputSchema } from '../modules/ai/validators/ai';
import type { OfferCopyInput } from '../modules/ai/prompts/offerCopy';
import { buildOfferCopyPrompt } from '../modules/ai/prompts/offerCopy';

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

export interface GeneratePlanResult {
  plan: MarketingPlan;
  source: 'ai' | 'rule-based';
  fallback: boolean;
  cached: boolean;
  latency: number;
  /** Aggregate-only context summary (counts + names, never PII). */
  context: {
    restaurantName: string;
    customerCount: number;
    dormant30d: number;
    birthdaysThisWeek: number;
    vipCount: number;
    segments: Array<{ id: string; name: string; customerCount: number }>;
  };
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
      Product.find({ restaurantId: oid, isDeleted: { $ne: true } })
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

// ─── PLAN GENERATION ────────────────────────────────────────────────

/**
 * Generate a marketing plan for the owner's request.
 *   LLM (validated) → rule-based offerEngine fallback.
 * Never throws: always returns a usable plan plus diagnostics.
 */
export async function generateMarketingPlan(
  restaurantId: string,
  input: MarketingRequestInput,
  opts: { bustCache?: boolean } = {},
): Promise<GeneratePlanResult> {
  const start = Date.now();
  const ctx = await buildMarketingContext(restaurantId);

  const prompt = buildMarketingPrompt(input, ctx);
  // cacheKeyVariant = restaurantId: one restaurant can never receive another's
  // cached AI plan (Phase 25). Phase 3: an explicit "Regenerate" passes
  // bustCache=true so the LLM is called fresh and the cache is replaced.
  const result = await executeAiCall({ prompt, feature: 'marketing', cacheKeyVariant: restaurantId, tenantId: restaurantId, bustCache: opts.bustCache });

  if (result.success && !result.fallback) {
    const parsed = marketingPlanSchema.safeParse(result.data);
    if (parsed.success) {
      return {
        plan: normalizePlan(parsed.data),
        source: 'ai',
        fallback: false,
        cached: result.cached,
        latency: Date.now() - start,
        context: summarizeContext(ctx),
      };
    }
    console.warn('[Marketing] LLM plan failed schema validation — using rule-based fallback');
  }

  const plan = await ruleBasedPlan(restaurantId, ctx, input);
  return {
    plan,
    source: 'rule-based',
    fallback: true,
    cached: false,
    latency: Date.now() - start,
    context: summarizeContext(ctx),
  };
}

function summarizeContext(ctx: MarketingContext & { segmentsFull: Array<{ id: string; name: string; customerCount: number }> }) {
  return {
    restaurantName: ctx.restaurantName,
    customerCount: ctx.customerCount,
    dormant30d: ctx.dormant30d,
    birthdaysThisWeek: ctx.birthdaysThisWeek,
    vipCount: ctx.vipCount,
    segments: ctx.segmentsFull.slice(0, 10),
  };
}

function normalizePlan(data: any): MarketingPlan {
  const offer = data.offer || {};
  const messages = data.messages || {};
  const audience = data.audience || {};
  const schedule = data.schedule || {};
  return {
    objective: data.objective || 'Promote your restaurant',
    summaryInsight: data.summaryInsight || '',
    offer: {
      title: offer.title || 'Special Offer',
      description: offer.description || 'Enjoy a special discount on your next order!',
      type: offer.type || 'percentage',
      value: Number(offer.value) || 0,
      minOrderValue: offer.minOrderValue ?? null,
      maxDiscount: offer.maxDiscount ?? null,
    },
    audience: {
      type: audience.type || 'segment',
      segmentNames: Array.isArray(audience.segmentNames) ? audience.segmentNames : [],
    },
    messages: {
      whatsapp: messages.whatsapp || '',
      sms: messages.sms || '',
      push: messages.push || '',
      emailSubject: messages.emailSubject || '',
      emailBody: messages.emailBody || '',
    },
    schedule: { type: schedule.type || 'now' },
    reason: data.reason || '',
    estimatedImpact: data.estimatedImpact || '',
  };
}

/** Deterministic plan from the offerEngine (Phases 11/29/30 fallback). */
async function ruleBasedPlan(
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

// ─── OFFER COPY GENERATION ──────────────────────────────────────────

export interface OfferCopyResult {
  title: string;
  description: string;
  whatsapp: string;
  sms: string;
  push: string;
  emailSubject: string;
  emailBody: string;
  fallback: boolean;
  cached: boolean;
  latency: number;
}

const FIELD_LIMITS: Record<string, number> = { title: 100, description: 500, whatsapp: 200, sms: 120, push: 100, emailSubject: 60, emailBody: 500 };

/**
 * Generate all copy fields with ONE consolidated LLM call (Phase 2) — the five
 * separate per-field calls (title/description/whatsapp/sms/push) are replaced
 * by a single structured request validated against offerCopyOutputSchema.
 * Falls back to deterministic templates when AI is unavailable, the response
 * fails schema validation, or a field comes back empty. cacheKeyVariant is the
 * restaurant id so copy is never shared across tenants; bustCache=true is used
 * for explicit "Regenerate" actions (Phase 3).
 */
export async function generateOfferCopy(
  restaurantId: string,
  input: OfferCopyInput,
  opts: { bustCache?: boolean } = {},
): Promise<OfferCopyResult> {
  const start = Date.now();
  const inputWithDefaults: OfferCopyInput = {
    ...input,
    applicableCategories: input.applicableCategories || [],
    targetAudience: input.targetAudience || 'all customers',
    reason: input.reason || 'promotion',
    durationDays: input.durationDays || 7,
    language: input.language || 'en',
    tone: input.tone || 'friendly',
  };

  // ONE prompt → ONE LLM call → structured JSON (Zod-validated).
  const prompt = buildOfferCopyPrompt(inputWithDefaults);
  const r = await executeAiCall({ prompt, feature: 'offer-copy', cacheKeyVariant: restaurantId, tenantId: restaurantId, bustCache: opts.bustCache });

  const fallback = buildFallbackCopy(inputWithDefaults);
  const out: Record<string, string> = { title: '', description: '', whatsapp: '', sms: '', push: '', emailSubject: '', emailBody: '' };
  let usedFallback = r.fallback || false;

  if (r.success && r.data && !r.fallback) {
    const parsed = offerCopyOutputSchema.safeParse(r.data);
    if (parsed.success) {
      const copy = parsed.data;
      out.title = truncate(copy.title || fallback.title, FIELD_LIMITS.title || 200);
      out.description = truncate(copy.description || fallback.description, FIELD_LIMITS.description || 500);
      out.whatsapp = truncate(copy.whatsapp || fallback.whatsapp, FIELD_LIMITS.whatsapp);
      out.sms = truncate(copy.sms || fallback.sms, FIELD_LIMITS.sms);
      out.push = truncate(copy.push || fallback.push, FIELD_LIMITS.push);
      // Empty individual fields fall back to the deterministic template.
      if (!copy.title || !copy.description || !copy.whatsapp || !copy.sms || !copy.push) usedFallback = true;
    } else {
      console.warn('[Marketing] LLM copy failed schema validation — using deterministic fallback');
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  // Email subject/body are generated deterministically (no dedicated prompt).
  out.emailSubject = truncate(fallback.emailSubject, FIELD_LIMITS.emailSubject);
  out.emailBody = truncate(fallback.emailBody, FIELD_LIMITS.emailBody);

  // Any field still empty after the LLM path → deterministic template.
  for (const key of ['title', 'description', 'whatsapp', 'sms', 'push'] as const) {
    if (!out[key]) {
      out[key] = truncate(fallback[key], FIELD_LIMITS[key] || 200);
      usedFallback = true;
    }
  }

  return {
    title: out.title,
    description: out.description,
    whatsapp: out.whatsapp,
    sms: out.sms,
    push: out.push,
    emailSubject: out.emailSubject,
    emailBody: out.emailBody,
    fallback: usedFallback,
    cached: r.cached,
    latency: Date.now() - start,
  };
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  const cleaned = text.trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Deterministic copy templates — used when the LLM is unavailable (Phase 11).
 * Phase 4: the fallback honours the owner's chosen tone + language so even a
 * no-AI moment returns copy in the style they asked for (never English-only).
 */
function buildFallbackCopy(
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

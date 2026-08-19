/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Controller — Handles all AI API requests.
 * Each endpoint:
 *   1. Receives sanitized data from the frontend
 *   2. Validates via Zod schemas
 *   3. Sanitizes data (strips sensitive fields)
 *   4. Builds prompt
 *   5. Calls AI service
 *   6. Returns structured response
 *
 * The AI NEVER accesses MongoDB directly.
 * All data comes from the frontend (which reads from MongoDB via existing APIs).
 */

import { Request, Response } from 'express';
import { executeAiCall, getFallbackData } from '../services/aiService';
import { recordAiUsage } from '../services/aiUsageLogger';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { sanitizeInventoryItems, sanitizeWasteEntries, sanitizeSalesData } from '../sanitizer';
import { buildDailySummaryPrompt, buildClosingPrompt } from '../prompts/summaries';
import { buildHealthPrompt, buildPurchaseRecPrompt, buildLowStockPrompt, buildWasteAnalysisPrompt } from '../prompts/inventory';
import { buildVoiceParsePrompt } from '../prompts/voice';
import { buildWeatherPrompt } from '../prompts/weather';
import { buildOfferPrompt } from '../prompts/offers';
import { fetchWeatherData } from '../services/weatherService';
import { generateMarketingPlan, generateOfferCopy } from '../../../services/marketingService';
import type { OfferCopyInput } from '../prompts/offerCopy';
import { buildRecommendationContext, resolveBranchScope } from '../../../services/recommendationContext';
import { validateFactConsistency, type FactBundle, type FactValidationResult } from '../../../services/factConsistencyService';

// ─── USAGE RECORDING HELPER ────────────────────────────────────────
// Fire-and-forget: records each AI call so the Admin Dashboard can show
// real AI usage. Never blocks or throws in the request path.

function trackUsage(req: Request, feature: string, result: {
  success: boolean;
  fallback: boolean;
  cached: boolean;
  latency: number;
  promptVersion?: string;
  promptHash?: string;
  cacheBust?: boolean;
}, extra?: {
  validation?: FactValidationResult | null;
  fallbackReason?: string | null;
}): void {
  const validation = extra?.validation;
  recordAiUsage({
    restaurantId: (req as AuthenticatedRequest).user?.restaurantId,
    feature,
    success: result.success,
    fallback: result.fallback,
    cached: result.cached,
    latencyMs: result.latency || 0,
    // Phase 8 — standard telemetry: prompt version, privacy-safe prompt hash,
    // explicit cache-bust flag, validation outcome and fallback reason.
    promptVersion: result.promptVersion,
    promptHash: result.promptHash,
    cacheBust: result.cacheBust,
    validationPassed: validation ? validation.status === 'VALID' : null,
    validationFailed: validation ? validation.status === 'INVALID' : null,
    fallbackReason: extra?.fallbackReason || null,
  });
}

// ─── PHASE 7 — FACT-CONSISTENCY HELPERS ────────────────────────────
// Compares AI narrative against the deterministic facts that were supplied to
// the prompt. INVALID → deterministic fallback (never display false claims).
// The validation result rides along in the response + AIUsageLog telemetry.

/** Serialize an AI feature payload into the free-text claims worth checking. */
function serializeAiOutput(feature: string, data: any): string {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : '';
  const parts: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) parts.push(v.trim()); };
  switch (feature) {
    case 'offers':
      push(data.summaryInsight); push(data.trendNote);
      for (const s of Array.isArray(data.suggestions) ? data.suggestions : []) {
        push(s?.title); push(s?.description); push(s?.reason); push(s?.estimatedImpact);
      }
      break;
    case 'summary':
      push(data.keyInsight); push(data.topPriority); push(data.revenuePrediction);
      for (const a of Array.isArray(data.alerts) ? data.alerts : []) push(a?.message);
      for (const s of Array.isArray(data.itemSuggestions) ? data.itemSuggestions : []) push(typeof s === 'string' ? s : s?.reason || s?.name);
      break;
    case 'inventory-health':
      for (const r of Array.isArray(data.recommendations) ? data.recommendations : []) {
        push(typeof r === 'string' ? r : r?.advice || r?.message || r?.item);
      }
      break;
    case 'purchase-recs':
      for (const r of Array.isArray(data.recommendations) ? data.recommendations : []) {
        push(typeof r === 'string' ? r : r?.reason || r?.advice || r?.item);
      }
      break;
    case 'low-stock':
      for (const p of Array.isArray(data.predictions) ? data.predictions : []) {
        push(typeof p === 'string' ? p : p?.reason || p?.advice || p?.item);
      }
      break;
    case 'waste':
      push(data.actionableAdvice ? String(data.actionableAdvice) : '');
      for (const w of Array.isArray(data.topWasteItems) ? data.topWasteItems : []) {
        push(typeof w === 'string' ? w : w?.name);
      }
      break;
    default:
      // Generic JSON → validate the serialized value (bounded to avoid noise).
      parts.push(JSON.stringify(data).slice(0, 1200));
  }
  return parts.join(' ');
}

/** Deterministic fact bundle for a request — only what was actually supplied. */
function factBundleFor(feature: string, req: Request, ctx?: any): FactBundle {
  const bundle: FactBundle = {};
  if (feature === 'offers' && ctx) {
    const amounts: Record<string, number> = {};
    if (ctx.sales?.monthlyRevenue != null) amounts.revenue = ctx.sales.monthlyRevenue;
    if (ctx.sales?.orderCount != null) amounts.orders = ctx.sales.orderCount;
    if (ctx.sales?.averageOrderValue != null) amounts.aov = ctx.sales.averageOrderValue;
    if (Object.keys(amounts).length) bundle.amounts = amounts;
    bundle.products = (ctx.products || []).map((p: any) => p.name);
    const catNames = ((ctx.products || []) as any[]).map((p: any) => p.category).filter((c): c is string => Boolean(c));
    bundle.categories = [...new Set(catNames)];
    bundle.segments = (ctx.segments || []).map((s: any) => s.name);
    bundle.offers = ((ctx.offerPerformance || []) as any[]).map((o: any) => o.title).filter((t): t is string => Boolean(t));
    bundle.branches = ctx.branchName ? [ctx.branchName] : [];
    bundle.surplusStockItems = (ctx.surplusStockItems || []).map((s: any) => s.productName);
    bundle.lowStockItems = (ctx.inventory || [])
      .filter((i: any) => i.minStock > 0 && i.currentStock <= i.minStock)
      .map((i: any) => i.name);
    bundle.wastageItems = ((ctx.wastage?.topItems || []) as any[]).map((w: any) => w.name).filter(Boolean);
    bundle.deterioratingItems = ((ctx.margin?.deterioratingProducts || []) as any[])
      .map((d: any) => d.productName)
      .filter(Boolean);
    return bundle;
  }
  const items = sanitizeInventoryItems(req.body.items);
  if (feature === 'summary') {
    const sales = sanitizeSalesData(req.body.sales);
    const amounts: Record<string, number> = {};
    if (sales?.totalRevenue != null) amounts.revenue = sales.totalRevenue;
    if (sales?.orderCount != null) amounts.orders = sales.orderCount;
    if (sales?.averageOrderValue != null) amounts.aov = sales.averageOrderValue;
    if (Object.keys(amounts).length) bundle.amounts = amounts;
    // Whitelist the entities the summary prompt actually supplies to the LLM:
    // top-selling items and category breakdowns (plus any inventory items).
    // Without this, an AI mention of a real top seller (e.g. "Mozzarella
    // Cheese") is rejected as unknown_entity and the summary falls back.
    const entityNames = new Set<string>();
    (sales?.topItems || []).forEach((i: any) => { if (i?.name) entityNames.add(String(i.name)); });
    (items || []).forEach((i: any) => { if (i?.name) entityNames.add(String(i.name)); });
    // Payment methods are supplied in the prompt (e.g. "Cash", "UPI") and may
    // be referenced by the AI — whitelist them as known entities.
    (sales?.paymentMethods || []).forEach((p: any) => { if (p?.method) entityNames.add(String(p.method)); });
    bundle.products = [...entityNames];
    bundle.categories = (sales?.categoryBreakdown || [])
      .map((c: any) => c?.category)
      .filter((c: string | undefined): c is string => Boolean(c));
    bundle.lowStockItems = (items || [])
      .filter((i: any) => i.minStock > 0 && i.currentStock <= i.minStock)
      .map((i: any) => i.name);
    return bundle;
  }
  if (items && items.length) {
    bundle.products = items.map((i: any) => i.name).filter((n): n is string => Boolean(n));
    bundle.lowStockItems = items
      .filter((i: any) => i.minStock > 0 && i.currentStock <= i.minStock)
      .map((i: any) => i.name);
  }
  if (feature === 'waste') {
    bundle.products = sanitizeWasteEntries(req.body.wasteEntries || []).map((w: any) => w.itemName || w.name).filter(Boolean);
  }
  return bundle;
}

/** Tenant scope for AI cache keys — always the JWT's restaurantId, never client input. */
function tenantOf(req: Request): string | undefined {
  return (req as AuthenticatedRequest).user?.restaurantId
    ? String((req as AuthenticatedRequest).user!.restaurantId)
    : undefined;
}

// ─── PHASE 7 — FACT-CONSISTENCY APPLICATION ────────────────────────
// Never display AI claims that contradict the deterministic facts the AI was
// given: on INVALID, substitute the feature's deterministic fallback and log
// the failure through the standard telemetry channel.

function applyValidation(feature: string, data: any, bundle: FactBundle): {
  data: any;
  fallback: boolean;
  validation: FactValidationResult;
} {
  const validation = validateFactConsistency(serializeAiOutput(feature, data), bundle);
  if (validation.status === 'INVALID') {
    console.warn(
      `[AiController] ${feature}: fact-consistency INVALID (${validation.violations.length} violations) — substituting deterministic fallback.`
    );
    return { data: getFallbackData(feature as any), fallback: true, validation };
  }
  return { data: undefined, fallback: false, validation };
}

function finalize(feature: string, req: Request, result: any, bundle: FactBundle): any {
  const v = applyValidation(feature, result.data, bundle);
  const payload: any = { ...result };
  if (v.fallback && !payload.fallback) payload.fallback = true;
  if (v.data !== undefined) payload.data = v.data;
  payload.factValidation = v.validation;
  trackUsage(req, feature, result, {
    validation: v.validation,
    fallbackReason: v.fallback ? 'fact-invalid' : result.fallback ? 'ai-unavailable' : null,
  });
  return payload;
}

// ─── INVENTORY HEALTH ──────────────────────────────────────────────

export async function inventoryHealth(req: Request, res: Response): Promise<void> {
  try {
    const items = sanitizeInventoryItems(req.body.items);
    const wasteTotal = req.body.wasteTotal || 0;
    const prompt = buildHealthPrompt(items, wasteTotal);

    const result = await executeAiCall({ prompt, feature: 'inventory-health', tenantId: tenantOf(req) });
    res.json(finalize('inventory-health', req, result, factBundleFor('inventory-health', req)));
  } catch (error: any) {
    console.error('[AiController] inventoryHealth error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── PURCHASE RECOMMENDATIONS ──────────────────────────────────────

export async function purchaseRecommendations(req: Request, res: Response): Promise<void> {
  try {
    const items = sanitizeInventoryItems(req.body.items);
    const prompt = buildPurchaseRecPrompt(items);

    const result = await executeAiCall({ prompt, feature: 'purchase-recs', tenantId: tenantOf(req) });
    res.json(finalize('purchase-recs', req, result, factBundleFor('purchase-recs', req)));
  } catch (error: any) {
    console.error('[AiController] purchaseRecommendations error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── LOW STOCK PREDICTIONS ─────────────────────────────────────────

export async function lowStockPredictions(req: Request, res: Response): Promise<void> {
  try {
    const items = sanitizeInventoryItems(req.body.items);
    const prompt = buildLowStockPrompt(items);

    const result = await executeAiCall({ prompt, feature: 'low-stock', tenantId: tenantOf(req) });
    res.json(finalize('low-stock', req, result, factBundleFor('low-stock', req)));
  } catch (error: any) {
    console.error('[AiController] lowStockPredictions error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── DAILY SUMMARY ─────────────────────────────────────────────────

export async function dailySummary(req: Request, res: Response): Promise<void> {
  try {
    const sales = sanitizeSalesData(req.body.sales);
    const extras = {
      lowStockCount: req.body.lowStockCount || 0,
      openOrderCount: req.body.openOrderCount || 0,
      wasteToday: req.body.wasteToday || 0,
      customerCount: req.body.customerCount || 0,
    };
    const prompt = buildDailySummaryPrompt(sales, extras);

    const result = await executeAiCall({ prompt, feature: 'summary', tenantId: tenantOf(req) });
    res.json(finalize('summary', req, result, factBundleFor('summary', req)));
  } catch (error: any) {
    console.error('[AiController] dailySummary error:', error.message);
    res.status(500).json({ success: false, error: 'AI summary failed', fallback: true, data: null });
  }
}

// ─── WASTE ANALYSIS ────────────────────────────────────────────────

export async function wasteAnalysis(req: Request, res: Response): Promise<void> {
  try {
    const entries = sanitizeWasteEntries(req.body.wasteEntries);
    const prompt = buildWasteAnalysisPrompt(entries);

    const result = await executeAiCall({ prompt, feature: 'waste', tenantId: tenantOf(req) });
    res.json(finalize('waste', req, result, factBundleFor('waste', req)));
  } catch (error: any) {
    console.error('[AiController] wasteAnalysis error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── VOICE PARSE ───────────────────────────────────────────────────

export async function voiceParse(req: Request, res: Response): Promise<void> {
  try {
    const text = req.body.transcript || '';
    const inventoryItems = req.body.items || [];
    const prompt = buildVoiceParsePrompt(text, inventoryItems);

    const result = await executeAiCall({ prompt, feature: 'voice', tenantId: tenantOf(req) });
    trackUsage(req, 'voice', result);
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] voiceParse error:', error.message);
    res.status(500).json({ success: false, error: 'AI parsing failed', fallback: true, data: null });
  }
}

// ─── CLOSING ASSISTANT ─────────────────────────────────────────────

export async function closingAssistant(req: Request, res: Response): Promise<void> {
  try {
    const { totalRevenue = 0, orderCount = 0, lowStockItems = 0, wasteCost = 0 } = req.body;
    const prompt = buildClosingPrompt(totalRevenue, orderCount, lowStockItems, wasteCost);

    const result = await executeAiCall({ prompt, feature: 'closing', tenantId: tenantOf(req) });
    trackUsage(req, 'closing', result);
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] closingAssistant error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── OFFER RECOMMENDATIONS ────────────────────────────────────────────

/**
 * POST /api/ai/offer-recommendations — LLM offer suggestions.
 *
 * Phase 1: the prompt is built from the SAME canonical RecommendationContext
 * the deterministic engine uses (built server-side, tenant-scoped) instead of
 * trusting client-supplied metrics. The LLM output is advisory only — the
 * deterministic engine remains the fallback and the financial authority.
 * Phase 3: an explicit refresh passes bustCache=true so the LLM is called
 * fresh and the cache is replaced.
 */
export async function offerRecommendations(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantOf(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' });
      return;
    }
    // Phase 9 — optional branch scope. A branchId that does not belong to this
    // restaurant is rejected (never silently aggregated, never cross-tenant).
    let branchId: string | undefined;
    if (req.body?.branchId) {
      const scope = await resolveBranchScope(restaurantId, String(req.body.branchId));
      if (!scope) { res.status(400).json({ error: 'Branch not found for this restaurant' }); return; }
      branchId = scope.branchId;
    }
    const ctx = await buildRecommendationContext(restaurantId, { branchId });
    // Weather is the only context the client may legitimately contribute
    // (it is advisory, not financial). Everything else is server-built.
    if (req.body?.weather) ctx.weather = req.body.weather;
    const prompt = buildOfferPrompt(ctx);
    const result = await executeAiCall({
      prompt,
      feature: 'offers',
      tenantId: restaurantId,
      // Phase 9 — branch-scoped cache isolation: Branch A can never receive
      // Branch B's (or the tenant-wide) cached recommendation.
      branchId,
      bustCache: req.body?.bustCache === true,
    });
    // Phase 7 — validate the AI narrative against the deterministic facts it
    // was given; INVALID claims are replaced by the deterministic fallback.
    res.json(finalize('offers', req, result, factBundleFor('offers', req, ctx)));
  } catch (error: any) {
    console.error('[AiController] offerRecommendations error:', error.message);
    res.status(500).json({ success: false, error: 'AI offer analysis failed', fallback: true, data: null });
  }
}

// ─── MARKETING (Create-with-AI) ─────────────────────────────────────

/**
 * POST /api/ai/marketing/generate — Build a full marketing plan (offer +
 * audience + messages + schedule) from the owner's natural-language goal.
 *
 * The backend gathers trusted, aggregate-only, tenant-scoped context and the
 * LLM output is strictly validated server-side. Nothing is ever sent or saved
 * without explicit user confirmation in the UI.
 */
export async function marketingGenerate(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String((req as AuthenticatedRequest).user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' });
      return;
    }
    const { request, tone, language, bustCache } = req.body;
    const result = await generateMarketingPlan(restaurantId, { request, tone, language }, { bustCache: bustCache === true });

    trackUsage(req, 'marketing', {
      success: true,
      fallback: result.source !== 'ai',
      cached: result.cached,
      latency: result.latency,
      cacheBust: bustCache === true,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] marketingGenerate error:', error.message);
    res.status(500).json({ success: false, error: 'AI marketing generation failed', fallback: true, data: null });
  }
}

/**
 * POST /api/ai/offer-copy — Generate all copy fields (title, description,
 * WhatsApp, SMS, push, email) for an offer using the existing offerCopy
 * prompts. Falls back to deterministic templates when AI is unavailable.
 */
export async function offerCopy(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String((req as AuthenticatedRequest).user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' });
      return;
    }
    const input: OfferCopyInput = {
      type: req.body.type,
      value: req.body.value,
      discountValue: req.body.discountValue,
      applicableCategories: req.body.applicableCategories || [],
      targetAudience: req.body.targetAudience,
      reason: req.body.reason,
      minOrderValue: req.body.minOrderValue,
      durationDays: req.body.durationDays,
      language: req.body.language,
      tone: req.body.tone,
    };
    const result = await generateOfferCopy(restaurantId, input, { bustCache: req.body?.bustCache === true });

    trackUsage(req, 'offer-copy', {
      success: true,
      fallback: result.fallback,
      cached: result.cached,
      latency: result.latency,
      cacheBust: req.body?.bustCache === true,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] offerCopy error:', error.message);
    res.status(500).json({ success: false, error: 'AI copy generation failed', fallback: true, data: null });
  }
}

// ─── WEATHER ───────────────────────────────────────────────────────

export async function weatherRecommendation(req: Request, res: Response): Promise<void> {
  try {
    const city = req.body.city || '';

    // Step 1: Fetch real-time weather data from OpenWeatherMap API
    const weatherData = await fetchWeatherData(city);

    // Step 2: Build a compact weather digest for the cache key
    // This ensures cached responses automatically invalidate when weather changes
    const cacheKeyVariant = weatherData
      ? `wth|${weatherData.city}|${weatherData.condition}|${weatherData.temperature}|${weatherData.humidity}|${weatherData.windSpeed}`
      : `wth|${city}|no-data`;

    // Step 3: Build prompt with real weather data as context
    const prompt = buildWeatherPrompt(city, weatherData);

    // Step 4: Let the LLM generate food recommendations based on real weather
    // cacheKeyVariant ensures different weather → different cache entry
    const result = await executeAiCall({ prompt, feature: 'weather', cacheKeyVariant, tenantId: tenantOf(req) });

    // Step 5: Override condition/temp/icon with authoritative real-time data
    if (result.success && weatherData) {
      result.data.condition = weatherData.condition;
      result.data.temperature = weatherData.temperature;
      result.data.icon = weatherData.icon;
    }

    trackUsage(req, 'weather', result);
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] weather error:', error.message);
    // Always return a graceful fallback for weather
    res.json({
      success: true,
      data: {
        condition: 'pleasant',
        temperature: 24,
        icon: '🌤️',
        recommendation: 'AI weather unavailable. Using seasonal defaults.',
        suggestedItems: [
          { name: 'Salads', reason: 'Light meals popular in good weather' },
          { name: 'Fresh Juices', reason: 'Health-conscious choices rise' },
        ],
        inventoryAdjustment: [
          { item: 'Milk', action: 'monitor', reason: 'Standard usage' },
        ],
      },
      latency: 0,
      fallback: true,
      error: error.message,
    });
  }
}

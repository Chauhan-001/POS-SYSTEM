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
import { executeAiCall } from '../services/aiService';
import { recordAiUsage } from '../services/aiUsageLogger';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { sanitizeInventoryItems, sanitizeWasteEntries, sanitizeSalesData } from '../sanitizer';
import { buildDailySummaryPrompt, buildClosingPrompt } from '../prompts/summaries';
import { buildHealthPrompt, buildPurchaseRecPrompt, buildLowStockPrompt, buildWasteAnalysisPrompt } from '../prompts/inventory';
import { buildVoiceParsePrompt } from '../prompts/voice';
import { buildWeatherPrompt } from '../prompts/weather';
import { buildOfferPrompt, type OfferSuggestionInput } from '../prompts/offers';
import { fetchWeatherData } from '../services/weatherService';

// ─── USAGE RECORDING HELPER ────────────────────────────────────────
// Fire-and-forget: records each AI call so the Admin Dashboard can show
// real AI usage. Never blocks or throws in the request path.

function trackUsage(req: Request, feature: string, result: {
  success: boolean;
  fallback: boolean;
  cached: boolean;
  latency: number;
}): void {
  recordAiUsage({
    restaurantId: (req as AuthenticatedRequest).user?.restaurantId,
    feature,
    success: result.success,
    fallback: result.fallback,
    cached: result.cached,
    latencyMs: result.latency || 0,
  });
}

// ─── INVENTORY HEALTH ──────────────────────────────────────────────

export async function inventoryHealth(req: Request, res: Response): Promise<void> {
  try {
    const items = sanitizeInventoryItems(req.body.items);
    const wasteTotal = req.body.wasteTotal || 0;
    const prompt = buildHealthPrompt(items, wasteTotal);

    const result = await executeAiCall({ prompt, feature: 'inventory-health' });
    trackUsage(req, 'inventory-health', result);
    res.json(result);
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

    const result = await executeAiCall({ prompt, feature: 'purchase-recs' });
    trackUsage(req, 'purchase-recs', result);
    res.json(result);
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

    const result = await executeAiCall({ prompt, feature: 'low-stock' });
    trackUsage(req, 'low-stock', result);
    res.json(result);
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

    const result = await executeAiCall({ prompt, feature: 'summary' });
    trackUsage(req, 'summary', result);
    res.json(result);
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

    const result = await executeAiCall({ prompt, feature: 'waste' });
    trackUsage(req, 'waste', result);
    res.json(result);
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

    const result = await executeAiCall({ prompt, feature: 'voice' });
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

    const result = await executeAiCall({ prompt, feature: 'closing' });
    trackUsage(req, 'closing', result);
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] closingAssistant error:', error.message);
    res.status(500).json({ success: false, error: 'AI analysis failed', fallback: true, data: null });
  }
}

// ─── OFFER RECOMMENDATIONS ────────────────────────────────────────────

export async function offerRecommendations(req: Request, res: Response): Promise<void> {
  try {
    const input: OfferSuggestionInput = {
      totalRevenue: req.body.totalRevenue || 0,
      orderCount: req.body.orderCount || 0,
      averageOrderValue: req.body.averageOrderValue || 0,
      topSellingCategories: req.body.topSellingCategories || [],
      lowStockItems: req.body.lowStockItems || [],
      currentOffers: req.body.currentOffers || [],
      customerCount: req.body.customerCount || 0,
      weather: req.body.weather || undefined,
    };
    const prompt = buildOfferPrompt(input);
    const result = await executeAiCall({ prompt, feature: 'offers' });
    trackUsage(req, 'offers', result);
    res.json(result);
  } catch (error: any) {
    console.error('[AiController] offerRecommendations error:', error.message);
    res.status(500).json({ success: false, error: 'AI offer analysis failed', fallback: true, data: null });
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
    const result = await executeAiCall({ prompt, feature: 'weather', cacheKeyVariant });

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

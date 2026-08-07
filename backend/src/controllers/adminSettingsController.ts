/**
 * =============================================================================
 *  adminSettingsController.ts — Platform Settings (MongoDB Persisted)
 * =============================================================================
 *
 * All settings are stored in the Settings collection (one doc per section).
 * Defaults are applied on first read if no document exists yet.
 * Changes persist across server restarts and deployments.
 *
 * Sections:
 *   company      → GET|PUT /admin/settings/company
 *   subscription → GET|PUT /admin/settings/default-subscription
 *   ai           → GET|PUT /admin/settings/ai
 *   general      → GET|PUT /admin/settings/general
 */

import { Request, Response } from 'express';
import Settings, {
  DEFAULT_COMPANY,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_AI,
  DEFAULT_GENERAL,
} from '../models/Settings';
import SubscriptionPlan from '../models/SubscriptionPlan';

// ─── Helpers ────────────────────────────────────────────────────

async function getSettings(key: string, defaults: Record<string, any>): Promise<Record<string, any>> {
  const doc = await Settings.findOneAndUpdate(
    { key },
    { $setOnInsert: { value: defaults } },
    { upsert: true, returnDocument: 'after' }
  ).exec();
  return { ...defaults, ...doc.value };
}

async function updateSettings(key: string, body: Record<string, any>, defaults: Record<string, any>): Promise<Record<string, any>> {
  const merged = { ...defaults, ...body };
  await Settings.findOneAndUpdate(
    { key },
    { $set: { value: merged } },
    { upsert: true }
  ).exec();
  return merged;
}

// ─── Default Plan Fallback ──────────────────────────────────────

let _cachedDefaultPlan: string | null = null;
let _lastPlanFetch = 0;
const PLAN_CACHE_TTL = 60_000; // 1 minute

async function getDefaultPlanFallback(): Promise<string> {
  const now = Date.now();
  if (_cachedDefaultPlan && now - _lastPlanFetch < PLAN_CACHE_TTL) return _cachedDefaultPlan;
  try {
    const firstPlan = await SubscriptionPlan.findOne({ isActive: true }).sort({ price: 1 }).exec();
    _cachedDefaultPlan = firstPlan?.planId || 'basic';
    _lastPlanFetch = now;
  } catch {
    _cachedDefaultPlan = 'basic';
  }
  return _cachedDefaultPlan;
}

// ─── Company Settings ───────────────────────────────────────────

export async function getCompanySettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await getSettings('company', DEFAULT_COMPANY);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Get company error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateCompanySettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await updateSettings('company', req.body, DEFAULT_COMPANY);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Update company error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// ─── Default Subscription Settings ──────────────────────────────

export async function getDefaultSubscriptionSettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await getSettings('subscription', DEFAULT_SUBSCRIPTION);
    // Replace hardcoded 'basic' fallback with real DB plan when no plan saved
    if (!settings.plan || settings.plan === 'basic') {
      settings.plan = await getDefaultPlanFallback();
    }
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Get subscription error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateDefaultSubscriptionSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await updateSettings('subscription', req.body, DEFAULT_SUBSCRIPTION);
    if (!settings.plan || settings.plan === 'basic') {
      settings.plan = await getDefaultPlanFallback();
    }
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Update subscription error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// ─── AI Settings ────────────────────────────────────────────────

export async function getAISettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await getSettings('ai', DEFAULT_AI);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Get AI error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateAISettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await updateSettings('ai', req.body, DEFAULT_AI);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Update AI error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// ─── General Settings ───────────────────────────────────────────

export async function getGeneralSettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await getSettings('general', DEFAULT_GENERAL);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Get general error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateGeneralSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await updateSettings('general', req.body, DEFAULT_GENERAL);
    res.json(settings);
  } catch (error) {
    console.error('[Settings] Update general error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

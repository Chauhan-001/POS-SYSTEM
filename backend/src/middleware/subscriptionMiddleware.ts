/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Subscription Middleware — Checks if a restaurant's subscription is active
 * and if its plan includes a specific feature (e.g. 'ai', 'inventory').
 *
 * Usage:
 *   router.post('/api/ai/summary', requireAuth, requireFeature('ai'), handler);
 *   router.post('/api/billing', requireAuth, requireSubscription, createBill);
 *
 * Skipped for:
 *   - Login/Settings/Renew/Subscription-status endpoints
 *   - Admin routes (admin can always access)
 */

import { Request, Response, NextFunction } from 'express';
import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import { effectiveFeatures } from '../utils/subscriptionFeatures';

/**
 * Middleware to reject requests from restaurants with suspended subscriptions.
 * Allows requests with an active/trial/grace subscription.
 */
export async function requireSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurantId = (req as any).user?.restaurantId;
    if (!restaurantId) {
      // No restaurant context = admin or public route
      next();
      return;
    }

    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      // No subscription record yet = allow (first-time setup)
      next();
      return;
    }

    if (sub.status === 'suspended') {
      res.status(403).json({
        error: 'Subscription suspended',
        message: 'Your subscription has been suspended. Please renew to continue using POS features.',
        code: 'SUBSCRIPTION_SUSPENDED',
      });
      return;
    }

    // Allow trial, active, grace
    next();
  } catch (error) {
    console.error('[SubscriptionMiddleware] Error:', error);
    next(); // Fail open to avoid blocking the restaurant
  }
}

/**
 * Middleware factory that checks if the restaurant's subscription plan
 * includes a specific feature (e.g. 'ai', 'loyalty', 'inventory').
 *
 * Usage: router.post('/api/ai/summary', requireAuth, requireFeature('ai'), handler);
 *
 * Returns 403 if the plan does not include the feature.
 * Admins are always allowed (no restaurant context).
 */
/**
 * requireFeature(feature) → 403 if the restaurant's plan doesn't include it.
 *
 * The subscription lookup is cached in-memory per tenant+feature for a short
 * TTL. The key is the full tenant identity (restaurantId), so a cache entry can
 * never leak across restaurants; plan/feature changes apply within the TTL.
 * Authorization is never weakened — a miss always re-reads the subscription.
 */
const FEATURE_CACHE_TTL_MS = 30_000;
const featureCheckCache = new Map<string, { allowed: boolean; expiresAt: number }>();

function readFeatureCache(key: string): boolean | undefined {
  const hit = featureCheckCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.allowed;
  return undefined;
}
function writeFeatureCache(key: string, allowed: boolean): void {
  featureCheckCache.set(key, { allowed, expiresAt: Date.now() + FEATURE_CACHE_TTL_MS });
  // Opportunistic cleanup — never grows unbounded for long.
  if (featureCheckCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of featureCheckCache) if (v.expiresAt <= now) featureCheckCache.delete(k);
  }
}

export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const restaurantId = (req as any).user?.restaurantId;
      if (!restaurantId) {
        // No restaurant context = admin or public route
        next();
        return;
      }

      const cacheKey = `${restaurantId}:${feature}`;
      const cached = readFeatureCache(cacheKey);
      if (cached !== undefined) {
        if (!cached) {
          res.status(403).json({
            error: 'Feature not available',
            message: `Your current plan does not include "${feature}". Upgrade to access this feature.`,
            code: 'FEATURE_NOT_IN_PLAN',
            requiredFeature: feature,
          });
          return;
        }
        next();
        return;
      }

      const sub = await Subscription.findOne({ restaurantId }).exec();
      if (!sub) {
        // No subscription record yet = first-time setup, allow
        writeFeatureCache(cacheKey, true);
        next();
        return;
      }

      if (sub.status === 'suspended') {
        res.status(403).json({
          error: 'Subscription suspended',
          message: 'Your subscription has been suspended. Please renew to continue using POS features.',
          code: 'SUBSCRIPTION_SUSPENDED',
        });
        return;
      }

      // Free trial unlocks every feature — no plan restriction during trial
      if (sub.status === 'trial') {
        writeFeatureCache(cacheKey, true);
        next();
        return;
      }

      const allowed = effectiveFeatures(sub.features, sub.grantedFeatures).includes(feature);
      if (!allowed) {
        const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();
        res.status(403).json({
          error: 'Feature not available',
          message: `Your current plan (${plan?.name || sub.plan}) does not include "${feature}". Upgrade to access this feature.`,
          code: 'FEATURE_NOT_IN_PLAN',
          requiredFeature: feature,
          currentPlan: sub.plan,
        });
        return;
      }

      writeFeatureCache(cacheKey, true);
      next();
    } catch (error) {
      console.error('[SubscriptionMiddleware] requireFeature error:', error);
      next(); // Fail open
    }
  };
}

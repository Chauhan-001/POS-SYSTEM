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
export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const restaurantId = (req as any).user?.restaurantId;
      if (!restaurantId) {
        // No restaurant context = admin or public route
        next();
        return;
      }

      const sub = await Subscription.findOne({ restaurantId }).exec();
      if (!sub) {
        // No subscription record yet = first-time setup, allow
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
        next();
        return;
      }

      if (!sub.features.includes(feature)) {
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

      next();
    } catch (error) {
      console.error('[SubscriptionMiddleware] requireFeature error:', error);
      next(); // Fail open
    }
  };
}

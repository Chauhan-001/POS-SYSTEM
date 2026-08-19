/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entitlement Service — Centralized subscription feature entitlement checks.
 *
 * Instead of scattering `if(plan === 'professional')` checks throughout the codebase,
 * all feature and limit checks go through this service. This makes it easy to:
 * - Add new limits/features without changing business logic
 * - Maintain consistent error messages
 * - Audit which features are being checked
 *
 * Usage:
 *   import { entitlementService } from '../services/entitlementService';
 *   const canCreate = await entitlementService.canCreateBranch(restaurantId);
 *   if (!canCreate.allowed) { return res.status(403).json({ ... }); }
 */

import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Branch from '../models/Branch';
import Employee from '../models/Employee';
import Table from '../models/Table';
import { effectiveFeatures } from '../utils/subscriptionFeatures';

export interface EntitlementResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
  remaining?: number;
}

export class EntitlementService {
  /**
   * Check if a restaurant can use a specific feature.
   * Features are defined in the plan's features array (e.g. 'multi_branch', 'ai', 'loyalty').
   */
  async canUseFeature(restaurantId: string, feature: string): Promise<EntitlementResult> {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      return { allowed: true }; // No subscription = first-time setup, allow
    }

    if (sub.status === 'suspended') {
      return { allowed: false, reason: 'Subscription is suspended. Please renew to access features.' };
    }

    // Free trial unlocks every feature
    if (sub.status === 'trial') {
      return { allowed: true };
    }

    const hasFeature = effectiveFeatures(sub.features, sub.grantedFeatures).includes(feature);
    if (!hasFeature) {
      const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();
      return {
        allowed: false,
        reason: `Your current plan (${plan?.name || sub.plan}) does not include ${feature.replace(/_/g, ' ')}. Upgrade to enable this feature.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a restaurant can create additional branches.
   * Validates subscription status, multi_branch feature, and branch count limit.
   */
  async canCreateBranch(restaurantId: string): Promise<EntitlementResult> {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      return { allowed: true }; // First-time setup, allow
    }

    if (sub.status === 'suspended') {
      return { allowed: false, reason: 'Subscription is suspended. Please renew to manage branches.' };
    }

    const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();

    // Count current active (non-deleted) branches for this restaurant
    const branchCount = await Branch.countDocuments({
      restaurantId,
      isDeleted: { $ne: true },
    }).exec();

    // Determine the max branches limit from subscription snapshot or plan
    const maxBranches = sub.limits?.maxBranches ?? plan?.limits?.maxBranches ?? 1;

    // Free trial unlocks every feature — multi-branch included. Admin-granted
    // add-ons count too, so granting multi_branch unlocks branch creation.
    // If the plan doesn't have multi_branch feature, only allow 1 branch (head branch)
    const hasMultiBranch = sub.status === 'trial' || effectiveFeatures(sub.features, sub.grantedFeatures).includes('multi_branch');
    if (!hasMultiBranch && branchCount >= 1) {
      return {
        allowed: false,
        reason: 'Your current plan does not support multiple branches. Upgrade to create more branches.',
        limit: 1,
        current: branchCount,
        remaining: 0,
      };
    }

    // If maxBranches is 0, it means unlimited
    if (maxBranches === 0) {
      return { allowed: true, limit: 0, current: branchCount, remaining: -1 };
    }

    if (branchCount >= maxBranches) {
      return {
        allowed: false,
        reason: `Your plan allows ${maxBranches} branch${maxBranches > 1 ? 'es' : ''}. Upgrade your subscription to create more branches.`,
        limit: maxBranches,
        current: branchCount,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      limit: maxBranches,
      current: branchCount,
      remaining: maxBranches - branchCount,
    };
  }

  /**
   * Get the branch usage summary for a restaurant.
   */
  async getBranchUsage(restaurantId: string) {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    const plan = sub
      ? await SubscriptionPlan.findOne({ planId: sub.plan }).exec()
      : null;

    const totalBranches = await Branch.countDocuments({
      restaurantId,
      isDeleted: { $ne: true },
    }).exec();

    const activeBranches = await Branch.countDocuments({
      restaurantId,
      isActive: true,
      isDeleted: { $ne: true },
    }).exec();

    const maxBranches = sub?.limits?.maxBranches ?? plan?.limits?.maxBranches ?? 1;
    const remainingBranches = maxBranches === 0 ? -1 : Math.max(0, maxBranches - totalBranches);

    // Get branch details
    const branches = await Branch.find({
      restaurantId,
      isDeleted: { $ne: true },
    }).sort({ name: 1 }).exec();

    const branchDetails = await Promise.all(branches.map(async (b) => {
      const [employeeCount, tableCount] = await Promise.all([
        Employee.countDocuments({ branchId: b._id.toString(), status: 'Active' }).exec(),
        Table.countDocuments({ branchId: b._id.toString() }).exec(),
      ]);
      return {
        id: b._id.toString(),
        name: b.name,
        status: b.isActive ? 'active' : 'inactive',
        isHeadBranch: b.isHeadBranch,
        employees: employeeCount,
        tables: tableCount,
      };
    }));

    return {
      plan: plan?.name || sub?.plan || 'N/A',
      maxBranches,
      usage: {
        totalBranches,
        activeBranches,
        remainingBranches: remainingBranches === -1 ? 'unlimited' : remainingBranches,
      },
      branches: branchDetails,
    };
  }

  /**
   * Check if the restaurant can add another user account (Max Users is the
   * TOTAL across the whole company — all branches combined, all roles).
   * Trial subscriptions are unlimited (every feature unlocked).
   */
  async canAddUser(restaurantId: string): Promise<EntitlementResult> {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) return { allowed: true }; // First-time setup, allow
    if (sub.status === 'suspended') {
      return { allowed: false, reason: 'Subscription is suspended. Please renew to manage users.' };
    }
    if (sub.status === 'trial') return { allowed: true }; // Trial = unlimited users

    const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();
    const maxUsers = sub.maxUsers ?? plan?.maxUsers ?? 5;
    // 0 = unlimited
    if (maxUsers === 0) return { allowed: true, limit: 0, current: 0, remaining: -1 };

    const userCount = await Employee.countDocuments({
      restaurantId,
      isDeleted: { $ne: true },
    }).exec();
    if (userCount >= maxUsers) {
      return {
        allowed: false,
        reason: `Your plan allows ${maxUsers} user${maxUsers > 1 ? 's' : ''} across all branches. Delete a user or upgrade your plan to add more.`,
        limit: maxUsers,
        current: userCount,
        remaining: 0,
      };
    }
    return { allowed: true, limit: maxUsers, current: userCount, remaining: maxUsers - userCount };
  }

  /**
   * Validate that a plan downgrade won't exceed the new plan's limits.
   * Returns the validation result with a reason if blocked.
   */
  async validatePlanDowngrade(
    restaurantId: string,
    newPlanId: string
  ): Promise<EntitlementResult> {
    const newPlan = await SubscriptionPlan.findOne({ planId: newPlanId }).exec();
    if (!newPlan) {
      return { allowed: false, reason: 'Target plan not found.' };
    }

    const newMaxBranches = newPlan.limits?.maxBranches ?? 1;
    if (newMaxBranches === 0) return { allowed: true }; // Unlimited

    const currentBranchCount = await Branch.countDocuments({
      restaurantId,
      isDeleted: { $ne: true },
    }).exec();

    if (currentBranchCount > newMaxBranches) {
      return {
        allowed: false,
        reason: `Cannot downgrade. Current branch usage (${currentBranchCount}) exceeds the selected plan limit (${newMaxBranches}).`,
        limit: newMaxBranches,
        current: currentBranchCount,
        remaining: 0,
      };
    }

    return { allowed: true };
  }

  /**
   * Get limits and features for a restaurant's subscription.
   * Used for cache/offline support and UI display.
   */
  async getSubscriptionLimits(restaurantId: string) {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) return null;

    const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();

    return {
      plan: sub.plan,
      planName: plan?.name || sub.plan,
      status: sub.status,
      limits: sub.limits || plan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 },
      features: effectiveFeatures(sub.features, sub.grantedFeatures),
      grantedFeatures: sub.grantedFeatures || [],
    };
  }
}

export const entitlementService = new EntitlementService();

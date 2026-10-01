/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * restaurantTools.ts — Restaurant read tools (spec §6): the tenant's own
 * profile and branches. Scope is forced to the authenticated tenant.
 */

import { z } from 'zod';
import mongoose from 'mongoose';
import Restaurant from '../../../models/core/Restaurant';
import Branch from '../../../models/core/Branch';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

function oid(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

// ─── getRestaurantProfile ───────────────────────────────────────────

export const getRestaurantProfileInputSchema = z.object({}).strict();
export type GetRestaurantProfileInput = z.infer<typeof getRestaurantProfileInputSchema>;

export interface RestaurantProfileOutput {
  available: boolean;
  reason?: 'RESTAURANT_NOT_FOUND';
  profile?: {
    name: string;
    restaurantId: string;
    restaurantType?: string;
    cuisineType?: string;
    city?: string;
    state?: string;
    currency: string;
    timezone: string;
    gstEnabled: boolean;
    loyaltyEnabled: boolean;
    /** Real establishment date (owner-declared at onboarding), if provided. */
    establishedDate?: string;
    onboardedAt: string;
  };
  generatedAt: string;
}

export async function executeGetRestaurantProfile(
  _input: GetRestaurantProfileInput,
  ctx: ToolContext,
): Promise<RestaurantProfileOutput> {
  const generatedAt = new Date().toISOString();
  const doc = await Restaurant.findById(ctx.tenant.restaurantId).lean().exec();
  if (!doc) {
    return { available: false, reason: 'RESTAURANT_NOT_FOUND', generatedAt };
  }
  return {
    available: true,
    profile: {
      name: doc.name,
      restaurantId: doc.restaurantId,
      restaurantType: doc.restaurantType,
      cuisineType: doc.cuisineType,
      city: doc.city,
      state: doc.state,
      currency: doc.currency || 'INR',
      timezone: doc.timezone || 'UTC',
      gstEnabled: doc.gstEnabled !== false,
      loyaltyEnabled: doc.loyaltyEnabled !== false,
      establishedDate: doc.establishedDate
        ? new Date(doc.establishedDate).toISOString().slice(0, 10)
        : undefined,
      onboardedAt: new Date(doc.createdAt).toISOString(),
    },
    generatedAt,
  };
}

export const getRestaurantProfileToolDefinition: ToolDefinition<GetRestaurantProfileInput, RestaurantProfileOutput> = {
  name: 'getRestaurantProfile',
  category: 'restaurant',
  access: 'read',
  meta: {
    description:
      'The restaurant\'s own profile: name, type, cuisine, location, currency, timezone, GST/loyalty flags, real establishment date and onboarding date.',
    source: 'models/core/Restaurant (authenticated tenant document)',
  },
  inputSchema: getRestaurantProfileInputSchema,
  execute: executeGetRestaurantProfile,
};

// ─── getBranches ────────────────────────────────────────────────────

export const getBranchesInputSchema = z.object({}).strict();
export type GetBranchesInput = z.infer<typeof getBranchesInputSchema>;

export interface BranchesOutput {
  available: boolean;
  reason?: 'NO_BRANCHES';
  branches?: Array<{
    id: string;
    name: string;
    isHeadBranch: boolean;
    isActive: boolean;
    city?: string;
  }>;
  generatedAt: string;
}

export async function executeGetBranches(
  _input: GetBranchesInput,
  ctx: ToolContext,
): Promise<BranchesOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const branches = await Branch.find({
      restaurantId: oid(ctx.tenant.restaurantId),
      isDeleted: { $ne: true },
    })
      .select('name isHeadBranch isActive city')
      .lean()
      .exec();
    if (branches.length === 0) {
      return { available: false, reason: 'NO_BRANCHES', generatedAt };
    }
    return {
      available: true,
      branches: branches.map((b: any) => ({
        id: String(b._id),
        name: b.name,
        isHeadBranch: !!b.isHeadBranch,
        isActive: b.isActive !== false,
        city: b.city,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_BRANCHES', generatedAt };
  }
}

export const getBranchesToolDefinition: ToolDefinition<GetBranchesInput, BranchesOutput> = {
  name: 'getBranches',
  category: 'restaurant',
  access: 'read',
  meta: {
    description: 'All branches of the restaurant with head-branch and active flags.',
    source: 'models/core/Branch (tenant-scoped)',
  },
  inputSchema: getBranchesInputSchema,
  execute: executeGetBranches,
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reward Service — Business logic for loyalty rewards catalog.
 * Handles CRUD with points-required sorting and active/inactive filtering.
 */

import mongoose from 'mongoose';
import { rewardRepo } from '../repositories';

export class RewardService {
  /**
   * List rewards with optional filtering by active status.
   * Tenant-scoped: returns the restaurant's rewards PLUS legacy global
   * catalog rewards (created before multi-tenant stamping) for backward
   * compatibility. Sorted by points required ascending.
   */
  async list(filter: { isActive?: boolean } = {}, restaurantId?: string) {
    const query: any = {};
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    if (restaurantId) {
      query.$or = [
        { restaurantId: new mongoose.Types.ObjectId(restaurantId) },
        { restaurantId: { $exists: false } },
        { restaurantId: null },
      ];
    }
    return rewardRepo.findAll(query, { sort: { pointsRequired: 1 } });
  }

  /**
   * Get a single reward by ID.
   */
  async getById(id: string) {
    return rewardRepo.findById(id);
  }

  /**
   * Create a new reward tier.
   */
  async create(data: {
    title: string;
    pointsRequired: number;
    type: 'percentage' | 'flat' | 'item';
    value: number;
    minBillAmount?: number;
    isLargeReward?: boolean;
    rewardItemId?: string;
    rewardItemName?: string;
    stock?: number;
    isActive?: boolean;
  }, restaurantId?: string) {
    return rewardRepo.create({
      ...data,
      restaurantId: restaurantId ? new mongoose.Types.ObjectId(restaurantId) : undefined,
      isActive: data.isActive ?? true,
      minBillAmount: data.minBillAmount ?? 0,
      isLargeReward: data.isLargeReward ?? false,
      redeemedCount: 0,
    } as any);
  }

  /**
   * Update an existing reward tier.
   */
  async update(id: string, data: any) {
    return rewardRepo.update(id, data);
  }

  /**
   * Soft-delete a reward tier.
   */
  async delete(id: string) {
    return rewardRepo.softDelete(id);
  }
}

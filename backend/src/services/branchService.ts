/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branch Service — Business logic for multi-branch management.
 * Handles branch CRUD, head branch enforcement, per-branch settings,
 * and consolidated data queries for the head branch.
 *
 * Rules:
 * - Only one branch can be head branch at a time.
 * - Deleting a branch requires at least one other branch to exist.
 * - Head branch can view consolidated data across all branches.
 */

import { branchRepo, branchSettingsRepo, employeeRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { entitlementService } from './entitlementService';

export class BranchService {
  /**
   * List all active branches.
   */
  async list(restaurantId?: string) {
    const filter: any = {};
    if (restaurantId) {
      filter.restaurantId = restaurantId;
    }
    return branchRepo.findAll(filter, { sort: { name: 1 } });
  }

  /**
   * Get a single branch with its settings.
   * Settings lookup is tenant-scoped when restaurantId is available.
   */
  async getById(id: string, restaurantId?: string) {
    const branch = await branchRepo.findById(id);
    if (!branch) return null;

    const settingsFilter: any = { branchId: id };
    if (restaurantId) settingsFilter.restaurantId = restaurantId;
    const settings = await branchSettingsRepo.findOne(settingsFilter);
    return {
      ...branch.toObject(),
      settings: settings || null,
    };
  }

  /**
   * Create a new branch.
   * Checks subscription limits before creating.
   * If isHeadBranch is true, unset head branch status on all others.
   */
  async create(data: { name: string; address?: string; phone?: string; isHeadBranch?: boolean; restaurantId?: string }) {
    // Check subscription limits if restaurantId is provided
    if (data.restaurantId) {
      const canCreate = await entitlementService.canCreateBranch(data.restaurantId);
      if (!canCreate.allowed) {
        throw new AppError(403, canCreate.reason || 'Branch limit reached.');
      }
    }

    if (data.isHeadBranch) {
      // Unset head branch on all existing branches (single batch update)
      const filter: any = { isHeadBranch: true };
      if (data.restaurantId) filter.restaurantId = data.restaurantId;
      await branchRepo.updateMany(filter, { isHeadBranch: false } as any);
    }

    return branchRepo.create(data as any);
  }

  /**
   * Update a branch.
   * If setting isHeadBranch, unset on all others first.
   */
  async update(id: string, data: any) {
    if (data.isHeadBranch) {
      // Unset head branch on all others (single batch update, exclude current)
      await branchRepo.updateMany(
        { _id: { $ne: id as any }, isHeadBranch: true },
        { isHeadBranch: false } as any
      );
    }

    return branchRepo.update(id, data);
  }

  /**
   * Soft-delete a branch. Cannot delete the last active branch.
   */
  async delete(id: string) {
    const allBranches = await branchRepo.findAll({}, {});
    if (allBranches.data.length <= 1) {
      throw new AppError(400, 'Cannot delete the only remaining branch');
    }
    return branchRepo.softDelete(id);
  }

  /**
   * Get or create branch-specific settings (tenant-scoped).
   */
  async getSettings(branchId: string, restaurantId?: string) {
    const filter: any = { branchId };
    if (restaurantId) filter.restaurantId = restaurantId;
    let settings = await branchSettingsRepo.findOne(filter);
    if (!settings) {
      settings = await branchSettingsRepo.create({ branchId, restaurantId } as any);
    }
    return settings;
  }

  /**
   * Update branch-specific settings (tenant-scoped).
   */
  async updateSettings(branchId: string, data: any, restaurantId?: string) {
    const filter: any = { branchId };
    if (restaurantId) filter.restaurantId = restaurantId;
    let settings = await branchSettingsRepo.findOne(filter);
    if (!settings) {
      settings = await branchSettingsRepo.create({ branchId, restaurantId } as any);
    }
    return branchSettingsRepo.update(settings._id.toString(), data);
  }
}

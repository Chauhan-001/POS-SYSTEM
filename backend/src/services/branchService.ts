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

import crypto from 'crypto';
import mongoose from 'mongoose';
import { branchRepo, branchSettingsRepo, employeeRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { hashPin } from '../utils/bcrypt';
import { entitlementService } from './entitlementService';

// Lazy-load Mongoose models so the module doesn't break if a model isn't
// registered yet. We import them at call time rather than top-level.
function getModel(name: string) {
  return mongoose.model(name);
}

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
  async create(data: { name: string; address?: string; phone?: string; isHeadBranch?: boolean; restaurantId?: string; exportData?: { products?: boolean; recipes?: boolean; offers?: boolean; tables?: boolean; menuConfigTemplates?: boolean; printers?: boolean } }) {
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

    const branch: any = await branchRepo.create(data as any);

    // Auto-provision a branch manager account so the new branch's owner can log
    // into the POS immediately. Credentials are minted server-side (unique
    // User ID derived from the branch name + a readable password and a 4-digit
    // PIN, both bcrypt-hashed at rest) and returned in plaintext exactly once
    // so the person creating the branch can hand them over. Failure here is
    // non-fatal — the branch itself is created and credentials can be reset
    // later from the Branch Management screen.
    if (data.restaurantId && branch?._id) {
      try {
        const gen = await this.generateBranchCredentials(data.name);
        const manager: any = await employeeRepo.create({
          username: gen.username,
          name: `Manager – ${data.name}`,
          role: 'Manager',
          pin: gen.pinHash,
          password: gen.passwordHash,
          status: 'Active',
          branchId: branch._id,
          restaurantId: data.restaurantId,
        } as any);
        branch.credentials = {
          username: gen.username,
          password: gen.password,
          pin: gen.pin,
          employeeId: manager?._id?.toString(),
        };
      } catch (err) {
        console.error('[BranchService] branch manager credential provisioning failed:', err);
      }
    }

    // Clone data from head branch if requested.
    // This must happen AFTER the branch is created so the target branchId exists.
    if (data.restaurantId && branch?._id && data.exportData) {
      try {
        // Find the head branch to clone FROM
        const headFilter: any = { isHeadBranch: true, restaurantId: data.restaurantId };
        const headBranch = await branchRepo.findOne(headFilter);
        if (headBranch) {
          const cloneSummary = await this.cloneDataToBranch(
            headBranch._id.toString(),
            branch._id.toString(),
            data.restaurantId,
            data.exportData,
          );
          // Attach clone summary so the response includes what was exported
          (branch as any)._cloneSummary = cloneSummary;
        }
      } catch (err) {
        console.error('[BranchService] data clone failed (branch still created):', err);
      }
    }

    return branch;
  }

  /**
   * Mint a unique, easy-to-share User ID + password + PIN for a branch manager.
   * The User ID is derived from the branch name (memorable), the password is a
   * readable word-word-digit pattern, and the PIN is a random 4-digit code.
   * Only the bcrypt hashes are ever stored.
   */
  private async generateBranchCredentials(branchName: string) {
    const slug = (branchName || 'branch')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_branch$/g, '') // avoid "Downtown Branch" → "downtown_branch_branch"
      .slice(0, 20) || 'branch';

    // Unique username — retry on collision with an incrementing suffix. The
    // repository's findOne already excludes soft-deleted docs, so a freed
    // username can be reused after a branch is deleted.
    let username = `${slug}_branch`;
    let attempts = 0;
    while ((await employeeRepo.findOne({ username } as any)) && attempts <= 20) {
      attempts += 1;
      username = `${slug}_branch${attempts}`;
    }

    // Readable-but-not-trivial password: two common words + 2 digits.
    const WORDS = ['mango','river','crown','tiger','golden','silver','royal','cobalt','spice','palm','ocean','mint','lime','baker','falcon','maple','cedar','amber','coral','storm'];
    const word = () => WORDS[crypto.randomInt(WORDS.length)];
    const password = `${word()}${word()}${crypto.randomInt(10)}${crypto.randomInt(10)}`;

    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');

    return {
      username,
      password,
      pin,
      passwordHash: await hashPin(password),
      pinHash: await hashPin(pin),
    };
  }

  /**
   * Regenerate the branch manager's password + PIN (the User ID stays the same
   * — it is the stable login identity). Returns the new plaintext credentials
   * exactly once so the owner can hand them to the branch manager.
   */
  async resetCredentials(id: string, restaurantId?: string) {
    // Tenant-scoped lookup — an Owner can only reset credentials for one of
    // their own branches (multi-tenant isolation).
    const filter: any = { _id: id };
    if (restaurantId) filter.restaurantId = restaurantId;
    const branch = await branchRepo.findOne(filter);
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const manager: any = await employeeRepo.findOne({
      branchId: branch._id,
      role: 'Manager',
      isDeleted: { $ne: true },
    } as any);
    if (!manager) {
      throw new AppError(404, 'No manager account found for this branch');
    }

    const gen = await this.generateBranchCredentials(branch.name);
    await employeeRepo.update(manager._id.toString(), {
      password: gen.passwordHash,
      pin: gen.pinHash,
      status: 'Active',
    } as any);

    return {
      username: manager.username,
      password: gen.password,
      pin: gen.pin,
      employeeId: manager._id.toString(),
    };
  }

  /**
   * Update a branch.
   * If setting isHeadBranch, unset on all others first.
   */
  async update(id: string, data: any, restaurantId?: string) {
    // Tenant-scoped guard — an Owner can only update one of their own
    // branches, never another restaurant's (multi-tenant isolation).
    const filter: any = { _id: id };
    if (restaurantId) filter.restaurantId = restaurantId;
    const existing = await branchRepo.findOne(filter);
    if (!existing) {
      throw new AppError(404, 'Branch not found');
    }

    if (data.isHeadBranch) {
      // Unset head branch on all others within THIS restaurant only
      // (single batch update, exclude current) — never across tenants.
      const unsetFilter: any = { _id: { $ne: id as any }, isHeadBranch: true };
      if (restaurantId) unsetFilter.restaurantId = restaurantId;
      await branchRepo.updateMany(
        unsetFilter,
        { isHeadBranch: false } as any
      );
    }

    return branchRepo.update(id, data);
  }

  /**
   * Soft-delete a branch. Cannot delete the last active branch.
   */
  async delete(id: string, restaurantId?: string) {
    // Tenant-scoped lookup — an Owner can only delete one of their own
    // branches, never another restaurant's (multi-tenant isolation).
    const filter: any = { _id: id };
    if (restaurantId) filter.restaurantId = restaurantId;
    const branch = await branchRepo.findOne(filter);
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }
    const allBranches = await branchRepo.findAll({ restaurantId }, {});
    if (allBranches.data.length <= 1) {
      throw new AppError(400, 'Cannot delete the only remaining branch');
    }

    // Staff of a deleted branch lose access with it — soft-delete the manager
    // and any employees assigned to this branch so their credentials die with
    // the branch (the username is freed for reuse by a future branch).
    try {
      await employeeRepo.updateMany(
        { branchId: id, isDeleted: { $ne: true } } as any,
        { isDeleted: true, deletedAt: new Date() } as any,
      );
    } catch (err) {
      console.error('[BranchService] failed to deactivate branch staff:', err);
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

  // ─── Clone Data from Head Branch ──────────────────────────────────

  /**
   * Clone selected data categories from the head branch into a newly created
   * branch. The source branch is the restaurant's head branch; the target is
   * the branch just created.
   *
   * Categories:
   *  - products: Menu items (Product) — cloned with new _id, branchId set,
   *              stock/financial data zeroed so each branch starts fresh.
   *  - recipes: Recipes tied to cloned products — cloned with new _id,
   *             branchId set, costSummary recalculated later.
   *  - offers: Active/draft Offers — cloned with new _id, branchIds updated.
   *  - tables: Table layout — cloned with new _id, status reset to Available,
   *            branchId set.
   *  - menuConfigTemplates: Reusable menu configuration templates — cloned.
   *  - printers: Printer definitions — cloned with new _id, branchId set.
   *
   * IMPORTANT: Does NOT duplicate inventory stock levels, purchase history,
   * or supplier relationships — those are branch-specific operations.
   */
  async cloneDataToBranch(
    headBranchId: string,
    targetBranchId: string,
    restaurantId: string,
    categories: {
      products?: boolean;
      recipes?: boolean;
      offers?: boolean;
      tables?: boolean;
      menuConfigTemplates?: boolean;
      printers?: boolean;
    },
  ): Promise<Record<string, number>> {
    const summary: Record<string, number> = {};
    const headOid = new mongoose.Types.ObjectId(headBranchId);
    const targetOid = new mongoose.Types.ObjectId(targetBranchId);
    const tenantOid = new mongoose.Types.ObjectId(restaurantId);

    // ── Products ─────────────────────────────────────────────────────
    if (categories.products) {
      try {
        const Product = getModel('Product');
        // Menu products belong to the restaurant (or are global). We clone
        // all non-deleted products whose availability is true (menu items).
        // Inventory items (availability:false) are NOT cloned — each branch
        // manages its own stock.
        const sourceProducts = await Product.find({
          restaurantId: tenantOid,
          isDeleted: { $ne: true },
          availability: true,
        }).lean();

        if (sourceProducts.length > 0) {
          const cloned = sourceProducts.map((p: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = p;
            return {
              ...rest,
              // Reset stock — each branch starts with zero
              currentStock: 0,
              averageCost: 0,
              // Clear voice/search aliases — each branch builds its own
              voiceAliases: [],
              searchAliases: [],
              learnedAliases: [],
              aliasUsageCount: 0,
              lastUsedAlias: null,
              // Clear per-branch price overrides
              branchPrice: {},
              comboBranchPrice: {},
            };
          });
          const result = await Product.insertMany(cloned, { ordered: false });
          summary.products = result.length;
        } else {
          summary.products = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone products failed:', err);
        summary.products = 0;
      }
    }

    // ── Menu Config Templates ────────────────────────────────────────
    if (categories.menuConfigTemplates) {
      try {
        const Template = getModel('ConfigurationTemplate');
        const sourceTemplates = await Template.find({
          restaurantId: tenantOid,
          status: { $ne: 'archived' },
        }).lean();

        if (sourceTemplates.length > 0) {
          const cloned = sourceTemplates.map((t: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = t;
            return {
              ...rest,
              sourceTemplateId: _id, // Track provenance
            };
          });
          const result = await Template.insertMany(cloned, { ordered: false });
          summary.menuConfigTemplates = result.length;
        } else {
          summary.menuConfigTemplates = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone menu config templates failed:', err);
        summary.menuConfigTemplates = 0;
      }
    }

    // ── Recipes ──────────────────────────────────────────────────────
    if (categories.recipes) {
      try {
        const Recipe = getModel('Recipe');
        const sourceRecipes = await Recipe.find({
          restaurantId: tenantOid,
          isDeleted: { $ne: true },
          status: { $in: ['active', 'draft'] },
        }).lean();

        if (sourceRecipes.length > 0) {
          const cloned = sourceRecipes.map((r: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = r;
            return {
              ...rest,
              branchId: targetOid,
              // Reset cost summary — will be recalculated by the cost engine
              costSummary: {
                recipeCost: 0,
                foodCostPercent: 0,
                contribution: 0,
                contributionMarginPercent: 0,
                perServingCost: 0,
                directIngredients: 0,
                minorAllowance: 0,
                cookingAllowance: 0,
                wastageAllowance: 0,
                packagingCost: 0,
                estimatedVariableCost: 0,
                conservativeCost: 0,
                directFoodCostPercent: 0,
                calculatedAt: null,
              },
            };
          });
          const result = await Recipe.insertMany(cloned, { ordered: false });
          summary.recipes = result.length;
        } else {
          summary.recipes = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone recipes failed:', err);
        summary.recipes = 0;
      }
    }

    // ── Offers ───────────────────────────────────────────────────────
    if (categories.offers) {
      try {
        const Offer = getModel('Offer');
        const sourceOffers = await Offer.find({
          restaurantId: tenantOid,
          isDeleted: { $ne: true },
          status: { $in: ['active', 'draft', 'scheduled'] },
        }).lean();

        if (sourceOffers.length > 0) {
          const cloned = sourceOffers.map((o: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = o;
            return {
              ...rest,
              // Scope offer to new branch only
              branchIds: [targetBranchId],
              // Reset usage counters
              currentUses: 0,
              // Reset coupon code — each branch gets its own
              couponCode: o.couponCode ? `${o.couponCode}_${targetBranchId.slice(-4)}` : undefined,
            };
          });
          const result = await Offer.insertMany(cloned, { ordered: false });
          summary.offers = result.length;
        } else {
          summary.offers = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone offers failed:', err);
        summary.offers = 0;
      }
    }

    // ── Tables ───────────────────────────────────────────────────────
    if (categories.tables) {
      try {
        const Table = getModel('Table');
        // Clone tables from the head branch (or unscoped tables if head has none)
        const sourceTables = await Table.find({
          restaurantId: tenantOid,
          $or: [
            { branchId: headOid },
            { branchId: null },
          ],
          isDeleted: { $ne: true },
        }).lean();

        if (sourceTables.length > 0) {
          const cloned = sourceTables.map((t: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = t;
            return {
              ...rest,
              branchId: targetOid,
              status: 'Available',
              // Clear runtime state
              waiterId: null,
              waiterName: null,
              customerId: null,
              customerPhone: null,
              customerName: null,
              occupiedSince: null,
              lastReleasedAt: null,
              cleaningSince: null,
              reservationId: null,
              reservationName: null,
              reservationTime: null,
            };
          });
          const result = await Table.insertMany(cloned, { ordered: false });
          summary.tables = result.length;
        } else {
          summary.tables = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone tables failed:', err);
        summary.tables = 0;
      }
    }

    // ── Printers ─────────────────────────────────────────────────────
    if (categories.printers) {
      try {
        const Printer = getModel('Printer');
        const sourcePrinters = await Printer.find({
          restaurantId: tenantOid,
          $or: [
            { branchId: headOid },
            { branchId: null },
          ],
        }).lean();

        if (sourcePrinters.length > 0) {
          const cloned = sourcePrinters.map((p: any) => {
            const { _id, __v, createdAt, updatedAt, ...rest } = p;
            return {
              ...rest,
              branchId: targetOid,
              isActive: false, // Printers start inactive — need manual setup
            };
          });
          const result = await Printer.insertMany(cloned, { ordered: false });
          summary.printers = result.length;
        } else {
          summary.printers = 0;
        }
      } catch (err) {
        console.error('[BranchService] clone printers failed:', err);
        summary.printers = 0;
      }
    }

    return summary;
  }
}

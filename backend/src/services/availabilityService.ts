/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AvailabilityService — authoritative online menu availability.
 *
 * Resolution order (branch override → restaurant default → AVAILABLE):
 *   getForProduct(restaurantId, branchId, productId) → boolean
 *
 * An item is AVAILABLE for online ordering unless a MenuAvailability row for
 * the restaurant (branch-scoped or restaurant-wide) says UNAVAILABLE (and its
 * `unavailableUntil` — if any — has not passed). Expired rows are lazily
 * flipped back to AVAILABLE on read (and swept by a background tick).
 *
 * This service never consults inventory stock — availability is a manual
 * operational switch by design.
 */

import mongoose from 'mongoose';
import MenuAvailability, { IMenuAvailability } from '../models/MenuAvailability';
import { auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';

export interface AvailabilityState {
  productId: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  unavailableUntil: string | null;
  reason?: string;
  source?: string;
  /** When false the item is not listed on the customer website at all. */
  visibleOnSite?: boolean;
}

export interface AvailabilityUpsertItem {
  productId: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  unavailableUntil?: string | null;
  reason?: string;
  /** Optional site-visibility toggle (defaults to true / unchanged). */
  visibleOnSite?: boolean;
}

export class AvailabilityService {
  /**
   * Resolve the effective availability state for one product.
   * Returns true when the item may be ordered online — that requires BOTH
   * the status to be AVAILABLE AND the item to be visible on the site (a
   * hidden item can never be ordered, even if it isn't sold out).
   */
  async getForProduct(
    restaurantId: string,
    branchId: string | null | undefined,
    productId: string
  ): Promise<boolean> {
    const state = await this.resolveState(restaurantId, branchId, productId);
    return state.status === 'AVAILABLE' && state.visibleOnSite !== false;
  }

  /**
   * Load the effective availability state for a product, applying the
   * branch-override → restaurant-default precedence and lazily expiring
   * past `unavailableUntil` rows.
   */
  async resolveState(
    restaurantId: string,
    branchId: string | null | undefined,
    productId: string
  ): Promise<AvailabilityState> {
    const rid = new mongoose.Types.ObjectId(restaurantId);
    const pid = new mongoose.Types.ObjectId(productId);
    const now = new Date();

    const rows = await MenuAvailability.find({
      restaurantId: rid,
      productId: pid,
      branchId: branchId ? { $in: [null, new mongoose.Types.ObjectId(branchId)] } : null,
    }).lean().exec();

    // Prefer the branch override; fall back to the restaurant-wide default.
    const globalRow = rows.find((r) => !r.branchId) as IMenuAvailability | undefined;
    // Hard block: a restaurant-wide hide wins over ANY branch override (the
    // Products-page toggle is the owner's master site-visibility control).
    if (globalRow && globalRow.visibleOnSite === false) {
      return {
        productId,
        status: globalRow.status,
        unavailableUntil: globalRow.unavailableUntil ? globalRow.unavailableUntil.toISOString() : null,
        reason: globalRow.reason || undefined,
        source: globalRow.source,
        visibleOnSite: false,
      };
    }
    const branchRow = branchId ? rows.find((r) => r.branchId && r.branchId.toString() === branchId) : undefined;
    const row = (branchRow || globalRow) as IMenuAvailability | undefined;

    if (!row) return { productId, status: 'AVAILABLE', unavailableUntil: null, visibleOnSite: true };
    if (row.status === 'UNAVAILABLE' && row.unavailableUntil && row.unavailableUntil.getTime() <= now.getTime()) {
      // Expired — restore lazily (the sweeper also covers this) and await so
      // subsequent reads and the persistence layer are consistent.
      await MenuAvailability.updateOne(
        { _id: row._id },
        { $set: { status: 'AVAILABLE', unavailableUntil: null, source: 'auto_expiry' } }
      ).exec().catch(() => undefined);
      return { productId, status: 'AVAILABLE', unavailableUntil: null, visibleOnSite: row.visibleOnSite !== false };
    }

    return {
      productId,
      status: row.status,
      unavailableUntil: row.unavailableUntil ? row.unavailableUntil.toISOString() : null,
      reason: row.reason || undefined,
      source: row.source,
      visibleOnSite: row.visibleOnSite !== false,
    };
  }

  /**
   * Bulk availability upsert. Each change is audited (old → new) so toggles
   * are fully traceable. Returns the effective states after the write.
   */
  async setBulk(
    restaurantId: string,
    items: AvailabilityUpsertItem[],
    ctx: { branchId?: string | null; operator?: string; operatorId?: string; source?: IMenuAvailability['source'] } = {}
  ): Promise<AvailabilityState[]> {
    const rid = new mongoose.Types.ObjectId(restaurantId);
    const branchOid = ctx.branchId && mongoose.Types.ObjectId.isValid(ctx.branchId)
      ? new mongoose.Types.ObjectId(ctx.branchId)
      : null;
    const source = ctx.source || 'manual';
    const results: AvailabilityState[] = [];

    for (const item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        throw new AppError(400, `Invalid product id: ${item.productId}`);
      }
      const pid = new mongoose.Types.ObjectId(item.productId);
      const unavailableUntil = item.unavailableUntil
        ? new Date(item.unavailableUntil)
        : null;
      if (unavailableUntil && Number.isNaN(unavailableUntil.getTime())) {
        throw new AppError(400, `Invalid unavailableUntil date for product ${item.productId}`);
      }

      const filter = { restaurantId: rid, branchId: branchOid, productId: pid };
      const previous = await MenuAvailability.findOne(filter).lean().exec();
      const prevStatus = previous?.status || 'AVAILABLE';
      const nextStatus = item.status;
      const prevVisible = previous ? previous.visibleOnSite !== false : true;
      const nextVisible = item.visibleOnSite !== undefined ? !!item.visibleOnSite : prevVisible;
      // Only touch unavailableUntil/reason when the caller EXPLICITLY provides
      // them — a pure visibility toggle (Products page) must never wipe an
      // existing "unavailable until 6pm" auto-restore timer or sold-out reason.
      const nextUntil = item.unavailableUntil !== undefined
        ? (item.unavailableUntil ? new Date(item.unavailableUntil) : null)
        : (previous?.unavailableUntil || null);
      const nextReason = item.reason !== undefined ? item.reason : (previous?.reason || '');

      // No-op guard — skip writes that change nothing (still return state).
      if (previous && prevStatus === nextStatus && prevVisible === nextVisible && !item.unavailableUntil) {
        results.push({
          productId: item.productId,
          status: nextStatus,
          unavailableUntil: nextUntil ? nextUntil.toISOString() : null,
          reason: nextReason || undefined,
          source: previous.source,
          visibleOnSite: nextVisible,
        });
        continue;
      }

      await MenuAvailability.findOneAndUpdate(
        filter,
        {
          $set: {
            status: nextStatus,
            unavailableUntil: nextUntil,
            reason: nextReason,
            visibleOnSite: nextVisible,
            source,
            updatedBy: ctx.operator || 'System',
            updatedById: ctx.operatorId || undefined,
          },
          $setOnInsert: { restaurantId: rid, branchId: branchOid, productId: pid },
        },
        { upsert: true, new: true }
      ).exec();

      // Restaurant-wide hide wins over stale branch overrides: when the owner
      // hides a product from the Products page (branchId null), force every
      // branch row for that product hidden too, so no branch can re-expose it.
      if (branchOid === null && nextVisible === false) {
        await MenuAvailability.updateMany(
          { restaurantId: rid, productId: pid, branchId: { $ne: null }, visibleOnSite: { $ne: false } },
          { $set: { visibleOnSite: false, source, updatedBy: ctx.operator || 'System' } }
        ).exec().catch(() => undefined);
      }

      // Audit the change (old → new), skipping the synthetic first row.
      auditLogRepo.create({
        action: 'availability.updated',
        entityType: 'product',
        entityId: item.productId,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId || undefined,
        restaurantId: rid,
        branchId: branchOid || undefined,
        details: {
          productId: item.productId,
          oldStatus: prevStatus,
          newStatus: nextStatus,
          oldVisibleOnSite: prevVisible,
          newVisibleOnSite: nextVisible,
          unavailableUntil: nextUntil ? nextUntil.toISOString() : null,
          reason: nextReason || '',
          source,
        },
      } as any).catch((err: any) => console.warn('[AvailabilityService] audit write failed:', err?.message));

      results.push({
        productId: item.productId,
        status: nextStatus,
        unavailableUntil: nextUntil ? nextUntil.toISOString() : null,
        reason: nextReason || undefined,
        source,
        visibleOnSite: nextVisible,
      });
    }

    return results;
  }

  /**
   * Load the availability map for a whole product set (used by the public
   * menu and the POS availability page).
   * @returns Map<productId, AvailabilityState>
   */
  async getMap(
    restaurantId: string,
    branchId: string | null | undefined,
    productIds: string[]
  ): Promise<Map<string, AvailabilityState>> {
    const map = new Map<string, AvailabilityState>();
    if (productIds.length === 0) return map;
    const rid = new mongoose.Types.ObjectId(restaurantId);

    const rows = await MenuAvailability.find({
      restaurantId: rid,
      productId: { $in: productIds.map((p) => new mongoose.Types.ObjectId(p)) },
      branchId: branchId ? { $in: [null, new mongoose.Types.ObjectId(branchId)] } : null,
    }).lean().exec();

    const now = Date.now();
    const byProduct = new Map<string, IMenuAvailability[]>();
    for (const r of rows) {
      const key = r.productId.toString();
      const arr = byProduct.get(key) || [];
      arr.push(r as IMenuAvailability);
      byProduct.set(key, arr);
    }

    for (const pid of productIds) {
      const arr = byProduct.get(pid) || [];
      const globalRow = arr.find((r) => !r.branchId) as IMenuAvailability | undefined;
      // Hard block: a restaurant-wide hide wins over any branch override — the
      // owner's Products-page master switch can never be re-exposed by a branch.
      if (globalRow && globalRow.visibleOnSite === false) {
        map.set(pid, {
          productId: pid,
          status: globalRow.status,
          unavailableUntil: globalRow.unavailableUntil ? globalRow.unavailableUntil.toISOString() : null,
          reason: globalRow.reason || undefined,
          source: globalRow.source,
          visibleOnSite: false,
        });
        continue;
      }
      const branchRow = branchId ? arr.find((r) => r.branchId && r.branchId.toString() === branchId) : undefined;
      const row = (branchRow || globalRow) as IMenuAvailability | undefined;
      if (!row || row.status === 'AVAILABLE') {
        map.set(pid, { productId: pid, status: 'AVAILABLE', unavailableUntil: null, visibleOnSite: row ? row.visibleOnSite !== false : true });
        continue;
      }
      if (row.unavailableUntil && row.unavailableUntil.getTime() <= now) {
        await MenuAvailability.updateOne(
          { _id: row._id },
          { $set: { status: 'AVAILABLE', unavailableUntil: null, source: 'auto_expiry' } }
        ).exec().catch(() => undefined);
        map.set(pid, { productId: pid, status: 'AVAILABLE', unavailableUntil: null, visibleOnSite: row.visibleOnSite !== false });
        continue;
      }
      map.set(pid, {
        productId: pid,
        status: 'UNAVAILABLE',
        unavailableUntil: row.unavailableUntil ? row.unavailableUntil.toISOString() : null,
        reason: row.reason || undefined,
        source: row.source,
        visibleOnSite: row.visibleOnSite !== false,
      });
    }

    return map;
  }

  /** Background sweeper: flip all expired UNAVAILABLE rows back to AVAILABLE. */
  async sweepExpired(): Promise<number> {
    const now = new Date();
    const res = await MenuAvailability.updateMany(
      { status: 'UNAVAILABLE', unavailableUntil: { $ne: null, $lte: now } },
      { $set: { status: 'AVAILABLE', unavailableUntil: null, source: 'auto_expiry' } }
    ).exec();
    return res.modifiedCount || 0;
  }
}

export const availabilityService = new AvailabilityService();

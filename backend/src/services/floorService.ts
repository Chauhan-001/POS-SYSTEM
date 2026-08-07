/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FloorService — Business logic for multi-floor restaurant layouts.
 * Floors are branch-scoped. Tables reference a floor via Table.floorId.
 */

import { floorRepo, tableRepo, auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';

export interface FloorCtx {
  restaurantId?: string;
  branchId?: string;
  operator?: string;
  operatorId?: string;
}

export class FloorService {
  async list(params: { branchId?: string; active?: boolean }, ctx: FloorCtx = {}) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    if (params.active !== undefined) query.isActive = params.active;
    if (ctx.restaurantId) query.restaurantId = { $in: [ctx.restaurantId, null] };
    return floorRepo.findAll(query, { sort: { sortOrder: 1, createdAt: 1 } });
  }

  async getById(id: string) {
    return floorRepo.findById(id);
  }

  async create(data: any, ctx: FloorCtx = {}) {
    const existing = await floorRepo.findOne({ branchId: data.branchId || ctx.branchId, name: data.name });
    if (existing) throw new AppError(409, `A floor named "${data.name}" already exists for this branch`);
    const floor = await floorRepo.create({
      ...data,
      branchId: data.branchId || ctx.branchId || null,
      restaurantId: data.restaurantId || ctx.restaurantId || null,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    } as any);
    await this.audit('FLOOR_CREATED', String(floor._id), ctx, { name: floor.name });
    return floor;
  }

  async update(id: string, data: any, ctx: FloorCtx = {}) {
    if (data.name) {
      const existing = await floorRepo.findOne({
        branchId: data.branchId || ctx.branchId,
        name: data.name,
        _id: { $ne: id } as any,
      });
      if (existing) throw new AppError(409, `A floor named "${data.name}" already exists for this branch`);
    }
    const floor = await floorRepo.update(id, data);
    if (!floor) return null;
    await this.audit('FLOOR_UPDATED', id, ctx, { name: floor.name });
    return floor;
  }

  async delete(id: string, ctx: FloorCtx = {}) {
    // Detach tables from the deleted floor (backward compatible — they become branch-default).
    await tableRepo.updateMany({ floorId: id } as any, { floorId: null });
    const floor = await floorRepo.softDelete(id);
    if (!floor) return null;
    await this.audit('FLOOR_DELETED', id, ctx, { name: floor.name });
    return floor;
  }

  private async audit(action: string, entityId: string, ctx: FloorCtx, details: Record<string, unknown>) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'Floor',
        entityId,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId,
        details,
        branchId: ctx.branchId ? (ctx.branchId as any) : undefined,
      } as any);
    } catch (err: any) {
      console.warn('[FloorService] audit log failed (non-fatal):', err.message);
    }
  }
}

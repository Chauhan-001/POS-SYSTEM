/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryEvent Service — Read/write access to the non-purchase inventory
 * activity feed (sold / adjusted / waste / closing). All queries are scoped to
 * the caller's restaurant for multi-tenant isolation.
 */

import mongoose from 'mongoose';
import { inventoryEventRepo } from '../repositories';
import { AppError } from '../utils/AppError';

const VALID_TYPES = ['sold', 'adjusted', 'waste', 'closing', 'purchase', 'return'];

export class InventoryEventService {
  /**
   * List inventory events for a restaurant with optional type filtering.
   * restaurantId is ALWAYS required — never list across tenants.
   */
  async list(params: {
    restaurantId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}) {
    if (!params.restaurantId) {
      throw new AppError(400, 'restaurantId is required');
    }
    if (params.type && !VALID_TYPES.includes(params.type)) {
      throw new AppError(400, 'Invalid event type');
    }
    const query: any = { restaurantId: params.restaurantId };
    if (params.type) query.type = params.type;
    if (params.startDate || params.endDate) {
      query.eventDate = {};
      if (params.startDate) query.eventDate.$gte = params.startDate;
      if (params.endDate) query.eventDate.$lte = params.endDate;
    }
    const limit = params.limit && params.limit > 0 ? params.limit : 100;
    return inventoryEventRepo.findAll(query, { limit, sort: { eventDate: -1, createdAt: -1 } });
  }

  /**
   * Create a new inventory event (e.g. a waste or stock-adjustment record).
   * The restaurant is stamped server-side from the authenticated user — never
   * trust a client-supplied restaurantId.
   */
  async create(data: any, restaurantId: string) {
    if (!data.item || !data.type) {
      throw new AppError(400, 'Item and type are required');
    }
    if (!VALID_TYPES.includes(data.type)) {
      throw new AppError(400, 'Invalid event type');
    }
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new AppError(400, 'Invalid restaurantId');
    }
    if (data.branchId && !mongoose.Types.ObjectId.isValid(data.branchId)) {
      throw new AppError(400, 'Invalid branchId');
    }
    const quantity = Number(data.quantity);
    if (Number.isNaN(quantity) || quantity === 0) {
      throw new AppError(400, 'Quantity must be a non-zero number');
    }
    return inventoryEventRepo.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      branchId: data.branchId ? new mongoose.Types.ObjectId(data.branchId) : undefined,
      type: data.type,
      item: String(data.item).trim(),
      quantity,
      unit: data.unit || 'pcs',
      operator: data.operator || 'System',
      details: data.details || `${data.type} recorded`,
      eventDate: data.eventDate || new Date().toISOString().slice(0, 10),
    });
  }
}

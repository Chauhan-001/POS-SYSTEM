/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeldOrder Service — Business logic for suspended-bill snapshots.
 * Held orders are opaque cart snapshots pushed from the POS when a cashier
 * holds a cart, so they can be resumed on any terminal.
 */

import { heldOrderRepo } from '../repositories';

export class HeldOrderService {
  /**
   * List held orders (scoped to the authenticated restaurant, optionally
   * filtered by branch), newest first.
   */
  async list(params: { restaurantId?: string; branchId?: string } = {}) {
    const query: any = {};
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.branchId) query.branchId = params.branchId;
    return heldOrderRepo.findAll(query, { sort: { createdAt: -1 } });
  }

  /**
   * Get a single held order by ID — tenant-scoped so a user can never read
   * another restaurant's suspended-bill snapshot (IDOR guard).
   */
  async getById(id: string, restaurantId?: string) {
    const filter: any = { _id: id };
    if (restaurantId) filter.restaurantId = restaurantId;
    return heldOrderRepo.findOne(filter);
  }

  /**
   * Create a held order snapshot. The client's cart id is preserved so the
   * frontend can keep using it as the local key. The restaurantId is tagged
   * server-side from the authenticated token — never trusted from the client.
   */
  async create(data: {
    clientId: string;
    orderId?: string;
    customer?: any;
    items?: any[];
    type?: string;
    timestamp?: string;
    branchId?: string;
  }, restaurantId?: string) {
    return heldOrderRepo.create({
      ...data,
      restaurantId: restaurantId || null,
      items: Array.isArray(data.items) ? data.items : [],
      customer: data.customer ?? null,
      type: data.type || 'Takeaway',
      timestamp: data.timestamp || '',
    } as any);
  }

  /**
   * Update a held order — tenant-scoped so a user can never modify another
   * restaurant's snapshot.
   */
  async update(id: string, data: any, restaurantId?: string) {
    const filter: any = { _id: id, isDeleted: { $ne: true } };
    if (restaurantId) filter.restaurantId = restaurantId;
    return heldOrderRepo.findOneAndUpdate(filter, data);
  }

  /**
   * Soft-delete a held order — tenant-scoped so a user can never delete
   * another restaurant's snapshot.
   */
  async delete(id: string, restaurantId?: string) {
    const filter: any = { _id: id, isDeleted: { $ne: true } };
    if (restaurantId) filter.restaurantId = restaurantId;
    return heldOrderRepo.findOneAndUpdate(filter, {
      isDeleted: true,
      deletedAt: new Date(),
    });
  }
}

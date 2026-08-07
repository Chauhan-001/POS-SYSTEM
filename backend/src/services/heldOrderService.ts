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
   * List held orders (optionally filtered by branch), newest first.
   */
  async list(params: { branchId?: string } = {}) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    return heldOrderRepo.findAll(query, { sort: { createdAt: -1 } });
  }

  /**
   * Get a single held order by ID.
   */
  async getById(id: string) {
    return heldOrderRepo.findById(id);
  }

  /**
   * Create a held order snapshot. The client's cart id is preserved so the
   * frontend can keep using it as the local key.
   */
  async create(data: {
    clientId: string;
    orderId?: string;
    customer?: any;
    items?: any[];
    type?: string;
    timestamp?: string;
    branchId?: string;
  }) {
    return heldOrderRepo.create({
      ...data,
      items: Array.isArray(data.items) ? data.items : [],
      customer: data.customer ?? null,
      type: data.type || 'Takeaway',
      timestamp: data.timestamp || '',
    } as any);
  }

  /**
   * Update a held order (e.g. restore the linked order id or refresh items).
   */
  async update(id: string, data: any) {
    return heldOrderRepo.update(id, data);
  }

  /**
   * Soft-delete a held order (removed when it is recalled or completed).
   */
  async delete(id: string) {
    return heldOrderRepo.softDelete(id);
  }
}

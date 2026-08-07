/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TakeawayOrder Service — Business logic for takeaway order management.
 * Handles CRUD with status flow (Preparing → Ready → Collected → Completed)
 * and optional branch filtering.
 */

import { takeawayOrderRepo } from '../repositories';

export class TakeawayOrderService {
  /**
   * List takeaway orders with optional status/branch filtering.
   */
  async list(params: { status?: string; branchId?: string } = {}) {
    const query: any = {};
    if (params.status) query.status = params.status;
    if (params.branchId) query.branchId = params.branchId;
    return takeawayOrderRepo.findAll(query, { sort: { createdAt: -1 } });
  }

  /**
   * Get a single takeaway order by ID.
   */
  async getById(id: string) {
    return takeawayOrderRepo.findById(id);
  }

  /**
   * Create a new takeaway order.
   */
  async create(data: {
    orderNumber: number;
    customerName: string;
    customerPhone?: string;
    amount: number;
    items: Array<{ itemName: string; quantity: number; price: number; variantName?: string }>;
    branchId?: string;
    paymentStatus?: 'Pending' | 'Paid';
  }) {
    return takeawayOrderRepo.create({
      ...data,
      status: 'Preparing',
      paymentStatus: data.paymentStatus ?? 'Pending',
    } as any);
  }

  /**
   * Update a takeaway order (status, items, payment, etc.).
   */
  async update(id: string, data: any) {
    return takeawayOrderRepo.update(id, data);
  }

  /**
   * Soft-delete a takeaway order.
   */
  async delete(id: string) {
    return takeawayOrderRepo.softDelete(id);
  }

  /**
   * Get the next order number for a branch.
   */
  async getNextOrderNumber(branchId?: string): Promise<number> {
    const query: any = {};
    if (branchId) query.branchId = branchId;
    const last = await takeawayOrderRepo.findAll(query, { sort: { orderNumber: -1 }, limit: 1 });
    const maxNumber = last.data.length > 0 ? (last.data[0] as any).orderNumber || 0 : 0;
    return maxNumber + 1;
  }
}

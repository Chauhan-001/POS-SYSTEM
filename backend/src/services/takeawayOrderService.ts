/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TakeawayOrder Service — Business logic for takeaway order management.
 * Handles CRUD with status flow (Preparing → Ready → Collected → Completed)
 * and optional branch filtering.
 */

import mongoose from 'mongoose';
import { takeawayOrderRepo } from '../repositories';

export class TakeawayOrderService {
  /**
   * List takeaway orders with optional status/branch filtering. The HTTP
   * controller passes the authenticated restaurantId so one tenant can never
   * see another's takeaway orders (or legacy rows missing the stamp).
   */
  async list(params: { status?: string; branchId?: string; restaurantId?: string } = {}) {
    const query: any = {};
    if (params.status) query.status = params.status;
    if (params.branchId) query.branchId = params.branchId;
    if (params.restaurantId) query.restaurantId = params.restaurantId;
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
    orderId?: string;
    paymentStatus?: 'Pending' | 'Paid';
  }) {
    return takeawayOrderRepo.create({
      ...data,
      status: 'Preparing',
      paymentStatus: data.paymentStatus ?? 'Pending',
      orderId: data.orderId ? new mongoose.Types.ObjectId(data.orderId) : undefined,
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
   * Get the next order number — ONE shared atomic series for the whole
   * restaurant (dine-in, takeaway and website orders all draw from the same
   * counter so numbers never repeat). Previously this computed branch-local
   * max+1, which could collide with the Order series.
   */
  async getNextOrderNumber(_branchId?: string): Promise<number> {
    const { orderService } = await import('./index');
    return orderService.getNextOrderNumber();
  }
}

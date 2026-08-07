/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Service — vendor CRUD for inventory, scoped to the caller's
 * restaurant for multi-tenant isolation.
 */

import mongoose from 'mongoose';
import { supplierRepo } from '../repositories';
import { AppError } from '../utils/AppError';

export class SupplierService {
  async list(params: { restaurantId?: string; search?: string; status?: string; limit?: number } = {}) {
    if (!params.restaurantId) throw new AppError(400, 'restaurantId is required');
    const query: any = { restaurantId: params.restaurantId };
    if (params.search) {
      query.$or = [
        { name: new RegExp(params.search, 'i') },
        { phone: new RegExp(params.search, 'i') },
        { gstin: new RegExp(params.search, 'i') },
      ];
    }
    if (params.status) query.status = params.status;
    const limit = params.limit && params.limit > 0 ? params.limit : 200;
    return supplierRepo.findAll(query, { limit, sort: { name: 1 } });
  }

  async getById(id: string, restaurantId: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(400, 'Invalid supplier id');
    const supplier = await supplierRepo.findById(id);
    if (!supplier) return null;
    if (String((supplier as any).restaurantId) !== restaurantId) {
      throw new AppError(403, 'Supplier not found in your restaurant');
    }
    return supplier;
  }

  async create(data: any, restaurantId: string) {
    if (!data.name || !String(data.name).trim()) {
      throw new AppError(400, 'Supplier name is required');
    }
    return supplierRepo.create({
      ...data,
      name: String(data.name).trim(),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      branchId: data.branchId ? new mongoose.Types.ObjectId(data.branchId) : undefined,
    });
  }

  async update(id: string, restaurantId: string, data: any) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(400, 'Invalid supplier id');
    const existing = await supplierRepo.findById(id);
    if (!existing) return null;
    if (String((existing as any).restaurantId) !== restaurantId) {
      throw new AppError(403, 'Supplier not found in your restaurant');
    }
    const updates: any = {};
    for (const key of ['branchId', 'name', 'phone', 'email', 'address', 'gstin', 'items', 'status', 'notes']) {
      if (data[key] !== undefined) updates[key] = data[key];
    }
    if (updates.name !== undefined) updates.name = String(updates.name).trim();
    if (updates.branchId !== undefined) updates.branchId = updates.branchId ? new mongoose.Types.ObjectId(updates.branchId) : undefined;
    return supplierRepo.update(id, updates);
  }

  async delete(id: string, restaurantId: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(400, 'Invalid supplier id');
    const existing = await supplierRepo.findById(id);
    if (!existing) return null;
    if (String((existing as any).restaurantId) !== restaurantId) {
      throw new AppError(403, 'Supplier not found in your restaurant');
    }
    return supplierRepo.softDelete(id);
  }
}

export const supplierService = new SupplierService();

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Employee Service — Business logic for staff management.
 * Handles PIN-based authentication, role-based filtering,
 * branch assignment, and PIN stripping from API responses.
 */

import { employeeRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { hashPin, isBcryptHash } from '../utils/bcrypt';
import { entitlementService } from './entitlementService';

export class EmployeeService {
  /**
   * List employees with optional branch and role filtering — scoped to the
   * authenticated restaurant (multi-tenant isolation).
   * PINs are stripped from the response.
   */
  async list(params: { restaurantId?: string; branchId?: string; role?: string } = {}) {
    const query: any = {};
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.branchId) query.branchId = params.branchId;
    if (params.role) query.role = params.role;

    const result = await employeeRepo.findAll(query, { sort: { name: 1 } });
    return {
      ...result,
      data: result.data.map(this.stripPin),
    };
  }

  /**
   * Get a single employee by ID (without PIN) — tenant-scoped so a user can
   * never read another restaurant's staff record (IDOR guard).
   */
  async getById(id: string, restaurantId?: string) {
    const filter: any = { _id: id };
    if (restaurantId) filter.restaurantId = restaurantId;
    const employee = await employeeRepo.findOne(filter);
    if (!employee) return null;
    return this.stripPin(employee);
  }

  /**
   * Create a new employee. PIN is required.
   * Enforces the plan's total Max Users limit (company-wide, all branches).
   */
  async create(data: { username: string; name: string; role: string; pin: string; password?: string; branchId?: string; restaurantId?: string }) {
    if (!data.pin) throw new AppError(400, 'PIN is required');
    // Max Users is the TOTAL user count across the whole company — enforce it
    // before creating the staff account.
    if (data.restaurantId) {
      const capacity = await entitlementService.canAddUser(String(data.restaurantId));
      if (!capacity.allowed) {
        throw new AppError(403, capacity.reason || 'User limit reached');
      }
    }
    // PINs must be bcrypt-hashed at rest so authService.verifyPin (bcrypt.compare)
    // succeeds on login. Storing plaintext made every API-created employee unable
    // to log in.
    const employee = await employeeRepo.create({
      ...data,
      pin: await hashPin(data.pin),
      password: data.password ? await hashPin(data.password) : undefined,
    } as any);
    return this.stripPin(employee);
  }

  /**
   * Update an employee. If PIN is not provided, it's preserved.
   * Tenant-scoped — an Owner can only update staff in their own restaurant,
   * never another restaurant's employee (prevents cross-tenant credential
   * takeover via PIN/password reset).
   */
  async update(id: string, data: any, restaurantId?: string) {
    // Hash a new plaintext PIN unless it is already a bcrypt hash (avoids
    // double-hashing when updating other fields with a preserved PIN).
    const updateData = { ...data };
    if (updateData.pin && !isBcryptHash(updateData.pin)) {
      updateData.pin = await hashPin(updateData.pin);
    }
    if (updateData.password && !isBcryptHash(updateData.password)) {
      updateData.password = await hashPin(updateData.password);
    }
    const filter: any = { _id: id, isDeleted: { $ne: true } };
    if (restaurantId) filter.restaurantId = restaurantId;
    const employee = await employeeRepo.findOneAndUpdate(filter, updateData);
    if (!employee) return null;
    return this.stripPin(employee);
  }

  /**
   * Soft-delete an employee — tenant-scoped.
   */
  async delete(id: string, restaurantId?: string) {
    const filter: any = { _id: id, isDeleted: { $ne: true } };
    if (restaurantId) filter.restaurantId = restaurantId;
    return employeeRepo.findOneAndUpdate(filter, {
      isDeleted: true,
      deletedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Strip the PIN/password fields from employee data before returning to client.
   */
  private stripPin(employee: any) {
    const obj = employee.toObject ? employee.toObject() : employee;
    const { pin, password, ...safe } = obj;
    return safe;
  }
}

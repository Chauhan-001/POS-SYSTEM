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

export class EmployeeService {
  /**
   * List employees with optional branch and role filtering.
   * PINs are stripped from the response.
   */
  async list(params: { branchId?: string; role?: string } = {}) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    if (params.role) query.role = params.role;

    const result = await employeeRepo.findAll(query, { sort: { name: 1 } });
    return {
      ...result,
      data: result.data.map(this.stripPin),
    };
  }

  /**
   * Get a single employee by ID (without PIN).
   */
  async getById(id: string) {
    const employee = await employeeRepo.findById(id);
    if (!employee) return null;
    return this.stripPin(employee);
  }

  /**
   * Create a new employee. PIN is required.
   */
  async create(data: { username: string; name: string; role: string; pin: string; password?: string; branchId?: string }) {
    if (!data.pin) throw new AppError(400, 'PIN is required');
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
   */
  async update(id: string, data: any) {
    // Hash a new plaintext PIN unless it is already a bcrypt hash (avoids
    // double-hashing when updating other fields with a preserved PIN).
    const updateData = { ...data };
    if (updateData.pin && !isBcryptHash(updateData.pin)) {
      updateData.pin = await hashPin(updateData.pin);
    }
    if (updateData.password && !isBcryptHash(updateData.password)) {
      updateData.password = await hashPin(updateData.password);
    }
    const employee = await employeeRepo.update(id, updateData);
    if (!employee) return null;
    return this.stripPin(employee);
  }

  /**
   * Soft-delete an employee.
   */
  async delete(id: string) {
    return employeeRepo.softDelete(id);
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

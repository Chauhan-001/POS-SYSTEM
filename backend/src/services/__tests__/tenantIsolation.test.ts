/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 — Multi-tenant isolation regression tests (real MongoDB).
 *
 * These prove the IDOR/BOLA fixes end-to-end: an authenticated user's
 * restaurantId is derived from the JWT and every read/write is scoped to it.
 * Records seeded under restaurant B must be invisible/immutable to a caller
 * operating as restaurant A.
 *
 * Covered:
 *   - HeldOrderService: list/get/update/delete tenant-scoped; create tags
 *     restaurantId server-side.
 *   - EmployeeService: list/get/update/delete tenant-scoped (cross-tenant
 *     credential takeover via PIN reset is impossible).
 *   - BranchService.update: tenant-scoped guard + head-branch unset never
 *     touches another restaurant's branches.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { HeldOrderService } from '../heldOrderService';
import { EmployeeService } from '../employeeService';
import { BranchService } from '../branchService';
import HeldOrder from '../../models/HeldOrder';
import Employee from '../../models/Employee';
import Branch from '../../models/Branch';

let mongod: MongoMemoryServer;

const heldOrderService = new HeldOrderService();
const employeeService = new EmployeeService();
const branchService = new BranchService();

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    HeldOrder.deleteMany({}),
    Employee.deleteMany({}),
    Branch.deleteMany({}),
  ]);
});

describe('HeldOrderService — tenant isolation', () => {
  it('list returns only the caller restaurant\'s held orders', async () => {
    await HeldOrder.create({ clientId: 'c-b', restaurantId: REST_B, items: [] });
    await HeldOrder.create({ clientId: 'c-a', restaurantId: REST_A, items: [] });

    const result = await heldOrderService.list({ restaurantId: REST_A });
    const ids = result.data.map((h: any) => h.clientId);
    expect(ids).toEqual(['c-a']);
    expect(ids).not.toContain('c-b');
  });

  it('getById cannot read another restaurant\'s held order', async () => {
    const other = await HeldOrder.create({ clientId: 'c-b', restaurantId: REST_B, items: [] });
    const order = await heldOrderService.getById(other._id.toString(), REST_A);
    expect(order).toBeNull();
  });

  it('getById CAN read the caller\'s own held order', async () => {
    const own = await HeldOrder.create({ clientId: 'c-a', restaurantId: REST_A, items: [] });
    const order = await heldOrderService.getById(own._id.toString(), REST_A);
    expect(order).not.toBeNull();
  });

  it('create tags restaurantId server-side', async () => {
    await heldOrderService.create({ clientId: 'new', items: [] }, REST_A);
    const saved = await HeldOrder.findOne({ clientId: 'new' }).lean();
    expect(String((saved as any).restaurantId)).toBe(REST_A);
  });

  it('update cannot modify another restaurant\'s held order', async () => {
    const other = await HeldOrder.create({ clientId: 'c-b', restaurantId: REST_B, items: [] });
    const updated = await heldOrderService.update(other._id.toString(), { type: 'DineIn' }, REST_A);
    expect(updated).toBeNull();
    const still = await HeldOrder.findById(other._id).lean();
    expect((still as any).type).toBe('Takeaway');
  });

  it('delete cannot remove another restaurant\'s held order', async () => {
    const other = await HeldOrder.create({ clientId: 'c-b', restaurantId: REST_B, items: [] });
    const deleted = await heldOrderService.delete(other._id.toString(), REST_A);
    expect(deleted).toBeNull();
    const still = await HeldOrder.findById(other._id).lean();
    expect(still).not.toBeNull();
  });
});

describe('EmployeeService — tenant isolation', () => {
  it('list returns only the caller restaurant\'s employees', async () => {
    await Employee.create({ username: 'u-b', name: 'B', role: 'Cashier', restaurantId: REST_B, pin: '1111' });
    await Employee.create({ username: 'u-a', name: 'A', role: 'Cashier', restaurantId: REST_A, pin: '1111' });

    const result = await employeeService.list({ restaurantId: REST_A });
    const usernames = result.data.map((e: any) => e.username);
    expect(usernames).toEqual(['u-a']);
    expect(usernames).not.toContain('u-b');
  });

  it('getById cannot read another restaurant\'s employee', async () => {
    const other = await Employee.create({ username: 'u-b', name: 'B', role: 'Cashier', restaurantId: REST_B, pin: '1111' });
    const emp = await employeeService.getById(other._id.toString(), REST_A);
    expect(emp).toBeNull();
  });

  it('update cannot reset another restaurant\'s employee PIN (credential takeover)', async () => {
    const other = await Employee.create({ username: 'u-b', name: 'B', role: 'Cashier', restaurantId: REST_B, pin: '1111' });
    const updated = await employeeService.update(other._id.toString(), { pin: '9999' }, REST_A);
    expect(updated).toBeNull();
    const still = await Employee.findById(other._id).lean();
    expect((still as any).pin).toBe('1111');
  });

  it('delete cannot remove another restaurant\'s employee', async () => {
    const other = await Employee.create({ username: 'u-b', name: 'B', role: 'Cashier', restaurantId: REST_B, pin: '1111' });
    const deleted = await employeeService.delete(other._id.toString(), REST_A);
    expect(deleted).toBeNull();
    const still = await Employee.findById(other._id).lean();
    expect(still).not.toBeNull();
  });
});

describe('BranchService.update — tenant isolation', () => {
  it('rejects updating a branch that does not belong to the restaurant', async () => {
    const other = await Branch.create({ name: 'B Branch', restaurantId: REST_B });
    await expect(
      branchService.update(other._id.toString(), { name: 'Hijacked' }, REST_A)
    ).rejects.toThrow('Branch not found');
    const still = await Branch.findById(other._id).lean();
    expect((still as any).name).toBe('B Branch');
  });

  it('head-branch unset never touches another restaurant\'s branches', async () => {
    const own = await Branch.create({ name: 'A-1', restaurantId: REST_A, isHeadBranch: true });
    const otherHead = await Branch.create({ name: 'B-1', restaurantId: REST_B, isHeadBranch: true });

    // Restaurant A promotes a second branch to head — must NOT clear B's head.
    const own2 = await Branch.create({ name: 'A-2', restaurantId: REST_A, isHeadBranch: false });
    await branchService.update(own2._id.toString(), { isHeadBranch: true }, REST_A);

    const a1 = await Branch.findById(own._id).lean();
    const b1 = await Branch.findById(otherHead._id).lean();
    const a2 = await Branch.findById(own2._id).lean();
    expect((a1 as any).isHeadBranch).toBe(false); // A's old head cleared
    expect((a2 as any).isHeadBranch).toBe(true);  // A's new head set
    expect((b1 as any).isHeadBranch).toBe(true);  // B's head untouched
  });
});

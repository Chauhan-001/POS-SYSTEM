/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Studio regen gate — regenerating a table sticker invalidates the printed
 * QR, so it requires the CURRENT user's password/PIN (verified server-side).
 * Creating a sticker for a table that has none stays password-free so the
 * auto-backfill/seed flow and new-table auto-generation keep working.
 *
 * Also locks in the NEVER-EXPIRE guarantee: rows are only ever replaced by an
 * explicit owner regen — nothing here rotates a sticker automatically.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Request, Response } from 'express';
import { hashPin } from '../../../utils/bcrypt';
import Restaurant from '../../../models/Restaurant';
import Table from '../../../models/Table';
import Employee from '../../../models/Employee';
import QrToken from '../models/QrToken';
import { createQrToken } from '../controllers/qrTokenController';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();

function makeReq(body: Record<string, unknown>, employeeId?: string | null) {
  return {
    body,
    user: { restaurantId: REST.toString(), role: 'owner', employeeId: employeeId ?? null },
  } as unknown as Request;
}
function makeRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('QR Studio table-sticker regeneration gate', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Restaurant.deleteMany({}),
      Table.deleteMany({}),
      Employee.deleteMany({}),
      QrToken.deleteMany({}),
    ]);
    await Restaurant.create({
      _id: REST,
      restaurantId: 'TEST_PIZZA',
      name: 'Test Pizza',
      phone: '+910000000000',
      ownerPin: await hashPin('owner-secret'),
      publicToken: 'pbl_abcdef1234567890',
    });
  });

  async function seedTable(): Promise<any> {
    return Table.create({
      number: 1,
      capacity: 4,
      status: 'Available',
      restaurantId: REST,
      branchId: BRANCH,
    });
  }

  async function seedSticker(table: any): Promise<any> {
    return QrToken.create({
      restaurantId: REST,
      branchId: BRANCH,
      type: 'table',
      tableId: table._id,
      tableNumber: table.number,
      token: 'qr_originalsticker',
      url: `http://qr.test/#/pbl_abcdef1234567890?mode=table&ref=${table._id.toString()}`,
    });
  }

  it('creating a sticker for a table WITHOUT one needs no password (201)', async () => {
    const table = await seedTable();
    const res = makeRes();

    await createQrToken(makeReq({ type: 'table', tableId: table._id.toString() }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0] as { token: any };
    expect(body.token).toBeDefined();
    expect(body.token.tableId?.toString()).toBe(table._id.toString());
    // New sticker row exists.
    expect(await QrToken.countDocuments({ type: 'table', tableId: table._id })).toBe(1);
  });

  it('regenerating WITHOUT a password is rejected (403) and the sticker is untouched', async () => {
    const table = await seedTable();
    await seedSticker(table);
    const res = makeRes();

    await createQrToken(makeReq({ type: 'table', tableId: table._id.toString() }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    // Original sticker still in place — regen never happened.
    const row = await QrToken.findOne({ type: 'table', tableId: table._id }).lean().exec();
    expect((row as any).token).toBe('qr_originalsticker');
  });

  it('regenerating with a WRONG password is rejected (403)', async () => {
    const table = await seedTable();
    await seedSticker(table);
    const res = makeRes();

    await createQrToken(
      makeReq({ type: 'table', tableId: table._id.toString(), password: 'wrong-password' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('regenerating with the OWNER password replaces the sticker (new token, 201)', async () => {
    const table = await seedTable();
    const old = await seedSticker(table);
    const res = makeRes();

    await createQrToken(
      makeReq({ type: 'table', tableId: table._id.toString(), password: 'owner-secret' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0] as { token: any };
    expect(body.token.token).not.toBe(old.token);
    expect(body.token.token).toMatch(/^qr_/);
    // Exactly one sticker for the table — replaced, not duplicated.
    expect(await QrToken.countDocuments({ type: 'table', tableId: table._id })).toBe(1);
  });

  it('regenerating with the EMPLOYEE password verifies against the logged-in employee', async () => {
    const table = await seedTable();
    await seedSticker(table);
    const emp = await Employee.create({
      username: 'mgr1',
      name: 'Manager One',
      role: 'Manager',
      pin: await hashPin('mgr-pin'),
      status: 'Active',
      restaurantId: REST,
      branchId: BRANCH,
    });
    const res = makeRes();

    await createQrToken(
      makeReq(
        { type: 'table', tableId: table._id.toString(), password: 'mgr-pin' },
        emp._id.toString(),
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(await QrToken.countDocuments({ type: 'table', tableId: table._id })).toBe(1);
  });

  it('regenerating with the WRONG EMPLOYEE password is rejected even when owner password is correct', async () => {
    const table = await seedTable();
    await seedSticker(table);
    const emp = await Employee.create({
      username: 'mgr2',
      name: 'Manager Two',
      role: 'Manager',
      pin: await hashPin('mgr-pin'),
      status: 'Active',
      restaurantId: REST,
      branchId: BRANCH,
    });
    const res = makeRes();

    // The employee is logged in; the OWNER password must NOT unlock it.
    await createQrToken(
      makeReq(
        { type: 'table', tableId: table._id.toString(), password: 'owner-secret' },
        emp._id.toString(),
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    const row = await QrToken.findOne({ type: 'table', tableId: table._id }).lean().exec();
    expect((row as any).token).toBe('qr_originalsticker');
  });

  it('a foreign table (different tenant) is never found — 404, no regen, no sticker row', async () => {
    const foreign = await Table.create({
      number: 99,
      capacity: 2,
      status: 'Available',
      restaurantId: new mongoose.Types.ObjectId(),
      branchId: BRANCH,
    });
    const res = makeRes();

    await createQrToken(makeReq({ type: 'table', tableId: foreign._id.toString() }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(await QrToken.countDocuments({})).toBe(0);
  });
});

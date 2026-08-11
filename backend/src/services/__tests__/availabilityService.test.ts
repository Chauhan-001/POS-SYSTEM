/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AvailabilityService tests — online menu availability:
 *   - Default state is AVAILABLE (no rows = everything orderable).
 *   - Branch override wins over the restaurant-wide default.
 *   - Branch isolation: Mumbai's UNAVAILABLE never affects Delhi.
 *   - unavailableUntil auto-expires back to AVAILABLE (lazy + sweep).
 *   - Bulk upsert + idempotent no-op writes.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { availabilityService } from '../availabilityService';
import MenuAvailability from '../../models/MenuAvailability';
import AuditLog from '../../models/AuditLog';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BR_MUMBAI = new mongoose.Types.ObjectId();
const BR_DELHI = new mongoose.Types.ObjectId();
const BURGER = new mongoose.Types.ObjectId();
const FRIES = new mongoose.Types.ObjectId();

describe('AvailabilityService — online menu availability', () => {
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
      MenuAvailability.deleteMany({}).exec(),
      AuditLog.deleteMany({}).exec(),
    ]);
  });

  it('defaults to AVAILABLE when no row exists', async () => {
    expect(await availabilityService.getForProduct(REST.toString(), null, BURGER.toString())).toBe(true);
  });

  it('restaurant-wide UNAVAILABLE blocks all branches', async () => {
    await availabilityService.setBulk(REST.toString(), [{ productId: BURGER.toString(), status: 'UNAVAILABLE', reason: 'Sold out' }]);
    expect(await availabilityService.getForProduct(REST.toString(), BR_MUMBAI.toString(), BURGER.toString())).toBe(false);
    expect(await availabilityService.getForProduct(REST.toString(), BR_DELHI.toString(), BURGER.toString())).toBe(false);
  });

  it('branch override beats the restaurant default (Mumbai OFF, Delhi ON)', async () => {
    // Restaurant-wide default: AVAILABLE (implicit). Mumbai override: UNAVAILABLE.
    await availabilityService.setBulk(REST.toString(), [{ productId: FRIES.toString(), status: 'UNAVAILABLE' }], {
      branchId: BR_MUMBAI.toString(),
    });
    expect(await availabilityService.getForProduct(REST.toString(), BR_MUMBAI.toString(), FRIES.toString())).toBe(false);
    // Delhi sees the restaurant-wide default → AVAILABLE (isolation).
    expect(await availabilityService.getForProduct(REST.toString(), BR_DELHI.toString(), FRIES.toString())).toBe(true);
  });

  it('unavailableUntil auto-expires back to AVAILABLE', async () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await availabilityService.setBulk(REST.toString(), [
      { productId: BURGER.toString(), status: 'UNAVAILABLE', unavailableUntil: past },
    ]);
    // Lazy expiry on read.
    expect(await availabilityService.getForProduct(REST.toString(), null, BURGER.toString())).toBe(true);
    // And the row has been flipped in the DB.
    const row = await MenuAvailability.findOne({ restaurantId: REST, productId: BURGER });
    expect(row?.status).toBe('AVAILABLE');
  });

  it('future unavailableUntil stays UNAVAILABLE until the time passes', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await availabilityService.setBulk(REST.toString(), [{ productId: BURGER.toString(), status: 'UNAVAILABLE', unavailableUntil: future }]);
    expect(await availabilityService.getForProduct(REST.toString(), null, BURGER.toString())).toBe(false);
  });

  it('bulk set is idempotent for identical writes', async () => {
    const payload = [{ productId: BURGER.toString(), status: 'UNAVAILABLE' as const, reason: 'Prep closed' }];
    const first = await availabilityService.setBulk(REST.toString(), payload);
    const second = await availabilityService.setBulk(REST.toString(), payload);
    expect(first[0].status).toBe('UNAVAILABLE');
    expect(second[0].status).toBe('UNAVAILABLE');
    // No duplicate rows from the no-op path.
    expect(await MenuAvailability.countDocuments({ restaurantId: REST })).toBe(1);
  });

  it('visibleOnSite=false hides the item from the site but keeps its status', async () => {
    await availabilityService.setBulk(REST.toString(), [{
      productId: BURGER.toString(),
      status: 'UNAVAILABLE',
      reason: 'Sold out',
    }]);
    // Pure visibility toggle — no status/reason/until override.
    await availabilityService.setBulk(REST.toString(), [{
      productId: BURGER.toString(),
      status: 'UNAVAILABLE',
      visibleOnSite: false,
    }]);

    const state = await availabilityService.getForProduct(REST.toString(), null, BURGER.toString());
    expect(state).toBe(false); // still unavailable
    const resolved = await availabilityService.resolveState(REST.toString(), null, BURGER.toString());
    expect(resolved.visibleOnSite).toBe(false);
    expect(resolved.status).toBe('UNAVAILABLE');
  });

  it('visibility toggle never wipes unavailableUntil or reason', async () => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    await availabilityService.setBulk(REST.toString(), [{
      productId: FRIES.toString(),
      status: 'UNAVAILABLE',
      unavailableUntil: later,
      reason: 'Running out tonight',
    }]);
    // Owner hides from Products page — must NOT clear the restore timer/reason.
    await availabilityService.setBulk(REST.toString(), [{
      productId: FRIES.toString(),
      status: 'UNAVAILABLE',
      visibleOnSite: false,
    }]);
    const resolved = await availabilityService.resolveState(REST.toString(), null, FRIES.toString());
    expect(resolved.visibleOnSite).toBe(false);
    expect(resolved.unavailableUntil).toBe(later);
    expect(resolved.reason).toBe('Running out tonight');
  });

  it('restaurant-wide hide hard-blocks a branch override that says visible', async () => {
    // Branch override explicitly visible=true.
    await availabilityService.setBulk(REST.toString(), [{
      productId: BURGER.toString(),
      status: 'AVAILABLE',
      visibleOnSite: true,
    }], { branchId: BR_MUMBAI.toString() });
    // Owner hides restaurant-wide from the Products page.
    await availabilityService.setBulk(REST.toString(), [{
      productId: BURGER.toString(),
      status: 'AVAILABLE',
      visibleOnSite: false,
    }]);
    // Mumbai must still NOT see it (global master switch wins).
    const mumbai = await availabilityService.getForProduct(REST.toString(), BR_MUMBAI.toString(), BURGER.toString());
    expect(mumbai).toBe(false);
    const mumbaiState = await availabilityService.resolveState(REST.toString(), BR_MUMBAI.toString(), BURGER.toString());
    expect(mumbaiState.visibleOnSite).toBe(false);
    // Delhi (no override) also hidden.
    const delhiState = await availabilityService.resolveState(REST.toString(), BR_DELHI.toString(), BURGER.toString());
    expect(delhiState.visibleOnSite).toBe(false);
  });

  it('getMap resolves the effective state for a product set', async () => {
    await availabilityService.setBulk(REST.toString(), [{ productId: FRIES.toString(), status: 'UNAVAILABLE' }]);
    const map = await availabilityService.getMap(REST.toString(), null, [BURGER.toString(), FRIES.toString()]);
    expect(map.get(BURGER.toString())?.status).toBe('AVAILABLE');
    expect(map.get(FRIES.toString())?.status).toBe('UNAVAILABLE');
  });
});

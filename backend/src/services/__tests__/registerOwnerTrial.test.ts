/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Registration trial integration test (real MongoDB via mongodb-memory-server).
 *
 * Locks in the go-live contract: a fresh POS registration with NO plan
 * selected automatically receives a config.subscription.trialDays (14) trial
 * covering EVERY feature in the catalog — genuinely "all features", derived
 * from constants/planFeatures so it can never drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authService } from '../index';
import { config } from '../../config';
import { ALL_FEATURES } from '../../constants/planFeatures';
import Subscription from '../../models/Subscription';
import Restaurant from '../../models/Restaurant';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('registerOwner — 14-day all-features trial (no plan selection)', () => {
  it('defaults the trial length to 14 days', () => {
    expect(config.subscription.trialDays).toBe(14);
  });

  it('registers without a planId and grants a full-catalog trial', async () => {
    const result = await authService.registerOwner({
      fullName: 'Trial Owner',
      phone: '9876543210',
      password: 'secret123',
      restaurantName: 'Trial Bistro',
      userId: 'trial_owner',
    });

    expect(result.employee).toBeTruthy();
    expect((result.employee as any).role).toBe('Owner');

    const restaurant = await Restaurant.findOne({ name: 'Trial Bistro' }).lean().exec();
    expect(restaurant).toBeTruthy();

    const sub = await Subscription.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(sub).toBeTruthy();
    expect(sub!.status).toBe('trial');
    expect(sub!.plan).toBe('free');

    // Trial length = config.subscription.trialDays (14 days) from registration,
    // and expiryDate stays in lockstep (trialEnd is what enforcement reads;
    // expiryDate feeds status payloads + proration).
    const expectedEnd = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const trialEnd = sub!.trialEnd as Date;
    const expiry = sub!.expiryDate as Date;
    expect(trialEnd).toBeTruthy();
    expect(expiry).toBeTruthy();
    expect(Math.abs(trialEnd.getTime() - expectedEnd)).toBeLessThan(60_000);
    expect(Math.abs(expiry.getTime() - expectedEnd)).toBeLessThan(60_000);

    // EVERY catalog feature is unlocked — the trial is the full product.
    expect(sub!.features.length).toBe(ALL_FEATURES.length);
    for (const f of ALL_FEATURES) {
      expect(sub!.features).toContain(f);
    }
  });

  it('keeps a single owner: a second registration is rejected', async () => {
    await expect(
      authService.registerOwner({
        fullName: 'Second Owner',
        phone: '9123456789',
        password: 'secret123',
        restaurantName: 'Second Bistro',
        userId: 'second_owner',
      }),
    ).rejects.toThrow(/already exists/);
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Segment engine tenant-isolation regression tests (Phase 2).
 * Restaurant A's segments must NEVER contain Restaurant B's customer phone
 * numbers — even when both restaurants have identical customers.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { updateAllSegments, getSegments } from '../segmentEngine';
import Customer from '../../models/Customer';
import CustomerSegment from '../../models/CustomerSegment';

let mongod: MongoMemoryServer;

describe('SegmentEngine tenant isolation (Phase 2)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}).exec(), CustomerSegment.deleteMany({}).exec()]);
  });

  async function seedCustomer(restaurantId: string, phone: string, overrides: any = {}): Promise<void> {
    await Customer.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      phone,
      name: `Cust ${phone}`,
      visits: 1,
      points: 0,
      isNewCustomer: true,
      lastVisit: new Date(),
      ...overrides,
    });
  }

  it('never copies another restaurant’s customers into this restaurant’s segments', async () => {
    const restA = new mongoose.Types.ObjectId().toString();
    const restB = new mongoose.Types.ObjectId().toString();

    // Identical customer sets in both restaurants — a classic cross-tenant leak.
    await seedCustomer(restA, '9111111111', { visits: 25, points: 600 }); // A VIP
    await seedCustomer(restA, '9222222222');
    await seedCustomer(restB, '9111111111', { visits: 25, points: 600 }); // B VIP
    await seedCustomer(restB, '9333333333');

    await updateAllSegments(restA);

    const segsA = await getSegments(restA);
    const allPhonesA = segsA.flatMap((s) => s.customerPhones);
    expect(allPhonesA).toContain('9111111111'); // A's own VIP
    expect(allPhonesA).toContain('9222222222'); // A's regular
    expect(allPhonesA).not.toContain('9333333333'); // B's customer must never appear
  });

  it('segment counts reflect only the restaurant’s own customers', async () => {
    const restA = new mongoose.Types.ObjectId().toString();
    const restB = new mongoose.Types.ObjectId().toString();

    await seedCustomer(restA, '9111111111', { visits: 25, points: 600 });
    await seedCustomer(restA, '9222222222', { visits: 25, points: 600 });
    await seedCustomer(restB, '9333333333', { visits: 25, points: 600 });

    await updateAllSegments(restA);

    const segsA = await getSegments(restA);
    const vipA = segsA.find((s) => s.type === 'vip_customer');
    expect(vipA?.customerCount).toBe(2); // only A's two VIPs, not B's
  });

  it('updating one restaurant leaves the other restaurant’s segments intact', async () => {
    const restA = new mongoose.Types.ObjectId().toString();
    const restB = new mongoose.Types.ObjectId().toString();

    await seedCustomer(restA, '9111111111');
    await seedCustomer(restB, '9333333333');

    await updateAllSegments(restA);
    await updateAllSegments(restB);

    const segsB = await getSegments(restB);
    const allPhonesB = segsB.flatMap((s) => s.customerPhones);
    expect(allPhonesB).toContain('9333333333');
    expect(allPhonesB).not.toContain('9111111111');
  });
});

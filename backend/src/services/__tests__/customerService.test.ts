import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { customerService } from '../index';
import Customer from '../../models/Customer';
import CustomerActivity from '../../models/CustomerActivity';
import LoyaltySettings from '../../models/LoyaltySettings';
import LoyaltyTier from '../../models/LoyaltyTier';
import LoyaltyTransaction from '../../models/LoyaltyTransaction';
import AuditLog from '../../models/AuditLog';

let mongod: MongoMemoryServer;

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

describe('CustomerService (Phase 1.6)', () => {
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
      Customer.deleteMany({}).exec(),
      CustomerActivity.deleteMany({}).exec(),
      LoyaltySettings.deleteMany({}).exec(),
      LoyaltyTier.deleteMany({}).exec(),
      LoyaltyTransaction.deleteMany({}).exec(),
      AuditLog.deleteMany({}).exec(),
    ]);
  });

  describe('multi-tenant isolation', () => {
    it('never leaks customers between restaurants', async () => {
      await customerService.create(REST_A, { phone: '9876543210', name: 'Alice' });
      await customerService.create(REST_B, { phone: '9876543211', name: 'Bob' });

      const listA = await customerService.list(REST_A, {});
      const listB = await customerService.list(REST_B, {});

      expect(listA.total).toBe(1);
      expect(listB.total).toBe(1);
      expect(listA.data[0].name).toBe('Alice');
      expect(listB.data[0].name).toBe('Bob');
    });

    it('allows the same phone in different restaurants (no global unique collision)', async () => {
      await customerService.create(REST_A, { phone: '9000000000', name: 'Same Phone A' });
      await customerService.create(REST_B, { phone: '9000000000', name: 'Same Phone B' });

      const a = await customerService.getByPhone(REST_A, '9000000000');
      const b = await customerService.getByPhone(REST_B, '9000000000');
      expect(a.name).toBe('Same Phone A');
      expect(b.name).toBe('Same Phone B');
    });

    it('cannot read another restaurant customer by id', async () => {
      const created = await customerService.create(REST_A, { phone: '9000000001', name: 'Secret' });
      const id = created.customer!.id;
      const viaB = await customerService.getById(REST_B, id);
      expect(viaB).toBeNull();
      // Update from another tenant must fail (returns null)
      const updated = await customerService.update(REST_B, id, { name: 'Hacked' });
      expect(updated).toBeNull();
      const stillA = await customerService.getById(REST_A, id);
      expect(stillA.name).toBe('Secret');
    });
  });

  describe('pagination & search', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) {
        await customerService.create(REST_A, { phone: `98${String(i).padStart(8, '0')}`, name: `Cust ${i}` });
      }
    });

    it('paginates with total, page, nextPage/previousPage', async () => {
      const page1 = await customerService.list(REST_A, { page: 1, limit: 10 });
      expect(page1.total).toBe(25);
      expect(page1.data).toHaveLength(10);
      expect(page1.totalPages).toBe(3);
      expect(page1.nextPage).toBe(2);
      expect(page1.previousPage).toBeNull();

      const page3 = await customerService.list(REST_A, { page: 3, limit: 10 });
      expect(page3.data).toHaveLength(5);
      expect(page3.nextPage).toBeNull();
      expect(page3.previousPage).toBe(2);
    });

    it('searches by name and by phone', async () => {
      const byName = await customerService.list(REST_A, { search: 'Cust 7' });
      expect(byName.total).toBeGreaterThanOrEqual(1);

      const byPhone = await customerService.list(REST_A, { search: '9800000007' });
      expect(byPhone.total).toBe(1);
      expect(byPhone.data[0].name).toBe('Cust 7');
    });
  });

  describe('CRUD & server-authoritative loyalty', () => {
    it('strips client-supplied loyalty fields on create', async () => {
      const result = await customerService.create(REST_A, {
        phone: '9812345678',
        name: 'Hacker',
        points: 99999,
        visits: 999,
        tier: 'Diamond',
        totalSpend: 999999,
      });
      const cust = result.customer!;
      expect(cust.points).toBe(0);
      expect(cust.visits).toBe(0);
      expect(cust.tier).toBe('Bronze');
      expect(cust.totalSpend).toBe(0);
      expect(cust.referralCode).toBeTruthy(); // auto-generated
      expect(cust.isNew).toBe(true);          // isNewCustomer → isNew mapping
    });

    it('strips client-supplied loyalty fields on update', async () => {
      const created = await customerService.create(REST_A, { phone: '9812345679', name: 'Legit' });
      const id = created.customer!.id;
      const updated = await customerService.update(REST_A, id, { name: 'Legit2', points: 5000, tier: 'Platinum' });
      expect(updated.name).toBe('Legit2');
      // Server-authoritative: points stay at the welcome balance (50), not 5000;
      // tier stays Bronze.
      expect(updated.points).toBe(50);
      expect(updated.tier).toBe('Bronze');
    });

    it('supports phone-based id lookups for backward compatibility', async () => {
      await customerService.create(REST_A, { phone: '9812345680', name: 'ByPhone' });
      const found = await customerService.getById(REST_A, '9812345680');
      expect(found.name).toBe('ByPhone');
      const updated = await customerService.update(REST_A, '9812345680', { notes: 'updated via phone' });
      expect(updated.notes).toBe('updated via phone');
    });

    it('soft-deletes and restores', async () => {
      const created = await customerService.create(REST_A, { phone: '9812345681', name: 'ToDelete' });
      const id = created.customer!.id;
      await customerService.delete(REST_A, id);
      const hidden = await customerService.list(REST_A, {});
      expect(hidden.total).toBe(0);

      const restored = await customerService.restore(REST_A, id);
      expect(restored.name).toBe('ToDelete');
      const visible = await customerService.list(REST_A, {});
      expect(visible.total).toBe(1);
    });

    it('blocks and unblocks with a reason', async () => {
      const created = await customerService.create(REST_A, { phone: '9812345682', name: 'BadActor' });
      const id = created.customer!.id;
      const blocked = await customerService.setBlocked(REST_A, id, true, 'fraud');
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.status).toBe('blocked');
      expect(blocked.blockReason).toBe('fraud');
      const unblocked = await customerService.setBlocked(REST_A, id, false, undefined);
      expect(unblocked.isBlocked).toBe(false);
      expect(unblocked.status).toBe('active');
    });

    it('merges duplicate customers into the primary', async () => {
      const primary = await customerService.create(REST_A, { phone: '9812345683', name: 'Primary' });
      const dup = await customerService.create(REST_A, { phone: '9812345684', name: 'Duplicate' });
      // Give both profiles stats (create() is server-authoritative, so set directly).
      await Customer.updateOne({ _id: primary.customer!.id }, { $set: { totalSpend: 100, visits: 3, totalOrders: 3 } }).exec();
      await Customer.updateOne({ _id: dup.customer!.id }, { $set: { totalSpend: 50, visits: 2, totalOrders: 2 } }).exec();

      const merged = await customerService.merge(REST_A, primary.customer!.id, dup.customer!.id);
      expect(merged.totalSpend).toBe(150);
      expect(merged.visits).toBe(5);
      expect(merged.totalOrders).toBe(5);

      const dupAfter = await customerService.getById(REST_A, dup.customer!.id);
      expect(dupAfter).toBeNull(); // soft-deleted → hidden
    });
  });
});

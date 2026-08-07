import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import RestaurantSettings from '../models/RestaurantSettings';
import Printer from '../models/Printer';
import AuditLog from '../../../models/AuditLog';
import { settingsService } from '../services/settingsService';
import { printerService } from '../services/printerService';
import { AppError } from '../../../utils/AppError';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const BRANCH_1 = new mongoose.Types.ObjectId().toString();
const DEVICE_X = 'terminal-01';

const actor = (restaurantId: string, extra: any = {}) => ({
  performedBy: 'Owner',
  performedById: 'emp-1',
  restaurantId,
  ...extra,
});

describe('Settings engine (Phase 1.9)', () => {
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
      RestaurantSettings.deleteMany({}).exec(),
      Printer.deleteMany({}).exec(),
      AuditLog.deleteMany({}).exec(),
    ]);
  });

  // ─── Priority merge ───────────────────────────────────────────
  describe('priority merge (device → branch → restaurant)', () => {
    it('auto-creates an empty restaurant scope and returns it', async () => {
      const result = await settingsService.getEffective(REST_A);
      expect(result.settings).toEqual({});
      expect(result.meta.scope).toBe('restaurant');
      const count = await RestaurantSettings.countDocuments({ restaurantId: REST_A, scope: 'restaurant' });
      expect(count).toBe(1);
    });

    it('merges restaurant + branch + device with highest priority winning', async () => {
      await settingsService.patch(
        { scope: 'restaurant', settings: { defaultTaxRate: 5, autoPrintReceipt: false, printerRoutingRules: [{ id: 'a', categoryGroup: 'Food', destinationPrinter: 'R1' }] } },
        actor(REST_A)
      );
      await settingsService.patch(
        { scope: 'branch', branchId: BRANCH_1, settings: { defaultTaxRate: 12, receiptFooterMessage: 'Branch footer' } },
        actor(REST_A)
      );
      await settingsService.patch(
        { scope: 'device', branchId: BRANCH_1, deviceId: DEVICE_X, settings: { autoPrintReceipt: true } },
        actor(REST_A)
      );

      const result = await settingsService.getEffective(REST_A, BRANCH_1, DEVICE_X);
      expect(result.settings.defaultTaxRate).toBe(12);       // branch wins over restaurant
      expect(result.settings.autoPrintReceipt).toBe(true);    // device wins over restaurant
      expect(result.settings.receiptFooterMessage).toBe('Branch footer');
      expect(result.settings.printerRoutingRules).toEqual([{ id: 'a', categoryGroup: 'Food', destinationPrinter: 'R1' }]);
      expect(result.meta.scope).toBe('device');
      expect(result.meta.version).toBe(1);
    });

    it('device without a branch doc still falls back to restaurant', async () => {
      await settingsService.patch(
        { scope: 'restaurant', settings: { defaultTaxRate: 5 } },
        actor(REST_A)
      );
      const result = await settingsService.getEffective(REST_A, undefined, DEVICE_X);
      expect(result.settings.defaultTaxRate).toBe(5);
      expect(result.meta.scope).toBe('restaurant');
    });
  });

  // ─── Optimistic concurrency ───────────────────────────────────
  describe('optimistic concurrency + versioning', () => {
    it('increments version and records history on each patch', async () => {
      // First patch: auto-created v1 (empty) doc bumps to v2.
      const first = await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      expect(first.settingsVersion).toBe(2);
      const second = await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 12 } }, actor(REST_A));
      expect(second.settingsVersion).toBe(3);

      const history = await settingsService.listHistory(REST_A, 'restaurant');
      expect(history.settingsVersion).toBe(3);
      expect(history.history).toHaveLength(2);
      expect(history.history[0].version).toBe(2);
      expect(history.history[1].version).toBe(1);
    });

    it('rejects a stale baseVersion with 409', async () => {
      const first = await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 12 } }, actor(REST_A));

      await expect(
        settingsService.patch(
          { scope: 'restaurant', settings: { defaultTaxRate: 18 }, baseVersion: first.settingsVersion },
          actor(REST_A)
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('accepts the write when baseVersion matches current', async () => {
      const first = await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      const ok = await settingsService.patch(
        { scope: 'restaurant', settings: { defaultTaxRate: 12 }, baseVersion: first.settingsVersion },
        actor(REST_A)
      );
      expect(ok.settingsVersion).toBe(3);
    });

    it('is atomic under concurrent PATCHes — only one writer wins', async () => {
      const first = await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      // Fire two concurrent writers with the SAME baseVersion.
      const results = await Promise.allSettled([
        settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 12 }, baseVersion: first.settingsVersion }, actor(REST_A)),
        settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 18 }, baseVersion: first.settingsVersion }, actor(REST_A)),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

      // Final state reflects exactly one writer's payload.
      const effective = await settingsService.getEffective(REST_A);
      expect([12, 18]).toContain(effective.settings.defaultTaxRate);
    });
  });

  // ─── Rollback ─────────────────────────────────────────────────
  describe('rollback', () => {
    it('restores a prior version and records it as a new version', async () => {
      // v1 (empty, auto-created) → v2 {5} → v3 {12}
      await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 12 } }, actor(REST_A));
      const rolled = await settingsService.rollback(
        { scope: 'restaurant', toVersion: 2, changeReason: 'wrong tax rate' },
        actor(REST_A)
      );
      expect(rolled.settings.defaultTaxRate).toBe(5);
      expect(rolled.settingsVersion).toBe(4);

      const effective = await settingsService.getEffective(REST_A);
      expect(effective.settings.defaultTaxRate).toBe(5);
    });

    it('rejects rollback to a version at or beyond current', async () => {
      await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 5 } }, actor(REST_A));
      await expect(
        settingsService.rollback({ scope: 'restaurant', toVersion: 99 }, actor(REST_A))
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ─── Tenant isolation ─────────────────────────────────────────
  describe('tenant isolation', () => {
    it('restaurant B can never see or modify restaurant A settings', async () => {
      await settingsService.patch(
        { scope: 'restaurant', settings: { restaurantName: 'Alpha Kitchen', defaultTaxRate: 5 } },
        actor(REST_A)
      );
      const b = await settingsService.getEffective(REST_B);
      expect(b.settings.restaurantName).toBeUndefined();

      // Restaurant B patches its own scope — A's doc is untouched.
      await settingsService.patch({ scope: 'restaurant', settings: { defaultTaxRate: 18 } }, actor(REST_B));
      const a = await settingsService.getEffective(REST_A);
      expect(a.settings.defaultTaxRate).toBe(5);

      const aDocs = await RestaurantSettings.countDocuments({ restaurantId: REST_A });
      expect(aDocs).toBe(1);
    });

    it('writes tenant-scoped audit entries', async () => {
      await settingsService.patch(
        { scope: 'restaurant', settings: { defaultTaxRate: 5 }, changeReason: 'configure' },
        actor(REST_A, { ipAddress: '10.0.0.5' })
      );
      const audit = await settingsService.listAudit(REST_A);
      expect(audit.total).toBe(1);
      expect(audit.data[0].action).toBe('SETTINGS_UPDATED');
      expect(audit.data[0].details.changedKeys).toContain('defaultTaxRate');
      expect(audit.data[0].ipAddress).toBe('10.0.0.5');

      const bAudit = await settingsService.listAudit(REST_B);
      expect(bAudit.total).toBe(0);
    });
  });

  // ─── Printers ─────────────────────────────────────────────────
  describe('printer registry', () => {
    it('creates, lists and deletes printers tenant-scoped', async () => {
      const p = await printerService.create(
        REST_A,
        {
          name: 'Kitchen',
          type: 'kitchen',
          connection: { kind: 'network', host: '192.168.1.42', port: 9100 },
          paperSize: '80mm',
          isDefault: true,
        },
        actor(REST_A)
      );
      expect(p.isDefault).toBe(true);

      const listA = await printerService.list(REST_A);
      expect(listA).toHaveLength(1);
      const listB = await printerService.list(REST_B);
      expect(listB).toHaveLength(0);

      await printerService.remove(REST_A, String(p._id), actor(REST_A));
      const after = await printerService.list(REST_A);
      expect(after).toHaveLength(0);
    });

    it('enforces a single default printer per restaurant', async () => {
      await printerService.create(REST_A, { name: 'Kitchen', type: 'kitchen', connection: { kind: 'network', host: '10.0.0.1' }, isDefault: true }, actor(REST_A));
      await printerService.create(REST_A, { name: 'Bar', type: 'bar', connection: { kind: 'network', host: '10.0.0.2' }, isDefault: true }, actor(REST_A));

      const printers = await printerService.list(REST_A);
      const defaults = printers.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('Bar');
    });

    it('rejects duplicate printer names', async () => {
      await printerService.create(REST_A, { name: 'Kitchen', type: 'kitchen', connection: { kind: 'network', host: '10.0.0.1' } }, actor(REST_A));
      await expect(
        printerService.create(REST_A, { name: 'Kitchen', type: 'receipt', connection: { kind: 'usb', address: '/dev/usb0' } }, actor(REST_A))
      ).rejects.toBeInstanceOf(AppError);
    });

    it('tests a network printer and marks health', async () => {
      const p = await printerService.create(
        REST_A,
        { name: 'Net', type: 'network', connection: { kind: 'network', host: '127.0.0.1', port: 1 } }, // port 1 → refuses fast
        actor(REST_A)
      );
      const result = await printerService.test(REST_A, String(p._id), actor(REST_A));
      expect(['online', 'offline']).toContain(result.healthStatus);
      const reloaded = await Printer.findById(p._id).exec();
      expect(reloaded!.lastTestedAt).toBeInstanceOf(Date);
    });

    it('marks usb/bluetooth as unknown (terminal confirms)', async () => {
      const p = await printerService.create(
        REST_A,
        { name: 'USB', type: 'usb', connection: { kind: 'usb', address: '/dev/usb0' } },
        actor(REST_A)
      );
      const result = await printerService.test(REST_A, String(p._id), actor(REST_A));
      expect(result.healthStatus).toBe('unknown');
      expect(result.ok).toBe(false);
    });
  });
});

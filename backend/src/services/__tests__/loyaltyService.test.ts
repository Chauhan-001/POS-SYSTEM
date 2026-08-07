import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { customerService, loyaltyService } from '../index';
import Customer from '../../models/Customer';
import LoyaltySettings from '../../models/LoyaltySettings';
import LoyaltyTier from '../../models/LoyaltyTier';
import LoyaltyTransaction from '../../models/LoyaltyTransaction';
import { AppError } from '../../utils/AppError';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

async function makeCustomer(phone = '9876543210'): Promise<string> {
  const created = await customerService.create(REST, { phone, name: 'Loyalty Tester' });
  return created.customer!.id;
}

describe('LoyaltyService (Phase 1.6)', () => {
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
      LoyaltySettings.deleteMany({}).exec(),
      LoyaltyTier.deleteMany({}).exec(),
      LoyaltyTransaction.deleteMany({}).exec(),
    ]);
  });

  it('awards welcome points on enrollment (server-computed)', async () => {
    const id = await makeCustomer();
    const cust = await Customer.findById(id).lean().exec();
    expect(cust!.points).toBe(50); // default welcomePoints
    expect(cust!.lifetimePoints).toBe(50);
  });

  it('earns points with the configured rate', async () => {
    const id = await makeCustomer();
    const { newBalance } = await loyaltyService.earnPoints(REST, id, {
      amount: 100,
      type: 'earn',
      description: 'test earn',
    });
    expect(newBalance).toBe(150);
  });

  it('rejects redemption beyond the available balance', async () => {
    const id = await makeCustomer();
    await expect(
      loyaltyService.redeemPoints(REST, id, 10_000)
    ).rejects.toBeInstanceOf(AppError);
  });

  it('prevents negative balances', async () => {
    const id = await makeCustomer();
    const balance = (await Customer.findById(id).lean().exec())!.points;
    await loyaltyService.redeemPoints(REST, id, balance); // drains to 0
    const after = (await Customer.findById(id).lean().exec())!.points;
    expect(after).toBe(0);
    await expect(loyaltyService.redeemPoints(REST, id, 1)).rejects.toThrow(/Insufficient/);
    expect((await Customer.findById(id).lean().exec())!.points).toBe(0);
  });

  it('enforces the per-transaction maximum redemption', async () => {
    const id = await makeCustomer();
    await loyaltyService.earnPoints(REST, id, { amount: 10_000, type: 'earn', description: 'big earn' });
    await expect(
      loyaltyService.redeemPoints(REST, id, 501) // default max 500
    ).rejects.toThrow(/Maximum redemption/);
  });

  it('enforces the daily redemption limit', async () => {
    const id = await makeCustomer();
    await loyaltyService.updateSettings(REST, { maxRedemptionPerTransaction: 1000 });
    await loyaltyService.earnPoints(REST, id, { amount: 10_000, type: 'earn', description: 'big earn' });
    // default daily limit 1000 — first redemption 600 ok, second 600 exceeds.
    await loyaltyService.redeemPoints(REST, id, 600);
    await expect(loyaltyService.redeemPoints(REST, id, 600)).rejects.toThrow(/Daily redemption limit/);
  });

  it('records every movement in the append-only ledger', async () => {
    const id = await makeCustomer();
    await loyaltyService.earnPoints(REST, id, { amount: 200, type: 'earn', description: 'bill 1' });
    await loyaltyService.redeemPoints(REST, id, 100, { description: 'voucher' });
    const txs = await loyaltyService.getTransactions(REST, id, { limit: 100 });
    expect(txs.total).toBe(3); // welcome + earn + redeem
    const redeem = txs.data.find((t: any) => t.type === 'redeem');
    expect(redeem).toBeTruthy();
    expect(redeem.points).toBe(-100);
    expect(redeem.consumedFrom?.length).toBeGreaterThan(0);
  });

  it('computes tier from lifetime spend and records tier changes', async () => {
    const id = await makeCustomer();
    // Bronze → Silver at 5000 spend
    await loyaltyService.recordBill(REST, id, { grandTotal: 6000, invoiceNumber: 'INV-1', customerPhone: '9876543210' });
    const cust = await Customer.findById(id).lean().exec();
    expect(cust!.tier).toBe('Silver');
    expect(cust!.totalSpend).toBe(6000);
    expect(cust!.visits).toBe(1);
    expect(cust!.totalOrders).toBe(1);
    expect(cust!.averageSpend).toBe(6000);
  });

  it('computes points server-side from bill spend (ignores client hints)', async () => {
    const id = await makeCustomer();
    const before = (await Customer.findById(id).lean().exec())!.points; // 50 welcome
    const { pointsEarned } = await loyaltyService.recordBill(REST, id, {
      grandTotal: 1000,
      invoiceNumber: 'INV-2',
      customerPhone: '9876543210',
    });
    // rate 1 pt/₹, round off → 1000 pts
    expect(pointsEarned).toBe(1000);
    const after = (await Customer.findById(id).lean().exec())!.points;
    expect(after).toBe(before + 1000);
  });

  it('expires points that pass their expiry date', async () => {
    const id = await makeCustomer();
    // Force rolling expiry with a 1-month window.
    await loyaltyService.updateSettings(REST, { pointExpiryMode: 'rolling', rollingExpiryMonths: 1 });
    const { newBalance } = await loyaltyService.earnPoints(REST, id, { amount: 100, type: 'earn', description: 'expirable' });
    expect(newBalance).toBeGreaterThan(0);

    // Backdate the earn entry so it is already expired.
    await LoyaltyTransaction.updateMany(
      { customerId: new mongoose.Types.ObjectId(id), type: 'earn' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    ).exec();

    const result = await loyaltyService.expirePoints(REST);
    expect(result.pointsExpired).toBe(100);
    const cust = await Customer.findById(id).lean().exec();
    expect(cust!.points).toBe(50); // only welcome (no expiry) remains
  });

  it('handles wallet credits and debits', async () => {
    const id = await makeCustomer();
    await loyaltyService.creditWallet(REST, id, 500, { description: 'cashback' });
    expect((await Customer.findById(id).lean().exec())!.walletBalance).toBe(500);
    await loyaltyService.debitWallet(REST, id, 200, { description: 'bill payment' });
    expect((await Customer.findById(id).lean().exec())!.walletBalance).toBe(300);
    await expect(loyaltyService.debitWallet(REST, id, 999)).rejects.toThrow(/Insufficient wallet/);
  });

  it('redeems bill-claims against the true server balance (forged over-claims rejected)', async () => {
    const id = await makeCustomer();
    // Raise caps so the test exercises balance math, not redemption limits.
    await loyaltyService.updateSettings(REST, { maxRedemptionPerTransaction: 2000, dailyRedemptionLimit: 5000, monthlyRedemptionLimit: 50000 });
    // Earn via a bill like billService does.
    await loyaltyService.recordBill(REST, id, { grandTotal: 1000, invoiceNumber: 'INV-R1', customerPhone: '9876543210' });
    const before = (await Customer.findById(id).lean().exec())!;
    expect(before.points).toBe(1050); // 50 welcome + 1000 earned

    const r1 = await loyaltyService.redeemPoints(REST, id, 400, {
      description: 'Reward: Free Dessert',
      refType: 'bill',
      refId: 'INV-R1',
    });
    expect(r1.newBalance).toBe(650);

    // A second legitimate redemption of the remaining balance succeeds.
    const r2 = await loyaltyService.redeemPoints(REST, id, 600, { refType: 'bill', refId: 'INV-R2' });
    expect(r2.newBalance).toBe(50);

    // A forged over-claim (more than the true remaining balance) is rejected.
    await expect(
      loyaltyService.redeemPoints(REST, id, 51, { refType: 'bill', refId: 'INV-FORGED' })
    ).rejects.toThrow(/Insufficient/);

    // Ledger-derived redemption total matches what was actually deducted.
    const txs = await loyaltyService.getTransactions(REST, id, { limit: 100 });
    const redeemTotal = txs.data
      .filter((t: any) => t.type === 'redeem')
      .reduce((s: number, t: any) => s + Math.abs(t.points), 0);
    expect(redeemTotal).toBe(1000);
    expect((await Customer.findById(id).lean().exec())!.points).toBe(50);
  });

  it('prevents double redemption of the same claim via the pool', async () => {
    const id = await makeCustomer(); // welcome = 50 pts
    await loyaltyService.redeemPoints(REST, id, 50, { refType: 'bill', refId: 'INV-D1' });

    // Replaying the identical claim must fail — the balance is fully consumed.
    await expect(
      loyaltyService.redeemPoints(REST, id, 50, { refType: 'bill', refId: 'INV-D1' })
    ).rejects.toThrow(/Insufficient/);

    // Exactly one redeem recorded for that claim.
    const txs = await loyaltyService.getTransactions(REST, id, { limit: 100 });
    const redeems = txs.data.filter((t: any) => t.type === 'redeem' && t.refId === 'INV-D1');
    expect(redeems.length).toBe(1);
    expect(redeems[0].consumedFrom?.length).toBeGreaterThan(0); // FIFO pool trace
  });
});

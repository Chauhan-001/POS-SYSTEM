import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { offerValidationService, customerService } from '../index';
import Customer from '../../models/Customer';
import Offer from '../../models/Offer';
import CouponRedemption from '../../models/CouponRedemption';
import CustomerSegment from '../../models/CustomerSegment';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

describe('OfferValidationService (Phase 1.6)', () => {
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
      Offer.deleteMany({}).exec(),
      CouponRedemption.deleteMany({}).exec(),
      CustomerSegment.deleteMany({}).exec(),
    ]);
  });

  async function makeOffer(overrides: any = {}): Promise<any> {
    return Offer.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      title: 'Test Offer',
      description: 'Test',
      type: 'percentage',
      value: 10,
      status: 'active',
      currentUses: 0,
      ...overrides,
    });
  }

  it('validates an active offer and computes the discount', async () => {
    const offer = await makeOffer({});
    const result = await offerValidationService.validate(REST, {
      offerId: offer._id.toString(),
      billSubtotal: 1000,
    });
    expect(result.valid).toBe(true);
    expect(result.discount).toBe(100); // 10%
  });

  it('rejects expired / paused / draft offers', async () => {
    const ended = await makeOffer({ endDate: '2020-01-01' });
    const paused = await makeOffer({ status: 'paused' });
    const draft = await makeOffer({ status: 'draft' });

    expect((await offerValidationService.validate(REST, { offerId: ended._id.toString(), billSubtotal: 500 })).valid).toBe(false);
    expect((await offerValidationService.validate(REST, { offerId: paused._id.toString(), billSubtotal: 500 })).valid).toBe(false);
    expect((await offerValidationService.validate(REST, { offerId: draft._id.toString(), billSubtotal: 500 })).valid).toBe(false);
  });

  it('rejects bills below the minimum order value', async () => {
    const offer = await makeOffer({ minOrderValue: 500 });
    const low = await offerValidationService.validate(REST, { offerId: offer._id.toString(), billSubtotal: 100 });
    const ok = await offerValidationService.validate(REST, { offerId: offer._id.toString(), billSubtotal: 600 });
    expect(low.valid).toBe(false);
    expect(ok.valid).toBe(true);
  });

  it('caps percentage discounts with maxDiscount', async () => {
    const offer = await makeOffer({ maxDiscount: 50 });
    const result = await offerValidationService.validate(REST, { offerId: offer._id.toString(), billSubtotal: 1000 });
    expect(result.discount).toBe(50);
  });

  it('enforces the per-customer usage limit', async () => {
    const offer = await makeOffer({ maxPerCustomer: 1 });
    const cust = await customerService.create(REST, { phone: '9812345670', name: 'Coupon User' });
    const customerDoc = await Customer.findById(cust.customer!.id).lean().exec();

    // First application passes.
    const first = await offerValidationService.validate(REST, {
      offerId: offer._id.toString(),
      customer: customerDoc,
      billSubtotal: 500,
    });
    expect(first.valid).toBe(true);
    await offerValidationService.recordApplication(REST, {
      offerId: offer._id.toString(),
      customerId: cust.customer!.id,
      customerPhone: '9812345670',
      discountAmount: first.discount || 0,
    });

    // Second application exceeds the per-customer limit.
    const second = await offerValidationService.validate(REST, {
      offerId: offer._id.toString(),
      customer: customerDoc,
      billSubtotal: 500,
    });
    expect(second.valid).toBe(false);
    expect(second.reason).toMatch(/limit/i);
  });

  it('enforces the global usage cap', async () => {
    const offer = await makeOffer({ maxUses: 2 });
    // Simulate 2 uses already.
    await Offer.updateOne({ _id: offer._id }, { $set: { currentUses: 2 } }).exec();
    const result = await offerValidationService.validate(REST, { offerId: offer._id.toString(), billSubtotal: 500 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/limit/i);
  });

  it('targets segments — rejects customers outside the segment', async () => {
    const offer = await makeOffer({});
    const cust = await customerService.create(REST, { phone: '9812345671', name: 'Segmented' });
    const customerDoc = await Customer.findById(cust.customer!.id).lean().exec();

    // Offer targets a segment the customer is NOT in.
    const segment = await CustomerSegment.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      name: 'VIP Customers',
      type: 'vip_customer',
      description: 'vip',
      customerPhones: ['9999999999'],
      customerCount: 1,
      isAutoGenerated: true,
    });
    await Offer.updateOne({ _id: offer._id }, { $set: { targetSegmentIds: [segment._id.toString()] } }).exec();

    const result = await offerValidationService.validate(REST, {
      offerId: offer._id.toString(),
      customer: customerDoc,
      billSubtotal: 500,
    });
    expect(result.valid).toBe(false);
  });

  it('resolves offers by coupon code', async () => {
    const offer = await makeOffer({ couponCode: 'SAVE10', type: 'flat', value: 50 });
    const byCode = await offerValidationService.findOfferByCode(REST, 'save10'); // case-insensitive
    expect(byCode).toBeTruthy();
    expect(byCode.id).toBe(offer._id.toString());

    const result = await offerValidationService.validate(REST, { couponCode: 'SAVE10', billSubtotal: 1000 });
    expect(result.valid).toBe(true);
    expect(result.discount).toBe(50);
  });

  it('does not leak offers across restaurants', async () => {
    const otherRest = new mongoose.Types.ObjectId().toString();
    const offer = await makeOffer({});
    const result = await offerValidationService.validate(otherRest, {
      offerId: offer._id.toString(),
      billSubtotal: 500,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Offer not found');
  });
});

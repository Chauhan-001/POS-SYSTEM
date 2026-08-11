/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer schema hardening tests (Phase 3) — the server must reject nonsensical
 * values regardless of what the frontend sends.
 */

import { describe, expect, it } from 'vitest';
import { createOfferSchema, updateOfferSchema, updateOfferStatusSchema } from '../offer';

const validOffer = {
  title: 'Weekend Special',
  description: 'Get 10% off on all orders above Rs.500',
  type: 'percentage',
  value: 10,
  minOrderValue: 500,
};

describe('createOfferSchema (Phase 3 hardening)', () => {
  it('accepts a valid offer', () => {
    const r = createOfferSchema.safeParse(validOffer);
    expect(r.success).toBe(true);
  });

  it('rejects a 10000% discount', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, value: 10000 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/exceeds the maximum allowed/i);
    }
  });

  it('accepts the exact 100% boundary', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, value: 100 });
    expect(r.success).toBe(true);
  });

  it('rejects negative values', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, value: -5 });
    expect(r.success).toBe(false);
  });

  it('rejects startDate after endDate', () => {
    const r = createOfferSchema.safeParse({
      ...validOffer,
      startDate: '2026-08-01',
      endDate: '2026-07-01',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/endDate must be on or after startDate/);
    }
  });

  it('accepts startDate before endDate', () => {
    const r = createOfferSchema.safeParse({
      ...validOffer,
      startDate: '2026-07-01',
      endDate: '2026-08-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed date string', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, endDate: 'tomorrow' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid coupon code format', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, couponCode: 'bad code!' });
    expect(r.success).toBe(false);
  });

  it('accepts a valid coupon code (and uppercases it)', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, couponCode: 'save-10' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.couponCode).toBe('SAVE-10');
  });

  it('rejects endHour <= startHour', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, startHour: 18, endHour: 17 });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid status value', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, status: 'expired_tomorrow' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    const r = createOfferSchema.safeParse({ ...validOffer, hackerField: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('updateOfferSchema (partial)', () => {
  it('allows updating a single field', () => {
    const r = updateOfferSchema.safeParse({ value: 25 });
    expect(r.success).toBe(true);
  });

  it('still enforces limits on the patched value', () => {
    const r = updateOfferSchema.safeParse({ type: 'percentage', value: 500 });
    expect(r.success).toBe(false);
  });
});

describe('updateOfferStatusSchema', () => {
  it('accepts only known statuses', () => {
    expect(updateOfferStatusSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(updateOfferStatusSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(updateOfferStatusSchema.safeParse({ status: 'hacked' }).success).toBe(false);
  });
});

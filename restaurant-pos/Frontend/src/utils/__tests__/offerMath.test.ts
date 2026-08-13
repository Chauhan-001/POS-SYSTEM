/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerMath tests — every number here mirrors OfferValidationService.computeDiscount()
 * so the offline POS applies exactly what the server would.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeOffer,
  computeOfferDiscountLocally,
  checkOfferEligibilityLocally,
  formatOfferExpiry,
  visibleOffersFromCache,
} from '../offerMath';

const NOW = new Date('2026-08-13T12:00:00'); // a Thursday

describe('computeOfferDiscountLocally (mirror of server)', () => {
  it('percentage: subtotal × value/100', () => {
    expect(computeOfferDiscountLocally({ type: 'percentage', value: 20 }, 280)).toBeCloseTo(56);
    expect(computeOfferDiscountLocally({ type: 'percentage', value: 15 }, 1000)).toBeCloseTo(150);
  });

  it('percentage: capped at maxDiscount', () => {
    expect(computeOfferDiscountLocally({ type: 'percentage', value: 20, maxDiscount: 40 }, 280)).toBeCloseTo(40);
    expect(computeOfferDiscountLocally({ type: 'percentage', value: 20, maxDiscount: 100 }, 280)).toBeCloseTo(56);
  });

  it('flat / cashback / coupon: min(value, subtotal)', () => {
    expect(computeOfferDiscountLocally({ type: 'flat', value: 100 }, 280)).toBeCloseTo(100);
    expect(computeOfferDiscountLocally({ type: 'flat', value: 100 }, 80)).toBeCloseTo(80);
    expect(computeOfferDiscountLocally({ type: 'cashback', value: 50 }, 200)).toBeCloseTo(50);
    expect(computeOfferDiscountLocally({ type: 'coupon', value: 100 }, 250)).toBeCloseTo(100);
  });

  it('line-level types return 0 (server handles bogo/free_item/combo at line level)', () => {
    expect(computeOfferDiscountLocally({ type: 'bogo', value: 1 }, 280)).toBe(0);
    expect(computeOfferDiscountLocally({ type: 'free_item', value: 1 }, 280)).toBe(0);
    expect(computeOfferDiscountLocally({ type: 'combo', value: 229 }, 290)).toBe(0);
    expect(computeOfferDiscountLocally({ type: 'reward_points', value: 500 }, 280)).toBe(0);
  });

  it('zero subtotal is safe', () => {
    expect(computeOfferDiscountLocally({ type: 'percentage', value: 20 }, 0)).toBe(0);
    expect(computeOfferDiscountLocally({ type: 'flat', value: 100 }, 0)).toBe(0);
  });
});

describe('checkOfferEligibilityLocally', () => {
  const active = { status: 'active', isDeleted: false, startDate: '2026-08-01', endDate: '2026-08-31' };

  it('accepts a live active offer', () => {
    expect(checkOfferEligibilityLocally(active, { subtotal: 280, now: NOW })).toEqual({ valid: true });
  });

  it('rejects non-active / deleted offers', () => {
    expect(checkOfferEligibilityLocally({ ...active, status: 'paused' }, { now: NOW }).valid).toBe(false);
    expect(checkOfferEligibilityLocally({ ...active, status: 'expired' }, { now: NOW }).valid).toBe(false);
    expect(checkOfferEligibilityLocally({ ...active, isDeleted: true }, { now: NOW }).valid).toBe(false);
  });

  it('rejects before start date and after end date', () => {
    expect(checkOfferEligibilityLocally({ ...active, startDate: '2026-09-01' }, { now: NOW }).valid).toBe(false);
    expect(checkOfferEligibilityLocally({ ...active, endDate: '2026-08-10' }, { now: NOW }).valid).toBe(false);
  });

  it('enforces day-of-week and hour windows like the server', () => {
    // 2026-08-13 is a Thursday (getDay() === 4)
    expect(checkOfferEligibilityLocally({ ...active, daysOfWeek: [4] }, { now: NOW }).valid).toBe(true);
    expect(checkOfferEligibilityLocally({ ...active, daysOfWeek: [0] }, { now: NOW }).valid).toBe(false);
    expect(checkOfferEligibilityLocally({ ...active, startHour: 9, endHour: 17 }, { now: NOW }).valid).toBe(true);
    expect(checkOfferEligibilityLocally({ ...active, startHour: 14, endHour: 17 }, { now: NOW }).valid).toBe(false);
  });

  it('enforces minimum order value', () => {
    expect(checkOfferEligibilityLocally({ ...active, minOrderValue: 300 }, { subtotal: 280, now: NOW }).valid).toBe(false);
    expect(checkOfferEligibilityLocally({ ...active, minOrderValue: 250 }, { subtotal: 280, now: NOW }).valid).toBe(true);
  });
});

describe('formatOfferExpiry', () => {
  it('returns null when no end date', () => {
    expect(formatOfferExpiry({}, NOW)).toBeNull();
    expect(formatOfferExpiry({ endDate: undefined }, NOW)).toBeNull();
  });

  it('labels today / tomorrow / upcoming / expired', () => {
    expect(formatOfferExpiry({ endDate: '2026-08-13' }, NOW)).toBe('Ends today');
    expect(formatOfferExpiry({ endDate: '2026-08-14' }, NOW)).toBe('Ends tomorrow');
    expect(formatOfferExpiry({ endDate: '2026-08-16' }, NOW)).toBe('Ends in 3 days');
    expect(formatOfferExpiry({ endDate: '2026-08-12' }, NOW)).toBe('Expired');
  });

  it('formats far-future dates as a short date', () => {
    expect(formatOfferExpiry({ endDate: '2026-12-25' }, NOW)).toBe('Valid until 25 Dec');
  });
});

describe('visibleOffersFromCache', () => {
  it('filters to active, non-deleted, non-expired offers', () => {
    const list = [
      { _id: '1', title: 'Live', status: 'active', isDeleted: false, endDate: '2026-09-01' },
      { _id: '2', title: 'Expired', status: 'active', isDeleted: false, endDate: '2026-08-01' },
      { _id: '3', title: 'Paused', status: 'paused', isDeleted: false, endDate: '2026-09-01' },
      { _id: '4', title: 'Deleted', status: 'active', isDeleted: true, endDate: '2026-09-01' },
      { _id: '5', title: 'Scheduled', status: 'active', isDeleted: false, startDate: '2026-09-01', endDate: '2026-10-01' },
    ];
    const visible = visibleOffersFromCache(list, NOW);
    expect(visible.map((o) => o.title)).toEqual(['Live']);
  });

  it('sorts by sortOrder then newest first', () => {
    const list = [
      { _id: 'a', title: 'B', status: 'active', sortOrder: 2, createdAt: '2026-08-10T00:00:00Z' },
      { _id: 'b', title: 'A', status: 'active', sortOrder: 1, createdAt: '2026-08-01T00:00:00Z' },
      { _id: 'c', title: 'C', status: 'active', sortOrder: 1, createdAt: '2026-08-11T00:00:00Z' },
    ];
    const visible = visibleOffersFromCache(list, NOW);
    expect(visible.map((o) => o.title)).toEqual(['C', 'A', 'B']);
  });
});

describe('sanitizeOffer', () => {
  it('normalizes a cached Mongo doc into the server sanitize() shape', () => {
    const raw = {
      _id: '507f1f77bcf86cd799439011',
      title: '20% OFF Paneer',
      description: 'desc',
      type: 'percentage',
      value: 20,
      minOrderValue: 100,
      maxDiscount: 50,
      couponCode: 'PANEER20',
      stackingAllowed: true,
      mutuallyExclusiveGroup: 'grp',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      currentUses: 3,
    };
    expect(sanitizeOffer(raw)).toEqual({
      id: '507f1f77bcf86cd799439011',
      title: '20% OFF Paneer',
      description: 'desc',
      type: 'percentage',
      value: 20,
      minOrderValue: 100,
      maxDiscount: 50,
      couponCode: 'PANEER20',
      stackingAllowed: true,
      mutuallyExclusiveGroup: 'grp',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
  });

  it('tolerates already-sanitized offers and missing fields', () => {
    expect(sanitizeOffer({ id: 'x', title: 'T', type: 'flat', value: 5 })).toMatchObject({
      id: 'x', title: 'T', type: 'flat', value: 5,
    });
    expect(sanitizeOffer(undefined)).toMatchObject({ id: '', title: '', type: 'percentage', value: 0 });
  });
});

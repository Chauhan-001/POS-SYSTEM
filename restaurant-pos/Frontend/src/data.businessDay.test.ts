import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  businessDateKey,
  isInBusinessDay,
  computeDailySales,
  localDateKey,
} from './data';
import type { Bill } from './types';

afterEach(() => {
  vi.useRealTimers();
});

function bill(date: string, time: string, grandTotal: number, paymentMethod: 'Cash' = 'Cash'): Bill {
  return {
    id: `b_${date}_${time}`,
    invoiceNumber: 'INV-1',
    ticketNumber: '#1',
    date,
    time,
    cashierName: 'Test',
    cashierRole: 'Cashier',
    items: [],
    subtotal: grandTotal,
    discount: 0,
    gst: 0,
    grandTotal,
    paymentMethod,
    orderType: 'Dine In',
    pointsEarned: 0,
    pointsRedeemed: 0,
  } as Bill;
}

describe('businessDateKey — opening-window day boundary', () => {
  it('rolls a pre-opening bill back to the previous business day', () => {
    expect(businessDateKey('2026-08-16', '03:00', '08:00')).toBe('2026-08-15');
    expect(businessDateKey('2026-08-16', '07:59', '08:00')).toBe('2026-08-15');
  });

  it('keeps bills at/after opening on their calendar day', () => {
    expect(businessDateKey('2026-08-16', '08:00', '08:00')).toBe('2026-08-16');
    expect(businessDateKey('2026-08-16', '23:59', '08:00')).toBe('2026-08-16');
  });

  it('defaults to 08:00 opening when unset', () => {
    expect(businessDateKey('2026-08-16', '03:00', undefined)).toBe('2026-08-15');
    expect(businessDateKey('2026-08-16', '12:00', undefined)).toBe('2026-08-16');
  });

  it('handles month boundaries', () => {
    expect(businessDateKey('2026-08-01', '01:00', '08:00')).toBe('2026-07-31');
    expect(businessDateKey('2026-01-01', '01:00', '08:00')).toBe('2025-12-31');
  });

  it('handles a custom opening time (e.g. 11:00 kitchen start)', () => {
    expect(businessDateKey('2026-08-16', '10:30', '11:00')).toBe('2026-08-15');
    expect(businessDateKey('2026-08-16', '11:00', '11:00')).toBe('2026-08-16');
  });
});

describe('isInBusinessDay — late-night sales group into the same business day', () => {
  it('yesterday-evening and today-early-morning bills share one business day', () => {
    const day = '2026-08-15'; // business day start
    expect(isInBusinessDay(bill('2026-08-15', '22:00', 300), day, '08:00')).toBe(true);
    expect(isInBusinessDay(bill('2026-08-16', '03:00', 200), day, '08:00')).toBe(true);
  });

  it('excludes bills outside the window', () => {
    const day = '2026-08-15';
    expect(isInBusinessDay(bill('2026-08-15', '06:00', 50), day, '08:00')).toBe(false);
    expect(isInBusinessDay(bill('2026-08-16', '09:00', 100), day, '08:00')).toBe(false);
  });
});

describe('computeDailySales — business-day aware "today"', () => {
  it('counts the in-progress business day (from opening, including last night)', () => {
    vi.useFakeTimers();
    // 10:00 local on Aug 16 → business day started Aug 16 08:00
    vi.setSystemTime(new Date('2026-08-16T10:00:00'));
    const todayStr = localDateKey();
    expect(todayStr).toBe('2026-08-16');

    const bills = [
      bill('2026-08-16', '09:00', 100),  // today, after opening → included
      bill('2026-08-16', '03:00', 200),  // today, before opening → belongs to YESTERDAY's business day
      bill('2026-08-15', '22:00', 300),  // last night → belongs to YESTERDAY's business day
    ];
    const sales = computeDailySales(bills, '₹', '08:00');
    expect(sales.totalRevenue).toBe(100);
    expect(sales.totalOrders).toBe(1);

    // ...but those two late-night bills count as YESTERDAY's business day
    // (business day starting 08-15 = [Aug 15 08:00 → Aug 16 08:00)).
    const yesterdayKey = '2026-08-15';
    expect(bills.filter(b => isInBusinessDay(b, yesterdayKey, '08:00')).reduce((s, b) => s + b.grandTotal, 0)).toBe(500);
  });

  it('before opening time, "today" is still yesterday\'s business day', () => {
    vi.useFakeTimers();
    // 03:00 local on Aug 16 → in-progress business day started Aug 15 08:00
    vi.setSystemTime(new Date('2026-08-16T03:00:00'));

    const bills = [
      bill('2026-08-15', '20:00', 500), // yesterday evening → today's business day
      bill('2026-08-16', '02:00', 250), // early morning → today's business day
      bill('2026-08-16', '10:00', 999), // future, after opening → not yet
    ];
    const sales = computeDailySales(bills, '₹', '08:00');
    expect(sales.totalRevenue).toBe(750);
    expect(sales.totalOrders).toBe(2);
  });
});

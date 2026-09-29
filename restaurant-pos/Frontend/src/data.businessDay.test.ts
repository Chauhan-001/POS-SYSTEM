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

describe('businessDateKey — POS reporting day (calendar day)', () => {
  // The POS has NO opening time — hours exist only for online ordering. The
  // reporting day is the plain local calendar day; time and any legacy
  // openingTime argument must NEVER shift a bill to another day.
  it('returns the own date of the bill regardless of time', () => {
    expect(businessDateKey('2026-08-16', '03:00', '08:00')).toBe('2026-08-16');
    expect(businessDateKey('2026-08-16', '07:59', '08:00')).toBe('2026-08-16');
    expect(businessDateKey('2026-08-16', '23:59')).toBe('2026-08-16');
    expect(businessDateKey('2026-08-16', undefined)).toBe('2026-08-16');
  });

  it('ignores the legacy openingTime argument', () => {
    expect(businessDateKey('2026-08-16', '03:00', '11:00')).toBe('2026-08-16');
    expect(businessDateKey('2026-01-01', '01:00', '08:00')).toBe('2026-01-01');
  });
});

describe('isInBusinessDay — same-day grouping', () => {
  it('groups bills by their calendar date only', () => {
    const day = '2026-08-15';
    expect(isInBusinessDay(bill('2026-08-15', '22:00', 300), day, '08:00')).toBe(true);
    expect(isInBusinessDay(bill('2026-08-15', '03:00', 200), day, '08:00')).toBe(true);
    expect(isInBusinessDay(bill('2026-08-16', '03:00', 200), day, '08:00')).toBe(false);
    expect(isInBusinessDay(bill('2026-08-16', '09:00', 100), day, '08:00')).toBe(false);
  });
});

describe('computeDailySales — calendar-day "today"', () => {
  it('counts every non-voided bill stamped today, whatever the hour', () => {
    vi.useFakeTimers();
    // 03:00 local on Aug 16 — the calendar day is still Aug 16.
    vi.setSystemTime(new Date('2026-08-16T03:00:00'));

    const bills = [
      bill('2026-08-16', '02:00', 250), // today, early morning → included
      bill('2026-08-16', '10:00', 999), // today, later → included
      bill('2026-08-15', '22:00', 300), // yesterday → excluded
    ];
    const sales = computeDailySales(bills, '₹', '08:00');
    expect(sales.totalRevenue).toBe(1249);
    expect(sales.totalOrders).toBe(2);
  });

  it('keeps evening sales of yesterday on yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T10:00:00'));
    const bills = [
      bill('2026-08-16', '09:00', 100),
      bill('2026-08-16', '03:00', 200), // today's early morning stays TODAY
      bill('2026-08-15', '22:00', 300), // yesterday evening stays YESTERDAY
    ];
    const sales = computeDailySales(bills, '₹', '08:00');
    expect(sales.totalRevenue).toBe(300);
    expect(sales.totalOrders).toBe(2);

    const yesterdayKey = '2026-08-15';
    expect(bills.filter(b => isInBusinessDay(b, yesterdayKey, '08:00')).reduce((s, b) => s + b.grandTotal, 0)).toBe(300);
  });
});

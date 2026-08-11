import { describe, expect, it } from 'vitest';
import { buildOrderOpenState, deriveOrderStatusFromKots, findLinkedTakeaway } from '../useOrders';
import type { Order, KOTRecord } from '../../types';

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order_1',
    orderNumber: 1001,
    type: 'Dine In',
    status: 'Accepted',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    items: [],
    kotRecords: [],
    timeline: [],
    interimBillPrinted: false,
    finalBillPrinted: false,
    subtotal: 0,
    discount: 0,
    gst: 0,
    grandTotal: 0,
    ...overrides,
  } as Order;
}

function kot(status: KOTRecord['status'], extra: Partial<KOTRecord> = {}): KOTRecord {
  return {
    id: `kot_${Math.random().toString(36).substring(2, 9)}`,
    kotNumber: 1,
    type: 'Original',
    status,
    printedAt: new Date().toISOString(),
    printedBy: 'Tester',
    items: [],
    ...extra,
  } as KOTRecord;
}

describe('deriveOrderStatusFromKots', () => {
  it('returns the fallback when there are no KOT records', () => {
    expect(deriveOrderStatusFromKots([], 'New')).toBe('New');
    expect(deriveOrderStatusFromKots([], 'Accepted')).toBe('Accepted');
  });

  it('advances to Preparing when a KOT starts preparing', () => {
    expect(deriveOrderStatusFromKots([kot('Preparing')], 'Accepted')).toBe('Preparing');
  });

  it('advances to Ready when any KOT is Ready (even if another is still cooking)', () => {
    const kots = [kot('Preparing'), kot('Ready')];
    expect(deriveOrderStatusFromKots(kots, 'Preparing')).toBe('Ready');
  });

  it('stays at the most advanced status when only Accepted KOTs remain', () => {
    expect(deriveOrderStatusFromKots([kot('Accepted')], 'Accepted')).toBe('Accepted');
    expect(deriveOrderStatusFromKots([kot('Accepted')], 'New')).toBe('New');
  });

  it('marks Served only when ALL KOTs are served', () => {
    expect(deriveOrderStatusFromKots([kot('Served'), kot('Served')], 'Ready')).toBe('Served');
    // One still cooking → not fully served
    expect(deriveOrderStatusFromKots([kot('Served'), kot('Preparing')], 'Ready')).toBe('Preparing');
    // One Ready, one Served → still Ready
    expect(deriveOrderStatusFromKots([kot('Served'), kot('Ready')], 'Ready')).toBe('Ready');
  });

  it('does not regress to a lower status once advanced', () => {
    // Mixed: a fresh additional KOT is Accepted, but one is Ready → stays Ready
    expect(deriveOrderStatusFromKots([kot('Ready'), kot('Accepted')], 'Ready')).toBe('Ready');
  });
});

describe('findLinkedTakeaway', () => {
  const rows = [
    { id: 'tw_server_1', orderId: 'order_server_1', orderNumber: 1001 },
    // Legacy row: stale orderId pointing at its own takeaway doc id
    { id: 'tw_legacy_2', orderId: 'tw_legacy_2', orderNumber: 1002 },
    // Legacy row: orderId clobbered to null by a pre-link server merge
    { id: 'tw_legacy_3', orderId: undefined, orderNumber: 1003 },
  ] as any[];

  it('matches by the live orderId link', () => {
    const found = findLinkedTakeaway(rows, { id: 'order_server_1', orderNumber: 1001 });
    expect(found?.id).toBe('tw_server_1');
  });

  it('falls back to orderNumber for a legacy row with a stale orderId', () => {
    const found = findLinkedTakeaway(rows, { id: 'order_server_2', orderNumber: 1002 });
    expect(found?.id).toBe('tw_legacy_2');
  });

  it('falls back to orderNumber when orderId is missing', () => {
    const found = findLinkedTakeaway(rows, { id: 'order_server_3', orderNumber: 1003 });
    expect(found?.id).toBe('tw_legacy_3');
  });

  it('returns undefined when no row matches', () => {
    expect(findLinkedTakeaway(rows, { id: 'order_server_9', orderNumber: 9999 })).toBeUndefined();
  });

  it('prefers the live id link over a coincidental orderNumber match', () => {
    const dup = [
      { id: 'tw_a', orderId: 'order_x', orderNumber: 5555 },
      { id: 'tw_b', orderId: 'order_y', orderNumber: 5555 },
    ] as any[];
    expect(findLinkedTakeaway(dup, { id: 'order_x', orderNumber: 5555 })?.id).toBe('tw_a');
  });
});

describe('buildOrderOpenState', () => {
  it('restores the current order items when an opened order has a populated items array', () => {
    const order = createOrder({
      items: [{
        id: 'item_1',
        product: { id: 'prod_1', name: 'Coffee' } as any,
        quantity: 2,
        price: 120,
      } as any],
      kotRecords: [],
    });

    const state = buildOrderOpenState(order);

    expect(state.cartItems).toHaveLength(1);
    expect(state.cartItems[0].quantity).toBe(2);
    expect(state.activeOrder?.items).toHaveLength(1);
  });

  it('rebuilds a KOT snapshot from existing KOT records when no explicit snapshot exists', () => {
    const order = createOrder({
      kotRecords: [{
        id: 'kot_1',
        kotNumber: 1,
        type: 'Original',
        status: 'Accepted',
        printedAt: '10:00',
        printedBy: 'Alice',
        items: [{
          id: 'item_1',
          product: { id: 'prod_1', name: 'Coffee' } as any,
          quantity: 1,
          price: 120,
        } as any],
      } as any],
    });

    const state = buildOrderOpenState(order);

    expect(state.activeOrder?.lastKotSnapshot).toHaveLength(1);
    expect(state.activeOrder?.lastKotSnapshot?.[0].quantity).toBe(1);
    expect(state.activeOrder?.lastKotSnapshot?.[0].product.name).toBe('Coffee');
  });
});

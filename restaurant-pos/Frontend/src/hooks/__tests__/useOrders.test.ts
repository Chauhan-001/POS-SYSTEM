import { describe, expect, it } from 'vitest';
import { buildOrderOpenState } from '../useOrders';
import type { Order } from '../../types';

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

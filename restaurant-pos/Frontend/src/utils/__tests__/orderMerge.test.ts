import { describe, expect, it } from 'vitest';
import { mergeOrdersWithServer, mergeOrderWithServer, mergeKotRecords } from '../orderMerge';
import type { Order } from '../../types';

function kot(kotNumber: number, status: string, extra: Record<string, any> = {}): any {
  return { id: `kot_${kotNumber}`, kotNumber, type: 'Original' as const, status, items: [], printedAt: '', printedBy: 'System', ...extra };
}

function order(id: string, status: string, kots: any[], extra: Record<string, any> = {}): Order {
  return { id, orderNumber: 100, type: 'Dine In', status: status as Order['status'], kotRecords: kots, items: [], timeline: [], ...extra } as Order;
}

describe('mergeKotRecords', () => {
  it('never regresses a Served KOT back to Accepted', () => {
    const local = [kot(1, 'Served')];
    const staleServer = [kot(1, 'Accepted')];
    const merged = mergeKotRecords(local, staleServer);
    expect(merged[0].status).toBe('Served');
  });

  it('accepts a more-advanced server status (Preparing from another terminal)', () => {
    const local = [kot(1, 'Accepted')];
    const fresh = [kot(1, 'Preparing')];
    expect(mergeKotRecords(local, fresh)[0].status).toBe('Preparing');
  });

  it('keeps KOTs that only exist locally (write still in flight)', () => {
    const local = [kot(1, 'Accepted'), kot(2, 'Preparing')];
    const fresh = [kot(1, 'Accepted')];
    const merged = mergeKotRecords(local, fresh);
    expect(merged).toHaveLength(2);
  });

  it('keeps KOTs that only exist on the server (new KOT from another terminal)', () => {
    const local = [kot(1, 'Accepted')];
    const fresh = [kot(1, 'Accepted'), kot(2, 'Preparing')];
    expect(mergeKotRecords(local, fresh)).toHaveLength(2);
  });

  it('treats Cancelled as terminal in both directions', () => {
    expect(mergeKotRecords([kot(1, 'Cancelled')], [kot(1, 'Accepted')])[0].status).toBe('Cancelled');
    expect(mergeKotRecords([kot(1, 'Ready')], [kot(1, 'Cancelled')])[0].status).toBe('Cancelled');
  });
});

describe('mergeOrderWithServer', () => {
  it('keeps the Served order status when the snapshot is stale (Accepted)', () => {
    const local = order('o1', 'Served', [kot(1, 'Served')]);
    const merged = mergeOrderWithServer(local, { _id: 'o1', status: 'Accepted', kotRecords: [kot(1, 'Accepted')] });
    expect(merged.status).toBe('Served');
    expect(merged.kotRecords[0].status).toBe('Served');
  });

  it('accepts a terminal status from the server (Paid/Closed elsewhere)', () => {
    const local = order('o1', 'Preparing', [kot(1, 'Preparing')]);
    const merged = mergeOrderWithServer(local, { _id: 'o1', status: 'Closed', kotRecords: [kot(1, 'Preparing')] });
    expect(merged.status).toBe('Closed');
  });

  it('keeps local items/timeline when the list snapshot omits them', () => {
    const local = order('o1', 'Preparing', [kot(1, 'Preparing')], { items: [{ id: 'i1' }], timeline: [{ id: 't1' }] });
    const merged = mergeOrderWithServer(local, { _id: 'o1', status: 'Preparing', kotRecords: [kot(1, 'Preparing')] });
    expect(merged.items).toHaveLength(1);
    expect(merged.timeline).toHaveLength(1);
  });
});

describe('mergeOrdersWithServer', () => {
  it('appends server-only orders and drops nothing on a stale snapshot', () => {
    const local = [order('o1', 'Served', [kot(1, 'Served')])];
    const incoming = [
      { _id: 'o1', status: 'Accepted', kotRecords: [kot(1, 'Accepted')] },
      { _id: 'o2', status: 'New', kotRecords: [kot(1, 'Accepted')] },
    ];
    const merged = mergeOrdersWithServer(local, incoming);
    expect(merged).toHaveLength(2);
    const o1 = merged.find((o: any) => (o._id || o.id) === 'o1');
    expect(o1.status).toBe('Served');
    expect(o1.kotRecords[0].status).toBe('Served');
  });

  it('drops locally-known orders absent from a real (non-empty) snapshot', () => {
    const local = [order('o1', 'New', [kot(1, 'Accepted')]), order('o2', 'New', [kot(1, 'Accepted')])];
    const incoming = [{ _id: 'o1', status: 'New', kotRecords: [kot(1, 'Accepted')] }];
    expect(mergeOrdersWithServer(local, incoming)).toHaveLength(1);
  });

  it('keeps local state when the snapshot is empty (server hiccup)', () => {
    const local = [order('o1', 'Served', [kot(1, 'Served')])];
    expect(mergeOrdersWithServer(local, [])).toHaveLength(1);
  });
});

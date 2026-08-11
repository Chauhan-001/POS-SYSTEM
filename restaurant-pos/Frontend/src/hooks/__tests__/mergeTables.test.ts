/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for mergeTablesById table-status reconciliation.
 *
 * Bug: a stale local "Occupied" status was preserved forever across refreshes,
 * even after the backend (authoritative, reconcileTable) returned Available —
 * so after making an order on one table, other tables could appear Occupied
 * permanently. The merge now trusts the backend for lifecycle status unless a
 * live local order binds the table, or the state is manual (Cleaning/Disabled).
 */
import { describe, expect, it } from 'vitest';
import { mergeTablesById } from '../usePOSState';
import type { TableInfo } from '../../types';

function table(id: string, number: number, status: string, section = 'Main Hall'): TableInfo {
  return { id, number, status: status as TableInfo['status'], capacity: 4, section, branchId: 'b1' } as TableInfo;
}

describe('mergeTablesById — status reconciliation', () => {
  it('heals a stale local Occupied table to Available when the backend is free and no live order binds it', () => {
    const local = [table('t1', 1, 'Occupied'), table('t2', 2, 'Occupied')];
    const incoming = [table('t1', 1, 'Available'), table('t2', 2, 'Available')];
    const merged = mergeTablesById(local, incoming, new Set<string>());
    expect(merged[0].status).toBe('Available');
    expect(merged[1].status).toBe('Available');
  });

  it('keeps the local lifecycle status when a live order binds the table', () => {
    const local = [table('t1', 1, 'Occupied')];
    const incoming = [table('t1', 1, 'Available')]; // backend not reconciled yet
    const merged = mergeTablesById(local, incoming, new Set(['t1']));
    expect(merged[0].status).toBe('Occupied');
  });

  it('preserves manual states (Cleaning/Disabled/Merged) even when the backend is Available', () => {
    const local = [table('t1', 1, 'Cleaning'), table('t2', 2, 'Disabled')];
    const incoming = [table('t1', 1, 'Available'), table('t2', 2, 'Available')];
    const merged = mergeTablesById(local, incoming, new Set<string>());
    expect(merged[0].status).toBe('Cleaning');
    expect(merged[1].status).toBe('Disabled');
  });

  it('takes the backend lifecycle status for an Available local table', () => {
    const local = [table('t1', 1, 'Available')];
    const incoming = [table('t1', 1, 'Served')];
    const merged = mergeTablesById(local, incoming, new Set<string>());
    expect(merged[0].status).toBe('Served');
  });

  it('takes the backend status for a live-bound table whose local status is Available', () => {
    const local = [table('t1', 1, 'Available')];
    const incoming = [table('t1', 1, 'Occupied')];
    const merged = mergeTablesById(local, incoming, new Set(['t1']));
    expect(merged[0].status).toBe('Occupied');
  });

  it('keeps the local floor plan when the backend returns an empty list (offline-first)', () => {
    const local = [table('t1', 1, 'Occupied')];
    const merged = mergeTablesById(local, [], new Set<string>());
    expect(merged.length).toBe(1);
    expect(merged[0].status).toBe('Occupied');
  });
});

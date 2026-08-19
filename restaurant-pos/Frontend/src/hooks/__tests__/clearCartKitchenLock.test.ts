/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the Clear-cart kitchen protection: items already sent to the
 * kitchen (kotPrinted) must never be cleared by the Clear button — only items
 * that have not been sent to the kitchen may be removed.
 */

import { describe, it, expect } from 'vitest';
import { partitionCartByKitchenLock } from '../useBilling';

function item(id: string, kotPrinted = false) {
  return { id, name: `Item ${id}`, quantity: 1, price: 100, kotPrinted };
}

describe('partitionCartByKitchenLock', () => {
  it('keeps kitchen-locked items in the locked bucket', () => {
    const items = [item('p1'), item('p2', true), item('p3')];
    const { locked, clearable } = partitionCartByKitchenLock(items);
    expect(locked.map((i: any) => i.id)).toEqual(['p2']);
    expect(clearable.map((i: any) => i.id)).toEqual(['p1', 'p3']);
  });

  it('puts everything in clearable when nothing was sent to the kitchen', () => {
    const items = [item('p1'), item('p2')];
    const { locked, clearable } = partitionCartByKitchenLock(items);
    expect(locked).toEqual([]);
    expect(clearable).toHaveLength(2);
  });

  it('puts everything in locked when every item was sent to the kitchen', () => {
    const items = [item('p1', true), item('p2', true)];
    const { locked, clearable } = partitionCartByKitchenLock(items);
    expect(locked).toHaveLength(2);
    expect(clearable).toEqual([]);
  });

  it('handles an empty cart', () => {
    const { locked, clearable } = partitionCartByKitchenLock([]);
    expect(locked).toEqual([]);
    expect(clearable).toEqual([]);
  });

  it('never drops an item — the union of both buckets equals the input', () => {
    const items = [item('a'), item('b', true), item('c', true), item('d')];
    const { locked, clearable } = partitionCartByKitchenLock(items);
    expect([...locked, ...clearable]).toHaveLength(items.length);
    expect([...locked, ...clearable].map((i: any) => i.id).sort())
      .toEqual(items.map((i: any) => i.id).sort());
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pricing engine (Phase 3) — pure deterministic unit tests.
 * No DB: exercises calculateLineItemPrice / summarizeSelection / roundMoney
 * across every pricing input combination the spec requires.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateLineItemPrice,
  roundMoney,
  summarizeSelection,
  PRICING_VERSION,
} from '../services/pricingEngine';
import type { ResolvedProductConfiguration } from '../services/configurationResolver';

/** A resolved Margherita Pizza with size variants, crust modifiers, add-ons. */
function margherita(over: Partial<ResolvedProductConfiguration> = {}): ResolvedProductConfiguration {
  return {
    product: { id: 'p1', name: 'Margherita Pizza', baseProductPrice: 199, category: 'Pizza', availability: true },
    configVersion: 3,
    variantGroups: [
      {
        id: 'g_size', name: 'Size', type: 'VARIANT_GROUP', status: 'active', version: 3,
        mode: 'shared', selectionMode: 'SINGLE', required: true, minSelections: 1, maxSelections: 1,
        freeSelectionCount: 0,
        options: [
          { id: 'o_small', name: 'Small', priceDelta: 0, active: true, sortOrder: 0 },
          { id: 'o_med', name: 'Medium', priceDelta: 100, active: true, sortOrder: 1 },
          { id: 'o_large', name: 'Large', priceDelta: 200, active: true, sortOrder: 2 },
        ],
      },
    ],
    modifierGroups: [
      {
        id: 'g_crust', name: 'Crust', type: 'MODIFIER_GROUP', status: 'active', version: 2,
        mode: 'shared', selectionMode: 'SINGLE', required: true, minSelections: 1, maxSelections: 1,
        freeSelectionCount: 0,
        options: [
          { id: 'o_reg', name: 'Regular', priceDelta: 0, active: true, sortOrder: 0 },
          { id: 'o_thin', name: 'Thin', priceDelta: 30, active: true, sortOrder: 1 },
          { id: 'o_cheese', name: 'Cheese Burst', priceDelta: 80, active: true, sortOrder: 2 },
        ],
      },
      {
        id: 'g_top', name: 'Toppings', type: 'MODIFIER_GROUP', status: 'active', version: 1,
        mode: 'shared', selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null,
        freeSelectionCount: 0,
        options: [
          { id: 'o_mushroom', name: 'Mushroom', priceDelta: 40, active: true, sortOrder: 0 },
          { id: 'o_olives', name: 'Olives', priceDelta: 30, active: true, sortOrder: 1 },
          { id: 'o_jalapeno', name: 'Jalapeño', priceDelta: 20, active: false, sortOrder: 2 },
        ],
      },
    ],
    addOnGroups: [
      {
        id: 'g_add', name: 'Sides', type: 'ADD_ON_GROUP', status: 'active', version: 1,
        mode: 'shared', selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null,
        freeSelectionCount: 0,
        options: [
          { id: 'o_coke', name: 'Coke', price: 60, priceDelta: 0, active: true, sortOrder: 0, minQuantity: 1, maxQuantity: 5 },
          { id: 'o_brownie', name: 'Brownie', price: 120, priceDelta: 0, active: true, sortOrder: 1 },
        ],
      },
    ],
    ...over,
  };
}

const sel = (selections: Array<{ groupId: string; optionIds: string[]; quantities?: Record<string, number> }>) => ({ selections });

describe('calculateLineItemPrice', () => {
  it('base only — no configuration selected', () => {
    const r = calculateLineItemPrice(margherita(), sel([]), 1);
    expect(r.basePrice).toBe(199);
    expect(r.variantDelta).toBe(0);
    expect(r.modifierDelta).toBe(0);
    expect(r.addonDelta).toBe(0);
    expect(r.grossItemPrice).toBe(199);
    expect(r.lineTotal).toBe(199);
  });

  it('base + variant', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_size', optionIds: ['o_large'] }]), 1);
    expect(r.grossItemPrice).toBe(399); // 199 + 200
    expect(r.variantDelta).toBe(200);
  });

  it('base + modifier', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_crust', optionIds: ['o_cheese'] }]), 1);
    expect(r.grossItemPrice).toBe(279); // 199 + 80
    expect(r.modifierDelta).toBe(80);
  });

  it('base + multiple modifiers', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([
        { groupId: 'g_crust', optionIds: ['o_thin'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ]),
      1
    );
    expect(r.grossItemPrice).toBe(299); // 199 + 30 + 40 + 30
    expect(r.modifierDelta).toBe(100);
  });

  it('base + add-on (unit price)', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_add', optionIds: ['o_coke'] }]), 1);
    expect(r.addonDelta).toBe(60);
    expect(r.grossItemPrice).toBe(259);
  });

  it('add-on quantity multiplies only the add-on', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([{ groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 2 } }]),
      1
    );
    expect(r.addonDelta).toBe(120); // 60 × 2
    expect(r.grossItemPrice).toBe(319);
  });

  it('spec scenario — 199 + 100 (Large) + 80 (Cheese Burst) + 40 (Mushroom) + 30 (Olives) = 449', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_med'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ]),
      1
    );
    expect(r.grossItemPrice).toBe(449);
    expect(r.lineTotal).toBe(449);
  });

  it('quantity multiplies the line total once', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_med'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ]),
      3
    );
    expect(r.grossItemPrice).toBe(449); // unit price unchanged
    expect(r.lineTotal).toBe(1347); // 449 × 3
  });

  it('inactive option contributes nothing', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_top', optionIds: ['o_jalapeno'] }]), 1);
    expect(r.modifierDelta).toBe(0);
    expect(r.grossItemPrice).toBe(199);
  });

  it('unknown group/option ids are ignored by the pricer', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_ghost', optionIds: ['x'] }]), 1);
    expect(r.grossItemPrice).toBe(199);
  });

  it('zero-price option stays free', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_crust', optionIds: ['o_reg'] }]), 1);
    expect(r.grossItemPrice).toBe(199);
  });

  it('exposes configVersion + pricingVersion for snapshots', () => {
    const r = calculateLineItemPrice(margherita(), sel([]), 1);
    expect(r.configVersion).toBe(3);
    expect(r.pricingVersion).toBe(PRICING_VERSION);
  });

  it('rounding is deterministic on fractional deltas', () => {
    const pizza = margherita();
    pizza.modifierGroups[0].options[1].priceDelta = 29.995;
    const r = calculateLineItemPrice(pizza, sel([{ groupId: 'g_crust', optionIds: ['o_thin'] }]), 1);
    expect(r.grossItemPrice).toBe(229.0); // 199 + 29.995 → 229.0 (half-up to paise)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3); // float-safe
  });
});

describe('summarizeSelection', () => {
  it('produces a compact human-readable summary without ids', () => {
    const s = summarizeSelection(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_large'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ])
    );
    expect(s).toBe('Large • Cheese Burst • Mushroom • Olives');
  });

  it('shows add-on quantities', () => {
    const s = summarizeSelection(
      margherita(),
      sel([{ groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 2 } }])
    );
    expect(s).toBe('Coke ×2');
  });

  it('ignores unknown ids', () => {
    const s = summarizeSelection(margherita(), sel([{ groupId: 'g_ghost', optionIds: ['x'] }]));
    expect(s).toBe('');
  });
});

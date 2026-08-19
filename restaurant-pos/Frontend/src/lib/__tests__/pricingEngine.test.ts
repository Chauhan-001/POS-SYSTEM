/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * POS pricing mirror + config selection unit tests (Phase 3).
 * These MUST stay numerically identical to the backend pricing engine tests —
 * online and offline pricing are the same rule.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateLineItemPrice,
  summarizeSelection,
  roundMoney,
  PRICING_VERSION,
  ConfigSelection,
} from '../pricingEngine';
import { validateSelection, buildConfiguredCartItem, configFingerprint, toggleOption, setOptionQuantity, hasConfigSelection } from '../configSelection';
import type { ResolvedProductConfig, ResolvedConfigGroup } from '../../types';

function margherita(): ResolvedProductConfig {
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
          { id: 'o_cheese', name: 'Cheese Burst', priceDelta: 80, active: true, sortOrder: 1 },
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
          { id: 'o_coke', name: 'Coke', price: 60, active: true, sortOrder: 0, maxQuantity: 5 },
        ],
      },
    ],
  };
}

const sel = (selections: Array<{ groupId: string; optionIds: string[]; quantities?: Record<string, number> }>): ConfigSelection => ({ selections });

describe('POS pricing mirror — identical to backend', () => {
  it('spec scenario — 199 + 100 + 80 + 40 + 30 = 449', () => {
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
  });

  it('quantity ×3 → 1347 line total, unit price unchanged', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_med'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ]),
      3
    );
    expect(r.grossItemPrice).toBe(449);
    expect(r.lineTotal).toBe(1347);
  });

  it('add-on quantity multiplies only the add-on', () => {
    const r = calculateLineItemPrice(
      margherita(),
      sel([{ groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 2 } }]),
      1
    );
    expect(r.addonDelta).toBe(120);
    expect(r.grossItemPrice).toBe(319);
  });

  it('inactive option contributes nothing', () => {
    const r = calculateLineItemPrice(margherita(), sel([{ groupId: 'g_top', optionIds: ['o_jalapeno'] }]), 1);
    expect(r.grossItemPrice).toBe(199);
  });

  it('rounds deterministically', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('exposes configVersion + pricingVersion', () => {
    const r = calculateLineItemPrice(margherita(), sel([]), 1);
    expect(r.configVersion).toBe(3);
    expect(r.pricingVersion).toBe(PRICING_VERSION);
  });
});

describe('config selection validator mirror', () => {
  it('rejects a missing required variant', () => {
    const v = validateSelection(margherita(), sel([]));
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.code === 'REQUIRED_VARIANT_MISSING')).toBe(true);
  });

  it('rejects a missing required modifier', () => {
    const v = validateSelection(margherita(), sel([{ groupId: 'g_size', optionIds: ['o_small'] }]));
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.code === 'REQUIRED_MODIFIER_MISSING')).toBe(true);
  });

  it('rejects an inactive option', () => {
    const v = validateSelection(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_small'] },
        { groupId: 'g_crust', optionIds: ['o_reg'] },
        { groupId: 'g_top', optionIds: ['o_jalapeno'] },
      ])
    );
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.code === 'INACTIVE_MODIFIER_OPTION')).toBe(true);
  });

  it('rejects an unknown option id', () => {
    const v = validateSelection(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_small'] },
        { groupId: 'g_crust', optionIds: ['o_ghost'] },
      ])
    );
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.code === 'INVALID_MODIFIER_OPTION')).toBe(true);
  });

  it('accepts a complete valid selection', () => {
    const v = validateSelection(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_large'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
        { groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 2 } },
      ])
    );
    expect(v.valid).toBe(true);
  });

  it('SINGLE groups keep exactly one selection after toggle', () => {
    const group = margherita().variantGroups[0];
    let s = sel([]);
    s = toggleOption(s, group, 'o_small');
    s = toggleOption(s, group, 'o_large');
    expect(s.selections[0].optionIds).toEqual(['o_large']);
  });

  it('add-on quantity is clamped to the option max', () => {
    const resolved = margherita();
    const option = resolved.addOnGroups[0].options[0];
    let s = sel([{ groupId: 'g_add', optionIds: ['o_coke'] }]);
    s = setOptionQuantity(s, 'g_add', 'o_coke', 9, option);
    expect(s.selections[0].quantities?.o_coke).toBe(5);
  });
});

describe('buildConfiguredCartItem', () => {
  it('produces the backend payload shape with origin + summary', () => {
    const item = buildConfiguredCartItem(
      margherita(),
      sel([
        { groupId: 'g_size', optionIds: ['o_large'] },
        { groupId: 'g_crust', optionIds: ['o_cheese'] },
        { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
      ]),
      2,
      'online'
    );
    expect(item.price).toBe(549); // 199 + 200 (Large) + 80 (Cheese) + 40 + 30
    expect(item.pricingSnapshot.origin).toBe('online');
    expect(item.pricingSnapshot.grossItemPrice).toBe(549);
    expect(item.configSummary).toBe('Large • Cheese Burst • Mushroom • Olives');
    expect(item.configuration.selections.length).toBe(3);
  });

  it('marks offline origin for offline billing', () => {
    const item = buildConfiguredCartItem(margherita(), sel([{ groupId: 'g_size', optionIds: ['o_small'] }]), 1, 'offline');
    expect(item.pricingSnapshot.origin).toBe('offline');
  });
});

describe('hasConfigSelection', () => {
  it('detects configured products', () => {
    expect(hasConfigSelection({ menuConfig: { variantConfigurations: [{ templateId: 'x' }], modifierConfigurations: [], addOnConfigurations: [] } })).toBe(true);
    expect(hasConfigSelection({ menuConfig: { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] } })).toBe(false);
    expect(hasConfigSelection({})).toBe(false);
  });
});

describe('configFingerprint (Phase 5 — deterministic configured-item identity)', () => {
  it('identical selections produce the same fingerprint regardless of entry order', () => {
    const a = configFingerprint(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_large'] },
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
      { groupId: 'g_top', optionIds: ['o_mushroom', 'o_olives'] },
    ]));
    const b = configFingerprint(margherita(), sel([
      { groupId: 'g_top', optionIds: ['o_olives', 'o_mushroom'] },
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
      { groupId: 'g_size', optionIds: ['o_large'] },
    ]));
    expect(a).toBe(b);
  });

  it('different configurations NEVER share a fingerprint', () => {
    const largeCheese = configFingerprint(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_large'] },
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
    ]));
    const largeRegular = configFingerprint(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_large'] },
      { groupId: 'g_crust', optionIds: ['o_reg'] },
    ]));
    const smallCheese = configFingerprint(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_small'] },
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
    ]));
    expect(largeCheese).not.toBe(largeRegular);
    expect(largeCheese).not.toBe(smallCheese);
  });

  it('add-on quantity changes the fingerprint (Extra Cheese ×1 ≠ ×2)', () => {
    const once = configFingerprint(margherita(), sel([{ groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 1 } }]));
    const twice = configFingerprint(margherita(), sel([{ groupId: 'g_add', optionIds: ['o_coke'], quantities: { o_coke: 2 } }]));
    expect(once).not.toBe(twice);
  });

  it('empty selection is the stable plain fingerprint', () => {
    expect(configFingerprint(margherita(), sel([]))).toBe('plain');
  });

  it('buildConfiguredCartItem emits deterministic ids — identical configs merge, different configs stay separate', () => {
    const a = buildConfiguredCartItem(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_large'] },
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
    ]), 1, 'online');
    const b = buildConfiguredCartItem(margherita(), sel([
      { groupId: 'g_crust', optionIds: ['o_cheese'] },
      { groupId: 'g_size', optionIds: ['o_large'] },
    ]), 1, 'online');
    const c = buildConfiguredCartItem(margherita(), sel([
      { groupId: 'g_size', optionIds: ['o_large'] },
      { groupId: 'g_crust', optionIds: ['o_reg'] },
    ]), 1, 'online');
    expect(a.id).toBe(b.id); // merges
    expect(a.id).not.toBe(c.id); // stays separate
    expect(a.id).toMatch(/^p1_cfg_/);
  });
});

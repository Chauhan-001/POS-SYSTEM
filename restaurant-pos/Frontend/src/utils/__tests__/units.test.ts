/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * units tests — verify family-scoped conversions (kg→g, L→ml) that power the
 * recipe editor's changeable ingredient units.
 */

import { describe, it, expect } from 'vitest';
import { conv, unitOptionsFor, normUnit } from '../units';

describe('conv', () => {
  it('converts within the mass family (kg→g, g→mg)', () => {
    expect(conv(2, 'kg', 'g')).toBe(2000);
    expect(conv(500, 'g', 'kg')).toBe(0.5);
    expect(conv(3, 'g', 'mg')).toBe(3000);
  });

  it('converts within the volume family (L→ml)', () => {
    expect(conv(1.5, 'L', 'ml')).toBe(1500);
    expect(conv(250, 'ml', 'L')).toBe(0.25);
  });

  it('returns 0 across families', () => {
    expect(conv(1, 'kg', 'L')).toBe(0);
    expect(conv(1, 'pcs', 'g')).toBe(0);
  });

  it('normalizes spelled-out units', () => {
    expect(conv(1, 'litre', 'ml')).toBe(1000);
    expect(conv(1, 'Gram', 'kg')).toBe(0.001);
  });
});

describe('unitOptionsFor', () => {
  it('offers lower units from the same family', () => {
    expect(unitOptionsFor('kg')).toContain('g');
    expect(unitOptionsFor('L')).toContain('ml');
    expect(unitOptionsFor('pcs')).toContain('unit');
  });

  it('does not mix families', () => {
    const opts = unitOptionsFor('kg');
    expect(opts).not.toContain('ml');
    expect(opts).not.toContain('L');
  });
});

describe('normUnit', () => {
  it('lowercases and trims', () => {
    expect(normUnit('  KG ')).toBe('kg');
    expect(normUnit(undefined)).toBe('');
  });
});
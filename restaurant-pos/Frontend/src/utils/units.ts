/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared unit helpers — mass (kg↔g↔mg), volume (L↔ml) and count units.
 * Used by the recipe editor to let merchants switch an ingredient's unit to a
 * smaller one (e.g. kg → grams, litre → ml) and by the live cost calculator
 * to convert quantities into the inventory item's native unit.
 */

export const UNIT_FAMILY: Record<string, { family: string; factor: number }> = {
  kg: { family: 'mass', factor: 1000 }, g: { family: 'mass', factor: 1 },
  gram: { family: 'mass', factor: 1 }, grams: { family: 'mass', factor: 1 },
  gm: { family: 'mass', factor: 1 }, mg: { family: 'mass', factor: 0.001 },
  l: { family: 'volume', factor: 1000 }, litre: { family: 'volume', factor: 1000 },
  liters: { family: 'volume', factor: 1000 }, ml: { family: 'volume', factor: 1 },
  pcs: { family: 'count', factor: 1 }, pc: { family: 'count', factor: 1 },
  piece: { family: 'count', factor: 1 }, pieces: { family: 'count', factor: 1 },
  nos: { family: 'count', factor: 1 }, no: { family: 'count', factor: 1 },
  unit: { family: 'count', factor: 1 }, units: { family: 'count', factor: 1 },
  plate: { family: 'count', factor: 1 }, plates: { family: 'count', factor: 1 },
  portion: { family: 'count', factor: 1 }, portions: { family: 'count', factor: 1 },
  serving: { family: 'count', factor: 1 }, servings: { family: 'count', factor: 1 },
};

export const YIELD_UNITS = ['plate', 'portion', 'serving', 'pcs', 'kg', 'g', 'L', 'ml', 'unit'];
export const MASS_UNITS = ['kg', 'g', 'mg'];
export const VOLUME_UNITS = ['L', 'ml'];
export const COUNT_UNITS = ['pcs', 'pc', 'piece', 'unit', 'nos'];
export const ALL_UNITS = [...new Set([...YIELD_UNITS, ...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS])];

export const normUnit = (u?: string) => (u || '').trim().toLowerCase();

/** Units within the same family as the given unit (so kg → g, L → ml, pcs …). */
export function unitOptionsFor(unit?: string): string[] {
  const fam = UNIT_FAMILY[normUnit(unit)]?.family;
  const base = fam === 'mass' ? MASS_UNITS : fam === 'volume' ? VOLUME_UNITS : COUNT_UNITS;
  const list = [...base];
  if (unit && !list.includes(unit)) list.unshift(unit);
  return list;
}

/** Convert a quantity from one unit to another within the same family. */
export function conv(qty: number, from: string, to: string): number {
  const a = UNIT_FAMILY[normUnit(from)];
  const b = UNIT_FAMILY[normUnit(to)];
  if (!a || !b || a.family !== b.family) return 0;
  return Math.round((qty * a.factor) / b.factor * 10000) / 10000;
}
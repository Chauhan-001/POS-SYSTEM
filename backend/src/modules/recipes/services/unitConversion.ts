/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UnitConversion — the ONLY unit-conversion logic in the recipe domain.
 *
 * The existing Inventory stores units as free-form strings ('kg', 'g', 'L',
 * 'ml', 'pcs') with NO conversion service — purchases, stock and cost all
 * assume a single unit per product. This small converter normalizes a recipe
 * component's quantity into the inventory item's own unit so the cost engine
 * and consumption movements always operate on the item's stored unit.
 *
 * Rules:
 *   - Only mass (kg/g/mg), volume (L/ml) and count (pcs) families exist.
 *   - Conversion across families (e.g. 500 ml of a kg-tracked item) is a hard
 *     error — a recipe cannot reference incompatible units.
 *   - Same-family conversions are exact powers of ten; nothing else is guessed.
 */

import { AppError } from '../../../utils/AppError';

export type UnitFamily = 'mass' | 'volume' | 'count';

interface UnitDef {
  family: UnitFamily;
  /** Multiplier to the family base (gram / litre / piece). */
  factor: number;
}

const UNIT_DEFS: Record<string, UnitDef> = {
  // ── Mass (base: gram) ──────────────────────────────────────────
  mg: { family: 'mass', factor: 0.001 },
  milligram: { family: 'mass', factor: 0.001 },
  milligrams: { family: 'mass', factor: 0.001 },
  g: { family: 'mass', factor: 1 },
  gram: { family: 'mass', factor: 1 },
  grams: { family: 'mass', factor: 1 },
  gm: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  kilo: { family: 'mass', factor: 1000 },
  kilogram: { family: 'mass', factor: 1000 },
  kilograms: { family: 'mass', factor: 1000 },
  // ── Volume (base: millilitre) ──────────────────────────────────
  ml: { family: 'volume', factor: 1 },
  milliliter: { family: 'volume', factor: 1 },
  milliliters: { family: 'volume', factor: 1 },
  millilitre: { family: 'volume', factor: 1 },
  millilitres: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
  litre: { family: 'volume', factor: 1000 },
  litres: { family: 'volume', factor: 1000 },
  liter: { family: 'volume', factor: 1000 },
  liters: { family: 'volume', factor: 1000 },
  // ── Count (base: piece) ────────────────────────────────────────
  pcs: { family: 'count', factor: 1 },
  pc: { family: 'count', factor: 1 },
  piece: { family: 'count', factor: 1 },
  pieces: { family: 'count', factor: 1 },
  nos: { family: 'count', factor: 1 },
  no: { family: 'count', factor: 1 },
  unit: { family: 'count', factor: 1 },
  units: { family: 'count', factor: 1 },
  serving: { family: 'count', factor: 1 },
  servings: { family: 'count', factor: 1 },
};

/** Normalize a unit string ('Kilograms' → 'kg', 'pcs' → 'pcs'). Returns null
 *  when the unit is unknown — callers decide whether to reject or pass through. */
export function normalizeUnit(unit: string | undefined | null): string | null {
  if (!unit) return null;
  const key = String(unit).trim().toLowerCase().replace(/\s+/g, '');
  const def = UNIT_DEFS[key];
  if (!def) return null;
  // Return a canonical short form.
  if (def.family === 'mass') return def.factor === 1000 ? 'kg' : def.factor === 0.001 ? 'mg' : 'g';
  if (def.family === 'volume') return def.factor === 1000 ? 'L' : 'ml';
  return 'pcs';
}

function unitDef(unit: string): UnitDef | null {
  return UNIT_DEFS[String(unit).trim().toLowerCase().replace(/\s+/g, '')] || null;
}

export function familyOf(unit: string): UnitFamily | null {
  const def = unitDef(unit);
  return def ? def.family : null;
}

/** True when both units belong to the same measurable family. */
export function canConvert(fromUnit: string, toUnit: string): boolean {
  const a = unitDef(fromUnit);
  const b = unitDef(toUnit);
  return !!a && !!b && a.family === b.family;
}

/** True when the unit is a known one (even if unmapped to an item). */
export function isKnownUnit(unit: string): boolean {
  return !!unitDef(unit);
}

/**
 * Convert a quantity from one unit to another.
 * Throws AppError(400) when either unit is unknown or families differ.
 */
export function convertQuantity(quantity: number, fromUnit: string, toUnit: string): number {
  const a = unitDef(fromUnit);
  const b = unitDef(toUnit);
  if (!a) throw new AppError(400, `Unknown unit "${fromUnit}"`);
  if (!b) throw new AppError(400, `Unknown unit "${toUnit}"`);
  if (a.family !== b.family) {
    throw new AppError(
      400,
      `Cannot convert ${fromUnit} to ${toUnit}: incompatible units (${a.family} vs ${b.family})`
    );
  }
  const baseValue = quantity * a.factor;
  return round4(baseValue / b.factor);
}

/** Round to 4dp — the maximum precision used across the recipe domain. */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

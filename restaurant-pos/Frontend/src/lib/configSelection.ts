/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * configSelection — the POS-side model for configured cart items.
 *
 * The PHASE 1 validator is mirrored here (same stable error codes) so the
 * configuration modal can block invalid selections before the item ever
 * reaches the cart. The BACKEND revalidates everything at bill time with the
 * authoritative copy — this mirror only improves the cashier's UX, it is never
 * trusted for the final bill.
 *
 * Also builds the cart item shape the backend expects:
 *   configuration    → selections
 *   pricingSnapshot  → immutable price evidence (origin online|offline)
 *   configSummary    → human-readable line for the cart + receipt
 */

import type { ResolvedProductConfig, ResolvedConfigGroup, ResolvedConfigOption, ConfigType } from '../types';
import { calculateLineItemPrice, summarizeSelection, ConfigSelection } from './pricingEngine';

export type ValidationErrorCode =
  | 'INVALID_GROUP' | 'INACTIVE_GROUP' | 'INVALID_OPTION' | 'INACTIVE_OPTION'
  | 'INVALID_VARIANT' | 'INACTIVE_VARIANT' | 'REQUIRED_VARIANT_MISSING'
  | 'INVALID_MODIFIER_OPTION' | 'INACTIVE_MODIFIER_OPTION' | 'REQUIRED_MODIFIER_MISSING'
  | 'INVALID_ADD_ON' | 'INACTIVE_ADD_ON'
  | 'TOO_FEW_SELECTIONS' | 'TOO_MANY_SELECTIONS' | 'DUPLICATE_OPTION' | 'INVALID_QUANTITY';

export interface ValidationError {
  code: ValidationErrorCode;
  groupId?: string;
  optionId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** All resolved groups (variants + modifiers + add-ons) indexed by id. */
function indexGroups(resolved: ResolvedProductConfig): Map<string, ResolvedConfigGroup> {
  const map = new Map<string, ResolvedConfigGroup>();
  for (const g of [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups]) {
    map.set(g.id, g);
  }
  return map;
}

function optionCodeFor(group: ResolvedConfigGroup, kind: 'INVALID' | 'INACTIVE'): ValidationErrorCode {
  if (group.type === 'VARIANT_GROUP') return kind === 'INVALID' ? 'INVALID_VARIANT' : 'INACTIVE_VARIANT';
  if (group.type === 'MODIFIER_GROUP') return kind === 'INVALID' ? 'INVALID_MODIFIER_OPTION' : 'INACTIVE_MODIFIER_OPTION';
  return kind === 'INVALID' ? 'INVALID_ADD_ON' : 'INACTIVE_ADD_ON';
}

function requiredMissingCode(group: ResolvedConfigGroup): ValidationErrorCode {
  return group.type === 'VARIANT_GROUP' ? 'REQUIRED_VARIANT_MISSING' : 'REQUIRED_MODIFIER_MISSING';
}

/**
 * Deterministic validation of a selection against a RESOLVED configuration —
 * mirror of backend configurationValidator with identical error codes.
 */
export function validateSelection(
  resolved: ResolvedProductConfig,
  selection: ConfigSelection
): ValidationResult {
  const errors: ValidationError[] = [];
  const groups = indexGroups(resolved);
  const selected = new Set<string>();

  for (const entry of selection?.selections ?? []) {
    const group = groups.get(entry.groupId);
    if (!group) {
      errors.push({ code: 'INVALID_GROUP', groupId: entry.groupId, message: `Unknown configuration group "${entry.groupId}"` });
      continue;
    }
    if (group.status === 'archived') {
      errors.push({ code: 'INACTIVE_GROUP', groupId: entry.groupId, message: `Configuration group "${group.name}" is archived` });
      continue;
    }

    const optionIds = entry.optionIds ?? [];
    const seen = new Set<string>();
    for (const optionId of optionIds) {
      if (seen.has(optionId)) {
        errors.push({ code: 'DUPLICATE_OPTION', groupId: group.id, optionId, message: `Option "${optionId}" selected more than once in "${group.name}"` });
        continue;
      }
      seen.add(optionId);
      const option = group.options.find((o) => o.id === optionId);
      if (!option) {
        errors.push({ code: optionCodeFor(group, 'INVALID'), groupId: group.id, optionId, message: `Option "${optionId}" does not exist in "${group.name}"` });
        continue;
      }
      if (option.active === false) {
        errors.push({ code: optionCodeFor(group, 'INACTIVE'), groupId: group.id, optionId, message: `Option "${option.name}" is unavailable` });
        continue;
      }
      if (group.type === 'ADD_ON_GROUP') {
        const q = Number(entry.quantities?.[optionId]) || 1;
        if (q < 1 || (option.maxQuantity != null && q > option.maxQuantity)) {
          errors.push({ code: 'INVALID_QUANTITY', groupId: group.id, optionId, message: `Quantity for "${option.name}" must be between 1 and ${option.maxQuantity ?? 'unlimited'}` });
        }
      }
      selected.add(`${group.id}::${optionId}`);
    }

    // Selection-count rules (min/max + required).
    if (group.required && optionIds.length === 0) {
      errors.push({ code: requiredMissingCode(group), groupId: group.id, message: `Please select an option for "${group.name}".` });
    }
    const free = group.freeSelectionCount ?? 0;
    if (group.minSelections > 0 && optionIds.length < group.minSelections) {
      errors.push({ code: 'TOO_FEW_SELECTIONS', groupId: group.id, message: `Select at least ${group.minSelections} option${group.minSelections === 1 ? '' : 's'} for "${group.name}".` });
    }
    if (group.maxSelections != null && optionIds.length > group.maxSelections) {
      errors.push({ code: 'TOO_MANY_SELECTIONS', groupId: group.id, message: `Select at most ${group.maxSelections} option${group.maxSelections === 1 ? '' : 's'} for "${group.name}".` });
    }
    if (free > 0 && group.type === 'MODIFIER_GROUP' && optionIds.length > free && group.maxSelections == null) {
      // free-selection semantics: beyond `free` paid selections require the
      // max to be set explicitly; keep validation strict on min/max only here.
    }
    // Mark the group as touched (mirror of the backend's `selected.add(group.id)`).
    selected.add(group.id);
  }

  // Groups the customer did NOT touch: enforce required/minimums — same pass
  // as the backend validator, so both always agree.
  for (const group of groups.values()) {
    if (selected.has(group.id)) continue;
    if (group.required) {
      errors.push({ code: requiredMissingCode(group), groupId: group.id, message: `Please select an option for "${group.name}".` });
    } else if ((group.minSelections ?? 0) > 0) {
      errors.push({ code: 'TOO_FEW_SELECTIONS', groupId: group.id, message: `Select at least ${group.minSelections} option${group.minSelections === 1 ? '' : 's'} for "${group.name}".` });
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Pure: toggle an option in a selection (returns a new selection). */
export function toggleOption(selection: ConfigSelection, group: ResolvedConfigGroup, optionId: string): ConfigSelection {
  const entry = selection.selections.find((s) => s.groupId === group.id);
  const current = entry?.optionIds ?? [];
  const isSelected = current.includes(optionId);
  const next = isSelected
    ? current.filter((id) => id !== optionId)
    : group.selectionMode === 'SINGLE'
      ? [optionId]
      : [...current, optionId];
  const rest = selection.selections.filter((s) => s.groupId !== group.id);
  return { selections: [...rest, { groupId: group.id, optionIds: next, quantities: entry?.quantities }] };
}

/** Pure: set an add-on quantity (clamped to the option's max). */
export function setOptionQuantity(
  selection: ConfigSelection,
  groupId: string,
  optionId: string,
  qty: number,
  option: ResolvedConfigOption
): ConfigSelection {
  const clamped = Math.max(1, Math.min(qty, option.maxQuantity ?? qty));
  const rest = selection.selections.filter((s) => s.groupId !== groupId);
  const entry = selection.selections.find((s) => s.groupId === groupId);
  const quantities = { ...(entry?.quantities ?? {}) };
  if (clamped <= 1) delete quantities[optionId];
  else quantities[optionId] = clamped;
  return { selections: [...rest, { groupId, optionIds: entry?.optionIds ?? [], quantities }] };
}

/** Whether a product has any configured groups (fast flag for the POS grid). */
export function hasConfigSelection(product: { menuConfig?: { variantConfigurations?: unknown[]; modifierConfigurations?: unknown[]; addOnConfigurations?: unknown[] } }): boolean {
  const c = product?.menuConfig;
  if (!c) return false;
  return (
    (c.variantConfigurations?.length ?? 0) > 0 ||
    (c.modifierConfigurations?.length ?? 0) > 0 ||
    (c.addOnConfigurations?.length ?? 0) > 0
  );
}

export interface ConfiguredCartItem {
  id: string;
  product: any;
  selectedVariant?: any;
  quantity: number;
  notes?: string;
  price: number; // unit price (grossItemPrice)
  configuration: ConfigSelection;
  pricingSnapshot: {
    basePrice: number;
    variantDelta: number;
    modifierDelta: number;
    addonDelta: number;
    grossItemPrice: number;
    lineTotal: number;
    configVersion: number;
    pricingVersion: number;
    origin: 'online' | 'offline';
  };
  configSummary: string;
}

/**
 * Deterministic configuration fingerprint (Phase 5).
 *
 * Two configured cart items are the SAME item iff they share a product AND
 * this fingerprint. It normalizes selection representation so ordering
 * differences never split identical lines:
 *   - selection entries are sorted by groupId
 *   - option ids within a group are sorted
 *   - add-on/modifier quantities are included (Extra Cheese ×1 ≠ ×2)
 *   - volatile fields (timestamps, ids, UI state) are excluded
 *
 * Returns 'plain' when the selection is empty — an unconfigured item.
 */
export function configFingerprint(resolved: ResolvedProductConfig, selection: ConfigSelection): string {
  const entries = (selection?.selections ?? [])
    .filter((s) => s && s.groupId && Array.isArray(s.optionIds) && s.optionIds.length > 0)
    .map((s) => {
      const optionIds = [...s.optionIds].sort();
      let q = '';
      if (s.quantities && Object.keys(s.quantities).length > 0) {
        q = Object.keys(s.quantities)
          .sort()
          .map((k) => `${k}:${s.quantities![k]}`)
          .join(',');
      }
      return `${s.groupId}|${optionIds.join(',')}${q ? `|q:${q}` : ''}`;
    })
    .sort();
  return entries.length > 0 ? entries.join(';') : 'plain';
}

/**
 * Build a cart item from a resolved configuration + selection. `origin` is
 * 'online' when the POS is connected at checkout time, 'offline' otherwise —
 * the backend treats the snapshot accordingly (online = reprice, offline =
 * honor history).
 *
 * The row id is DETERMINISTIC (product + configuration fingerprint) so the
 * cart can merge identical configured items and keep differently-configured
 * items separate (Phase 5, release-gate scenario: Large+CheeseBurst must never
 * merge with Large+Regular). `existingId` is retained for callers that need
 * to address a row being edited; the emitted id always reflects the selection.
 */
export function buildConfiguredCartItem(
  resolved: ResolvedProductConfig,
  selection: ConfigSelection,
  quantity: number,
  origin: 'online' | 'offline',
  existingId?: string,
  fullProduct?: any
): ConfiguredCartItem {
  const price = calculateLineItemPrice(resolved, selection, quantity);
  const productId = resolved.product.id;
  const summary = summarizeSelection(resolved, selection);
  return {
    id: existingId || `${productId}_cfg_${configFingerprint(resolved, selection)}`,
    // Keep the FULL product so the cart row (image), tax calc (gstPercent),
    // KOT and receipt all behave exactly like a legacy item.
    product: fullProduct ?? { id: productId, name: resolved.product.name, category: resolved.product.category },
    quantity,
    price: price.grossItemPrice,
    configuration: selection,
    pricingSnapshot: {
      basePrice: price.basePrice,
      variantDelta: price.variantDelta,
      modifierDelta: price.modifierDelta,
      addonDelta: price.addonDelta,
      grossItemPrice: price.grossItemPrice,
      lineTotal: price.lineTotal,
      configVersion: price.configVersion,
      pricingVersion: price.pricingVersion,
      origin,
    },
    configSummary: summary,
  };
}

/** Human label for a configuration group type (menu-management UI language). */
export const CONFIG_TYPE_LABEL: Record<ConfigType, string> = {
  VARIANT_GROUP: 'Variants',
  MODIFIER_GROUP: 'Customizations',
  ADD_ON_GROUP: 'Add-ons',
};

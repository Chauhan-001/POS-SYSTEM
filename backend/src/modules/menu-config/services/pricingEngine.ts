/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pricingEngine — ONE deterministic pricing rule for configured products.
 *
 *   ResolvedProductConfiguration + Selection → LineItemPrice
 *
 * The engine is PURE (no DB, no I/O) so it can run anywhere: backend bill
 * validation (authoritative online), the POS preview, offline billing from a
 * local catalog snapshot, the customer site, and tests — all with identical
 * results. There is deliberately no "online engine" vs "offline engine": the
 * only difference between the two paths is WHERE the inputs come from.
 *
 * This module computes the configured item's gross price only. Bill-level
 * discounts are the existing Offer Engine's job and bill-level tax uses the
 * existing tax rules — this engine must never duplicate either.
 */

import type { ResolvedConfigGroup, ResolvedProductConfiguration, ResolvedConfigOption } from './configurationResolver';

/** Deterministic pricing result for a single configured line item. */
export interface LineItemPrice {
  /** Product's base (unit) price from the resolved configuration. */
  basePrice: number;
  /** Sum of selected variant-option price deltas (unit). */
  variantDelta: number;
  /** Sum of selected modifier-option price deltas (unit). */
  modifierDelta: number;
  /** Sum of add-on prices × their quantities (unit — includes add-on qty). */
  addonDelta: number;
  /** base + variantDelta + modifierDelta + addonDelta (unit). */
  grossItemPrice: number;
  /** grossItemPrice × quantity (before bill-level discounts/tax). */
  lineTotal: number;
  /** Version of the configuration this price was computed from. */
  configVersion: number;
  /** Monotonic pricing-rule revision (bump when pricing rules change). */
  pricingVersion: number;
}

export interface SelectionEntry {
  groupId: string;
  optionIds: string[];
  /** Per-optionId quantity — add-ons only. Omitted/1 = single. */
  quantities?: Record<string, number>;
}

export interface ConfigSelection {
  selections: SelectionEntry[];
}

/**
 * Deterministic financial rounding — 2-decimal paise, half-up.
 * This is the single rounding point for configured-item pricing.
 */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Index a group by id. */
function indexGroup(groups: ResolvedConfigGroup[], id: string): ResolvedConfigGroup | undefined {
  return groups.find((g) => g.id === id);
}

/** The delta contributed by one selected option (variant/modifier = delta; add-on = price × qty). */
function optionDelta(group: ResolvedConfigGroup, option: ResolvedConfigOption, quantity: number): number {
  if (group.type === 'ADD_ON_GROUP') {
    const unit = option.price ?? 0;
    return roundMoney(unit * Math.max(1, quantity || 1));
  }
  return option.priceDelta ?? 0;
}

/**
 * Calculate the deterministic price for a configured line item.
 *
 * @param resolved  The resolved product configuration (Phase 1 resolver output).
 * @param selection The customer's selection (option ids per group, add-on qty).
 * @param quantity  Line quantity (≥ 1). Applied once at the end.
 */
export function calculateLineItemPrice(
  resolved: ResolvedProductConfiguration,
  selection: ConfigSelection,
  quantity = 1
): LineItemPrice {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const groups = [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups];

  let variantDelta = 0;
  let modifierDelta = 0;
  let addonDelta = 0;

  for (const entry of selection?.selections ?? []) {
    const group = indexGroup(groups, entry.groupId);
    if (!group) continue; // unknown groups are reported by the validator, not the pricer
    for (const optionId of entry.optionIds ?? []) {
      const option = group.options.find((o) => o.id === optionId);
      if (!option || option.active === false) continue;
      const q = group.type === 'ADD_ON_GROUP' ? Math.max(1, Number(entry.quantities?.[optionId]) || 1) : 1;
      const delta = optionDelta(group, option, q);
      if (group.type === 'VARIANT_GROUP') variantDelta += delta;
      else if (group.type === 'MODIFIER_GROUP') modifierDelta += delta;
      else addonDelta += delta;
    }
  }

  const basePrice = roundMoney(resolved.product.baseProductPrice ?? 0);
  variantDelta = roundMoney(variantDelta);
  modifierDelta = roundMoney(modifierDelta);
  addonDelta = roundMoney(addonDelta);
  const grossItemPrice = roundMoney(basePrice + variantDelta + modifierDelta + addonDelta);

  return {
    basePrice,
    variantDelta,
    modifierDelta,
    addonDelta,
    grossItemPrice,
    lineTotal: roundMoney(grossItemPrice * qty),
    configVersion: resolved.configVersion ?? 0,
    pricingVersion: PRICING_VERSION,
  };
}

/**
 * Pricing-rule revision. Bump ONLY when the calculation semantics above change
 * (not when a menu price changes) — it lets snapshots tell "old pricing rules"
 * from "old menu prices".
 */
export const PRICING_VERSION = 1;

/**
 * Compact human-readable summary of a configured selection for receipts, KOTs
 * and the cart ("Large • Cheese Burst • Mushroom, Olives"). Never includes
 * internal ids.
 */
export function summarizeSelection(
  resolved: ResolvedProductConfiguration,
  selection: ConfigSelection
): string {
  const parts: string[] = [];
  const groups = [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups];
  for (const entry of selection?.selections ?? []) {
    const group = indexGroup(groups, entry.groupId);
    if (!group) continue;
    for (const optionId of entry.optionIds ?? []) {
      const option = group.options.find((o) => o.id === optionId);
      if (!option) continue;
      const q = group.type === 'ADD_ON_GROUP' ? Math.max(1, Number(entry.quantities?.[optionId]) || 1) : 1;
      parts.push(q > 1 ? `${option.name} ×${q}` : option.name);
    }
  }
  return parts.join(' • ');
}

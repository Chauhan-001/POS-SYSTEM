/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pricingEngine (POS mirror) — deterministic line-item pricing for configured
 * products. This is the EXACT mirror of
 * backend/src/modules/menu-config/services/pricingEngine.ts (same pure
 * function, same rounding, same PRICING_VERSION). The backend is authoritative
 * for online bills; this mirror powers the live cart preview and offline
 * billing so both paths always agree. If the two ever diverge, the backend
 * rejects the bill — never trust frontend totals.
 */

import type { ResolvedProductConfig, ResolvedConfigGroup, ResolvedConfigOption } from '../types';

export interface LineItemPrice {
  basePrice: number;
  variantDelta: number;
  modifierDelta: number;
  addonDelta: number;
  grossItemPrice: number;
  lineTotal: number;
  configVersion: number;
  pricingVersion: number;
}

export interface SelectionEntry {
  groupId: string;
  optionIds: string[];
  quantities?: Record<string, number>;
}

export interface ConfigSelection {
  selections: SelectionEntry[];
}

/** Deterministic financial rounding — 2-decimal paise, half-up. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const PRICING_VERSION = 1;

function indexGroup(groups: ResolvedConfigGroup[], id: string): ResolvedConfigGroup | undefined {
  return groups.find((g) => g.id === id);
}

function optionDelta(group: ResolvedConfigGroup, option: ResolvedConfigOption, quantity: number): number {
  if (group.type === 'ADD_ON_GROUP') {
    const unit = option.price ?? 0;
    return roundMoney(unit * Math.max(1, quantity || 1));
  }
  return option.priceDelta ?? 0;
}

export function calculateLineItemPrice(
  resolved: ResolvedProductConfig,
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
    if (!group) continue;
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

/** Compact human-readable summary ("Large • Cheese Burst • Mushroom, Olives"). */
export function summarizeSelection(
  resolved: ResolvedProductConfig,
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

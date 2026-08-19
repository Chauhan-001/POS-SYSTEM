/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * configurationValidator — deterministic validation of a customer's selection
 * against a RESOLVED product configuration. Pure (no DB, no I/O) so it can run
 * anywhere: backend order validation, POS, customer website, tests.
 *
 * Returns structured errors with stable codes, never free-form strings:
 *   { valid: false, errors: [{ code, groupId?, optionId?, message }] }
 */

import { ResolvedConfigGroup, ResolvedProductConfiguration } from './configurationResolver';
import { ValidationErrorCode } from '../constants';

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

export interface SelectionEntry {
  groupId: string;
  optionIds: string[];
  /** Per-optionId quantity (add-ons). */
  quantities?: Record<string, number>;
}

export interface ConfigSelection {
  selections: SelectionEntry[];
}

/** All resolved groups (variants + modifiers + add-ons) indexed by id. */
function indexGroups(resolved: ResolvedProductConfiguration): Map<string, ResolvedConfigGroup> {
  const map = new Map<string, ResolvedConfigGroup>();
  for (const g of [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups]) {
    map.set(g.id, g);
  }
  return map;
}

export function validateProductConfigurationSelection(
  resolved: ResolvedProductConfiguration,
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
        errors.push({
          code: optionCodeFor(group, 'INVALID'),
          groupId: group.id,
          optionId,
          message: `Option "${optionId}" does not exist in "${group.name}"`,
        });
        continue;
      }
      if (!option.active) {
        errors.push({
          code: optionCodeFor(group, 'INACTIVE'),
          groupId: group.id,
          optionId,
          message: `Option "${option.name}" is not available`,
        });
      }

      // Quantity constraints are checked independently of availability.
      if (group.type === 'ADD_ON_GROUP' || option.minQuantity !== undefined || option.maxQuantity !== undefined) {
        const qty = entry.quantities?.[optionId] ?? 1;
        if (option.minQuantity !== undefined && qty < option.minQuantity) {
          errors.push({ code: 'INVALID_QUANTITY', groupId: group.id, optionId, message: `Minimum quantity for "${option.name}" is ${option.minQuantity}` });
        }
        if (option.maxQuantity !== undefined && qty > option.maxQuantity) {
          errors.push({ code: 'INVALID_QUANTITY', groupId: group.id, optionId, message: `Maximum quantity for "${option.name}" is ${option.maxQuantity}` });
        }
      }
    }

    const count = seen.size;
    if (group.required && count < group.minSelections) {
      errors.push({
        code: group.type === 'VARIANT_GROUP' ? 'REQUIRED_VARIANT_MISSING' : 'REQUIRED_MODIFIER_MISSING',
        groupId: group.id,
        message: group.type === 'VARIANT_GROUP'
          ? `Please select a variant for "${group.name}"`
          : `"${group.name}" is required — select at least ${group.minSelections}`,
      });
    } else if (count < group.minSelections) {
      errors.push({ code: 'TOO_FEW_SELECTIONS', groupId: group.id, message: `"${group.name}" needs at least ${group.minSelections} selection${group.minSelections === 1 ? '' : 's'}` });
    }
    if (group.maxSelections !== null && count > group.maxSelections) {
      errors.push({ code: 'TOO_MANY_SELECTIONS', groupId: group.id, message: `"${group.name}" allows at most ${group.maxSelections} selection${group.maxSelections === 1 ? '' : 's'}` });
    }

    selected.add(group.id);
  }

  // Groups the customer did NOT touch: enforce required/minimums.
  for (const group of groups.values()) {
    if (selected.has(group.id)) continue;
    if (group.required) {
      errors.push({
        code: group.type === 'VARIANT_GROUP' ? 'REQUIRED_VARIANT_MISSING' : 'REQUIRED_MODIFIER_MISSING',
        groupId: group.id,
        message: group.type === 'VARIANT_GROUP'
          ? `Please select a variant for "${group.name}"`
          : `"${group.name}" is required — select at least ${group.minSelections}`,
      });
    } else if (group.minSelections > 0) {
      errors.push({ code: 'TOO_FEW_SELECTIONS', groupId: group.id, message: `"${group.name}" needs at least ${group.minSelections} selection${group.minSelections === 1 ? '' : 's'}` });
    }
  }

  return { valid: errors.length === 0, errors };
}

function optionCodeFor(group: ResolvedConfigGroup, kind: 'INVALID' | 'INACTIVE'): ValidationErrorCode {
  if (group.type === 'VARIANT_GROUP') return kind === 'INVALID' ? 'INVALID_VARIANT' : 'INACTIVE_VARIANT';
  if (group.type === 'ADD_ON_GROUP') return kind === 'INVALID' ? 'INVALID_ADD_ON' : 'INACTIVE_ADD_ON';
  return kind === 'INVALID' ? 'INVALID_MODIFIER_OPTION' : 'INACTIVE_MODIFIER_OPTION';
}

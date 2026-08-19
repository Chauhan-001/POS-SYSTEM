/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * menu-config constants — single source of truth for the reusable Menu
 * Configuration domain. All modules import from here; no arbitrary strings
 * are used across the codebase.
 */

/** The three kinds of reusable configuration template. */
export const CONFIG_TYPES = ['VARIANT_GROUP', 'MODIFIER_GROUP', 'ADD_ON_GROUP'] as const;
export type ConfigType = (typeof CONFIG_TYPES)[number];

/** Selection semantics of a group. Extensible for future modes (e.g. EXACT). */
export const SELECTION_MODES = ['SINGLE', 'MULTIPLE'] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

/**
 * How a product relates to a reusable template:
 *  - shared    → use the template as-is (live)
 *  - override  → inherit the template but apply item-specific overrides
 *  - copy      → the referenced template is an independent copy (provenance
 *                recorded via sourceTemplateId)
 */
export const CONFIG_MODES = ['shared', 'override', 'copy'] as const;
export type ConfigMode = (typeof CONFIG_MODES)[number];

/** Template lifecycle. archived templates are excluded from resolution. */
export const CONFIG_STATUSES = ['draft', 'active', 'archived'] as const;
export type ConfigStatus = (typeof CONFIG_STATUSES)[number];

/** Structured validation error codes (stable — consumers may branch on them). */
export const VALIDATION_ERROR_CODES = [
  'INVALID_GROUP',
  'INACTIVE_GROUP',
  'INVALID_OPTION',
  'INACTIVE_OPTION',
  'INVALID_VARIANT',
  'INACTIVE_VARIANT',
  'REQUIRED_VARIANT_MISSING',
  'INVALID_MODIFIER_OPTION',
  'INACTIVE_MODIFIER_OPTION',
  'REQUIRED_MODIFIER_MISSING',
  'INVALID_ADD_ON',
  'INACTIVE_ADD_ON',
  'TOO_FEW_SELECTIONS',
  'TOO_MANY_SELECTIONS',
  'DUPLICATE_OPTION',
  'INVALID_QUANTITY',
] as const;
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** Default selection rules applied at resolve-time when a template omits them. */
export const DEFAULT_GROUP_RULES: Record<ConfigType, {
  selectionMode: SelectionMode;
  required: boolean;
  minSelections: number;
  maxSelections: number | null;
}> = {
  VARIANT_GROUP: { selectionMode: 'SINGLE', required: true, minSelections: 1, maxSelections: 1 },
  MODIFIER_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
  ADD_ON_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * menu-config validators — zod schemas for the reusable Menu Configuration
 * API. Mirrors the recipes-module validator conventions (.strict(), objectId,
 * defaulted enums).
 */

import { z } from 'zod';
import { objectId } from '../../../validation/common';
import { CONFIG_TYPES, SELECTION_MODES, CONFIG_MODES, CONFIG_STATUSES } from '../constants';

const optionIdSchema = z.string().min(1).max(64).trim();

/** Shared shape for one option inside a template's data. */
export const configOptionSchema = z.object({
  id: optionIdSchema,
  name: z.string().min(1).max(200).trim(),
  priceDelta: z.number().min(0).default(0),
  price: z.number().min(0).optional(),
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  sku: z.string().max(100).trim().optional(),
  barcode: z.string().max(100).trim().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  minQuantity: z.number().int().min(0).optional(),
  maxQuantity: z.number().int().min(0).optional(),
  recipeMappingId: z.string().max(100).trim().optional(),
  kitchenInstruction: z.string().max(500).trim().optional(),
}).strict();

export const templateDataSchema = z.object({
  selectionMode: z.enum(SELECTION_MODES).optional(),
  required: z.boolean().optional(),
  minSelections: z.number().int().min(0).optional(),
  maxSelections: z.number().int().min(0).optional(),
  freeSelectionCount: z.number().int().min(0).optional(),
  options: z.array(configOptionSchema).max(200).default([]),
}).strict();

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).trim().optional(),
  type: z.enum(CONFIG_TYPES),
  status: z.enum(CONFIG_STATUSES).default('active'),
  versionNote: z.string().max(300).trim().optional(),
  data: templateDataSchema,
}).strict()
  .superRefine((t, ctx) => {
    const { options, minSelections, maxSelections, required, selectionMode } = t.data;
    if (maxSelections !== undefined && minSelections !== undefined && minSelections > maxSelections) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'minSelections'], message: 'minSelections cannot exceed maxSelections' });
    }
    if (required && (minSelections === undefined || minSelections < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'required'], message: 'A required group needs minSelections >= 1' });
    }
    if (t.type === 'VARIANT_GROUP' && selectionMode === 'MULTIPLE') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'selectionMode'], message: 'Variant groups are single-select' });
    }
    // Unique option ids + unique (case-insensitive) names within the template.
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const o of options) {
      if (ids.has(o.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Duplicate option id "${o.id}"` });
      ids.add(o.id);
      const key = o.name.toLowerCase();
      if (names.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Duplicate option name "${o.name}"` });
      names.add(key);
    }
    // ADD_ON_GROUP options need an absolute price (or a product reference);
    // VARIANT/MODIFIER options may be free (delta 0) but not priced absolutely.
    for (const o of options) {
      if (t.type === 'ADD_ON_GROUP' && o.price === undefined && o.productId === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Add-on "${o.name}" needs a price or productId` });
      }
      if (t.type !== 'ADD_ON_GROUP' && o.price !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Option "${o.name}": only add-ons use an absolute price` });
      }
    }
  });

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
  type: z.enum(CONFIG_TYPES).optional(),
  status: z.enum(CONFIG_STATUSES).optional(),
  versionNote: z.string().max(300).trim().optional(),
  // Deep-partial: an update may touch only some data fields without wiping
  // the rest (the service merges into the existing doc before re-validating).
  data: templateDataSchema.partial().strict().optional(),
}).strict()
  .superRefine((t, ctx) => {
    if (!t.data) return;
    const { options, minSelections, maxSelections, required, selectionMode } = t.data;
    if (maxSelections !== undefined && minSelections !== undefined && minSelections > maxSelections) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'minSelections'], message: 'minSelections cannot exceed maxSelections' });
    }
    if (required && (minSelections === undefined || minSelections < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'required'], message: 'A required group needs minSelections >= 1' });
    }
    // Cross-field rules that need the existing type are re-checked in the
    // service against the merged document via createTemplateSchema.
    if (t.type === 'VARIANT_GROUP' && selectionMode === 'MULTIPLE') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'selectionMode'], message: 'Variant groups are single-select' });
    }
    if (options) {
      const ids = new Set<string>();
      const names = new Set<string>();
      for (const o of options) {
        if (ids.has(o.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Duplicate option id "${o.id}"` });
        ids.add(o.id);
        const key = o.name.toLowerCase();
        if (names.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'options'], message: `Duplicate option name "${o.name}"` });
        names.add(key);
      }
    }
  });

export const templateQuerySchema = z.object({
  type: z.enum(CONFIG_TYPES).optional(),
  status: z.enum(CONFIG_STATUSES).optional(),
  search: z.string().max(100).trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();

export const templateParamsSchema = z.object({ id: objectId }).strict();

export const copyTemplateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
}).strict();

// ─── Product configuration relationship ───────────────────────────

const optionOverrideSchema = z.object({
  optionId: optionIdSchema,
  priceDelta: z.number().min(0).optional(),
  name: z.string().min(1).max(200).trim().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  removed: z.boolean().optional(),
}).strict();

export const productConfigRefSchema = z.object({
  templateId: objectId,
  mode: z.enum(CONFIG_MODES).default('shared'),
  overrides: z.object({
    group: z.object({
      required: z.boolean().optional(),
      minSelections: z.number().int().min(0).optional(),
      maxSelections: z.number().int().min(0).optional(),
      selectionMode: z.enum(SELECTION_MODES).optional(),
    }).strict().optional(),
    options: z.array(optionOverrideSchema).max(200).optional(),
  }).strict().optional(),
}).strict();

/** Attach payload — the config type decides which product array the ref lands in. */
export const attachConfigSchema = productConfigRefSchema.extend({
  type: z.enum(CONFIG_TYPES),
});

/** Update payload — `overrides: null` resets to pure shared behavior. */
export const updateConfigRefSchema = z.object({
  mode: z.enum(CONFIG_MODES).optional(),
  overrides: z.object({
    group: z.object({
      required: z.boolean().optional(),
      minSelections: z.number().int().min(0).optional(),
      maxSelections: z.number().int().min(0).optional(),
      selectionMode: z.enum(SELECTION_MODES).optional(),
    }).strict().optional(),
    options: z.array(optionOverrideSchema).max(200).optional(),
  }).strict().nullable().optional(),
}).strict();

export const productParamsSchema = z.object({ productId: objectId }).strict();
export const productRefParamsSchema = z.object({ productId: objectId, refId: objectId }).strict();

// ─── Selection validation ─────────────────────────────────────────

export const selectionEntrySchema = z.object({
  groupId: z.string().min(1).max(64).trim(),
  optionIds: z.array(z.string().min(1).max(64).trim()).max(200),
  quantities: z.record(z.string(), z.number().int().min(0)).optional(),
}).strict();

export const validateSelectionSchema = z.object({
  productId: objectId,
  selection: z.object({
    selections: z.array(selectionEntrySchema).max(500).default([]),
  }).strict(),
}).strict();

/** Batch config summary for the menu-management screen (card badges). */
export const productSummarySchema = z.object({
  productIds: z.array(objectId).min(1).max(500),
}).strict();

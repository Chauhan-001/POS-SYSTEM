/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * configurationResolver — the central domain service that turns a product plus
 * its configuration references (shared / override / copy) into the EFFECTIVE
 * configuration a consumer sees.
 *
 *            Product + Shared Templates + Overrides + Copies
 *                                   ↓
 *                       ResolvedProductConfiguration
 *
 * Consumers (POS, order validation, customer site, offline catalog, tests)
 * never need to understand inheritance — they get final resolved options,
 * rules, price deltas and version metadata.
 *
 * The core resolution logic is PURE (resolveGroup / applyOverrides) and
 * operates on plain template documents, so it is trivially testable and
 * reusable without a database. The async entry point loads the product and
 * templates with tenant isolation, then delegates to the pure core.
 */

import mongoose from 'mongoose';
import ConfigurationTemplate, { IConfigurationTemplate, IConfigOption } from '../models/ConfigurationTemplate';
import Product from '../../../models/Product';
import { AppError } from '../../../utils/AppError';
import { ConfigMode, ConfigStatus, ConfigType, DEFAULT_GROUP_RULES } from '../constants';

// ─── Resolved domain types ─────────────────────────────────────────

export interface ResolvedConfigOption {
  id: string;
  name: string;
  /** Variant/modifier option price delta (₹) — deterministic pricing data. */
  priceDelta: number;
  /** Absolute price for add-on options. */
  price?: number;
  /** Optional reference to an existing product (reusable add-ons). */
  productId?: string;
  sku?: string;
  barcode?: string;
  active: boolean;
  sortOrder: number;
  minQuantity?: number;
  maxQuantity?: number;
  recipeMappingId?: string;
  kitchenInstruction?: string;
}

export interface ResolvedConfigGroup {
  /** Template id (or copy id) this group came from. */
  id: string;
  name: string;
  description?: string;
  type: ConfigType;
  status: ConfigStatus;
  /** Version of the underlying template at resolve time. */
  version: number;
  /** 'copy' groups carry provenance here. */
  sourceTemplateId?: string;
  mode: ConfigMode;
  selectionMode: 'SINGLE' | 'MULTIPLE';
  required: boolean;
  minSelections: number;
  /** null = unlimited. */
  maxSelections: number | null;
  freeSelectionCount: number;
  options: ResolvedConfigOption[];
}

export interface ResolvedProductConfiguration {
  product: {
    id: string;
    name: string;
    baseProductPrice: number;
    category: string;
    availability: boolean;
  };
  /** Max template version across all referenced (non-archived) groups. */
  configVersion: number;
  variantGroups: ResolvedConfigGroup[];
  modifierGroups: ResolvedConfigGroup[];
  addOnGroups: ResolvedConfigGroup[];
}

// ─── Pure core ─────────────────────────────────────────────────────

/** Applies a product's item-specific overrides to a template's group data. */
export function applyOverrides(
  group: Omit<ResolvedConfigGroup, 'mode' | 'version' | 'sourceTemplateId'>,
  overrides?: { group?: { required?: boolean; minSelections?: number; maxSelections?: number; selectionMode?: 'SINGLE' | 'MULTIPLE' }; options?: Array<{ optionId: string; priceDelta?: number; name?: string; active?: boolean; sortOrder?: number; removed?: boolean }> }
): Omit<ResolvedConfigGroup, 'mode' | 'version' | 'sourceTemplateId'> {
  if (!overrides) return group;

  const g = overrides.group ?? {};
  const out: typeof group = {
    ...group,
    required: g.required ?? group.required,
    minSelections: g.minSelections ?? group.minSelections,
    maxSelections: g.maxSelections !== undefined ? g.maxSelections : group.maxSelections,
    selectionMode: g.selectionMode ?? group.selectionMode,
  };

  if (!overrides.options?.length) return out;

  const byId = new Map(group.options.map((o) => [o.id, o]));
  const ordered: Array<{ sort: number; original: number; option: ResolvedConfigOption }> = [];
  const productSpecific: Array<{ sort: number; original: number; option: ResolvedConfigOption }> = [];

  for (const ov of overrides.options) {
    const existing = byId.get(ov.optionId);
    if (ov.removed) {
      if (existing) byId.delete(ov.optionId); // product-specific removal
      continue;
    }
    if (existing) {
      const patched: ResolvedConfigOption = {
        ...existing,
        priceDelta: ov.priceDelta ?? existing.priceDelta,
        name: ov.name ?? existing.name,
        active: ov.active ?? existing.active,
        sortOrder: ov.sortOrder ?? existing.sortOrder,
      };
      byId.set(ov.optionId, patched);
    } else if (ov.name) {
      // Product-specific option: an override entry with a fresh optionId
      // and a name ADDS an option for this product only.
      productSpecific.push({
        sort: ov.sortOrder ?? 0,
        original: Number.MAX_SAFE_INTEGER,
        option: {
          id: ov.optionId,
          name: ov.name,
          priceDelta: ov.priceDelta ?? 0,
          active: ov.active ?? true,
          sortOrder: ov.sortOrder ?? 0,
        },
      });
    }
  }

  for (const o of byId.values()) ordered.push({ sort: o.sortOrder, original: ordered.length, option: o });
  ordered.sort((a, b) => a.sort - b.sort || a.original - b.original);
  productSpecific.sort((a, b) => a.sort - b.sort);

  out.options = [...ordered.map((x) => x.option), ...productSpecific.map((x) => x.option)];
  return out;
}

/** Pure: resolves one template + ref pair into a ResolvedConfigGroup. */
export function resolveGroup(template: Pick<IConfigurationTemplate, '_id' | 'name' | 'description' | 'type' | 'status' | 'version' | 'sourceTemplateId' | 'data'>, ref?: { mode?: ConfigMode; overrides?: { group?: { required?: boolean; minSelections?: number; maxSelections?: number; selectionMode?: 'SINGLE' | 'MULTIPLE' }; options?: Array<{ optionId: string; priceDelta?: number; name?: string; active?: boolean; sortOrder?: number; removed?: boolean }> } }): ResolvedConfigGroup {
  const mode: ConfigMode = ref?.mode ?? 'shared';
  const defaults = DEFAULT_GROUP_RULES[template.type];
  const data = template.data ?? { options: [] };

  const base: Omit<ResolvedConfigGroup, 'mode' | 'version' | 'sourceTemplateId'> = {
    id: String(template._id),
    name: template.name,
    description: template.description || undefined,
    type: template.type,
    status: template.status,
    selectionMode: data.selectionMode ?? defaults.selectionMode,
    required: data.required ?? defaults.required,
    minSelections: data.minSelections ?? defaults.minSelections,
    maxSelections: data.maxSelections ?? defaults.maxSelections,
    freeSelectionCount: data.freeSelectionCount ?? 0,
    options: (data.options ?? []).map(normalizeOption),
  };

  const resolved = applyOverrides(base, mode === 'override' ? ref?.overrides : undefined);

  return {
    ...resolved,
    mode,
    version: template.version,
    sourceTemplateId: template.sourceTemplateId ? String(template.sourceTemplateId) : undefined,
  };
}

function normalizeOption(o: IConfigOption): ResolvedConfigOption {
  return {
    id: o.id,
    name: o.name,
    priceDelta: o.priceDelta ?? 0,
    price: o.price,
    productId: o.productId ? String(o.productId) : undefined,
    sku: o.sku || undefined,
    barcode: o.barcode || undefined,
    active: o.active ?? true,
    sortOrder: o.sortOrder ?? 0,
    minQuantity: o.minQuantity,
    maxQuantity: o.maxQuantity,
    recipeMappingId: o.recipeMappingId || undefined,
    kitchenInstruction: o.kitchenInstruction || undefined,
  };
}

// ─── Async, tenant-isolated loader ─────────────────────────────────

export interface ResolveOptions {
  /** Include archived templates (admin preview). Default false. */
  includeArchived?: boolean;
}

export async function resolveProductConfiguration(
  restaurantId: string,
  productId: string,
  opts: ResolveOptions = {}
): Promise<ResolvedProductConfiguration> {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new AppError(404, 'Product not found in your restaurant');
  }
  const rid = new mongoose.Types.ObjectId(restaurantId);
  const product = await Product.findOne({ _id: productId, restaurantId: rid, isDeleted: false }).exec();
  if (!product) throw new AppError(404, 'Product not found in your restaurant');

  const cfg = product.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
  const allRefs = [
    ...cfg.variantConfigurations.map((r) => ({ ref: r, type: 'VARIANT_GROUP' as ConfigType })),
    ...cfg.modifierConfigurations.map((r) => ({ ref: r, type: 'MODIFIER_GROUP' as ConfigType })),
    ...cfg.addOnConfigurations.map((r) => ({ ref: r, type: 'ADD_ON_GROUP' as ConfigType })),
  ];

  const templateIds = allRefs
    .map(({ ref }) => String(ref.templateId))
    .filter((id, i, arr) => arr.indexOf(id) === i);

  // ALL templates are loaded tenant-scoped. A missing template means the ref
  // points outside this tenant (or was deleted) — resolution fails closed.
  const templates = templateIds.length
    ? await ConfigurationTemplate.find({
        _id: { $in: templateIds },
        restaurantId: rid,
      }).exec()
    : [];

  const byId = new Map<string, IConfigurationTemplate>();
  for (const t of templates) byId.set(String(t._id), t);
  for (const id of templateIds) {
    if (!byId.has(id)) {
      throw new AppError(400, `Configuration reference points to a template outside this restaurant (${id})`);
    }
  }

  const variantGroups: ResolvedConfigGroup[] = [];
  const modifierGroups: ResolvedConfigGroup[] = [];
  const addOnGroups: ResolvedConfigGroup[] = [];

  for (const { ref, type } of allRefs) {
    const template = byId.get(String(ref.templateId))!;
    if (template.status === 'archived' && !opts.includeArchived) continue;
    const group = resolveGroup(template, ref as any);
    if (type === 'VARIANT_GROUP') variantGroups.push(group);
    else if (type === 'MODIFIER_GROUP') modifierGroups.push(group);
    else addOnGroups.push(group);
  }

  const sortGroups = (a: ResolvedConfigGroup, b: ResolvedConfigGroup) =>
    a.name.localeCompare(b.name);

  const configVersion = [...variantGroups, ...modifierGroups, ...addOnGroups].reduce(
    (max, g) => Math.max(max, g.version),
    0
  );

  return {
    product: {
      id: String(product._id),
      name: product.name,
      baseProductPrice: product.price,
      category: product.category,
      availability: product.availability,
    },
    configVersion,
    variantGroups: variantGroups.sort(sortGroups),
    modifierGroups: modifierGroups.sort(sortGroups),
    addOnGroups: addOnGroups.sort(sortGroups),
  };
}

// ─── Batch summary (menu-management card badges) ─────────────────────

/** Display counts for one product's effective configuration. */
export interface ProductConfigSummary {
  productId: string;
  /** Number of effective variant options across all variant groups. */
  variantCount: number;
  /** Number of effective modifier options across all modifier groups. */
  modifierCount: number;
  /** Number of effective add-on options across all add-on groups. */
  addOnCount: number;
  hasConfiguration: boolean;
  configVersion: number;
}

/**
 * Batch, tenant-scoped configuration summary for the menu-management screen.
 * Uses the SAME pure resolution logic as resolveProductConfiguration — the
 * frontend never re-implements resolution. Products outside the tenant are
 * silently excluded (no existence leak).
 */
export async function summarizeConfigurations(
  restaurantId: string,
  productIds: string[]
): Promise<ProductConfigSummary[]> {
  const rid = new mongoose.Types.ObjectId(restaurantId);
  const oids = [...new Set(productIds)]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!oids.length) return [];

  const products = await Product.find({
    _id: { $in: oids },
    restaurantId: rid,
    isDeleted: false,
  })
    .select('price menuConfig')
    .lean()
    .exec();
  if (!products.length) return [];

  // Collect every referenced template (tenant-scoped) in one query.
  const refIds: string[] = [];
  const refsByProduct = new Map<string, Array<{ templateId: string; mode: ConfigMode; overrides?: any }>>();
  for (const p of products) {
    const cfg = p.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
    const refs: Array<{ templateId: string; mode: ConfigMode; overrides?: any }> = [];
    for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
      for (const r of cfg[key] ?? []) {
        if (!r || !r.templateId) continue;
        const id = String(r.templateId);
        refs.push({ templateId: id, mode: (r.mode as ConfigMode) ?? 'shared', overrides: r.overrides ?? undefined });
        refIds.push(id);
      }
    }
    refsByProduct.set(String(p._id), refs);
  }

  const uniqueIds = [...new Set(refIds)];
  const templates = uniqueIds.length
    ? await ConfigurationTemplate.find({
        _id: { $in: uniqueIds.map((id) => new mongoose.Types.ObjectId(id)) },
        restaurantId: rid,
      })
        .lean()
        .exec()
    : [];
  const templateById = new Map(templates.map((t) => [String(t._id), t]));

  const summaries: ProductConfigSummary[] = [];
  for (const p of products) {
    const refs = refsByProduct.get(String(p._id)) ?? [];
    let variantCount = 0;
    let modifierCount = 0;
    let addOnCount = 0;
    let hasConfiguration = false;
    let configVersion = 0;

    for (const ref of refs) {
      const tpl = templateById.get(ref.templateId);
      if (!tpl || tpl.status === 'archived') continue; // archived → not effective
      hasConfiguration = true;
      configVersion = Math.max(configVersion, tpl.version ?? 1);
      const group = resolveGroup(tpl as any, ref as any);
      const active = group.options.filter((o) => o.active).length;
      if (tpl.type === 'VARIANT_GROUP') variantCount += active;
      else if (tpl.type === 'MODIFIER_GROUP') modifierCount += active;
      else addOnCount += active;
    }

    summaries.push({
      productId: String(p._id),
      variantCount,
      modifierCount,
      addOnCount,
      hasConfiguration,
      configVersion,
    });
  }

  return summaries;
}

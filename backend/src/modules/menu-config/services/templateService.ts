/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * templateService — lifecycle of reusable ConfigurationTemplates.
 *
 * Tenant isolation is enforced on EVERY query: the restaurantId always comes
 * from the authenticated user (never the body), and every read/write is
 * scoped by it. Cross-tenant access returns 404 (no existence leak).
 *
 * Versioning: `version` is bumped on every mutation of an existing template.
 * The version is monotonically meaningful — consumers can diff revisions and
 * later phases (offline snapshots, sync, cache invalidation) key off it.
 */

import mongoose from 'mongoose';
import ConfigurationTemplate, { IConfigurationTemplate, IConfigOption, ITemplateData } from '../models/ConfigurationTemplate';
import Product from '../../../models/Product';
import { AppError } from '../../../utils/AppError';
import { auditService } from '../../audit/auditService';
import { createTemplateSchema, updateTemplateSchema } from '../validators/menuConfig';
import { ConfigType, ConfigStatus, CONFIG_MODES } from '../constants';

export interface TemplateOperator {
  name?: string;
  id?: string;
  branchId?: string;
}

export interface TemplateListOptions {
  type?: ConfigType;
  status?: ConfigStatus;
  search?: string;
  page?: number;
  limit?: number;
}

/** Plain (non-Document) view of a template — what list/get return. */
export interface TemplateView {
  _id: string;
  restaurantId: string;
  name: string;
  description?: string;
  type: ConfigType;
  status: ConfigStatus;
  version: number;
  versionNote?: string;
  sourceTemplateId?: string;
  createdBy?: string;
  updatedBy?: string;
  data: {
    selectionMode?: 'SINGLE' | 'MULTIPLE';
    required?: boolean;
    minSelections?: number;
    maxSelections?: number;
    freeSelectionCount?: number;
    options: Array<Omit<IConfigOption, 'productId'> & { productId?: string }>;
  };
  createdAt: Date;
  updatedAt: Date;
  productCount: number;
}

export interface TemplateListResult {
  items: TemplateView[];
  total: number;
  page: number;
  limit: number;
}

/** Generates a stable option id (short random — unique within a template). */
export function makeOptionId(): string {
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Deep-normalizes mongoose docs/subdocs to plain JSON with nulls → undefined. */
function stripNulls<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T;
}

/** Bump-only update guard: only active/draft templates are editable. */
function assertEditable(template: IConfigurationTemplate): void {
  if (template.status === 'archived') {
    throw new AppError(400, 'Archived templates cannot be modified — copy it instead');
  }
}

async function audit(
  action: string,
  entityId: string,
  entityLabel: string,
  details: Record<string, unknown>,
  operator?: TemplateOperator
): Promise<void> {
  await auditService.log({
    action,
    entityType: 'ConfigurationTemplate',
    entityId,
    entityLabel,
    details,
    performedBy: operator?.name,
    performedById: operator?.id,
    branchId: operator?.branchId,
  });
}

function toView(t: Record<string, any>, productCount: number): TemplateView {
  return {
    _id: String(t._id),
    restaurantId: String(t.restaurantId),
    name: t.name,
    description: t.description || undefined,
    type: t.type,
    status: t.status,
    version: t.version,
    versionNote: t.versionNote || undefined,
    sourceTemplateId: t.sourceTemplateId ? String(t.sourceTemplateId) : undefined,
    createdBy: t.createdBy || undefined,
    updatedBy: t.updatedBy || undefined,
    data: {
      selectionMode: t.data?.selectionMode,
      required: t.data?.required,
      minSelections: t.data?.minSelections,
      maxSelections: t.data?.maxSelections,
      freeSelectionCount: t.data?.freeSelectionCount,
      options: (t.data?.options ?? []).map((o: any) => ({
        ...o,
        productId: o.productId ? String(o.productId) : undefined,
      })),
    },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    productCount,
  };
}

export async function list(
  restaurantId: string,
  opts: TemplateListOptions = {}
): Promise<TemplateListResult> {
  const { type, status, search, page = 1, limit = 50 } = opts;
  const filter: Record<string, unknown> = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [items, total] = await Promise.all([
    ConfigurationTemplate.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    ConfigurationTemplate.countDocuments(filter).exec(),
  ]);

  // Usage counts: which products reference each template (tenant-scoped).
  const templateIds = items.map((t) => String(t._id));
  const usage = templateIds.length
    ? await usageCountsForTemplates(restaurantId, templateIds)
    : new Map<string, number>();

  return {
    items: items.map((t) => toView(t, usage.get(String(t._id)) ?? 0)),
    total,
    page,
    limit,
  };
}

export async function getById(restaurantId: string, id: string): Promise<TemplateView> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(404, 'Template not found in your restaurant');
  const template = await ConfigurationTemplate.findOne({
    _id: id,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!template) throw new AppError(404, 'Template not found in your restaurant');
  const usage = await usageCountsForTemplates(restaurantId, [id]);
  return toView(template.toObject(), usage.get(id) ?? 0);
}

export async function create(
  restaurantId: string,
  input: {
    name: string;
    description?: string;
    type: ConfigType;
    status?: ConfigStatus;
    versionNote?: string;
    data: ITemplateData;
  },
  operator?: TemplateOperator
): Promise<IConfigurationTemplate> {
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues.map((i) => i.message).join('; '));
  }
  const body = parsed.data;
  // Normalize: fill stable ids when the client omitted them; cast the zod
  // string productId to an ObjectId for the model.
  const options: IConfigOption[] = (body.data.options ?? []).map((o) => ({
    ...o,
    id: o.id ?? makeOptionId(),
    productId: o.productId ? new mongoose.Types.ObjectId(o.productId) : undefined,
  }));

  const template = await ConfigurationTemplate.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    name: body.name,
    description: body.description ?? '',
    type: body.type,
    status: body.status ?? 'active',
    version: 1,
    versionNote: body.versionNote ?? '',
    createdBy: operator?.name,
    updatedBy: operator?.name,
    data: { ...body.data, options },
  });

  await audit('menu-config.template_created', String(template._id), template.name, {
    type: template.type,
    version: template.version,
  }, operator);

  return template;
}

export async function update(
  restaurantId: string,
  id: string,
  patch: Partial<{
    name: string;
    description?: string;
    type: ConfigType;
    status?: ConfigStatus;
    versionNote?: string;
    data: Partial<ITemplateData>;
  }>,
  operator?: TemplateOperator
): Promise<IConfigurationTemplate> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(404, 'Template not found in your restaurant');
  const existing = await ConfigurationTemplate.findOne({
    _id: id,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!existing) throw new AppError(404, 'Template not found in your restaurant');
  assertEditable(existing);

  // Type is immutable once created — products reference it by type semantics.
  if (patch.type && patch.type !== existing.type) {
    throw new AppError(400, 'Template type cannot be changed — create a new template instead');
  }

  // Merge data (deep-partial) so a partial `data` patch never wipes options.
  // Convert the stored subdoc to plain JSON first — spreading a hydrated
  // mongoose subdoc would leak $__/_doc internals into the merge.
  const existingData = (existing.data as unknown as { toObject(): ITemplateData }).toObject();
  const mergedData: ITemplateData = {
    ...existingData,
    ...(patch.data ?? {}),
    options: patch.data?.options ?? existingData.options,
  };

  const merged = {
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    type: patch.type ?? existing.type,
    status: patch.status ?? existing.status,
    versionNote: patch.versionNote,
    data: mergedData,
  };

  // Re-validate the FULL merged document — catches cross-field rules that
  // depend on the existing type (e.g. variant group + MULTIPLE selection).
  // The merged doc may carry mongoose subdocument internals and nulls for
  // unset numerics, so normalize to a plain object first.
  const parsed = createTemplateSchema.safeParse(stripNulls(merged));
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues.map((i) => i.message).join('; '));
  }

  existing.set(parsed.data);
  existing.version = existing.version + 1;
  existing.updatedBy = operator?.name;
  await existing.save();

  await audit('menu-config.template_updated', String(existing._id), existing.name, {
    type: existing.type,
    version: existing.version,
    changedFields: Object.keys(patch),
  }, operator);

  return existing;
}

export async function archive(
  restaurantId: string,
  id: string,
  operator?: TemplateOperator
): Promise<IConfigurationTemplate> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(404, 'Template not found in your restaurant');
  const template = await ConfigurationTemplate.findOne({
    _id: id,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!template) throw new AppError(404, 'Template not found in your restaurant');
  if (template.status === 'archived') {
    throw new AppError(400, 'Template is already archived');
  }
  template.status = 'archived';
  template.updatedBy = operator?.name;
  await template.save();

  await audit('menu-config.template_archived', String(template._id), template.name, {
    type: template.type,
  }, operator);

  return template;
}

/**
 * Creates an INDEPENDENT copy of a template. The copy is a brand-new document
 * (version 1) with sourceTemplateId recording provenance — later edits to the
 * original never affect the copy, and vice-versa.
 */
export async function copy(
  restaurantId: string,
  id: string,
  input: { name?: string } = {},
  operator?: TemplateOperator
): Promise<IConfigurationTemplate> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(404, 'Template not found in your restaurant');
  const source = await ConfigurationTemplate.findOne({
    _id: id,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!source) throw new AppError(404, 'Template not found in your restaurant');

  const copyDoc = await ConfigurationTemplate.create({
    restaurantId: source.restaurantId,
    name: input.name ?? `${source.name} (copy)`,
    description: source.description,
    type: source.type,
    status: 'active',
    version: 1,
    versionNote: `Independent copy of template ${String(source._id)} v${source.version}`,
    sourceTemplateId: source._id,
    createdBy: operator?.name,
    updatedBy: operator?.name,
    data: {
      selectionMode: source.data.selectionMode,
      required: source.data.required,
      minSelections: source.data.minSelections,
      maxSelections: source.data.maxSelections,
      freeSelectionCount: source.data.freeSelectionCount,
      options: source.data.options.map((o) => ({ ...o, id: makeOptionId() })),
    },
  });

  await audit('menu-config.template_copied', String(copyDoc._id), copyDoc.name, {
    sourceTemplateId: String(source._id),
    sourceVersion: source.version,
  }, operator);

  return copyDoc;
}

/** Products that reference a template (tenant-scoped, non-destructive). */
export async function usage(
  restaurantId: string,
  templateId: string
): Promise<Array<{ productId: string; name: string; mode: string }>> {
  if (!mongoose.Types.ObjectId.isValid(templateId)) {
    throw new AppError(404, 'Template not found in your restaurant');
  }
  const rid = new mongoose.Types.ObjectId(restaurantId);
  const tid = new mongoose.Types.ObjectId(templateId);
  const products = await Product.find({
    restaurantId: rid,
    isDeleted: false,
    $or: [
      { 'menuConfig.variantConfigurations.templateId': tid },
      { 'menuConfig.modifierConfigurations.templateId': tid },
      { 'menuConfig.addOnConfigurations.templateId': tid },
    ],
  })
    .select('name menuConfig')
    .lean()
    .exec();

  const refs: Array<{ productId: string; name: string; mode: string }> = [];
  for (const p of products) {
    const cfg = p.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
    for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
      for (const ref of cfg[key] ?? []) {
        if (ref && String(ref.templateId) === templateId) {
          refs.push({ productId: String(p._id), name: p.name, mode: ref.mode });
        }
      }
    }
  }
  return refs;
}

async function usageCountsForTemplates(restaurantId: string, templateIds: string[]): Promise<Map<string, number>> {
  const rid = new mongoose.Types.ObjectId(restaurantId);
  const tids = templateIds.map((t) => new mongoose.Types.ObjectId(t));
  const products = await Product.find({
    restaurantId: rid,
    isDeleted: false,
    $or: [
      { 'menuConfig.variantConfigurations.templateId': { $in: tids } },
      { 'menuConfig.modifierConfigurations.templateId': { $in: tids } },
      { 'menuConfig.addOnConfigurations.templateId': { $in: tids } },
    ],
  })
    .select('menuConfig')
    .lean()
    .exec();

  const counts = new Map<string, number>();
  for (const p of products) {
    const cfg = p.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
    const seen = new Set<string>();
    for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
      for (const ref of cfg[key] ?? []) {
        const id = ref && String(ref.templateId);
        if (id && !seen.has(id)) {
          seen.add(id);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/**
 * Guards a template reference against cross-tenant use. Used by the
 * product-relationship API before attaching/updating refs.
 */
export async function assertTemplateBelongsToTenant(restaurantId: string, templateId: string): Promise<IConfigurationTemplate> {
  if (!mongoose.Types.ObjectId.isValid(templateId)) {
    throw new AppError(400, 'Invalid template reference');
  }
  const template = await ConfigurationTemplate.findOne({
    _id: templateId,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!template) throw new AppError(404, 'Template not found in your restaurant');
  return template;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * productConfigService — the Product ↔ ConfigurationTemplate relationship.
 * Attach / update / detach / reset-overrides. Tenant isolation is enforced on
 * BOTH sides: the product must belong to the tenant, and every template
 * reference is verified to belong to the same tenant before it is stored —
 * a restaurant can never attach another tenant's template.
 */

import mongoose from 'mongoose';
import Product, { IProductConfigRef, ProductConfigMode } from '../../../models/Product';
import { AppError } from '../../../utils/AppError';
import { auditService } from '../../audit/auditService';
import { assertTemplateBelongsToTenant, copy as copyTemplate, TemplateOperator } from './templateService';

export interface ProductRefInput {
  templateId: string;
  mode?: ProductConfigMode;
  overrides?: IProductConfigRef['overrides'];
}

async function loadProduct(restaurantId: string, productId: string) {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new AppError(404, 'Product not found in your restaurant');
  }
  const product = await Product.findOne({
    _id: productId,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    isDeleted: false,
  }).exec();
  if (!product) throw new AppError(404, 'Product not found in your restaurant');
  return product;
}

function configArraysOf(product: any) {
  const cfg = product.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
  return cfg;
}

async function audit(action: string, productId: string, productName: string, details: Record<string, unknown>, operator?: TemplateOperator): Promise<void> {
  await auditService.log({
    action,
    entityType: 'Product',
    entityId: productId,
    entityLabel: productName,
    details,
    performedBy: operator?.name,
    performedById: operator?.id,
    branchId: operator?.branchId,
  });
}

/** Array key for a config type. */
function arrayKeyFor(type: 'VARIANT_GROUP' | 'MODIFIER_GROUP' | 'ADD_ON_GROUP'): 'variantConfigurations' | 'modifierConfigurations' | 'addOnConfigurations' {
  if (type === 'VARIANT_GROUP') return 'variantConfigurations';
  if (type === 'MODIFIER_GROUP') return 'modifierConfigurations';
  return 'addOnConfigurations';
}

/**
 * Attach a reusable configuration to a product.
 * mode 'copy' → server creates an INDEPENDENT copy of the template and
 * attaches the copy (provenance recorded on both the ref and the copy).
 */
export async function attachConfiguration(
  restaurantId: string,
  productId: string,
  type: 'VARIANT_GROUP' | 'MODIFIER_GROUP' | 'ADD_ON_GROUP',
  input: ProductRefInput,
  operator?: TemplateOperator
): Promise<IProductConfigRef> {
  const product = await loadProduct(restaurantId, productId);
  const template = await assertTemplateBelongsToTenant(restaurantId, input.templateId);

  if (template.type !== type) {
    throw new AppError(400, `Template "${template.name}" is a ${template.type}, not a ${type}`);
  }
  if (template.status === 'archived') {
    throw new AppError(400, 'Cannot attach an archived template — copy it first');
  }

  let refTemplateId = input.templateId;
  let sourceTemplateId: string | undefined;

  if (input.mode === 'copy') {
    const copyDoc = await copyTemplate(restaurantId, input.templateId, { name: `${template.name} (${product.name})` }, operator);
    refTemplateId = String(copyDoc._id);
    sourceTemplateId = input.templateId;
  }

  const arrayKey = arrayKeyFor(type);
  const menuConfig = product.menuConfig ?? {
    variantConfigurations: [],
    modifierConfigurations: [],
    addOnConfigurations: [],
  };
  if (!product.menuConfig) product.menuConfig = menuConfig;
  const arr = menuConfig[arrayKey] as unknown as mongoose.Types.DocumentArray<IProductConfigRef>;

  // Prevent duplicate attachments of the same template to the same product.
  if (arr.some((r) => r && String(r.templateId) === refTemplateId)) {
    throw new AppError(400, `Configuration "${template.name}" is already attached to this product`);
  }

  const ref = {
    templateId: new mongoose.Types.ObjectId(refTemplateId),
    mode: input.mode ?? 'shared',
    sourceTemplateId: sourceTemplateId ? new mongoose.Types.ObjectId(sourceTemplateId) : undefined,
    overrides: input.overrides ?? undefined,
  };
  const subdoc = arr.create(ref as any);
  arr.push(subdoc);
  await product.save();

  await audit('menu-config.config_attached', productId, product.name, {
    templateId: refTemplateId,
    templateName: template.name,
    mode: subdoc.mode,
    type,
    sourceTemplateId,
  }, operator);

  return subdoc.toObject() as IProductConfigRef;
}

export async function updateConfiguration(
  restaurantId: string,
  productId: string,
  refId: string,
  patch: { mode?: ProductConfigMode; overrides?: IProductConfigRef['overrides'] | null },
  operator?: TemplateOperator
): Promise<IProductConfigRef> {
  const product = await loadProduct(restaurantId, productId);
  const cfg = configArraysOf(product);

  let found = false;
  let updated: IProductConfigRef | undefined;
  let templateName = '';

  for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
    const arr = cfg[key] as IProductConfigRef[];
    const idx = arr.findIndex((r) => r && String((r as any)._id) === refId);
    if (idx === -1) continue;

    // Re-verify the referenced template still belongs to this tenant.
    const tpl = await assertTemplateBelongsToTenant(restaurantId, String(arr[idx].templateId));
    templateName = tpl.name;

    if (patch.mode !== undefined) arr[idx].mode = patch.mode;
    if (patch.overrides !== undefined) {
      // null / empty resets overrides (back to pure shared behavior).
      arr[idx].overrides = patch.overrides && (patch.overrides.options?.length || patch.overrides.group)
        ? patch.overrides
        : undefined;
    }
    updated = arr[idx];
    found = true;
    break;
  }

  if (!found || !updated) throw new AppError(404, 'Configuration reference not found on this product');

  product.markModified('menuConfig');
  await product.save();

  await audit('menu-config.config_updated', productId, product.name, {
    refId,
    templateName,
    mode: updated.mode,
    hasOverrides: !!updated.overrides,
  }, operator);

  return updated;
}

export async function detachConfiguration(
  restaurantId: string,
  productId: string,
  refId: string,
  operator?: TemplateOperator
): Promise<{ detached: boolean }> {
  const product = await loadProduct(restaurantId, productId);
  const cfg = configArraysOf(product);

  let removed = false;
  let templateName = '';
  for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
    const arr = cfg[key] as IProductConfigRef[];
    const idx = arr.findIndex((r) => r && String((r as any)._id) === refId);
    if (idx !== -1) {
      const tpl = await assertTemplateBelongsToTenant(restaurantId, String(arr[idx].templateId));
      templateName = tpl.name;
      arr.splice(idx, 1);
      removed = true;
      break;
    }
  }
  if (!removed) throw new AppError(404, 'Configuration reference not found on this product');

  product.markModified('menuConfig');
  await product.save();

  await audit('menu-config.config_detached', productId, product.name, { refId, templateName }, operator);
  return { detached: true };
}

/** Convenience: drop the product-specific overrides (back to shared as-is). */
export async function resetOverrides(
  restaurantId: string,
  productId: string,
  refId: string,
  operator?: TemplateOperator
): Promise<IProductConfigRef> {
  const product = await loadProduct(restaurantId, productId);
  const cfg = configArraysOf(product);
  let updated: IProductConfigRef | undefined;

  for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
    const arr = cfg[key] as IProductConfigRef[];
    const ref = arr.find((r) => r && String((r as any)._id) === refId);
    if (ref) {
      await assertTemplateBelongsToTenant(restaurantId, String(ref.templateId));
      ref.overrides = undefined;
      updated = ref;
      break;
    }
  }
  if (!updated) throw new AppError(404, 'Configuration reference not found on this product');

  product.markModified('menuConfig');
  await product.save();

  await audit('menu-config.override_reset', productId, product.name, { refId }, operator);
  return updated;
}

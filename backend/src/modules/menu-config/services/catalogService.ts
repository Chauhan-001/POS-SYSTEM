/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * catalogService — offline-capable menu catalog snapshot (Phase 3).
 *
 * The POS downloads ONE payload containing everything needed to sell
 * configured products with NO internet: light product rows, active reusable
 * templates and the resolved configuration of every configured product, plus
 * a monotonic catalog version. When the server catalog changes, the version
 * changes and the POS re-downloads. Historical bills never re-resolve against
 * this catalog — they keep their own immutable pricing snapshots.
 *
 * Tenant isolation: every query is scoped to the calling restaurantId. A
 * restaurant can never see another restaurant's templates or resolutions.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import ConfigurationTemplate from '../models/ConfigurationTemplate';
import { resolveGroup, ResolvedProductConfiguration, ResolvedConfigGroup } from './configurationResolver';
import { ConfigType } from '../constants';

export interface CatalogProductRow {
  id: string;
  name: string;
  code?: string;
  category: string;
  price: number;
  gstPercent: number;
  availability: boolean;
  isCombo?: boolean;
  comboPrice?: number;
  comboComponentIds?: string[];
  image?: string;
  /** Whether this product has any configured groups (fast flag for the POS). */
  hasConfiguration: boolean;
}

export interface CatalogPayload {
  /** Monotonic catalog revision — changes whenever products/templates change. */
  version: number;
  generatedAt: string;
  products: CatalogProductRow[];
  /** Active reusable templates (light, tenant-scoped). */
  templates: Array<{
    id: string;
    name: string;
    description?: string;
    type: ConfigType;
    version: number;
    data: {
      selectionMode?: 'SINGLE' | 'MULTIPLE';
      required?: boolean;
      minSelections?: number;
      maxSelections?: number | null;
      freeSelectionCount?: number;
      options: Array<{
        id: string;
        name: string;
        priceDelta?: number;
        price?: number;
        active?: boolean;
        sortOrder?: number;
        minQuantity?: number;
        maxQuantity?: number;
        recipeMappingId?: string;
        kitchenInstruction?: string;
      }>;
    };
  }>;
  /** Resolved configuration per configured product (id → resolved). */
  resolved: Record<string, ResolvedProductConfiguration>;
}

/**
 * Build the offline catalog snapshot for a tenant. Light enough for 500+
 * products: one product query, one template query, then the PURE resolver core
 * per configured product (no per-product DB round trips).
 */
export async function buildCatalog(restaurantId: string): Promise<CatalogPayload> {
  const rid = new mongoose.Types.ObjectId(restaurantId);

  const [products, templates] = await Promise.all([
    Product.find({ restaurantId: rid, isDeleted: false })
      .select('name code category price gstPercent availability isCombo comboPrice comboComponentIds image menuConfig')
      .lean()
      .exec(),
    ConfigurationTemplate.find({ restaurantId: rid, status: 'active' })
      .lean()
      .exec(),
  ]);

  // Index templates by id for batch resolution.
  const templatesById = new Map<string, any>();
  for (const t of templates) templatesById.set(String(t._id), t);

  const productsOut: CatalogProductRow[] = [];
  const resolved: Record<string, ResolvedProductConfiguration> = {};

  let latestUpdated = new Date(0);

  for (const p of products) {
    const pAny = p as any;
    if (pAny.updatedAt && new Date(pAny.updatedAt).getTime() > latestUpdated.getTime()) {
      latestUpdated = new Date(pAny.updatedAt);
    }

    const cfg = pAny.menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
    const refs = [
      ...(cfg.variantConfigurations ?? []).map((r: any) => ({ ref: r, type: 'VARIANT_GROUP' as ConfigType })),
      ...(cfg.modifierConfigurations ?? []).map((r: any) => ({ ref: r, type: 'MODIFIER_GROUP' as ConfigType })),
      ...(cfg.addOnConfigurations ?? []).map((r: any) => ({ ref: r, type: 'ADD_ON_GROUP' as ConfigType })),
    ].filter(({ ref }) => ref && ref.templateId && templatesById.has(String(ref.templateId)));

    productsOut.push({
      id: String(p._id),
      name: p.name,
      code: pAny.code,
      category: pAny.category,
      price: Number(pAny.price) || 0,
      gstPercent: Number(pAny.gstPercent) ?? 5,
      availability: pAny.availability !== false,
      isCombo: pAny.isCombo,
      comboPrice: pAny.comboPrice ? Number(pAny.comboPrice) : undefined,
      comboComponentIds: Array.isArray(pAny.comboComponentIds) ? pAny.comboComponentIds.map(String) : undefined,
      image: pAny.image,
      hasConfiguration: refs.length > 0,
    });

    if (refs.length === 0) continue;

    // Pure resolution with the pre-loaded templates — same logic as the
    // per-product resolve endpoint, zero additional queries.
    const variantGroups: ResolvedConfigGroup[] = [];
    const modifierGroups: ResolvedConfigGroup[] = [];
    const addOnGroups: ResolvedConfigGroup[] = [];
    for (const { ref, type } of refs) {
      const template = templatesById.get(String(ref.templateId));
      if (!template || template.status === 'archived') continue;
      const group = resolveGroup(template, ref as any);
      if (type === 'VARIANT_GROUP') variantGroups.push(group);
      else if (type === 'MODIFIER_GROUP') modifierGroups.push(group);
      else addOnGroups.push(group);
    }

    const configVersion = [...variantGroups, ...modifierGroups, ...addOnGroups].reduce(
      (max, g) => Math.max(max, g.version),
      0
    );

    resolved[String(p._id)] = {
      product: {
        id: String(p._id),
        name: p.name,
        baseProductPrice: Number(pAny.price) || 0,
        category: pAny.category,
        availability: pAny.availability !== false,
      },
      configVersion,
      variantGroups: variantGroups.sort((a, b) => a.name.localeCompare(b.name)),
      modifierGroups: modifierGroups.sort((a, b) => a.name.localeCompare(b.name)),
      addOnGroups: addOnGroups.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  for (const t of templates) {
    if (t.updatedAt && new Date(t.updatedAt).getTime() > latestUpdated.getTime()) {
      latestUpdated = new Date(t.updatedAt);
    }
  }

  // Monotonic version: ms timestamp of the newest product/template change.
  // Collision-safe enough for change detection; the POS compares inequality.
  const version = latestUpdated.getTime() > 0 ? latestUpdated.getTime() : Date.now();

  return {
    version,
    generatedAt: new Date().toISOString(),
    products: productsOut,
    templates: templates.map((t) => {
      const data = t.data ?? { options: [] };
      return {
        id: String(t._id),
        name: t.name,
        description: t.description,
        type: t.type,
        version: t.version,
        data: {
          selectionMode: data.selectionMode,
          required: data.required,
          minSelections: data.minSelections,
          maxSelections: data.maxSelections ?? null,
          freeSelectionCount: data.freeSelectionCount ?? 0,
          options: (data.options ?? []).map((o: any) => ({
            id: o.id,
            name: o.name,
            priceDelta: o.priceDelta ?? 0,
            price: o.price,
            active: o.active ?? true,
            sortOrder: o.sortOrder ?? 0,
            minQuantity: o.minQuantity,
            maxQuantity: o.maxQuantity,
            recipeMappingId: o.recipeMappingId || undefined,
            kitchenInstruction: o.kitchenInstruction || undefined,
          })),
        },
      };
    }),
    resolved,
  };
}

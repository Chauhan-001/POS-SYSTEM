/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Menu Configuration (Phase 1) integration tests — mongodb-memory-server +
 * the REAL service layer:
 *  - backward compatibility: simple products resolve with no configuration
 *  - reusable templates: variant groups, modifier groups, add-on groups
 *  - three reuse modes: shared / override / copy
 *  - versioning: updates bump the version monotonically
 *  - tenant isolation: cross-tenant read/attach/modify is impossible
 *  - resolver: shared + override produces the effective configuration
 *  - validator: required-missing, too few/many, inactive, invalid ids
 *  - usage: which products reference a template
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import ConfigurationTemplate from '../models/ConfigurationTemplate';
import Product from '../../../models/Product';
import * as templateService from '../services/templateService';
import * as productConfigService from '../services/productConfigService';
import { resolveProductConfiguration, resolveGroup, summarizeConfigurations } from '../services/configurationResolver';
import { validateProductConfigurationSelection } from '../services/configurationValidator';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    ConfigurationTemplate.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
  ]);
});

const ridA = new mongoose.Types.ObjectId().toString();
const ridB = new mongoose.Types.ObjectId().toString();

/** Helper: create a tenant-scoped product (like a real POS catalog item). */
async function makeProduct(restaurantId: string, name = 'Coke', price = 40) {
  return Product.create({
    name,
    code: `P-${Math.random().toString(36).slice(2, 8)}`,
    price,
    category: 'Beverages',
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    isDeleted: false,
  });
}

const pizzaSizeData = {
  options: [
    { id: 'size_s', name: 'Small', priceDelta: 199, sortOrder: 0 },
    { id: 'size_m', name: 'Medium', priceDelta: 299, sortOrder: 1 },
    { id: 'size_l', name: 'Large', priceDelta: 399, sortOrder: 2 },
  ],
};

const crustData = {
  selectionMode: 'SINGLE' as const,
  required: true,
  minSelections: 1,
  maxSelections: 1,
  options: [
    { id: 'crust_regular', name: 'Regular', priceDelta: 0, sortOrder: 0 },
    { id: 'crust_thin', name: 'Thin', priceDelta: 30, sortOrder: 1 },
    { id: 'crust_cheese', name: 'Cheese Burst', priceDelta: 80, sortOrder: 2 },
  ],
};

const toppingData = {
  selectionMode: 'MULTIPLE' as const,
  required: false,
  minSelections: 0,
  maxSelections: 3,
  options: [
    { id: 'top_cheese', name: 'Extra Cheese', priceDelta: 50, sortOrder: 0 },
    { id: 'top_paneer', name: 'Paneer', priceDelta: 70, sortOrder: 1 },
    { id: 'top_onion', name: 'Onion', priceDelta: 20, sortOrder: 2 },
    { id: 'top_olives', name: 'Olives', priceDelta: 40, sortOrder: 3 },
  ],
};

const addOnData = {
  selectionMode: 'MULTIPLE' as const,
  required: false,
  minSelections: 0,
  options: [
    { id: 'ao_coke', name: 'Coke', price: 40, minQuantity: 1, maxQuantity: 5, sortOrder: 0 },
    { id: 'ao_garlic', name: 'Garlic Bread', price: 120, sortOrder: 1 },
  ],
};

// ─── Backward compatibility ───────────────────────────────────────

describe('backward compatibility', () => {
  it('a simple product (no configuration) resolves to empty groups and keeps its base price', async () => {
    const product = await makeProduct(ridA);
    const resolved = await resolveProductConfiguration(ridA, String(product._id));

    expect(resolved.product.baseProductPrice).toBe(40);
    expect(resolved.product.name).toBe('Coke');
    expect(resolved.variantGroups).toHaveLength(0);
    expect(resolved.modifierGroups).toHaveLength(0);
    expect(resolved.addOnGroups).toHaveLength(0);
    expect(resolved.configVersion).toBe(0);
  });

  it('an existing product with pre-created docs (no menuConfig field) resolves safely', async () => {
    // Simulate a legacy document saved before the schema change.
    const raw = await Product.collection.insertOne({
      name: 'Old Coke',
      code: 'OLD-1',
      price: 40,
      category: 'Beverages',
      restaurantId: new mongoose.Types.ObjectId(ridA),
      isDeleted: false,
    });
    const resolved = await resolveProductConfiguration(ridA, String(raw.insertedId));
    expect(resolved.variantGroups).toHaveLength(0);
    expect(resolved.product.baseProductPrice).toBe(40);
  });
});

// ─── Templates ────────────────────────────────────────────────────

describe('templates', () => {
  it('creates a reusable variant group template with version 1', async () => {
    const t = await templateService.create(ridA, {
      name: 'Pizza Sizes',
      type: 'VARIANT_GROUP',
      data: pizzaSizeData,
    });
    expect(t.version).toBe(1);
    expect(t.status).toBe('active');
    expect(t.data.options).toHaveLength(3);
    expect(t.data.options[0].priceDelta).toBe(199);
  });

  it('creates a modifier group and an add-on group', async () => {
    const m = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const a = await templateService.create(ridA, { name: 'Sides', type: 'ADD_ON_GROUP', data: addOnData });
    expect(m.type).toBe('MODIFIER_GROUP');
    expect(a.type).toBe('ADD_ON_GROUP');
    expect(a.data.options[0].price).toBe(40);
  });

  it('rejects duplicate option names and min > max inside a template', async () => {
    await expect(templateService.create(ridA, {
      name: 'Bad',
      type: 'MODIFIER_GROUP',
      data: {
        options: [
          { id: 'a', name: 'Same', priceDelta: 1 },
          { id: 'b', name: 'same', priceDelta: 2 },
        ],
      },
    })).rejects.toThrow(/Duplicate option name/);

    await expect(templateService.create(ridA, {
      name: 'Bad2',
      type: 'MODIFIER_GROUP',
      data: { minSelections: 5, maxSelections: 2, options: [{ id: 'a', name: 'One', priceDelta: 1 }] },
    })).rejects.toThrow(/minSelections cannot exceed maxSelections/);
  });

  it('rejects an add-on without a price or product reference', async () => {
    await expect(templateService.create(ridA, {
      name: 'BadAddOn',
      type: 'ADD_ON_GROUP',
      data: { options: [{ id: 'x', name: 'Free Thing', priceDelta: 0 }] },
    })).rejects.toThrow(/needs a price or productId/);
  });

  it('bumps version on every update and keeps it monotonic', async () => {
    const t = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const v1 = t.version;

    const updated = await templateService.update(ridA, String(t._id), {
      data: { options: [...crustData.options, { id: 'crust_stuffed', name: 'Stuffed', priceDelta: 100 }] },
    });
    expect(updated.version).toBe(v1 + 1);

    const updated2 = await templateService.update(ridA, String(t._id), { description: 'updated crust' });
    expect(updated2.version).toBe(v1 + 2);
  });

  it('does not wipe options on a partial data update', async () => {
    const t = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const updated = await templateService.update(ridA, String(t._id), {
      data: { required: false }, // only touches one field
    });
    expect(updated.data.options).toHaveLength(3);
    expect(updated.data.required).toBe(false);
  });

  it('archives a template; archived templates are excluded from resolution', async () => {
    const t = await templateService.create(ridA, { name: 'Pizza Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const product = await makeProduct(ridA, 'Margherita', 199);
    await productConfigService.attachConfiguration(ridA, String(product._id), 'VARIANT_GROUP', {
      templateId: String(t._id),
      mode: 'shared',
    });

    let resolved = await resolveProductConfiguration(ridA, String(product._id));
    expect(resolved.variantGroups).toHaveLength(1);

    await templateService.archive(ridA, String(t._id));
    resolved = await resolveProductConfiguration(ridA, String(product._id));
    expect(resolved.variantGroups).toHaveLength(0); // archived → gone

    // Admin preview still sees it.
    resolved = await resolveProductConfiguration(ridA, String(product._id), { includeArchived: true });
    expect(resolved.variantGroups).toHaveLength(1);
  });
});

// ─── Reuse modes: shared / override / copy ────────────────────────

describe('reuse modes', () => {
  it('SHARED — several products reference one template as-is', async () => {
    const t = await templateService.create(ridA, { name: 'Pizza Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p1 = await makeProduct(ridA, 'Margherita', 199);
    const p2 = await makeProduct(ridA, 'Farmhouse', 249);

    await productConfigService.attachConfiguration(ridA, String(p1._id), 'VARIANT_GROUP', { templateId: String(t._id), mode: 'shared' });
    await productConfigService.attachConfiguration(ridA, String(p2._id), 'VARIANT_GROUP', { templateId: String(t._id), mode: 'shared' });

    const r1 = await resolveProductConfiguration(ridA, String(p1._id));
    const r2 = await resolveProductConfiguration(ridA, String(p2._id));
    expect(r1.variantGroups[0].options.map((o) => o.priceDelta)).toEqual([199, 299, 399]);
    expect(r2.variantGroups[0].options.map((o) => o.priceDelta)).toEqual([199, 299, 399]);

    // A shared change propagates to all linked products.
    await templateService.update(ridA, String(t._id), {
      data: { options: [...pizzaSizeData.options, { id: 'size_xl', name: 'XL', priceDelta: 499 }] },
    });
    const r1b = await resolveProductConfiguration(ridA, String(p1._id));
    expect(r1b.variantGroups[0].options).toHaveLength(4);
  });

  it('SHARED + OVERRIDE — one product changes a price without touching the template', async () => {
    const t = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const p1 = await makeProduct(ridA, 'Pizza A', 199);
    const p2 = await makeProduct(ridA, 'Pizza B', 229);

    await productConfigService.attachConfiguration(ridA, String(p1._id), 'MODIFIER_GROUP', {
      templateId: String(t._id),
      mode: 'override',
      overrides: {
        options: [{ optionId: 'crust_cheese', priceDelta: 100 }], // only this product pays ₹100
      },
    });
    await productConfigService.attachConfiguration(ridA, String(p2._id), 'MODIFIER_GROUP', {
      templateId: String(t._id),
      mode: 'shared',
    });

    const r1 = await resolveProductConfiguration(ridA, String(p1._id));
    const cheese1 = r1.modifierGroups[0].options.find((o) => o.id === 'crust_cheese')!;
    expect(cheese1.priceDelta).toBe(100);

    const r2 = await resolveProductConfiguration(ridA, String(p2._id));
    const cheese2 = r2.modifierGroups[0].options.find((o) => o.id === 'crust_cheese')!;
    expect(cheese2.priceDelta).toBe(80); // template unchanged

    // The stored override is a DELTA, not a full copy of the template.
    const p1doc = await Product.findById(p1._id).exec();
    const ref = p1doc!.menuConfig!.modifierConfigurations[0];
    expect(ref.mode).toBe('override');
    expect(ref.overrides!.options).toHaveLength(1);
    expect((ref.overrides!.options![0] as any).optionId).toBe('crust_cheese');
  });

  it('override can remove, rename, deactivate, and add product-specific options', async () => {
    const t = await templateService.create(ridA, { name: 'Toppings', type: 'MODIFIER_GROUP', data: toppingData });
    const p = await makeProduct(ridA, 'Pizza C', 199);

    await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', {
      templateId: String(t._id),
      mode: 'override',
      overrides: {
        options: [
          { optionId: 'top_onion', removed: true },                                   // remove
          { optionId: 'top_cheese', name: 'Double Cheese', priceDelta: 90 },          // rename + repriced
          { optionId: 'top_paneer', active: false },                                  // deactivate
          { optionId: 'top_jalapeno', name: 'Jalapeño', priceDelta: 25, sortOrder: 9 }, // product-specific
        ],
      },
    });

    const resolved = await resolveProductConfiguration(ridA, String(p._id));
    const opts = resolved.modifierGroups[0].options;
    const ids = opts.map((o) => o.id);
    expect(ids).not.toContain('top_onion');
    expect(ids).toContain('top_jalapeno');
    const cheese = opts.find((o) => o.id === 'top_cheese')!;
    expect(cheese.name).toBe('Double Cheese');
    expect(cheese.priceDelta).toBe(90);
    expect(opts.find((o) => o.id === 'top_paneer')!.active).toBe(false);

    // Reset overrides → back to pure shared.
    const ref = (await Product.findById(p._id).exec())!.menuConfig!.modifierConfigurations[0];
    await productConfigService.resetOverrides(ridA, String(p._id), String((ref as any)._id));
    const after = await resolveProductConfiguration(ridA, String(p._id));
    expect(after.modifierGroups[0].options.map((o) => o.id)).toEqual(['top_cheese', 'top_paneer', 'top_onion', 'top_olives']);
    expect(after.modifierGroups[0].options.find((o) => o.id === 'top_cheese')!.priceDelta).toBe(50);
  });

  it('INDEPENDENT COPY — the copy stops following the original', async () => {
    const t = await templateService.create(ridA, { name: 'Pizza Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Margherita', 199);

    const copyDoc = await templateService.copy(ridA, String(t._id), {}, { name: 'Copy' });
    expect(String(copyDoc.sourceTemplateId!)).toBe(String(t._id));
    expect(copyDoc.version).toBe(1);

    // Attach the copy as mode 'copy' via the product API (server-side copy path).
    const p2 = await makeProduct(ridA, 'Farmhouse', 249);
    const ref = await productConfigService.attachConfiguration(ridA, String(p2._id), 'VARIANT_GROUP', {
      templateId: String(t._id),
      mode: 'copy',
    });
    expect(String(ref.templateId)).not.toBe(String(t._id)); // attached the COPY

    // Change the ORIGINAL — the copy must not change.
    await templateService.update(ridA, String(t._id), {
      data: { options: [...pizzaSizeData.options, { id: 'size_xl', name: 'XL', priceDelta: 499 }] },
    });

    const resolved = await resolveProductConfiguration(ridA, String(p2._id));
    expect(resolved.variantGroups[0].options).toHaveLength(3);
    expect(resolved.variantGroups[0].sourceTemplateId).toBe(String(t._id));
  });

  it('prevents duplicate attachment of the same template', async () => {
    const t = await templateService.create(ridA, { name: 'Pizza Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Margherita', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) });
    await expect(
      productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) })
    ).rejects.toThrow(/already attached/);
  });

  it('usage — reports which products reference a template', async () => {
    const t = await templateService.create(ridA, { name: 'Pizza Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p1 = await makeProduct(ridA, 'Margherita', 199);
    const p2 = await makeProduct(ridA, 'Farmhouse', 249);
    await productConfigService.attachConfiguration(ridA, String(p1._id), 'VARIANT_GROUP', { templateId: String(t._id) });
    await productConfigService.attachConfiguration(ridA, String(p2._id), 'VARIANT_GROUP', { templateId: String(t._id) });

    const usage = await templateService.usage(ridA, String(t._id));
    expect(usage).toHaveLength(2);
    expect(usage.map((u) => u.name).sort()).toEqual(['Farmhouse', 'Margherita']);

    const view = await templateService.getById(ridA, String(t._id));
    expect(view.productCount).toBe(2);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────

describe('tenant isolation', () => {
  it('tenant A cannot read tenant B’s template', async () => {
    const t = await templateService.create(ridB, { name: 'Secret Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    await expect(templateService.getById(ridA, String(t._id))).rejects.toThrow('not found');
    await expect(templateService.archive(ridA, String(t._id))).rejects.toThrow('not found');
    await expect(templateService.update(ridA, String(t._id), { name: 'Hijacked' })).rejects.toThrow('not found');
    await expect(templateService.copy(ridA, String(t._id))).rejects.toThrow('not found');
  });

  it('tenant A cannot attach tenant B’s template to its product', async () => {
    const t = await templateService.create(ridB, { name: 'B Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Margherita', 199);
    await expect(
      productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) })
    ).rejects.toThrow('not found');
  });

  it('tenant B cannot even resolve a product whose refs point into A (fails closed)', async () => {
    const t = await templateService.create(ridA, { name: 'A Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Margherita', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) });

    // Product belongs to A; resolving as B must fail (product not found).
    await expect(resolveProductConfiguration(ridB, String(p._id))).rejects.toThrow('not found');
  });

  it('list is tenant-scoped — A never sees B’s templates', async () => {
    await templateService.create(ridA, { name: 'A Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    await templateService.create(ridB, { name: 'B Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });

    const aList = await templateService.list(ridA);
    expect(aList.items.map((t) => t.name)).toEqual(['A Sizes']);
    expect(aList.total).toBe(1);

    const bList = await templateService.list(ridB);
    expect(bList.items.map((t) => t.name)).toEqual(['B Sizes']);
  });
});

// ─── Resolver ─────────────────────────────────────────────────────

describe('resolver', () => {
  it('shared + override resolves the spec example (Cheese Burst ₹80 → ₹100)', async () => {
    const t = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', {
      templateId: String(t._id),
      mode: 'override',
      overrides: { options: [{ optionId: 'crust_cheese', priceDelta: 100 }] },
    });

    const resolved = await resolveProductConfiguration(ridA, String(p._id));
    const group = resolved.modifierGroups[0];
    expect(group.options.map((o) => [o.name, o.priceDelta])).toEqual([
      ['Regular', 0],
      ['Thin', 30],
      ['Cheese Burst', 100],
    ]);
    expect(group.mode).toBe('override');
    expect(group.version).toBe(t.version);
    expect(resolved.configVersion).toBe(1);
  });

  it('resolveGroup pure function applies defaults for missing rules', () => {
    const fake = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Sizes',
      type: 'VARIANT_GROUP' as const,
      status: 'active' as const,
      version: 2,
      data: { options: [{ id: 's', name: 'Small', priceDelta: 0 } as any] },
    };
    const g = resolveGroup(fake as any);
    expect(g.selectionMode).toBe('SINGLE');
    expect(g.required).toBe(true);
    expect(g.minSelections).toBe(1);
    expect(g.maxSelections).toBe(1);
  });

  it('resolver returns full deterministic pricing data (base + deltas + add-on price)', async () => {
    const v = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const m = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const a = await templateService.create(ridA, { name: 'Sides', type: 'ADD_ON_GROUP', data: addOnData });
    const p = await makeProduct(ridA, 'Pizza A', 199);

    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(v._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', { templateId: String(m._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'ADD_ON_GROUP', { templateId: String(a._id) });

    const resolved = await resolveProductConfiguration(ridA, String(p._id));
    expect(resolved.product.baseProductPrice).toBe(199);
    expect(resolved.variantGroups[0].options[0].priceDelta).toBe(199);
    expect(resolved.modifierGroups[0].options[1].priceDelta).toBe(30);
    expect(resolved.addOnGroups[0].options[0].price).toBe(40);
    expect(resolved.addOnGroups[0].options[0].maxQuantity).toBe(5);
  });
});

// ─── Validator ────────────────────────────────────────────────────

describe('validator', () => {
  async function resolvedPizza() {
    const v = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const m = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const toppings = await templateService.create(ridA, { name: 'Toppings', type: 'MODIFIER_GROUP', data: toppingData });
    const a = await templateService.create(ridA, { name: 'Sides', type: 'ADD_ON_GROUP', data: addOnData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(v._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', { templateId: String(m._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', { templateId: String(toppings._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'ADD_ON_GROUP', { templateId: String(a._id) });
    return resolveProductConfiguration(ridA, String(p._id));
  }

  it('accepts a valid full selection', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, {
      selections: [
        { groupId: resolved.variantGroups[0].id, optionIds: ['size_m'] },
        { groupId: resolved.modifierGroups[0].id, optionIds: ['crust_cheese'] },
        { groupId: resolved.modifierGroups[1].id, optionIds: ['top_cheese', 'top_paneer'] },
        { groupId: resolved.addOnGroups[0].id, optionIds: ['ao_coke'], quantities: { ao_coke: 2 } },
      ],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('REQUIRED_MODIFIER_MISSING when a required group is not selected', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, {
      selections: [
        { groupId: resolved.variantGroups[0].id, optionIds: ['size_s'] },
        // crust group omitted entirely
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'REQUIRED_MODIFIER_MISSING', groupId: resolved.modifierGroups[0].id }));
  });

  it('REQUIRED_VARIANT_MISSING when no variant is chosen', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, { selections: [] });
    expect(result.errors.some((e) => e.code === 'REQUIRED_VARIANT_MISSING')).toBe(true);
  });

  it('TOO_MANY_SELECTIONS when exceeding the group max', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, {
      selections: [
        { groupId: resolved.variantGroups[0].id, optionIds: ['size_s'] },
        { groupId: resolved.modifierGroups[0].id, optionIds: ['crust_regular'] },
        { groupId: resolved.modifierGroups[1].id, optionIds: ['top_cheese', 'top_paneer', 'top_onion', 'top_olives', 'top_cheese'] },
      ],
    });
    // 5 entries, 4 distinct → exceeds max 3 + duplicate detected
    expect(result.errors.some((e) => e.code === 'TOO_MANY_SELECTIONS')).toBe(true);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_OPTION')).toBe(true);
  });

  it('INVALID_OPTION / INVALID_VARIANT for unknown option ids', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, {
      selections: [
        { groupId: resolved.variantGroups[0].id, optionIds: ['size_zzz'] },
        { groupId: resolved.modifierGroups[0].id, optionIds: ['crust_regular', 'nope'] },
      ],
    });
    expect(result.errors.some((e) => e.code === 'INVALID_VARIANT')).toBe(true);
    expect(result.errors.some((e) => e.code === 'INVALID_MODIFIER_OPTION')).toBe(true);
  });

  it('INACTIVE_OPTION for a disabled option and INVALID_QUANTITY outside add-on limits', async () => {
    const v = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const a = await templateService.create(ridA, { name: 'Sides', type: 'ADD_ON_GROUP', data: addOnData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(v._id) });
    await productConfigService.attachConfiguration(ridA, String(p._id), 'ADD_ON_GROUP', {
      templateId: String(a._id),
      mode: 'override',
      overrides: { options: [{ optionId: 'ao_coke', active: false }] },
    });
    const resolved = await resolveProductConfiguration(ridA, String(p._id));

    const result = validateProductConfigurationSelection(resolved, {
      selections: [
        { groupId: resolved.variantGroups[0].id, optionIds: ['size_s'] },
        { groupId: resolved.addOnGroups[0].id, optionIds: ['ao_coke'], quantities: { ao_coke: 10 } },
      ],
    });
    expect(result.errors.some((e) => e.code === 'INACTIVE_ADD_ON')).toBe(true);
    expect(result.errors.some((e) => e.code === 'INVALID_QUANTITY')).toBe(true);
  });

  it('INVALID_GROUP for a selection against an unknown group', async () => {
    const resolved = await resolvedPizza();
    const result = validateProductConfigurationSelection(resolved, {
      selections: [{ groupId: 'ghost-group', optionIds: ['x'] }],
    });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'INVALID_GROUP', groupId: 'ghost-group' }));
  });
});

// ─── Batch summary (menu-management badges) ───────────────────────

describe('config summary', () => {
  it('returns per-product counts using the same resolution logic', async () => {
    const v = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const m = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const plain = await makeProduct(ridA, 'Coke', 40);
    const configured = await makeProduct(ridA, 'Pizza A', 199);

    await productConfigService.attachConfiguration(ridA, String(configured._id), 'VARIANT_GROUP', { templateId: String(v._id) });
    await productConfigService.attachConfiguration(ridA, String(configured._id), 'MODIFIER_GROUP', {
      templateId: String(m._id),
      mode: 'override',
      overrides: { options: [{ optionId: 'crust_cheese', active: false }] }, // 2 active crust options remain
    });

    const summaries = await summarizeConfigurations(ridA, [String(configured._id), String(plain._id)]);
    const byId = new Map(summaries.map((s) => [s.productId, s]));

    const pizza = byId.get(String(configured._id))!;
    expect(pizza.variantCount).toBe(3);
    expect(pizza.modifierCount).toBe(2); // cheese burst deactivated by override
    expect(pizza.hasConfiguration).toBe(true);
    expect(pizza.configVersion).toBe(1);

    const coke = byId.get(String(plain._id))!;
    expect(coke.variantCount).toBe(0);
    expect(coke.modifierCount).toBe(0);
    expect(coke.addOnCount).toBe(0);
    expect(coke.hasConfiguration).toBe(false);
  });

  it('never leaks another tenant\'s products into the summary', async () => {
    const t = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) });

    const asB = await summarizeConfigurations(ridB, [String(p._id)]);
    expect(asB).toHaveLength(0);
  });
});

// ─── Product relationships API behavior ───────────────────────────

describe('product relationships', () => {
  it('detach removes the reference; update switches mode and resets overrides', async () => {
    const t = await templateService.create(ridA, { name: 'Crust', type: 'MODIFIER_GROUP', data: crustData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    const ref = await productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', {
      templateId: String(t._id),
      mode: 'override',
      overrides: { options: [{ optionId: 'crust_cheese', priceDelta: 100 }] },
    });

    // Update: reset overrides via null.
    await productConfigService.updateConfiguration(ridA, String(p._id), String((ref as any)._id), { overrides: null });
    let doc = await Product.findById(p._id).exec();
    expect(doc!.menuConfig!.modifierConfigurations[0].overrides).toBeFalsy();

    // Detach.
    await productConfigService.detachConfiguration(ridA, String(p._id), String((ref as any)._id));
    doc = await Product.findById(p._id).exec();
    expect(doc!.menuConfig!.modifierConfigurations).toHaveLength(0);

    const resolved = await resolveProductConfiguration(ridA, String(p._id));
    expect(resolved.modifierGroups).toHaveLength(0);
  });

  it('attaching a template of the wrong type is rejected', async () => {
    const t = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await expect(
      productConfigService.attachConfiguration(ridA, String(p._id), 'MODIFIER_GROUP', { templateId: String(t._id) })
    ).rejects.toThrow(/is a VARIANT_GROUP, not a MODIFIER_GROUP/);
  });

  it('archived templates cannot be attached or modified', async () => {
    const t = await templateService.create(ridA, { name: 'Sizes', type: 'VARIANT_GROUP', data: pizzaSizeData });
    await templateService.archive(ridA, String(t._id));
    const p = await makeProduct(ridA, 'Pizza A', 199);
    await expect(
      productConfigService.attachConfiguration(ridA, String(p._id), 'VARIANT_GROUP', { templateId: String(t._id) })
    ).rejects.toThrow(/archived/);
    await expect(templateService.update(ridA, String(t._id), { name: 'x' })).rejects.toThrow(/Archived/);
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Catalog snapshot (Phase 3) integration tests — mongodb-memory-server:
 *  - version changes when products/templates change
 *  - configured products carry resolved configs; simple products don't
 *  - tenant isolation: a restaurant only sees its own catalog/resolutions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import ConfigurationTemplate from '../models/ConfigurationTemplate';
import Product from '../../../models/Product';
import { buildCatalog } from '../services/catalogService';

let mongod: MongoMemoryServer;

const ridA = new mongoose.Types.ObjectId().toString();
const ridB = new mongoose.Types.ObjectId().toString();

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

async function makeProduct(restaurantId: string, over: Record<string, unknown> = {}) {
  return Product.create({
    name: 'Coke',
    code: `P-${Math.random().toString(36).slice(2, 8)}`,
    price: 40,
    category: 'Beverages',
    gstPercent: 5,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    isDeleted: false,
    ...over,
  });
}

async function makeTemplate(restaurantId: string, type: 'VARIANT_GROUP' | 'MODIFIER_GROUP' | 'ADD_ON_GROUP' = 'VARIANT_GROUP') {
  return ConfigurationTemplate.create({
    name: 'Size',
    type,
    status: 'active',
    version: 1,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    createdBy: 'test',
    updatedBy: 'test',
    data: {
      selectionMode: 'SINGLE',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 's', name: 'Small', priceDelta: 0, active: true, sortOrder: 0 },
        { id: 'l', name: 'Large', priceDelta: 20, active: true, sortOrder: 1 },
      ],
    },
  });
}

describe('buildCatalog (Phase 3 offline snapshot)', () => {
  it('includes light product rows and only resolves configured products', async () => {
    const tpl = await makeTemplate(ridA);
    const simple = await makeProduct(ridA);
    const configured = await makeProduct(ridA, {
      menuConfig: { variantConfigurations: [{ templateId: tpl._id, mode: 'shared' }], modifierConfigurations: [], addOnConfigurations: [] },
    });

    const catalog = await buildCatalog(ridA);
    expect(catalog.products.length).toBe(2);
    expect(catalog.products.some((p) => p.id === String(simple._id) && !p.hasConfiguration)).toBe(true);
    const row = catalog.products.find((p) => p.id === String(configured._id));
    expect(row!.hasConfiguration).toBe(true);

    expect(Object.keys(catalog.resolved)).toEqual([String(configured._id)]);
    const resolved = catalog.resolved[String(configured._id)];
    expect(resolved.variantGroups[0].options.map((o) => o.name)).toEqual(['Small', 'Large']);
    expect(resolved.variantGroups[0].version).toBe(1);
    expect(resolved.product.baseProductPrice).toBe(40);
  });

  it('version changes when a template changes (change detection)', async () => {
    const tpl = await makeTemplate(ridA);
    await makeProduct(ridA, {
      menuConfig: { variantConfigurations: [{ templateId: tpl._id, mode: 'shared' }], modifierConfigurations: [], addOnConfigurations: [] },
    });
    const v1 = (await buildCatalog(ridA)).version;

    await ConfigurationTemplate.updateOne({ _id: tpl._id }, { $set: { version: 2, updatedAt: new Date() } }).exec();
    const v2 = (await buildCatalog(ridA)).version;
    expect(v2).toBeGreaterThan(v1);
  });

  it('templates are tenant-isolated', async () => {
    await makeTemplate(ridA);
    await makeTemplate(ridB);
    const a = await buildCatalog(ridA);
    const b = await buildCatalog(ridB);
    expect(a.templates.length).toBe(1);
    expect(b.templates.length).toBe(1);
  });

  it('resolutions are tenant-isolated — refs to another tenant are excluded', async () => {
    const tplB = await makeTemplate(ridB);
    // Product in A references B's template (cross-tenant) — must not resolve.
    await makeProduct(ridA, {
      menuConfig: { variantConfigurations: [{ templateId: tplB._id, mode: 'shared' }], modifierConfigurations: [], addOnConfigurations: [] },
    });
    const a = await buildCatalog(ridA);
    expect(Object.keys(a.resolved)).toEqual([]);
    expect(a.products.find((p) => p.hasConfiguration)).toBeUndefined();
  });

  it('archived templates are excluded from the snapshot', async () => {
    const tpl = await makeTemplate(ridA);
    await ConfigurationTemplate.updateOne({ _id: tpl._id }, { $set: { status: 'archived' } }).exec();
    const a = await buildCatalog(ridA);
    expect(a.templates.length).toBe(0);
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 — Configured online/QR ordering integration tests.
 *
 * The customer website must consume the SAME menu-configuration source as the
 * POS and the SAME deterministic pricing engine — never its own rules:
 *
 *   1. getMenu resolves reusable variant/modifier groups for configured items
 *      (customer-safe projection: names, rules, option prices — no internals).
 *   2. createOrder re-prices a configured line server-side (base + variant +
 *      modifier deltas) and stores the immutable configuration/price snapshot.
 *   3. A client-supplied price is never trusted — totals are server-derived.
 *   4. An invalid selection (missing required group) is rejected with the
 *      unavailable subset — a stale cart never slips through silently.
 *   5. Cross-tenant: a product whose template belongs to ANOTHER restaurant
 *      resolves to nothing — the line is rejected, never priced.
 *   6. clientRef idempotency still holds: replays return the original order.
 *   7. Historical snapshot: after the template's option price changes, the
 *      stored order keeps the price that was valid at order time.
 *   8. Auto-KOT carries the configured summary to the kitchen display.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Restaurant from '../../../models/Restaurant';
import Product from '../../../models/Product';
import Order from '../../../models/Order';
import OrderItem from '../../../models/OrderItem';
import KOTRecord from '../../../models/KOTRecord';
import RestaurantSettings from '../../settings/models/RestaurantSettings';
import ConfigurationTemplate from '../../menu-config/models/ConfigurationTemplate';
import CustomerRequest from '../../qr-ordering/models/CustomerRequest';
import { generatePublicToken } from '../../../utils/publicToken';
import { publicStoreOrderService } from '../services/publicStoreOrderService';

let mongod: MongoMemoryServer;

function oid(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

async function seedRestaurant() {
  const token = generatePublicToken();
  const restaurant = await Restaurant.create({
    restaurantId: `rest-${oid()}`,
    name: 'Phase 4 Kitchen',
    brandName: 'Phase 4 Kitchen',
    description: 'Test',
    phone: '9999999999',
    area: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    currency: 'INR',
    isActive: true,
    publicToken: token,
  });
  return { restaurant, token };
}

/** Size (VARIANT_GROUP) + Cheese/Topping (MODIFIER_GROUP) reusable templates. */
async function seedTemplates(restaurantId: mongoose.Types.ObjectId) {
  const size = await ConfigurationTemplate.create({
    name: 'Size',
    type: 'VARIANT_GROUP',
    status: 'active',
    version: 1,
    restaurantId,
    createdBy: 'test',
    updatedBy: 'test',
    data: {
      selectionMode: 'SINGLE',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'o_s', name: 'Small', priceDelta: 0, active: true, sortOrder: 0 },
        { id: 'o_l', name: 'Large', priceDelta: 200, active: true, sortOrder: 1 },
      ],
    },
  });
  const cheese = await ConfigurationTemplate.create({
    name: 'Cheese',
    type: 'MODIFIER_GROUP',
    status: 'active',
    version: 1,
    restaurantId,
    createdBy: 'test',
    updatedBy: 'test',
    data: {
      selectionMode: 'MULTIPLE',
      required: false,
      minSelections: 0,
      maxSelections: 3,
      options: [
        { id: 'm_x', name: 'Extra Cheese', priceDelta: 60, active: true, sortOrder: 0 },
        { id: 'm_m', name: 'Mushroom', priceDelta: 40, active: true, sortOrder: 1 },
      ],
    },
  });
  return { size, cheese };
}

async function seedConfiguredProduct(
  restaurantId: mongoose.Types.ObjectId,
  opts: { attachTemplates?: boolean; templates?: { size: any; cheese: any } } = {}
) {
  const product = await Product.create({
    restaurantId,
    name: 'Margherita Pizza',
    alias: 'margherita-pizza',
    code: 'PIZZA-4',
    price: 199,
    category: 'Pizza',
    gstPercent: 5,
    isDeleted: false,
    menuConfig: {
      variantConfigurations: [],
      modifierConfigurations: [],
      addOnConfigurations: [],
    },
  });
  if (opts.attachTemplates && opts.templates) {
    product.menuConfig = {
      variantConfigurations: [{ templateId: opts.templates.size._id, mode: 'shared' }],
      modifierConfigurations: [{ templateId: opts.templates.cheese._id, mode: 'shared' }],
      addOnConfigurations: [],
    };
    await product.save();
  }
  return product;
}

async function seedSimpleProduct(restaurantId: mongoose.Types.ObjectId) {
  return Product.create({
    restaurantId,
    name: 'Coke',
    alias: 'coke',
    code: 'COKE-4',
    price: 40,
    category: 'Beverages',
    gstPercent: 5,
    isDeleted: false,
  });
}

describe('Phase 4 — configured online/QR ordering', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Restaurant.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      Order.deleteMany({}).exec(),
      OrderItem.deleteMany({}).exec(),
      KOTRecord.deleteMany({}).exec(),
      ConfigurationTemplate.deleteMany({}).exec(),
      CustomerRequest.deleteMany({}).exec(),
      RestaurantSettings.deleteMany({}).exec(),
    ]);
  });

  it('getMenu exposes the resolved configuration (customer-safe projection)', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });
    await seedSimpleProduct(restaurant._id);

    const menu = await publicStoreOrderService.getMenu(token);
    const pizza = menu.categories
      .flatMap((c: any) => c.items)
      .find((i: any) => i.name === 'Margherita Pizza');

    expect(pizza.hasConfiguration).toBe(true);
    expect(pizza.configuration.variantGroups).toHaveLength(1);
    expect(pizza.configuration.modifierGroups).toHaveLength(1);
    const sizeGroup = pizza.configuration.variantGroups[0];
    expect(sizeGroup.name).toBe('Size');
    expect(sizeGroup.required).toBe(true);
    expect(sizeGroup.selectionMode).toBe('SINGLE');
    expect(sizeGroup.options.map((o: any) => [o.name, o.priceDelta])).toEqual([
      ['Small', 0],
      ['Large', 200],
    ]);
    const cheeseGroup = pizza.configuration.modifierGroups[0];
    expect(cheeseGroup.options.map((o: any) => [o.name, o.priceDelta])).toEqual([
      ['Extra Cheese', 60],
      ['Mushroom', 40],
    ]);
    // Internal resolver internals must never leak to the customer payload.
    expect(JSON.stringify(pizza.configuration)).not.toMatch(/templateId|sourceTemplateId|version/);

    const coke = menu.categories.flatMap((c: any) => c.items).find((i: any) => i.name === 'Coke');
    expect(coke.hasConfiguration).toBe(false);
    expect(coke.configuration).toBeNull();
  });

  it('createOrder re-prices a configured line authoritatively and stores the snapshot + KOT summary', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });

    const selection = {
      selections: [
        { groupId: String(templates.size._id), optionIds: ['o_l'] },
        { groupId: String(templates.cheese._id), optionIds: ['m_x'] },
      ],
    };
    // Client throws a bogus price in — the server must ignore it.
    const { order, items } = await publicStoreOrderService.createOrder(token, {
      clientRef: 'ref-p4-1',
      items: [{ productId: String(product._id), quantity: 2, price: 1, configuration: selection } as any],
    });

    // base 199 + Large 200 + Extra Cheese 60 = 459 per unit; ×2 = 918; GST 5% = 45.90.
    expect(items[0].price).toBe(459);
    expect(items[0].configSummary).toBe('Large • Extra Cheese');
    expect(order.subtotal).toBe(918);
    expect(order.gst).toBeCloseTo(45.9, 1);
    expect(order.grandTotal).toBeCloseTo(963.9, 1);

    // Snapshot fields persisted on the order line.
    const itemDoc = await OrderItem.findOne({ orderId: order._id }).lean().exec();
    expect(itemDoc).toBeTruthy();
    expect((itemDoc as any).configSummary).toBe('Large • Extra Cheese');
    expect((itemDoc as any).configurationSnapshot?.selections).toHaveLength(2);
    expect((itemDoc as any).pricingSnapshot?.grossItemPrice).toBe(459);
    expect((itemDoc as any).pricingSnapshot?.pricingVersion).toBe(1);
    expect((itemDoc as any).pricingSnapshot?.origin).toBe('online');

    // Auto-KOT carries the configured summary to the kitchen.
    const kot = await KOTRecord.findOne({ orderId: order._id }).lean().exec();
    expect(kot).toBeTruthy();
    expect((kot as any).items[0].configSummary).toBe('Large • Extra Cheese');
    expect((kot as any).items[0].itemName).toBe('Margherita Pizza');
    expect((kot as any).items[0].quantity).toBe(2);
  });

  it('does NOT auto-KOT when the restaurant turns onlineOrderAutoKot off — the cashier sends it from the POS later', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });
    // Setting OFF: online orders arrive WITHOUT a kitchen ticket.
    await RestaurantSettings.create({
      restaurantId: restaurant._id,
      scope: 'restaurant',
      settingsVersion: 1,
      settings: { onlineOrderAutoKot: false },
      history: [],
    });

    const selection = {
      selections: [
        { groupId: String(templates.size._id), optionIds: ['o_l'] },
        { groupId: String(templates.cheese._id), optionIds: ['m_x'] },
      ],
    };
    const { order, items } = await publicStoreOrderService.createOrder(token, {
      clientRef: 'ref-p4-manual-kot',
      items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
    });

    // The order + priced line exist (server-authoritative, unchanged)...
    expect(items[0].price).toBe(459);
    expect(items[0].configSummary).toBe('Large • Extra Cheese');
    expect(await Order.countDocuments({ _id: order._id }).exec()).toBe(1);
    // ...but NO KOT was fired — the cashier reviews it and presses KOT in the
    // billing workspace (the POS KOT button upserts the ticket via updateOrder).
    expect(await KOTRecord.countDocuments({ orderId: order._id }).exec()).toBe(0);
  });

  it('rejects an invalid selection (missing required variant group)', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });

    const selection = {
      selections: [
        // Only the optional cheese group — the REQUIRED size group is missing.
        { groupId: String(templates.cheese._id), optionIds: ['m_x'] },
      ],
    };
    await expect(
      publicStoreOrderService.createOrder(token, {
        clientRef: 'ref-p4-bad',
        items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
      })
    ).rejects.toMatchObject({ code: 'SOME_ITEMS_UNAVAILABLE', statusCode: 409 });

    // No order, no KOT, no phantom line rows.
    expect(await Order.countDocuments({}).exec()).toBe(0);
    expect(await KOTRecord.countDocuments({}).exec()).toBe(0);
  });

  it('rejects a selection whose option id does not exist', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });

    const selection = {
      selections: [
        { groupId: String(templates.size._id), optionIds: ['o_l'] },
        { groupId: String(templates.cheese._id), optionIds: ['m_does_not_exist'] },
      ],
    };
    await expect(
      publicStoreOrderService.createOrder(token, {
        items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
      })
    ).rejects.toMatchObject({ code: 'SOME_ITEMS_UNAVAILABLE' });
  });

  it('cross-tenant: a product configured with ANOTHER restaurant template is never priced', async () => {
    const { restaurant: rA, token: tA } = await seedRestaurant();
    const { restaurant: rB } = await seedRestaurant();
    const templatesB = await seedTemplates(rB._id);
    // rA's product references rB's template (should be impossible via the API,
    // but the server must be safe even against a forged reference).
    const product = await seedConfiguredProduct(rA._id, { attachTemplates: true, templates: templatesB });

    const menu = await publicStoreOrderService.getMenu(tA);
    const pizza = menu.categories
      .flatMap((c: any) => c.items)
      .find((i: any) => i.name === 'Margherita Pizza');
    expect(pizza.hasConfiguration).toBe(false);

    await expect(
      publicStoreOrderService.createOrder(tA, {
        clientRef: 'ref-p4-x',
        items: [
          {
            productId: String(product._id),
            quantity: 1,
            configuration: {
              selections: [{ groupId: String(templatesB.size._id), optionIds: ['o_l'] }],
            },
          } as any,
        ],
      })
    ).rejects.toMatchObject({ code: 'SOME_ITEMS_UNAVAILABLE' });
  });

  it('clientRef replay returns the original order — no duplicate sales', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });

    const selection = {
      selections: [{ groupId: String(templates.size._id), optionIds: ['o_l'] }],
    };
    const payload = {
      clientRef: 'ref-p4-idem',
      items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
    };
    const first = await publicStoreOrderService.createOrder(token, payload);
    const replay = await publicStoreOrderService.createOrder(token, payload);

    expect(replay.idempotent).toBe(true);
    expect(String(replay.order._id)).toBe(String(first.order._id));
    expect(await Order.countDocuments({}).exec()).toBe(1);
    expect(await OrderItem.countDocuments({}).exec()).toBe(1);
    // One KOT for the one order.
    expect(await KOTRecord.countDocuments({}).exec()).toBe(1);
  });

  it('historical snapshot survives a later template price change', async () => {
    const { restaurant, token } = await seedRestaurant();
    const templates = await seedTemplates(restaurant._id);
    const product = await seedConfiguredProduct(restaurant._id, { attachTemplates: true, templates });

    const selection = {
      selections: [{ groupId: String(templates.size._id), optionIds: ['o_l'] }],
    };
    const { order } = await publicStoreOrderService.createOrder(token, {
      clientRef: 'ref-p4-hist',
      items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
    });
    // Large was +₹200 at order time → line price 399.
    const itemBefore = await OrderItem.findOne({ orderId: order._id }).lean().exec();
    expect((itemBefore as any).pricingSnapshot?.grossItemPrice).toBe(399);

    // Restaurant bumps Large to +₹300 (a NEW template version).
    templates.size.data.options.find((o: any) => o.id === 'o_l').priceDelta = 300;
    templates.size.version = 2;
    await templates.size.save();

    // The stored order line must keep +₹200 — never rewritten by today's menu.
    const itemAfter = await OrderItem.findOne({ orderId: order._id }).lean().exec();
    expect((itemAfter as any).pricingSnapshot?.grossItemPrice).toBe(399);
    expect((itemAfter as any).price).toBe(399);
    // And a NEW order after the change uses the new price.
    const fresh = await publicStoreOrderService.createOrder(token, {
      clientRef: 'ref-p4-hist2',
      items: [{ productId: String(product._id), quantity: 1, configuration: selection } as any],
    });
    expect(fresh.items[0].price).toBe(499);
  });
});

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../../modules/voice-inventory/services/AliasGeneratorService', () => ({
  generateAndApplyAliases: vi.fn().mockResolvedValue(undefined),
}));

import { productService } from '../index';
import Product from '../../models/Product';
import ProductVariant from '../../models/ProductVariant';

let mongod: MongoMemoryServer;

describe('ProductService', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Product.deleteMany({}).exec();
    await ProductVariant.deleteMany({}).exec();
  });

  it('skips malformed variant payloads when creating a product', async () => {
    const created = await productService.create({
      name: 'Coke',
      code: 'COKE',
      price: 120,
      category: 'Drinks',
      variants: [
        { name: '', price: 90 },
        { name: 'Large', price: 150 },
        { price: 140 },
      ],
    });

    expect(created.variants).toHaveLength(1);
    expect(created.variants[0]).toMatchObject({ name: 'Large', price: 150 });

    const persistedVariants = await ProductVariant.find({ productId: created._id }).lean();
    expect(persistedVariants).toHaveLength(1);
  });

  it('replaces variants on update while ignoring malformed replacements', async () => {
    const created = await productService.create({
      name: 'Burger',
      code: 'BURGER',
      price: 200,
      category: 'Food',
      variants: [{ name: 'Classic', price: 200 }],
    });

    const updated = await productService.update(created._id.toString(), {
      name: 'Burger',
      price: 220,
      variants: [{ name: 'Spicy', price: 230 }, { price: 240 }],
    });

    expect(updated?.variants).toHaveLength(1);
    expect(updated?.variants[0]).toMatchObject({ name: 'Spicy', price: 230 });

    const persistedVariants = await ProductVariant.find({ productId: created._id }).lean();
    expect(persistedVariants).toHaveLength(1);
  });
});

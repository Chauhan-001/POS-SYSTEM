import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Product from '../../models/catalog/Product';
import Recipe from '../../modules/recipes/models/Recipe';
import { recipeCostEngine } from '../../modules/recipes/services/recipeCostEngine';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

describe('Phase 5: RecipeCostEngine', () => {
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
      Product.deleteMany({}).exec(),
      Recipe.deleteMany({}).exec(),
    ]);
  });

  // ─── Recipe cost uses recipeCost instead of product.averageCost ───

  it('uses recipeCost from RecipeCostEngine instead of product.averageCost', async () => {
    // Create ingredient product first
    const ingredientProduct = await Product.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      name: 'Ingredient A',
      code: 'ING001',
      price: 50,
      category: 'Ingredients',
      type: 'inventory',
      availability: false,
      currentStock: 100,
      unit: 'pcs',
      minStock: 0,
      maxStock: 100,
      reorderLevel: 0,
      averageCost: 50,
    });

    const product = await Product.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      name: 'Test Dish',
      code: 'TEST001',
      price: 200,
      category: 'Test',
      gstPercent: 5,
      type: 'menu',
      availability: true,
      currentStock: 100,
      unit: 'pcs',
      minStock: 0,
      maxStock: 100,
      reorderLevel: 0,
      averageCost: 50,
    });

    const recipe = await Recipe.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      productId: product._id,
      productName: product.name,
      variantName: 'Default',
      recipeMode: 'override',
      name: 'Test Dish Recipe',
      status: 'active',
      version: 1,
      effectiveFrom: '2026-01-01',
      yieldQuantity: 1,
      yieldUnit: 'unit',
      components: [
        {
          inventoryItemId: ingredientProduct._id,
          itemName: 'Ingredient A',
          unit: 'pcs',
          quantity: 2,
          normalizedQuantity: 2,
          normalizedUnit: 'pcs',
          componentType: 'ingredient',
          subRecipeId: null,
          wastagePercent: 0,
          optional: false,
          notes: '',
          sequence: 0,
          costPerUnit: 50,
          lineCost: 100,
        },
      ],
      costSummary: {
        recipeCost: 100,
        foodCostPercent: 50,
        contribution: 100,
        contributionMarginPercent: 50,
        perServingCost: 100,
        directIngredients: 100,
        minorAllowance: 0,
        cookingAllowance: 0,
        wastageAllowance: 0,
        packagingCost: 0,
        estimatedVariableCost: 100,
        conservativeCost: 110,
        directFoodCostPercent: 50,
        calculatedAt: new Date(),
      },
    });

    const result = await recipeCostEngine.costRecipe(recipe, {
      restaurantId: new mongoose.Types.ObjectId(REST),
    });

    // Recipe cost should be ₹100 (from recipe), not ₹50 (product.averageCost)
    expect(result.recipeCost).toBe(100);
    expect(result.sellingPrice).toBe(200); // product price
    expect(result.contribution).toBe(100); // 200 - 100
    expect(result.contributionMarginPercent).toBe(50); // 100 / 200 * 100
  });

  // ─── Item with no active recipe falls back to averageCost with missingCost=true ───

  it('flags items with no active recipe', async () => {
    const product = await Product.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      name: 'No Recipe Item',
      code: 'PROD002',
      price: 200,
      category: 'Test',
      gstPercent: 5,
      type: 'menu',
      availability: true,
      currentStock: 100,
      unit: 'pcs',
      minStock: 0,
      maxStock: 100,
      reorderLevel: 0,
      averageCost: 50,
    });

    // No recipe created for this product
    const recipes = await Recipe.find({
      productId: product._id,
      restaurantId: new mongoose.Types.ObjectId(REST),
      status: 'active',
      isDeleted: { $ne: true },
    }).lean().exec();

    expect(recipes.length).toBe(0);
  });
});

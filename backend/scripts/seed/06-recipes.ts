/**
 * 06-recipes.ts — Creates recipes connecting menu items to inventory ingredients.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, oid } from './types';
import { daysAgo, pick } from './helpers';

export async function seedRecipes(db: Db, ctx: SeedContext, productsCtx: ProductSeedResult): Promise<void> {
  console.log('📖 Seeding recipes...');
  const rid = ctx.restaurantId;

  // Map inventory item names to IDs for recipe building
  const inv = productsCtx.productByName;

  const RECIPES: { menuName: string; ingredients: { invName: string; qty: number; unit: string }[] }[] = [
    { menuName: 'Paneer Kadhai', ingredients: [{ invName: 'Paneer', qty: 0.25, unit: 'kg' }, { invName: 'Onion', qty: 0.1, unit: 'kg' }, { invName: 'Tomato', qty: 0.1, unit: 'kg' }, { invName: 'Capsicum', qty: 0.08, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.03, unit: 'L' }, { invName: 'Spice Mix (Garam Masala)', qty: 0.005, unit: 'kg' }] },
    { menuName: 'Paneer Butter Masala', ingredients: [{ invName: 'Paneer', qty: 0.25, unit: 'kg' }, { invName: 'Butter', qty: 0.03, unit: 'kg' }, { invName: 'Cream', qty: 0.05, unit: 'L' }, { invName: 'Tomato', qty: 0.12, unit: 'kg' }, { invName: 'Cashew', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Shahi Paneer', ingredients: [{ invName: 'Paneer', qty: 0.25, unit: 'kg' }, { invName: 'Cream', qty: 0.05, unit: 'L' }, { invName: 'Cashew', qty: 0.015, unit: 'kg' }, { invName: 'Almond', qty: 0.005, unit: 'kg' }, { invName: 'Butter', qty: 0.02, unit: 'kg' }] },
    { menuName: 'Dal Makhani', ingredients: [{ invName: 'Butter', qty: 0.04, unit: 'kg' }, { invName: 'Cream', qty: 0.05, unit: 'L' }, { invName: 'Spice Mix (Garam Masala)', qty: 0.005, unit: 'kg' }, { invName: 'Tomato', qty: 0.08, unit: 'kg' }, { invName: 'Ginger', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Butter Chicken', ingredients: [{ invName: 'Butter', qty: 0.04, unit: 'kg' }, { invName: 'Cream', qty: 0.05, unit: 'L' }, { invName: 'Tomato', qty: 0.15, unit: 'kg' }, { invName: 'Cashew', qty: 0.01, unit: 'kg' }, { invName: 'Ginger', qty: 0.01, unit: 'kg' }, { invName: 'Garlic', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Butter Naan', ingredients: [{ invName: 'Maida (Refined Flour)', qty: 0.15, unit: 'kg' }, { invName: 'Butter', qty: 0.01, unit: 'kg' }, { invName: 'Milk', qty: 0.03, unit: 'L' }] },
    { menuName: 'Garlic Naan', ingredients: [{ invName: 'Maida (Refined Flour)', qty: 0.15, unit: 'kg' }, { invName: 'Garlic', qty: 0.015, unit: 'kg' }, { invName: 'Butter', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Veg Biryani', ingredients: [{ invName: 'Rice (Basmati)', qty: 0.2, unit: 'kg' }, { invName: 'Onion', qty: 0.08, unit: 'kg' }, { invName: 'Capsicum', qty: 0.05, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.02, unit: 'L' }, { invName: 'Spice Mix (Garam Masala)', qty: 0.005, unit: 'kg' }, { invName: 'Cumin (Jeera)', qty: 0.003, unit: 'kg' }] },
    { menuName: 'Chicken Biryani', ingredients: [{ invName: 'Rice (Basmati)', qty: 0.25, unit: 'kg' }, { invName: 'Onion', qty: 0.1, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.03, unit: 'L' }, { invName: 'Spice Mix (Garam Masala)', qty: 0.005, unit: 'kg' }, { invName: 'Ginger', qty: 0.01, unit: 'kg' }, { invName: 'Garlic', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Jeera Rice', ingredients: [{ invName: 'Rice (Basmati)', qty: 0.2, unit: 'kg' }, { invName: 'Cumin (Jeera)', qty: 0.005, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.01, unit: 'L' }] },
    { menuName: 'Fried Rice', ingredients: [{ invName: 'Rice (Basmati)', qty: 0.2, unit: 'kg' }, { invName: 'Capsicum', qty: 0.05, unit: 'kg' }, { invName: 'Onion', qty: 0.03, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.02, unit: 'L' }, { invName: 'Garlic', qty: 0.01, unit: 'kg' }] },
    { menuName: 'Veg Manchurian', ingredients: [{ invName: 'Maida (Refined Flour)', qty: 0.05, unit: 'kg' }, { invName: 'Onion', qty: 0.06, unit: 'kg' }, { invName: 'Capsicum', qty: 0.05, unit: 'kg' }, { invName: 'Ginger', qty: 0.01, unit: 'kg' }, { invName: 'Garlic', qty: 0.01, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.04, unit: 'L' }] },
    { menuName: 'Hakka Noodles', ingredients: [{ invName: 'Maida (Refined Flour)', qty: 0.15, unit: 'kg' }, { invName: 'Capsicum', qty: 0.05, unit: 'kg' }, { invName: 'Onion', qty: 0.03, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.02, unit: 'L' }, { invName: 'Garlic', qty: 0.008, unit: 'kg' }] },
    { menuName: 'Palak Paneer', ingredients: [{ invName: 'Paneer', qty: 0.2, unit: 'kg' }, { invName: 'Cream', qty: 0.03, unit: 'L' }, { invName: 'Ginger', qty: 0.005, unit: 'kg' }, { invName: 'Garlic', qty: 0.005, unit: 'kg' }] },
    { menuName: 'Cold Coffee', ingredients: [{ invName: 'Milk', qty: 0.25, unit: 'L' }, { invName: 'Cream', qty: 0.03, unit: 'L' }] },
    { menuName: 'Mango Lassi', ingredients: [{ invName: 'Milk', qty: 0.2, unit: 'L' }, { invName: 'Cream', qty: 0.02, unit: 'L' }] },
    { menuName: 'Masala Chai', ingredients: [{ invName: 'Milk', qty: 0.1, unit: 'L' }, { invName: 'Spice Mix (Garam Masala)', qty: 0.002, unit: 'kg' }, { invName: 'Ginger', qty: 0.003, unit: 'kg' }] },
    { menuName: 'Lunch Thali', ingredients: [{ invName: 'Rice (Basmati)', qty: 0.2, unit: 'kg' }, { invName: 'Paneer', qty: 0.15, unit: 'kg' }, { invName: 'Butter', qty: 0.02, unit: 'kg' }, { invName: 'Wheat Flour (Atta)', qty: 0.1, unit: 'kg' }, { invName: 'Cooking Oil', qty: 0.02, unit: 'L' }] },
  ];

  let count = 0;
  for (const recipe of RECIPES) {
    const menuId = productsCtx.productByName.get(recipe.menuName);
    if (!menuId) continue;

    const ingredients = recipe.ingredients
      .map(ing => {
        const invId = inv.get(ing.invName);
        if (!invId) return null;
        return {
          productId: invId,
          productName: ing.invName,
          quantity: ing.qty,
          unit: ing.unit,
          costPerUnit: 0, // will be computed from inventory
        };
      })
      .filter(Boolean);

    if (ingredients.length === 0) continue;

    await db.collection('recipes').insertOne({
      _id: oid(),
      restaurantId: rid,
      productId: menuId,
      productName: recipe.menuName,
      ingredients,
      totalCost: ingredients.reduce((sum: number, i: any) => sum + (i.costPerUnit || 0) * i.quantity, 0),
      servingSize: 1,
      isActive: true,
      isDeleted: false,
      createdAt: daysAgo(160),
      updatedAt: new Date(),
    });
    count++;
  }

  console.log(`   ✅ Recipes: ${count}`);
}

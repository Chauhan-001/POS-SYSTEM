/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TestDatasets — Realistic and edge-case restaurant datasets for testing.
 *
 * Restaurant A: High-volume QSR
 * Restaurant B: Small cafe
 * Restaurant C: Family restaurant
 * Restaurant D: Highly seasonal restaurant
 * Restaurant E: New restaurant with insufficient data
 */

import mongoose from 'mongoose';

/**
 * Realistic restaurant datasets
 */
export const RESTAURANT_DATASETS = {
  restaurantA: {
    name: 'Restaurant A - High-Volume QSR',
    type: 'quick_service',
    dailyBills: 200,
    dailyOrders: 180,
    monthlyRevenue: 500000,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 120, recipeCost: 40, unit: 'piece', gstPercent: 5, isNew: false },
      { id: 'p2', name: 'Fries', category: 'sides', price: 60, recipeCost: 20, unit: 'small', gstPercent: 5, isNew: false },
      { id: 'p3', name: 'Chai', category: 'beverages', price: 20, recipeCost: 5, unit: 'cup', gstPercent: 0, isNew: false },
      { id: 'p4', name: 'Samosa', category: 'snacks', price: 40, recipeCost: 15, unit: 'piece', gstPercent: 5, isNew: false },
      { id: 'p5', name: 'Cold Drink', category: 'beverages', price: 45, recipeCost: 15, unit: 'bottle', gstPercent: 0, isNew: false },
    ],
    customers: 5000,
    monthlyNewCustomers: 300,
    dormant30d: 800,
    activeCustomers: 2000,
    vipCount: 200,
    weeklyBills: [
      { day: 1, bills: 180, revenue: 45000 },
      { day: 2, bills: 190, revenue: 48000 },
      { day: 3, bills: 200, revenue: 50000 },
      { day: 4, bills: 195, revenue: 49000 },
      { day: 5, bills: 210, revenue: 52000 },
      { day: 6, bills: 250, revenue: 60000 }, // Saturday high
      { day: 7, bills: 220, revenue: 55000 }, // Sunday medium
    ],
    inventory: [
      { id: 'p1', name: 'Burger', currentStock: 50, minStock: 20, maxStock: 100, unit: 'piece' },
      { id: 'p2', name: 'Fries', currentStock: 100, minStock: 30, maxStock: 200, unit: 'small' },
      { id: 'p3', name: 'Chai', currentStock: 200, minStock: 50, maxStock: 500, unit: 'cup' },
      { id: 'p4', name: 'Samosa', currentStock: 30, minStock: 10, maxStock: 100, unit: 'piece' },
      { id: 'p5', name: 'Cold Drink', currentStock: 150, minStock: 20, maxStock: 300, unit: 'bottle' },
    ],
    // This product has no recipe - testing LOW_DATA_CONFIDENCE
    specialProduct: { id: 'p6', name: 'Mystery Platter', category: 'specials', price: 200, recipeCost: undefined, isNew: true },
  },

  restaurantB: {
    name: 'Restaurant B - Small Cafe',
    type: 'cafe',
    dailyBills: 40,
    dailyOrders: 35,
    monthlyRevenue: 80000,
    products: [
      { id: 'p1', name: 'Espresso', category: 'beverages', price: 50, recipeCost: 15, unit: 'shot', gstPercent: 0, isNew: false },
      { id: 'p2', name: 'Croissant', category: 'food', price: 80, recipeCost: 25, unit: 'piece', gstPercent: 0, isNew: false },
      { id: 'p3', name: 'Latte', category: 'beverages', price: 100, recipeCost: 30, unit: 'cup', gstPercent: 0, isNew: false },
      { id: 'p4', name: 'Muffin', category: 'food', price: 60, recipeCost: 20, unit: 'piece', gstPercent: 0, isNew: false },
    ],
    customers: 800,
    monthlyNewCustomers: 20,
    dormant30d: 50,
    activeCustomers: 150,
    vipCount: 10,
    weeklyBills: [
      { day: 1, bills: 38, revenue: 8500 },
      { day: 2, bills: 42, revenue: 9200 },
      { day: 3, bills: 35, revenue: 7800 },
      { day: 4, bills: 40, revenue: 9000 },
      { day: 5, bills: 50, revenue: 11000 }, // Friday high
      { day: 6, bills: 30, revenue: 6500 }, // Saturday low
      { day: 7, bills: 32, revenue: 7000 }, // Sunday low
    ],
    inventory: [
      { id: 'p1', name: 'Espresso', currentStock: 10, minStock: 5, maxStock: 50, unit: 'shots' },
      { id: 'p2', name: 'Croissant', currentStock: 20, minStock: 5, maxStock: 50, unit: 'piece' },
      { id: 'p3', name: 'Latte', currentStock: 50, minStock: 10, maxStock: 100, unit: 'cups' },
      { id: 'p4', name: 'Muffin', currentStock: 15, minStock: 5, maxStock: 50, unit: 'piece' },
    ],
    // Product with incomplete recipe (no ingredients list)
    specialProduct: { id: 'p5', name: 'Special Cake', category: 'desserts', price: 150, recipeCost: 50, ingredients: [], isNew: true },
  },

  restaurantC: {
    name: 'Restaurant C - Family Restaurant',
    type: 'family',
    dailyBills: 80,
    dailyOrders: 70,
    monthlyRevenue: 300000,
    products: [
      { id: 'p1', name: 'Chicken Curry', category: 'mains', price: 250, recipeCost: 100, unit: 'plate', gstPercent: 12, isNew: false },
      { id: 'p2', name: 'Rice', category: 'sides', price: 80, recipeCost: 25, unit: 'plate', gstPercent: 12, isNew: false },
      { id: 'p3', name: 'Naan', category: 'sides', price: 50, recipeCost: 15, unit: 'piece', gstPercent: 12, isNew: false },
      { id: 'p4', name: 'Gulab Jamun', category: 'desserts', price: 100, recipeCost: 40, unit: 'piece', gstPercent: 12, isNew: false },
      { id: 'p5', name: 'Mineral Water', category: 'beverages', price: 30, recipeCost: 10, unit: 'bottle', gstPercent: 0, isNew: false },
    ],
    customers: 3000,
    monthlyNewCustomers: 50,
    dormant30d: 200,
    activeCustomers: 800,
    vipCount: 50,
    weeklyBills: [
      { day: 1, bills: 75, revenue: 18000 },
      { day: 2, bills: 82, revenue: 20000 },
      { day: 3, bills: 78, revenue: 19000 },
      { day: 4, bills: 85, revenue: 21000 },
      { day: 5, bills: 100, revenue: 25000 }, // Friday high
      { day: 6, bills: 90, revenue: 22000 }, // Saturday
      { day: 7, bills: 88, revenue: 21500 }, // Sunday
    ],
    inventory: [
      { id: 'p1', name: 'Chicken Curry', currentStock: 30, minStock: 10, maxStock: 80, unit: 'plates' },
      { id: 'p2', name: 'Rice', currentStock: 100, minStock: 20, maxStock: 200, unit: 'plates' },
      { id: 'p3', name: 'Naan', currentStock: 40, minStock: 10, maxStock: 80, unit: 'pieces' },
      { id: 'p3', name: 'Gulab Jamun', currentStock: 25, minStock: 5, maxStock: 50, unit: 'pieces' },
      { id: 'p5', name: 'Mineral Water', currentStock: 60, minStock: 10, maxStock: 150, unit: 'bottles' },
    ],
    // Product with variant (testing variant awareness)
    variants: [
      { id: 'p1a', name: 'Chicken Curry - Regular', price: 250, recipeCost: 100, isNew: false },
      { id: 'p1b', name: 'Chicken Curry - Large', price: 300, recipeCost: 120, isNew: false },
    ],
    // Product with no recipe - testing LOW_DATA_CONFIDENCE
    specialProduct: { id: 'p6', name: 'Chef Special', category: 'mains', price: 350, recipeCost: undefined, isNew: true },
  },

  restaurantD: {
    name: 'Restaurant D - Highly Seasonal',
    type: 'seasonal',
    dailyBills: 60,
    dailyOrders: 50,
    monthlyRevenue: 150000,
    products: [
      { id: 'p1', name: 'Mango Lassi', category: 'beverages', price: 100, recipeCost: 30, unit: 'glass', gstPercent: 0, isNew: false },
      { id: 'p2', name: 'Pakora', category: 'snacks', price: 60, recipeCost: 20, unit: 'piece', gstPercent: 0, isNew: false },
      { id: 'p3', name: 'Fresh Juice', category: 'beverages', price: 80, recipeCost: 25, unit: 'glass', gstPercent: 0, isNew: false },
      { id: 'p4', name: 'Ice Cream', category: 'desserts', price: 120, recipeCost: 40, unit: ' scoop', gstPercent: 0, isNew: false },
    ],
    customers: 1500,
    monthlyNewCustomers: 100,
    dormant30d: 100,
    activeCustomers: 600,
    vipCount: 30,
    weeklyBills: [
      { day: 1, bills: 50, revenue: 12000 }, // Day 1
      { day: 2, bills: 55, revenue: 13000 },
      { day: 3, bills: 60, revenue: 14000 },
      { day: 4, bills: 65, revenue: 15000 },
      { day: 5, bills: 80, revenue: 20000 }, // Weekend spike
      { day: 6, bills: 90, revenue: 25000 }, // Weekend peak
      { day: 7, bills: 70, revenue: 16000 }, // Sunday decline
    ],
    inventory: [
      { id: 'p1', name: 'Mango Lassi', currentStock: 30, minStock: 10, maxStock: 80, unit: 'glasses' },
      { id: 'p2', name: 'Pakora', currentStock: 50, minStock: 10, maxStock: 100, unit: 'pieces' },
      { id: 'p3', name: 'Fresh Juice', currentStock: 40, minStock: 10, maxStock: 80, unit: 'glasses' },
      { id: 'p4', name: 'Ice Cream', currentStock: 20, minStock: 5, maxStock: 50, unit: 'scoops' },
    ],
    // Seasonal product (mango-based - only good during mango season)
    seasonalProduct: { id: 'p5', name: 'Mango Smoothie', category: 'beverages', price: 150, recipeCost: 50, isNew: false, seasonal: 'mango_season' },
    // Off-season product that should NOT be promoted
    offSeasonProduct: { id: 'p6', name: 'Chestnut Soup', category: 'soups', price: 100, recipeCost: 40, isNew: false, seasonal: 'winter_only' },
  },

  restaurantE: {
    name: 'Restaurant E - New Restaurant (Insufficient Data)',
    type: 'new',
    dailyBills: 5,
    dailyOrders: 5,
    monthlyRevenue: 5000,
    products: [
      { id: 'p1', name: 'House Burger', category: 'mains', price: 150, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: true },
      { id: 'p2', name: 'House Soft Drink', category: 'beverages', price: 50, recipeCost: 15, unit: 'glass', gstPercent: 0, isNew: true },
    ],
    customers: 50,
    monthlyNewCustomers: 10,
    dormant30d: 5,
    activeCustomers: 10,
    vipCount: 0,
    weeklyBills: [
      { day: 1, bills: 3, revenue: 500 },
      { day: 2, bills: 4, revenue: 600 },
    ],
    inventory: [
      { id: 'p1', name: 'House Burger', currentStock: 10, minStock: 5, maxStock: 50, unit: 'piece' },
      { id: 'p2', name: 'House Soft Drink', currentStock: 20, minStock: 5, maxStock: 50, unit: 'glass' },
    ],
    // No historical data - should get "Limited intelligence"
    note: 'Insufficient data - system should gracefully degrade to basic recommendations',
  },
};

/**
 * Edge case datasets
 */
export const EDGE_CASE_DATASETS = {
  no_sales: {
    name: 'No Sales - Brand New',
    dailyBills: 0,
    dailyOrders: 0,
    monthlyRevenue: 0,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 100, recipeCost: 40, unit: 'piece', gstPercent: 5, isNew: true },
    ],
    customers: 0,
    note: 'No bills in system - should return "Limited intelligence"',
  },

  very_low_sales: {
    name: 'Very Low Sales',
    dailyBills: 3,
    dailyOrders: 3,
    monthlyRevenue: 300,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 100, recipeCost: 40, unit: 'piece', gstPercent: 5, isNew: true },
    ],
    customers: 10,
    note: 'Only 3 bills - insufficient data for full intelligence',
  },

  sudden_spike: {
    name: 'Sudden Sales Spike',
    dailyBills: 50,
    dailyOrders: 45,
    monthlyRevenue: 100000,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 150, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 2000,
    note: 'Recent sales spike - trend detection should flag this',
  },

  product_discontinued: {
    name: 'Product Discontinued',
    dailyBills: 30,
    dailyOrders: 28,
    monthlyRevenue: 25000,
    products: [
      { id: 'p1', name: 'Discontinued Burger', category: 'mains', price: 0, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false, isActive: false },
    ],
    customers: 500,
    note: 'Product marked inactive - recommendations should not feature discontinued item',
  },

  recipe_missing: {
    name: 'Missing Recipe',
    dailyBills: 30,
    dailyOrders: 28,
    monthlyRevenue: 20000,
    products: [
      { id: 'p1', name: 'No-Recipe Item', category: 'mains', price: 100, recipeCost: undefined, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 300,
    note: 'No recipe cost - contribution-based recommendations should be limited',
  },

  negative_stock: {
    name: 'Negative Stock Edge Case',
    dailyBills: 10,
    dailyOrders: 8,
    monthlyRevenue: 5000,
    products: [
      { id: 'p1', name: 'Item', category: 'mains', price: 100, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 100,
    note: 'Test edge case - inventory handling',
  },

  price_changed: {
    name: 'Price Changed',
    dailyBills: 30,
    dailyOrders: 28,
    monthlyRevenue: 20000,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 150, recipeCost: 50, gstPercent: 5, isNew: false, priceChanged: true, previousPrice: 120 },
    ],
    customers: 300,
    note: 'Price change detected - margins should be recalculated',
  },

  new_product: {
    name: 'New Product',
    dailyBills: 20,
    dailyOrders: 18,
    monthlyRevenue: 15000,
    products: [
      { id: 'p1', name: 'New Item', category: 'mains', price: 200, recipeCost: 60, unit: 'piece', gstPercent: 5, isNew: true },
      { id: 'p2', name: 'Existing Item', category: 'mains', price: 150, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 200,
    note: 'New product launch - should gradually unlock advanced intelligence',
  },

  promotion_abuse: {
    name: 'Promotion Abuse',
    dailyBills: 30,
    dailyOrders: 28,
    monthlyRevenue: 20000,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 150, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 300,
    note: 'Test promotion abuse detection - frequent redeemer tracking',
  },

  offline_sync_conflict: {
    name: 'Offline Sync Conflict',
    dailyBills: 20,
    dailyOrders: 18,
    monthlyRevenue: 15000,
    products: [
      { id: 'p1', name: 'Burger', category: 'mains', price: 150, recipeCost: 50, unit: 'piece', gstPercent: 5, isNew: false },
    ],
    customers: 200,
    note: 'Test offline mode sync conflict resolution',
  },
};
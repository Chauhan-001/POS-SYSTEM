import type {
  InventoryItem, Purchase, StockAdjustment, WasteEntry,
  Supplier, ExpiryItem, TimelineEntry, InventoryAlert, InventorySettings
} from './types';

export const INVENTORY_ITEMS: InventoryItem[] = [
  { id: 'inv_001', name: 'Milk', category: 'Dairy', image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&q=80', currentStock: 45, unit: 'L', minStock: 20, maxStock: 100, averageCost: 56, supplier: 'Amul Dairy', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_002', name: 'Tea Powder', category: 'Beverages', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&q=80', currentStock: 3, unit: 'kg', minStock: 5, maxStock: 25, averageCost: 340, supplier: 'Tata Consumer', status: 'low', lastUpdated: '2026-07-23' },
  { id: 'inv_003', name: 'Bread', category: 'Bakery', image: 'https://images.unsplash.com/photo-1549931319-a545753467c9?w=200&q=80', currentStock: 2, unit: 'pcs', minStock: 10, maxStock: 50, averageCost: 35, supplier: 'Modern Bakery', status: 'critical', lastUpdated: '2026-07-23' },
  { id: 'inv_004', name: 'Potato', category: 'Vegetables', image: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=200&q=80', currentStock: 85, unit: 'kg', minStock: 20, maxStock: 150, averageCost: 28, supplier: 'Local Vendor', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_005', name: 'Cooking Oil', category: 'Cooking Essentials', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=200&q=80', currentStock: 18, unit: 'L', minStock: 10, maxStock: 50, averageCost: 195, supplier: 'Fortune Oil', status: 'normal', lastUpdated: '2026-07-23' },
  { id: 'inv_006', name: 'Sugar', category: 'Cooking Essentials', image: 'https://images.unsplash.com/photo-1586201375761-83865001e8ac?w=200&q=80', currentStock: 12, unit: 'kg', minStock: 10, maxStock: 40, averageCost: 42, supplier: 'Local Vendor', status: 'normal', lastUpdated: '2026-07-23' },
  { id: 'inv_007', name: 'Lemon', category: 'Vegetables', image: 'https://images.unsplash.com/photo-1590502593387-59b1726c8f8f?w=200&q=80', currentStock: 8, unit: 'pcs', minStock: 20, maxStock: 100, averageCost: 5, supplier: 'Local Vendor', status: 'low', lastUpdated: '2026-07-23' },
  { id: 'inv_008', name: 'Tomato', category: 'Vegetables', image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200&q=80', currentStock: 22, unit: 'kg', minStock: 10, maxStock: 60, averageCost: 35, supplier: 'Local Vendor', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_009', name: 'Onion', category: 'Vegetables', image: 'https://images.unsplash.com/photo-1508747703725-719d63ab9a74?w=200&q=80', currentStock: 30, unit: 'kg', minStock: 15, maxStock: 80, averageCost: 32, supplier: 'Local Vendor', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_010', name: 'Flour (Atta)', category: 'Cooking Essentials', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&q=80', currentStock: 25, unit: 'kg', minStock: 10, maxStock: 50, averageCost: 32, supplier: 'Ashirwad', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_011', name: 'Rice', category: 'Cooking Essentials', image: 'https://images.unsplash.com/photo-1586201375761-83865001e8ac?w=200&q=80', currentStock: 40, unit: 'kg', minStock: 15, maxStock: 80, averageCost: 55, supplier: 'Local Vendor', status: 'healthy', lastUpdated: '2026-07-23' },
  { id: 'inv_012', name: 'Butter', category: 'Dairy', image: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=200&q=80', currentStock: 5, unit: 'kg', minStock: 5, maxStock: 20, averageCost: 260, supplier: 'Amul Dairy', status: 'normal', lastUpdated: '2026-07-23' },
  { id: 'inv_013', name: 'Cheese', category: 'Dairy', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&q=80', currentStock: 4, unit: 'kg', minStock: 3, maxStock: 15, averageCost: 420, supplier: 'Amul Dairy', status: 'normal', lastUpdated: '2026-07-23' },
  { id: 'inv_014', name: 'Paneer', category: 'Dairy', image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=200&q=80', currentStock: 6, unit: 'kg', minStock: 5, maxStock: 20, averageCost: 320, supplier: 'Amul Dairy', status: 'normal', lastUpdated: '2026-07-23' },
  { id: 'inv_015', name: 'Chicken', category: 'Meat', image: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=200&q=80', currentStock: 15, unit: 'kg', minStock: 10, maxStock: 40, averageCost: 220, supplier: 'Poultry Farm', status: 'healthy', lastUpdated: '2026-07-23' },
];

export const PURCHASES: Purchase[] = [
  { id: 'pur_001', supplier: 'Amul Dairy', item: 'Milk', quantity: 20, unit: 'L', price: 56, total: 1120, date: '2026-07-23 08:30 AM', status: 'completed' },
  { id: 'pur_002', supplier: 'Tata Consumer', item: 'Tea Powder', quantity: 5, unit: 'kg', price: 340, total: 1700, date: '2026-07-22 10:15 AM', status: 'completed' },
  { id: 'pur_003', supplier: 'Modern Bakery', item: 'Bread', quantity: 25, unit: 'pcs', price: 35, total: 875, date: '2026-07-23 07:00 AM', status: 'completed' },
  { id: 'pur_004', supplier: 'Local Vendor', item: 'Potato', quantity: 50, unit: 'kg', price: 28, total: 1400, date: '2026-07-22 06:45 AM', status: 'completed' },
  { id: 'pur_005', supplier: 'Fortune Oil', item: 'Cooking Oil', quantity: 15, unit: 'L', price: 195, total: 2925, date: '2026-07-21 11:20 AM', status: 'completed' },
  { id: 'pur_006', supplier: 'Local Vendor', item: 'Sugar', quantity: 10, unit: 'kg', price: 42, total: 420, date: '2026-07-23 09:00 AM', status: 'completed' },
  { id: 'pur_007', supplier: 'Local Vendor', item: 'Lemon', quantity: 100, unit: 'pcs', price: 5, total: 500, date: '2026-07-22 07:30 AM', status: 'completed' },
];

export const STOCK_ADJUSTMENTS: StockAdjustment[] = [
  { id: 'adj_001', item: 'Cooking Oil', quantity: -2, reason: 'staff_consumption', notes: 'Staff meal preparation', date: '2026-07-23 02:30 PM' },
  { id: 'adj_002', item: 'Milk', quantity: -1, reason: 'damaged', notes: 'Container leak', date: '2026-07-22 09:15 AM' },
  { id: 'adj_003', item: 'Bread', quantity: -5, reason: 'correction', notes: 'Inventory count correction', date: '2026-07-21 06:00 PM' },
  { id: 'adj_004', item: 'Tomato', quantity: 3, reason: 'returned', notes: 'Extra from supplier', date: '2026-07-23 08:00 AM' },
];

export const WASTE_ENTRIES: WasteEntry[] = [
  { id: 'wst_001', item: 'Bread', quantity: 3, unit: 'pcs', reason: 'expired', cost: 105, date: '2026-07-23' },
  { id: 'wst_002', item: 'Milk', quantity: 2, unit: 'L', reason: 'spoiled', cost: 112, date: '2026-07-22' },
  { id: 'wst_003', item: 'Tomato', quantity: 1.5, unit: 'kg', reason: 'spoiled', cost: 53, date: '2026-07-22' },
  { id: 'wst_004', item: 'Cooking Oil', quantity: 0.5, unit: 'L', reason: 'dropped', cost: 98, date: '2026-07-21' },
  { id: 'wst_005', item: 'Bread', quantity: 2, unit: 'pcs', reason: 'burnt', cost: 70, date: '2026-07-21' },
  { id: 'wst_006', item: 'Onion', quantity: 2, unit: 'kg', reason: 'spoiled', cost: 64, date: '2026-07-20' },
  { id: 'wst_007', item: 'Chicken', quantity: 0.5, unit: 'kg', reason: 'expired', cost: 110, date: '2026-07-19' },
];

export const SUPPLIERS: Supplier[] = [
  { id: 'sup_001', name: 'Amul Dairy', phone: '+91 98765 43210', email: 'orders@amuldairy.com', address: 'Anand, Gujarat', items: ['Milk', 'Butter', 'Cheese', 'Paneer'], lastPurchase: '2026-07-23', averageCost: 264, status: 'active', totalPurchases: 48 },
  { id: 'sup_002', name: 'Tata Consumer', phone: '+91 87654 32109', email: 'b2b@tataconsumer.com', address: 'Mumbai, Maharashtra', items: ['Tea Powder', 'Coffee', 'Salt'], lastPurchase: '2026-07-22', averageCost: 340, status: 'active', totalPurchases: 22 },
  { id: 'sup_003', name: 'Modern Bakery', phone: '+91 76543 21098', email: 'info@modernbakery.in', address: 'Pune, Maharashtra', items: ['Bread', 'Buns', 'Pav'], lastPurchase: '2026-07-23', averageCost: 35, status: 'active', totalPurchases: 35 },
  { id: 'sup_004', name: 'Local Vendor', phone: '+91 65432 10987', email: '', address: 'Local Market', items: ['Potato', 'Onion', 'Tomato', 'Lemon', 'Sugar', 'Rice'], lastPurchase: '2026-07-23', averageCost: 33, status: 'active', totalPurchases: 120 },
  { id: 'sup_005', name: 'Fortune Oil', phone: '+91 54321 09876', email: 'sales@fortunoil.com', address: 'Delhi', items: ['Cooking Oil'], lastPurchase: '2026-07-21', averageCost: 195, status: 'active', totalPurchases: 15 },
  { id: 'sup_006', name: 'Poultry Farm', phone: '+91 43210 98765', email: 'order@poultryfarm.in', address: 'Nashik, Maharashtra', items: ['Chicken'], lastPurchase: '2026-07-20', averageCost: 220, status: 'active', totalPurchases: 28 },
  { id: 'sup_007', name: 'Ashirwad', phone: '+91 32109 87654', email: 'b2b@ashirwad.com', address: 'Punjab', items: ['Flour (Atta)'], lastPurchase: '2026-07-18', averageCost: 32, status: 'inactive', totalPurchases: 10 },
];

export const EXPIRY_ITEMS: ExpiryItem[] = [
  { id: 'exp_001', item: 'Milk', batchNumber: 'B-2026-07-20', quantity: 10, unit: 'L', expiryDate: '2026-07-24', daysRemaining: 1, suggestedAction: 'use_immediately' },
  { id: 'exp_002', item: 'Bread', batchNumber: 'B-2026-07-22', quantity: 8, unit: 'pcs', expiryDate: '2026-07-25', daysRemaining: 2, suggestedAction: 'sale' },
  { id: 'exp_003', item: 'Butter', batchNumber: 'B-2026-07-15', quantity: 2, unit: 'kg', expiryDate: '2026-07-28', daysRemaining: 5, suggestedAction: 'use_immediately' },
  { id: 'exp_004', item: 'Chicken', batchNumber: 'B-2026-07-20', quantity: 3, unit: 'kg', expiryDate: '2026-07-26', daysRemaining: 3, suggestedAction: 'use_immediately' },
  { id: 'exp_005', item: 'Paneer', batchNumber: 'B-2026-07-18', quantity: 2, unit: 'kg', expiryDate: '2026-07-27', daysRemaining: 4, suggestedAction: 'sale' },
  { id: 'exp_006', item: 'Cheese', batchNumber: 'B-2026-07-10', quantity: 1, unit: 'kg', expiryDate: '2026-07-22', daysRemaining: -1, suggestedAction: 'discard' },
  { id: 'exp_007', item: 'Milk', batchNumber: 'B-2026-07-22', quantity: 5, unit: 'L', expiryDate: '2026-07-26', daysRemaining: 3, suggestedAction: 'use_immediately' },
];

export const TIMELINE_ENTRIES: TimelineEntry[] = [
  { id: 'tl_001', type: 'purchased', item: 'Milk', quantity: 20, unit: 'L', timestamp: '2026-07-23 08:30 AM', operator: 'Ravi Singh', details: 'Purchase from Amul Dairy' },
  { id: 'tl_002', type: 'sold', item: 'Chai', quantity: 45, unit: 'cups', timestamp: '2026-07-23 10:00 AM', operator: 'System', details: 'Sales consumption' },
  { id: 'tl_003', type: 'adjusted', item: 'Cooking Oil', quantity: -2, unit: 'L', timestamp: '2026-07-23 02:30 PM', operator: 'Ravi Singh', details: 'Staff consumption adjustment' },
  { id: 'tl_004', type: 'purchased', item: 'Bread', quantity: 25, unit: 'pcs', timestamp: '2026-07-23 07:00 AM', operator: 'Ravi Singh', details: 'Purchase from Modern Bakery' },
  { id: 'tl_005', type: 'waste', item: 'Bread', quantity: 3, unit: 'pcs', timestamp: '2026-07-23 06:00 PM', operator: 'Ravi Singh', details: 'Expired bread discarded' },
  { id: 'tl_006', type: 'closing', item: 'Milk', quantity: 12, unit: 'L', timestamp: '2026-07-22 11:00 PM', operator: 'Priya Sharma', details: 'Closing stock count' },
  { id: 'tl_007', type: 'purchased', item: 'Sugar', quantity: 10, unit: 'kg', timestamp: '2026-07-23 09:00 AM', operator: 'Ravi Singh', details: 'Purchase from Local Vendor' },
  { id: 'tl_008', type: 'sold', item: 'Tea', quantity: 60, unit: 'cups', timestamp: '2026-07-23 11:00 AM', operator: 'System', details: 'Sales consumption' },
];

export const INVENTORY_ALERTS: InventoryAlert[] = [
  { id: 'al_001', type: 'low_stock', item: 'Tea Powder', message: 'Tea Powder stock is low (3 kg). Minimum threshold is 5 kg.', severity: 'warning', timestamp: '2026-07-23 10:00 AM' },
  { id: 'al_002', type: 'low_stock', item: 'Bread', message: 'Bread stock is critical (2 pcs). Minimum threshold is 10 pcs.', severity: 'critical', timestamp: '2026-07-23 09:00 AM' },
  { id: 'al_003', type: 'expiry', item: 'Milk', message: '10 L of Milk expires tomorrow (2026-07-24).', severity: 'warning', timestamp: '2026-07-23 08:00 AM' },
  { id: 'al_004', type: 'purchase_reminder', item: 'Tea Powder', message: 'Time to reorder Tea Powder. Last purchase was 2 days ago.', severity: 'info', timestamp: '2026-07-23 07:00 AM' },
  { id: 'al_005', type: 'unusual_consumption', item: 'Cooking Oil', message: 'Cooking Oil usage is 30% higher than usual this week.', severity: 'info', timestamp: '2026-07-22 06:00 PM' },
  { id: 'al_006', type: 'low_stock', item: 'Lemon', message: 'Lemon stock is low (8 pcs). Minimum threshold is 20 pcs.', severity: 'warning', timestamp: '2026-07-23 11:00 AM' },
];

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  lowStockThreshold: 10,
  defaultSupplier: 'Local Vendor',
  enableVoiceEntry: false,
  enableNotifications: true,
  units: ['kg', 'L', 'pcs', 'g', 'mL', 'dozen', 'packet', 'bottle'],
  currency: '₹',
};

export const HEALTH_CHECKLIST = [
  { item: 'Milk', status: 'healthy' as const },
  { item: 'Oil', status: 'healthy' as const },
  { item: 'Lemon', status: 'low' as const },
  { item: 'Bread', status: 'critical' as const },
  { item: 'Tea', status: 'healthy' as const },
];

export const PURCHASE_RECOMMENDATIONS = [
  { item: 'Milk', quantity: '20L', priority: 'high' as const },
  { item: 'Lemon', quantity: '150', priority: 'medium' as const },
  { item: 'Sugar', quantity: '5kg', priority: 'medium' as const },
  { item: 'Bread', quantity: '25 pcs', priority: 'high' as const },
  { item: 'Tea Powder', quantity: '5kg', priority: 'high' as const },
];

export const STATUS_ITEMS = [
  { name: 'Milk', status: 'healthy' as const },
  { name: 'Tea Powder', status: 'low' as const },
  { name: 'Bread', status: 'critical' as const },
  { name: 'Potato', status: 'healthy' as const },
  { name: 'Oil', status: 'normal' as const },
];

export const CATEGORIES = [
  'All', 'Dairy', 'Vegetables', 'Cooking Essentials', 'Bakery', 'Beverages', 'Meat'
];

// Chart data
export const INVENTORY_VALUE_DATA = [
  { name: 'Mon', value: 18500 },
  { name: 'Tue', value: 19200 },
  { name: 'Wed', value: 17800 },
  { name: 'Thu', value: 16400 },
  { name: 'Fri', value: 17100 },
  { name: 'Sat', value: 18800 },
  { name: 'Sun', value: 18300 },
];

export const CONSUMPTION_TREND_DATA = [
  { name: 'Mon', milk: 15, tea: 2.5, oil: 3 },
  { name: 'Tue', milk: 18, tea: 3, oil: 3.5 },
  { name: 'Wed', milk: 12, tea: 2, oil: 2.5 },
  { name: 'Thu', milk: 20, tea: 3.5, oil: 4 },
  { name: 'Fri', milk: 22, tea: 4, oil: 4.5 },
  { name: 'Sat', milk: 28, tea: 5, oil: 5 },
  { name: 'Sun', milk: 25, tea: 4.5, oil: 4 },
];

export const PURCHASE_TREND_DATA = [
  { name: 'Week 1', value: 12500 },
  { name: 'Week 2', value: 14800 },
  { name: 'Week 3', value: 11200 },
  { name: 'Week 4', value: 13500 },
];

export const WASTE_TREND_DATA = [
  { name: 'Mon', waste: 450 },
  { name: 'Tue', waste: 380 },
  { name: 'Wed', waste: 520 },
  { name: 'Thu', waste: 290 },
  { name: 'Fri', waste: 610 },
  { name: 'Sat', waste: 750 },
  { name: 'Sun', waste: 580 },
];

export const CATEGORY_DISTRIBUTION_DATA = [
  { name: 'Dairy', value: 35 },
  { name: 'Vegetables', value: 25 },
  { name: 'Essentials', value: 20 },
  { name: 'Bakery', value: 10 },
  { name: 'Beverages', value: 5 },
  { name: 'Meat', value: 5 },
];

export const FAST_MOVING_ITEMS = [
  { name: 'Milk', sold: 120, revenue: 6720 },
  { name: 'Tea Powder', sold: 8, revenue: 2720 },
  { name: 'Bread', sold: 60, revenue: 2100 },
  { name: 'Oil', sold: 15, revenue: 2925 },
  { name: 'Sugar', sold: 18, revenue: 756 },
];

export const SLOW_MOVING_ITEMS = [
  { name: 'Paneer', sold: 3, revenue: 960 },
  { name: 'Cheese', sold: 2, revenue: 840 },
  { name: 'Butter', sold: 4, revenue: 1040 },
];

export const CATEGORY_VALUE_DATA = [
  { name: 'Dairy', value: 8500 },
  { name: 'Vegetables', value: 4200 },
  { name: 'Essentials', value: 3800 },
  { name: 'Bakery', value: 1200 },
  { name: 'Meat', value: 3300 },
  { name: 'Beverages', value: 1700 },
];

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  image: string;
  currentStock: number;
  unit: string;
  minStock: number;
  maxStock: number;
  averageCost: number;
  supplier: string;
  status: 'healthy' | 'normal' | 'low' | 'critical';
  expiryDate?: string;
  batchNumber?: string;
  lastUpdated: string;
}

export interface Purchase {
  id: string;
  supplier: string;
  /** Brand/variant of the item (e.g. "Amul") — only present when one was named. */
  brand?: string;
  /** Expiry date of this batch (YYYY-MM-DD) — only when one was mentioned. */
  expiryDate?: string;
  item: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
  invoiceUrl?: string;
  date: string;
  status: 'completed' | 'pending' | 'cancelled';
}

export interface StockAdjustment {
  id: string;
  item: string;
  quantity: number;
  reason: 'damaged' | 'staff_consumption' | 'returned' | 'correction' | 'sample';
  notes: string;
  date: string;
}

export interface WasteEntry {
  id: string;
  item: string;
  quantity: number;
  unit: string;
  reason: 'spoiled' | 'burnt' | 'expired' | 'dropped' | 'other';
  cost: number;
  date: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  items: string[];
  lastPurchase: string;
  averageCost: number;
  status: 'active' | 'inactive';
  totalPurchases: number;
}

export interface ExpiryItem {
  id: string;
  item: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  expiryDate: string;
  daysRemaining: number;
  suggestedAction: 'use_immediately' | 'donate' | 'discard' | 'sale';
}

export interface TimelineEntry {
  id: string;
  type: 'purchased' | 'sold' | 'adjusted' | 'waste' | 'closing' | 'purchase' | 'return';
  item: string;
  quantity: number;
  unit: string;
  timestamp: string;
  operator: string;
  details: string;
}

export interface InventoryAlert {
  id: string;
  type: 'low_stock' | 'expiry' | 'purchase_reminder' | 'unusual_consumption';
  item: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

export interface InventorySettings {
  lowStockThreshold: number;
  defaultSupplier: string;
  enableVoiceEntry: boolean;
  enableNotifications: boolean;
  units: string[];
  currency: string;
}

export type InventoryPage =
  | 'dashboard'
  | 'items'
  | 'purchase'
  | 'waste'
  | 'suppliers'
  | 'analytics'
  | 'expiry'
  | 'settings'
  | 'voice'
  | 'stock-adjustment'
  | 'timeline'
  | 'recipes'
  | 'cost';
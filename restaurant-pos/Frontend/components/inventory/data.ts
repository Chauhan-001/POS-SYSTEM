import type { InventorySettings } from './types';

/**
 * Inventory module configuration defaults.
 *
 * NOTE: this file intentionally contains NO demo/seed data. Every number shown
 * anywhere in the Inventory module comes from the backend (MongoDB) — the
 * product catalog, purchases, waste events, expiry dates, suppliers and
 * analytics are all fetched through the API client. Screens show honest empty
 * or offline states instead of fabricated rows.
 */
export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  lowStockThreshold: 10,
  defaultSupplier: 'Local Vendor',
  enableVoiceEntry: false,
  enableNotifications: true,
  units: ['kg', 'L', 'pcs', 'g', 'mL', 'dozen', 'packet', 'bottle'],
  currency: '₹',
};

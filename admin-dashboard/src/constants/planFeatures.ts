/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * planFeatures.ts — Admin dashboard mirror of the backend feature catalog
 * (backend/src/constants/planFeatures.ts). Every feature a plan can grant is
 * defined here with a stable key, label, description, and category group so
 * plan creation offers the admin full control over what each plan includes.
 *
 * KEEP IN SYNC with the backend catalog — the POS enforces these exact keys.
 */

export interface AdminFeatureDefinition {
  key: string
  label: string
  description: string
  group: string
  /** Mandatory features can never be removed from a plan. */
  required?: boolean
}

export const FEATURE_CATALOG: AdminFeatureDefinition[] = [
  // ── Core ─────────────────────────────────────────────────────
  { key: 'core_pos', label: 'Core POS', description: 'Billing, orders, table management, and payment processing', group: 'Core', required: true },
  // ── Ordering & Service ───────────────────────────────────────
  { key: 'table_service', label: 'Table Service', description: 'Dine-in floor plan with table states and guest counts', group: 'Ordering & Service' },
  { key: 'takeaway', label: 'Takeaway', description: 'Takeaway and quick orders without a table', group: 'Ordering & Service' },
  { key: 'delivery', label: 'Delivery', description: 'Delivery orders from partner apps (Swiggy, Zomato, Uber Eats)', group: 'Ordering & Service' },
  { key: 'online_ordering', label: 'Online Ordering', description: 'Customer-facing online ordering website and order intake', group: 'Ordering & Service' },
  { key: 'qr_ordering', label: 'QR Ordering', description: 'QR-based self-ordering from the table, car, or pickup', group: 'Ordering & Service' },
  { key: 'waiter_management', label: 'Waiter Management', description: 'Assign waiters to tables and track service', group: 'Ordering & Service' },
  { key: 'kitchen_display', label: 'Kitchen Display', description: 'Kitchen order tickets (KOT) and display screen', group: 'Ordering & Service' },
  // ── Catalog & Pricing ────────────────────────────────────────
  { key: 'products', label: 'Products & Menu', description: 'Product catalog, categories, variants, and menu management', group: 'Catalog & Pricing' },
  { key: 'staff', label: 'Staff Management', description: 'Employees, roles, PINs, and shift management', group: 'Business Operations' },
  { key: 'discounts', label: 'Discounts', description: 'Discounts, price overrides, and happy hours', group: 'Catalog & Pricing' },
  { key: 'guest_checkout', label: 'Guest Checkout', description: 'Bill without a registered customer', group: 'Catalog & Pricing' },
  { key: 'order_notes', label: 'Order Notes', description: 'Item notes, modifiers, and special instructions', group: 'Catalog & Pricing' },
  { key: 'offers', label: 'Offers & Promotions', description: 'Coupons, BOGO, and promotional offers', group: 'Catalog & Pricing' },
  { key: 'loyalty', label: 'Loyalty', description: 'Customer rewards program, points tracking, and promotions', group: 'Catalog & Pricing' },
  { key: 'crm', label: 'CRM', description: 'Customer profiles, segmentation, and relationship management', group: 'Catalog & Pricing' },
  // ── Business Operations ──────────────────────────────────────
  { key: 'reservations', label: 'Reservations', description: 'Table booking and waitlist management', group: 'Business Operations' },
  { key: 'inventory', label: 'Inventory', description: 'Stock tracking, purchase orders, and low-stock alerts', group: 'Business Operations' },
  { key: 'expense_tracking', label: 'Expense Tracking', description: 'Record and categorize operational expenses', group: 'Business Operations' },
  { key: 'finance', label: 'Finance', description: 'Cash flow, P&L, and financial statements', group: 'Business Operations' },
  { key: 'analytics', label: 'Analytics', description: 'Advanced dashboards and business intelligence', group: 'Business Operations' },
  { key: 'basic_reports', label: 'Basic Reports', description: 'Daily sales summaries and order history', group: 'Business Operations' },
  { key: 'advanced_reports', label: 'Advanced Reports', description: 'Profit & loss, tax reports, and custom exports', group: 'Business Operations' },
  // ── Multi-location ───────────────────────────────────────────
  { key: 'multi_branch', label: 'Multi Branch', description: 'Centralized management across multiple locations', group: 'Multi-location' },
  { key: 'multi_device', label: 'Multi Device', description: 'Run the POS on multiple terminals concurrently', group: 'Multi-location' },
  // ── AI & Voice ───────────────────────────────────────────────
  { key: 'ai', label: 'AI', description: 'AI menu suggestions, demand forecasting, and smart insights', group: 'AI & Voice' },
  { key: 'voice_ordering', label: 'Voice Ordering', description: 'Voice-assisted order entry and inventory', group: 'AI & Voice' },
  // ── Platform ─────────────────────────────────────────────────
  { key: 'offline_mode', label: 'Offline Mode', description: 'Continue billing during internet outages', group: 'Platform' },
  { key: 'customer_display', label: 'Customer Display', description: 'Customer-facing order and payment display', group: 'Platform' },
  { key: 'marketing', label: 'Marketing', description: 'Campaigns and promotional tools', group: 'Platform' },
  { key: 'integrations', label: 'Integrations', description: 'Swiggy, Zomato, Uber Eats and delivery partners', group: 'Platform' },
  { key: 'api_access', label: 'API Access', description: 'REST API for third-party integrations', group: 'Platform' },
  { key: 'custom_branding', label: 'Custom Branding', description: 'White-label experience with custom logo and branding', group: 'Platform' },
  { key: 'priority_support', label: 'Priority Support', description: 'Dedicated support with priority ticketing', group: 'Platform' },
]

/** Ordered category groups (for the grouped plan-feature picker). */
export const FEATURE_GROUPS: string[] = Array.from(new Set(FEATURE_CATALOG.map((f) => f.group)))

/** key → definition lookup. */
export const FEATURE_BY_KEY: Record<string, AdminFeatureDefinition> =
  Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, f]))

/** All feature keys (in catalog order). */
export const ALL_FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key)

/** Human label for a feature key (fallback: humanized key). */
export function featureLabel(key: string): string {
  return FEATURE_BY_KEY[key]?.label
    || key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

/** Human description for a feature key (fallback: ''). */
export function featureDescription(key: string): string {
  return FEATURE_BY_KEY[key]?.description || ''
}

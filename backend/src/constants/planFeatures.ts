/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * planFeatures.ts — Single source of truth for plan feature flags and limits
 * (Phase 2.4).
 *
 * Every feature a plan can grant is defined here with a stable key, a human
 * label and a description. Validation, the admin dashboard and the backend
 * entitlement layer all reference this catalog so feature configuration is
 * centralized and never drifts between layers.
 *
 * Limits use the convention: 0 = unlimited.
 */

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { key: 'core_pos', label: 'Core POS', description: 'Billing, orders, table management, and payment processing' },
  { key: 'loyalty', label: 'Loyalty', description: 'Customer rewards program, points tracking, and promotions' },
  { key: 'crm', label: 'CRM', description: 'Customer profiles, segmentation, and relationship management' },
  { key: 'inventory', label: 'Inventory', description: 'Stock tracking, purchase orders, and low-stock alerts' },
  { key: 'kitchen_display', label: 'Kitchen Display', description: 'Kitchen order tickets and display screen' },
  { key: 'qr_ordering', label: 'QR Ordering', description: 'QR-based self-ordering from the table' },
  { key: 'ai', label: 'AI', description: 'AI menu suggestions, demand forecasting, and smart insights' },
  { key: 'voice_ordering', label: 'Voice Ordering', description: 'Voice-assisted order entry and inventory' },
  { key: 'basic_reports', label: 'Basic Reports', description: 'Daily sales summaries and order history' },
  { key: 'advanced_reports', label: 'Advanced Reports', description: 'Profit & loss, tax reports, and custom exports' },
  { key: 'finance', label: 'Finance', description: 'Expense tracking, cash flow, and financial statements' },
  { key: 'expense_tracking', label: 'Expense Tracking', description: 'Record and categorize operational expenses' },
  { key: 'multi_branch', label: 'Multi Branch', description: 'Centralized management across multiple locations' },
  { key: 'multi_device', label: 'Multi Device', description: 'Run the POS on multiple terminals concurrently' },
  { key: 'offline_mode', label: 'Offline Mode', description: 'Continue billing during internet outages' },
  { key: 'customer_display', label: 'Customer Display', description: 'Customer-facing order and payment display' },
  { key: 'analytics', label: 'Analytics', description: 'Advanced dashboards and business intelligence' },
  { key: 'marketing', label: 'Marketing', description: 'Campaigns, offers, and promotional tools' },
  { key: 'reservations', label: 'Reservations', description: 'Table booking and waitlist management' },
  { key: 'api_access', label: 'API Access', description: 'REST API for third-party integrations' },
  { key: 'integrations', label: 'Integrations', description: 'Swiggy, Zomato, Uber Eats and delivery partners' },
  { key: 'custom_branding', label: 'Custom Branding', description: 'White-label experience with custom logo and branding' },
  { key: 'priority_support', label: 'Priority Support', description: 'Dedicated support with priority ticketing' },
];

/** Feature keys as a Set for fast membership checks. */
export const FEATURE_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));

/**
 * All configurable plan limits. 0 = unlimited everywhere.
 * Values are validated against this key set in planService + zod schemas.
 */
export const LIMIT_KEYS = [
  'maxRestaurants',
  'maxBranches',
  'maxDevices',
  'maxEmployees',
  'maxProducts',
  'maxCustomers',
  'maxMonthlyOrders',
  'maxStorageMB',
  'maxAIRequests',
  'maxVoiceRequests',
  'maxImages',
  'maxExports',
] as const;

export type PlanLimitKey = (typeof LIMIT_KEYS)[number];

/** Default limits applied when a plan does not specify them. */
export const DEFAULT_LIMITS: Record<PlanLimitKey, number> = {
  maxRestaurants: 1,
  maxBranches: 1,
  maxDevices: 3,
  maxEmployees: 10,
  maxProducts: 0, // unlimited
  maxCustomers: 0, // unlimited
  maxMonthlyOrders: 0, // unlimited
  maxStorageMB: 500,
  maxAIRequests: 0, // unlimited
  maxVoiceRequests: 0, // unlimited
  maxImages: 0, // unlimited
  maxExports: 0, // unlimited
};

/** Plan lifecycle statuses (Phase 2.4). */
export const PLAN_STATUSES = ['active', 'draft', 'archived', 'deprecated', 'hidden'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Plan types used for filtering (trial / paid / enterprise / free). */
export const PLAN_TYPES = ['free', 'trial', 'paid', 'enterprise'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/** Visibility controls whether a plan appears to restaurants. */
export const PLAN_VISIBILITIES = ['public', 'private', 'hidden'] as const;
export type PlanVisibility = (typeof PLAN_VISIBILITIES)[number];

/** Sort whitelist for plan listings. */
export const PLAN_SORT_FIELDS = [
  'name',
  'price',
  'createdAt',
  'updatedAt',
  'sortOrder',
  'restaurantCount',
] as const;

/** Stable mapping used for descriptions in the UI. */
export function featureLabel(key: string): string {
  return FEATURE_CATALOG.find((f) => f.key === key)?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

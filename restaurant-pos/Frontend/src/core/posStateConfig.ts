/**
 * All subscription feature keys.
 * The 7-day free trial unlocks all of them; restrictions apply after a paid
 * plan is selected.
 */
export const ALL_FEATURES: string[] = [
  'core_pos', 'table_service', 'takeaway', 'delivery', 'online_ordering',
  'qr_ordering', 'waiter_management', 'kitchen_display', 'products', 'staff',
  'discounts', 'guest_checkout', 'order_notes', 'offers', 'loyalty', 'crm',
  'reservations', 'inventory', 'expense_tracking', 'finance', 'analytics',
  'basic_reports', 'advanced_reports', 'multi_branch', 'multi_device',
  'ai', 'voice_ordering', 'offline_mode', 'customer_display', 'marketing',
  'integrations', 'api_access', 'custom_branding', 'priority_support',
];

/**
 * Maps each module toggle to the subscription-plan features that enable it.
 * Multiple features use OR semantics.
 */
export const MODULE_FEATURE_MAP: Record<string, string[]> = {
  enableOnlineOrders: ['online_ordering'],
  enableQROrdering: ['qr_ordering'],
  enableMenuAvailability: ['online_ordering', 'qr_ordering'],
  autoMarkSoldOutFromOrder: ['online_ordering', 'qr_ordering'],
  enableTakeawayModule: ['takeaway'],
  enableDeliveryModule: ['delivery'],
  enableTableService: ['table_service'],
  enableDineInModule: ['table_service'],
  enableWaiterManagement: ['waiter_management'],
  enableDiscountOnBilling: ['discounts'],
  enableGuestCheckout: ['guest_checkout'],
  enableOrderNotes: ['order_notes'],
  enableKitchenDisplay: ['kitchen_display'],
  enableLoyalty: ['loyalty'],
  enableReservations: ['reservations'],
  enableMultiBranch: ['multi_branch'],
  enableExpenseManagement: ['expense_tracking'],
  enableOffers: ['offers', 'marketing'],
  enableOffersPopup: ['offers', 'marketing'],
  enableProducts: ['products'],
  enableStaff: ['staff'],
  enableAIInventoryHealth: ['ai'],
  enableAIPurchaseRecs: ['ai'],
  enableAILowStock: ['ai'],
  enableAIWasteAnalysis: ['ai'],
  enableInventory: ['inventory'],
};

export const CACHE_KEYS = {
  PRODUCTS: 'pos_products',
  CUSTOMERS: 'pos_customers',
  EMPLOYEES: 'pos_employees',
  BILLS: 'pos_bills',
  EXPENSES: 'pos_expenses',
  BRANCHES: 'pos_branches',
  SETTINGS: 'pos_settings',
  REWARDS: 'pos_rewards',
  ORDERS: 'pos_orders',
  TABLES: 'pos_tables',
  TAKEAWAY: 'pos_takeaway_orders',
  RESERVATIONS: 'pos_reservations',
  WAITING: 'pos_waiting_list',
  FLOORS: 'pos_floors',
} as const;

export const VOID_REASONS = [
  { id: 'wrong_item', label: 'Wrong item ordered' },
  { id: 'customer_changed', label: 'Customer changed mind' },
  { id: 'prep_error', label: 'Preparation error' },
  { id: 'duplicate', label: 'Duplicate entry' },
  { id: 'quality_issue', label: 'Quality issue' },
  { id: 'order_cancelled', label: 'Order cancelled' },
  { id: 'other', label: 'Other' },
];

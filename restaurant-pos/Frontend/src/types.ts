/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ProductVariant {
  name: string;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  gstPercent: number;
  availability: boolean;
  variants?: ProductVariant[];
  favorite?: boolean;
  code: string; // SKU or short-code for typing/barcode search
  branchId?: string;
}

export interface CartItem {
  id: string; // Unique ID for this line item (combines product id and variant)
  product: Product;
  selectedVariant?: ProductVariant;
  quantity: number;
  notes?: string;
  price: number; // Final price including variant adjustment
  isFree?: boolean; // If this item is part of a free loyalty reward redemption
  originalPrice?: number; // Store original price for when free reward is toggled
  kotPrinted?: boolean; // Whether this item has been sent to the kitchen
  customPrice?: number; // Manual price override for special cases
  cancelled?: boolean;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface PurchaseHistoryItem {
  id: string;
  invoiceNumber: string;
  ticketNumber: string;
  date: string;
  grandTotal: number;
  itemsCount: number;
  items: CartItem[];
  redeemedRewardTitle?: string;
  pointsRedeemed?: number;
  pointsEarned?: number;
}

export interface Customer {
  id?: string;
  _id?: string;
  phone: string;
  name: string;
  email?: string;
  isNew: boolean;
  visits: number;
  points: number;
  birthday?: string;
  anniversary?: string;
  gender?: 'Male' | 'Female' | 'Other';
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  gstNumber?: string;
  tags?: string[];
  marketingOptIn?: boolean;
  taxExemption?: boolean;
  isVip?: boolean;
  status?: 'active' | 'blocked' | 'dormant' | 'deleted';
  blockReason?: string;
  lastVisit?: string;
  firstVisit?: string;
  notes?: string;
  isBlocked?: boolean;
  // ── Loyalty (server-authoritative) ─────────────────────
  tier?: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
  lifetimePoints?: number;
  walletBalance?: number;
  totalSpend?: number;
  averageSpend?: number;
  totalOrders?: number;
  visitFrequency?: number;
  referralCode?: string;
  referredBy?: string;
  referralCount?: number;
  favoriteItems?: string[];
  favoriteCategories?: string[];
  preferredPaymentMethod?: string;
  purchaseHistory: PurchaseHistoryItem[];
}

/** Paginated API response envelope used by all list endpoints */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nextPage: number | null;
  previousPage: number | null;
}

/** Loyalty ledger transaction (server-authoritative) */
export interface LoyaltyTransaction {
  id: string;
  type: 'earn' | 'welcome' | 'birthday' | 'anniversary' | 'referral' | 'adjustment' | 'redeem' | 'expiry' | 'refund' | 'wallet_credit' | 'wallet_debit';
  points: number;
  wallet: number;
  balanceAfter: number;
  description?: string;
  refType?: string;
  refId?: string;
  consumedFrom?: Array<{ transactionId: string; points: number }>;
  createdAt: string;
}

/** Customer timeline / activity entry */
export interface CustomerActivity {
  id: string;
  type: string;
  title: string;
  description?: string;
  performedBy?: string;
  createdAt: string;
}

/** Loyalty tier configuration */
export interface LoyaltyTier {
  id?: string;
  name: string;
  minLifetimeSpend: number;
  pointsMultiplier: number;
  rewardPercent: number;
  expiryMonths: number;
  benefits: string[];
  priority: number;
  birthdayRewardPoints: number;
  anniversaryRewardPoints: number;
  isActive: boolean;
  isDefault: boolean;
}

/** Per-restaurant loyalty settings */
export interface LoyaltySettings {
  pointsPerCurrency: number;
  pointsValueInCurrency: number;
  roundOffPoints: boolean;
  minRedemption: number;
  maxRedemptionPerTransaction: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  pointExpiryMode: 'none' | 'rolling' | 'fixed' | 'annual';
  rollingExpiryMonths: number;
  fixedExpiryDate?: string;
  expiryReminderDays: number[];
  welcomePoints: number;
  birthdayBonusPoints: number;
  anniversaryBonusPoints: number;
  referralEnabled: boolean;
  referralReferrerPoints: number;
  referralRefereePoints: number;
  enableWallet: boolean;
  enableTiers: boolean;
  otpEnabled: boolean;
  largeRewardThreshold: number;
}

/** Referral record */
export interface Referral {
  id: string;
  code: string;
  referrerPhone: string;
  refereePhone: string;
  refereeName?: string;
  status: 'pending' | 'completed' | 'rewarded' | 'voided';
  referrerRewardPoints: number;
  refereeRewardPoints: number;
  referrerRewarded: boolean;
  refereeRewarded: boolean;
  createdAt: string;
}

/** Full CRM profile assembled by GET /api/customers/:id/profile */
export interface CustomerProfile {
  customer: Customer;
  profile: {
    recentOrders: Array<{ id: string; invoiceNumber: string; date: string; grandTotal: number; pointsEarned: number; pointsRedeemed: number; redeemedRewardTitle?: string }>;
    totalOrders: number;
    rewardHistory: LoyaltyTransaction[];
    transactions: LoyaltyTransaction[];
    timeline: CustomerActivity[];
    availableOffers: Array<{ id: string; title: string; description: string; type: string; value: number; minOrderValue?: number; endDate?: string; couponCode?: string }>;
    segments: Array<{ id: string; name: string; type: string }>;
    couponsUsed: any[];
    referral: { code?: string; referredBy?: string; referralCount: number; referrals: Referral[] };
    auditTrail: Array<{ action: string; performedBy: string; createdAt: string }>;
  };
}

/** Customer CRM report bundle */
export interface CustomerReport {
  summary: Record<string, number>;
  tierDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  topCustomers: Array<{ phone: string; name: string; tier: string; totalSpend: number; averageSpend: number; visits: number; totalOrders: number; points: number; walletBalance: number; lastVisit?: string; isVip?: boolean }>;
  birthdaysToday: any[];
  rewardUsage: Array<{ title: string; redeemedCount: number; pointsRequired: number }>;
  couponUsage: Array<{ code: string; uses: number }>;
  referralPerformance: { total: number; rewarded: number };
  segmentDistribution: Array<{ name: string; type: string; customerCount: number }>;
  growth: Array<{ month: string; newCustomers: number }>;
}

export interface LoyaltyReward {
  id: string;
  title: string;
  pointsRequired: number;
  type: 'percentage' | 'flat' | 'item';
  value: number; // Percentage discount or flat amount or free item price
  minBillAmount: number;
  isLargeReward: boolean; // Requires OTP verification if true
  rewardItemId?: string;   // Added for free menu item
  rewardItemName?: string; // Added for free menu item
}

export interface Bill {
  id: string;
  /** Phase 1.10 — idempotency key (stable local bill id) so offline queue replays dedupe server-side. */
  clientRef?: string;
  invoiceNumber: string;
  ticketNumber: string;
  date: string;
  time: string;
  cashierName: string;
  cashierRole: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod: 'Cash' | 'UPI' | 'Card' | 'Wallet' | 'Split';
  splitDetails?: {
    cashAmount: number;
    cardAmount: number;
    upiAmount: number;
    walletAmount: number;
  };
  orderType: 'Dine In' | 'Takeaway' | 'Delivery' | 'Swiggy' | 'Zomato' | 'Uber Eats' | 'Website' | 'Phone Orders' | 'Other';
  branchId?: string;
  customerPhone?: string;
  customerName?: string;
  customerId?: string; // Phase 1.6 — bill → customer reference (phone snapshot kept)
  pointsEarned: number;
  pointsRedeemed: number;
  redeemedRewardTitle?: string;
  milestoneRewardAwarded?: string;
  /** Table number for dine-in orders (used by showTableNumber setting) */
  tableNumber?: number;
  /** Original order creation time (used by showOrderTime setting) */
  createdAt?: string;
  /** Voided bill — reversal of the whole bill (with reason/actor from backend) */
  isVoided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  /** Refunded bill — full/partial refund (with reason/actor from backend) */
  isRefunded?: boolean;
  refundReason?: string;
  refundedBy?: string;
  refundAmount?: number;
  refundedAt?: string;
}

export interface Employee {
  id: string;
  username: string;
  name: string;
  role: 'Owner' | 'Manager' | 'Cashier';
  pin: string; // Quick 4-digit PIN for switching cashiers
  status: 'Active' | 'Inactive';
  branchId?: string; // Which branch this employee belongs to
  lastLogin?: string;
}

/**
 * Title-case a staff role and clamp it to the three POS roles.
 * The backend auth may return lowercase roles ('owner'), so every consumer
 * (login caching, PIN-screen filtering, role checks) normalizes through this
 * single helper to avoid casing mismatches.
 */
export function normalizeRole(role?: string | null): Employee['role'] {
  const r = String(role || '').trim();
  if (!r) return 'Cashier';
  const t = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
  return (t === 'Owner' || t === 'Manager' || t === 'Cashier' ? t : 'Cashier') as Employee['role'];
}

export interface LoginSession {
  id: string;
  username: string;
  name: string;
  role: 'Owner' | 'Manager' | 'Cashier';
  loginTime: string;
  ipAddress: string;
}

export interface VisitMilestone {
  id: string;
  visits: number;
  rewardItemId: string;
  rewardItemName: string;
}

/** Daily sales summary stored in localStorage and updated after each checkout */

export interface DailySales {
  date: string; // ISO date string
  totalRevenue: number;
  totalOrders: number;
  totalItemsSold: number;
  totalDiscount: number;
  totalGst: number;
  averageOrderValue: number;
  paymentBreakdown: { method: string; amount: number; count: number }[];
  categoryBreakdown: { category: string; qty: number; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  cashierPerformance: { name: string; orders: number; revenue: number }[];
}

/** Single entry in the real-time activity / history chat feed */
export interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'payment' | 'void' | 'hold' | 'recall' | 'refund' | 'reward' | 'login';
  title: string;
  description: string;
  amount?: number;
  currencySymbol?: string;
  invoiceNumber?: string;
  cashierName?: string;
  paymentMethod?: string;
}

// ============================================================
// ORDER MANAGEMENT TYPES
// ============================================================

/** Order status lifecycle for all order types */
export type OrderStatus =
  | 'New'
  | 'Accepted'
  | 'Preparing'
  | 'Ready'
  | 'Served'
  | 'Waiting Payment'
  | 'Paid'
  | 'Closed'
  | 'Cancelled'
  | 'Refunded'
  | 'Held'
  | 'Transferred'
  | 'Merged'
  | 'Split';

/** Table status for restaurant floor management */
export type TableStatus =
  | 'Available'
  | 'Occupied'
  | 'Reserved'
  | 'Preparing'
  | 'Food Ready'
  | 'Served'
  | 'Waiting Payment'
  | 'Cleaning'
  | 'Paid'
  | 'Cancelled';

/** KOT (Kitchen Order Ticket) type */
export type KOTType = 'Original' | 'Additional' | 'Reprint';

/** KOT status within the kitchen display workflow */
export type KOTStatus = 'Accepted' | 'Preparing' | 'Ready' | 'Served';

/** Timeline event types for order history tracking */
export type TimelineEventType =
  | 'order_created'
  | 'kot_printed'
  | 'item_added'
  | 'item_removed'
  | 'kot_additional_printed'
  | 'kot_reprint'
  | 'interim_bill_printed'
  | 'payment_completed'
  | 'final_bill_printed'
  | 'order_closed'
  | 'order_held'
  | 'order_resumed'
  | 'order_transferred'
  | 'order_merged'
  | 'order_split'
  | 'discount_applied'
  | 'customer_assigned'
  | 'waiter_assigned'
  | 'order_cancelled'
  | 'order_refunded';

/** Order platform for online orders */
export type OrderPlatform = 'Swiggy' | 'Zomato' | 'Uber Eats' | 'Website' | 'Phone';

/** Order type supported by the system */
export type OrderType =
  | 'Dine In'
  | 'Takeaway'
  | 'Delivery'
  | 'Swiggy'
  | 'Zomato'
  | 'Uber Eats'
  | 'Website'
  | 'Phone Orders';

/** A single event in the order timeline */
export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: TimelineEventType;
  description: string;
  actor?: string;
}

/** A Kitchen Order Ticket record */
export interface KOTRecord {
  id: string;
  kotNumber: number;
  type: KOTType;
  status: KOTStatus;
  items: CartItem[];
  printedAt: string;
  printedBy: string;
  note?: string;
}

/** Table information for floor management */
export interface TableInfo {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  section?: string;
  branchId?: string;
  floorId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: 'circle' | 'square' | 'rectangle';
  isLocked?: boolean;
  guestCount?: number;
  waiterId?: string;
  waiterName?: string;
  runningBill?: number;
  orderId?: string;
  orderSince?: string;
  occupiedSince?: string;
  kitchenStatus?: string;
  paymentStatus?: string;
  reservationName?: string;
  reservationTime?: string;
  priority?: 'normal' | 'high' | 'urgent';
  isOnlineOrder?: boolean;
  platform?: string;
}

/** Restaurant floor (multi-floor layout management) */
export interface Floor {
  id: string;
  name: string;
  branchId?: string;
  sortOrder: number;
  isActive: boolean;
  theme?: string;
}

/** Takeaway order card info */
export interface TakeawayOrder {
  id: string;
  orderId: string;
  orderNumber: number;
  customerName: string;
  customerPhone?: string;
  elapsedTime: string;
  status: 'Preparing' | 'Ready' | 'Collected' | 'Completed';
  amount: number;
  paymentStatus: 'Pending' | 'Paid';
  items: CartItem[];
  branchId?: string;
  createdAt: string;
}

/** Complete Order object that manages the full order lifecycle */
export interface Order {
  id: string;
  orderNumber: number;
  type: OrderType;
  status: OrderStatus;
  tableId?: string;
  tableNumber?: number;
  platform?: OrderPlatform;
  branchId?: string;
  customerPhone?: string;
  customerName?: string;
  customerId?: string; // Phase 1.6 — bill → customer reference (phone snapshot kept)
  waiterId?: string;
  waiterName?: string;
  guestCount?: number;
  specialInstructions?: string;
  deliveryAddress?: string;
  deliveryEta?: string;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
  kotRecords: KOTRecord[];
  timeline: TimelineEvent[];
  interimBillPrinted: boolean;
  finalBillPrinted: boolean;
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod?: 'Cash' | 'UPI' | 'Card' | 'Wallet' | 'Split';
  paidAt?: string;
  closedAt?: string;
  appliedRewardTitle?: string;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  /** Cumulative snapshot of all items printed across all KOTs (for delta detection) */
  lastKotSnapshot?: CartItem[];
}

/** Held/suspended order snapshot */
export interface HeldOrder {
  id: string;
  timestamp: string;
  items: CartItem[];
  customer: Customer | null;
  type: string;
  orderId?: string;
}

/** A restaurant branch / location */
export interface Branch {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  isHeadBranch: boolean;
  isActive: boolean;
  createdAt: string;
}

/** Module-level settings for toggling restaurant features */
export interface ModuleSettings {
  enableTableService: boolean;
  enableWaiterManagement: boolean;
  enableReservations: boolean;
  enableQROrdering: boolean;
  enableDeliveryModule: boolean;
  enableOnlineOrders: boolean;
  enableKitchenDisplay: boolean;
  enableLoyalty: boolean;
  showImagesInBilling?: boolean;
  showCashierPerformance?: boolean;
  enableMultiBranch?: boolean;
  // New module settings for finer control
  enableOffersPopup?: boolean;
  enableAutoPrintKOT?: boolean;
  enableQuickSoundAlerts?: boolean;
  showItemCodeOnCard?: boolean;
  enableGuestCheckout?: boolean;
  enableOrderNotes?: boolean;
  enableTakeawayModule?: boolean;
  enableDineInModule?: boolean;
  enableExpenseManagement?: boolean;
  enableDiscountOnBilling?: boolean;
  // ─── AI Feature Toggles ──────────────────────────────
  enableAISummary?: boolean;       // Dashboard AI Daily Summary
  enableAIInventoryHealth?: boolean; // Inventory Health Score
  enableAIPurchaseRecs?: boolean;   // Smart Purchase Recommendations
  enableAILowStock?: boolean;       // Low Stock Predictions
  enableAIWasteAnalysis?: boolean;  // AI Waste Analysis
  enableAIVoiceEntry?: boolean;     // Voice Inventory Entry
  enableAIWeather?: boolean;        // Weather-Based Recommendations
  enableAIClosingAssistant?: boolean; // Closing Time Assistant
}

export interface SystemSettings {
  restaurantName: string;
  gstin: string;
  address: string;
  phone: string;
  currency: string;
  currencySymbol: string;
  defaultTaxRate: number; // default GST %
  loyaltyPointsPerDollar: number; // e.g. 1 point per $10 spent (so value is 0.1)
  pointsNeededForOneUnitCurrency: number; // e.g. 10 points = $1 value (so value is 10)
  visitThresholdForBonus: number; // visits required for bonus points
  bonusPointsPerVisit: number;
  printSize: '58mm' | '80mm';
  brandingColor: string;
  autoPrintReceipt: boolean;
  otpSimulationEnabled: boolean;
  visitMilestones?: VisitMilestone[];
  invoicePrefix?: string;
  invoiceStartingNumber?: number;
  invoiceSuffix?: string;
  showCustomerNameOnReceipt?: boolean;
  showLoyaltyPointsOnReceipt?: boolean;
  showQrCodeOnReceipt?: boolean;
  showDiscountBreakdownOnReceipt?: boolean;
  printCategoryHeaders?: boolean;
  showItemModifiers?: boolean;
  showOrderTime?: boolean;
  showTableNumber?: boolean;
  printerRoutingRules?: Array<{ id: string; categoryGroup: string; destinationPrinter: string }>;
  sidebarLogoUrl?: string;
  printLogoOnReceipt?: boolean;
  roundOffTotal?: boolean;
  groupItemsInKOT?: boolean;
  kotFooterNote?: string;
  receiptFooterMessage?: string;
  receiptFooterImageUrl?: string;
  showTaxSummaryOnReceipt?: boolean;
  showLoyaltyPointsEarnedOnReceipt?: boolean;
  // Module settings
  moduleSettings?: ModuleSettings;
  // Role-based permissions (configurable by Owner)
  rolePermissions?: RolePermissions;

  // ═══ Phase 1.9 — centralized server-driven configuration ═══
  // Tax settings (server-validated; FinanceSettings governs accounting)
  tax?: {
    cgst?: number;
    sgst?: number;
    igst?: number;
    cess?: number;
    mode?: 'inclusive' | 'exclusive';
    hsnRequired?: boolean;
    sacRequired?: boolean;
    taxGroups?: Array<{ id: string; name: string; rate: number; hsn?: string; sac?: string }>;
  };
  // Discount settings
  discount?: {
    maxDiscountPct?: number;
    managerApprovalAbove?: number;
    ownerApprovalAbove?: number;
    reasons?: string[];
    happyHours?: Array<{ id: string; label: string; start: string; end: string; discountPct: number; daysOfWeek: number[] }>;
    allowStacking?: boolean;
  };
  // Receipt template configuration
  receiptTemplate?: {
    header?: string;
    footer?: string;
    watermark?: string;
    showGstin?: boolean;
    showFssai?: boolean;
    fssai?: string;
    customFields?: Array<{ id: string; label: string; value: string }>;
  };
  // Theme system
  theme?: {
    mode: 'dark' | 'light' | 'system';
    brandColor?: string;
    accentColor?: string;
    density?: 'comfortable' | 'compact' | 'spacious';
    borderRadius?: number;
  };
  // Keyboard shortcuts
  shortcuts?: Record<string, string>;
  // Notification configuration
  notifications?: {
    lowStock?: boolean;
    orders?: boolean;
    sales?: boolean;
    backups?: boolean;
    printerErrors?: boolean;
    syncFailures?: boolean;
    employeeAlerts?: boolean;
    channels?: Array<'email' | 'sms' | 'whatsapp' | 'push' | 'webhook' | 'desktop'>;
    webhookUrl?: string;
  };
  // Security settings
  security?: {
    passwordMinLength?: number;
    requireSpecialChar?: boolean;
    sessionTimeoutMinutes?: number;
    autoLogout?: boolean;
    pinPolicy?: { minLength?: number; requireNumbers?: boolean };
    failedLoginLockThreshold?: number;
    twoFactorEnabled?: boolean;
  };
  // AI configuration (restaurant-level overrides)
  ai?: {
    enabled?: boolean;
    dailyLimit?: number;
    model?: string;
    fallbackModel?: string;
  };
  // Integrations (secrets stored encrypted server-side)
  integrations?: {
    whatsapp?: { enabled?: boolean; phoneNumberId?: string };
    sms?: { enabled?: boolean };
    email?: { enabled?: boolean };
    webhook?: { enabled?: boolean; url?: string; secret?: string };
    paymentProviders?: string[];
  };
}

/**
 * Role-based permissions — configurable by the Owner in Settings.
 * Controls what each role can access in the POS.
 * Owner always has full access to everything.
 * Manager access is controlled by the `managerCan*` toggles.
 * Cashier access is controlled by the `cashierCan*` toggles (all default OFF,
 * so out of the box Cashier keeps the operational-only base access).
 */
export interface RolePermissions {
  // ── Manager workspace access ──────────────────────────────
  managerCanAccessSettings: boolean;
  managerCanManageStaff: boolean;
  managerCanManageProducts: boolean;
  managerCanManageExpenses: boolean;
  managerCanAccessReports: boolean;
  managerCanAccessAnalytics: boolean;
  managerCanAccessFinance: boolean;
  managerCanAccessInventory: boolean;
  managerCanManageCustomers: boolean;
  managerCanManageOffers: boolean;
  managerCanAccessReservations: boolean;
  managerCanAccessBranches: boolean;
  // ── Manager billing capabilities ──────────────────────────
  managerCanApplyDiscounts: boolean;
  // ── Cashier workspace access (Owner-configurable) ─────────
  cashierCanAccessSettings: boolean;
  cashierCanManageStaff: boolean;
  cashierCanManageProducts: boolean;
  cashierCanManageExpenses: boolean;
  cashierCanAccessReports: boolean;
  cashierCanAccessAnalytics: boolean;
  cashierCanAccessFinance: boolean;
  cashierCanAccessInventory: boolean;
  cashierCanManageCustomers: boolean;
  cashierCanManageOffers: boolean;
  cashierCanAccessReservations: boolean;
  cashierCanAccessBranches: boolean;
  // ── Cashier billing capabilities ──────────────────────────
  cashierCanApplyDiscounts: boolean;
}

/**
 * Default role permissions.
 * Manager has most features ON (but not Settings/Staff).
 * Cashier has all elevated permissions OFF — the operational-only base access
 * (Dashboard, Orders, Billing, Kitchen, More, Receipt History, Daily Sales,
 * Activity Feed, Sync Status) is always available to every role.
 */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  managerCanAccessSettings: false,
  managerCanManageStaff: false,
  managerCanManageProducts: true,
  managerCanManageExpenses: true,
  managerCanAccessReports: true,
  managerCanAccessAnalytics: true,
  managerCanAccessFinance: true,
  managerCanAccessInventory: true,
  managerCanManageCustomers: true,
  managerCanManageOffers: true,
  managerCanAccessReservations: true,
  managerCanAccessBranches: true,
  managerCanApplyDiscounts: true,
  cashierCanAccessSettings: false,
  cashierCanManageStaff: false,
  cashierCanManageProducts: false,
  cashierCanManageExpenses: false,
  cashierCanAccessReports: false,
  cashierCanAccessAnalytics: false,
  cashierCanAccessFinance: false,
  cashierCanAccessInventory: false,
  cashierCanManageCustomers: false,
  cashierCanManageOffers: false,
  cashierCanAccessReservations: false,
  cashierCanAccessBranches: false,
  cashierCanApplyDiscounts: false,
};

// ============================================================
// OFFER MANAGEMENT TYPES
// ============================================================

export type OfferType =
  | 'percentage' | 'flat' | 'bogo' | 'free_item' | 'combo' | 'cashback'
  | 'reward_points' | 'coupon' | 'festival' | 'referral' | 'loyalty_bonus';

export type OfferStatus = 'draft' | 'active' | 'scheduled' | 'paused' | 'expired' | 'cancelled';

export type OfferRecommendationSource =
  | 'weather' | 'festival' | 'inventory_clearance' | 'inventory_low_stock_protection'
  | 'high_margin_promotion' | 'combo_upsell' | 'time_based' | 'weekend'
  | 'slow_day' | 'weak_category' | 'repeat_customer' | 'lost_customer'
  | 'vip_reward' | 'first_visit' | 'second_visit' | 'new_menu'
  | 'seasonal_menu' | 'birthday' | 'anniversary' | 'referral' | 'manual';

export interface Offer {
  _id: string;
  restaurantId: string;
  title: string;
  description: string;
  shortDescription?: string;
  type: OfferType;
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  maxUses?: number;
  currentUses: number;
  maxPerCustomer?: number;
  applicableCategories: string[];
  applicableProductIds: string[];
  targetSegmentIds: string[];
  targetSegmentNames: string[];
  startDate?: string;
  endDate?: string;
  scheduledDate?: string;
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  freeItemId?: string;
  freeItemName?: string;
  recommendationSource?: OfferRecommendationSource;
  recommendationReason?: string;
  estimatedReach?: number;
  expectedImpact?: string;
  isAiGenerated: boolean;
  isAutoActivate: boolean;
  status: OfferStatus;
  whatsappMessage?: string;
  smsMessage?: string;
  appNotification?: string;
  emailSubject?: string;
  emailBody?: string;
  imageUrl?: string;
  branchIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OfferSegment {
  _id: string;
  name: string;
  type: string;
  description: string;
  customerCount: number;
  averageSpend: number;
  averageVisitFrequency: number;
  lastCampaignDate?: string;
  isAutoGenerated: boolean;
}

export interface OfferAnalytics {
  _id: string;
  offerId: string;
  customersTargeted: number;
  customersReached: number;
  opened: number;
  redeemed: number;
  revenueGenerated: number;
  repeatVisits: number;
  averageBillIncrease: number;
  roi: number;
  snapshotDate: string;
}

export interface OfferSuggestion {
  title: string;
  type: string;
  value: number;
  description: string;
  recommendationSource: OfferRecommendationSource;
  recommendationReason: string;
  estimatedReach: number;
  expectedImpact: string;
  priority: 'high' | 'medium' | 'low';
  applicableCategories: string[];
  minOrderValue?: number;
  startHour?: number;
  endHour?: number;
  daysOfWeek?: number[];
  defaultDurationDays: number;
}

// ============================================================
// EXPENSE MANAGEMENT TYPES (Phase 1.7)
// ============================================================

export type ExpensePaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Other';

export interface ExpenseGst {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  inputGst: boolean;
  taxInclusive: boolean;
  hsn?: string;
  sac?: string;
}

export interface ExpenseAttachment {
  name: string;
  mime: string;
  size: number;
  url?: string;
  storage?: 'local' | 'cloud';
}

export interface ExpenseEntry {
  id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  category: string;
  categoryId?: string;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  vendor?: string;
  vendorId?: string;
  notes?: string;
  isCogs?: boolean;
  gst?: ExpenseGst;
  attachments?: ExpenseAttachment[];
  isRecurring?: boolean;
  isSystemGenerated?: boolean;
  recurringTemplateId?: string;
  branchId?: string;
  /** Optimistic-concurrency version (server-authoritative). */
  version?: number;
  isDeleted?: boolean;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
}

/** Configurable expense category (system + custom, server-seeded). */
export interface ExpenseCategory {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  isCogs: boolean;
  isSystem: boolean;
  isActive: boolean;
}

/** Finance vendor (GSTIN, contacts, terms). */
export interface Vendor {
  id: string;
  name: string;
  gstin?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  paymentTermsDays?: number;
  defaultPaymentMethod?: string;
  status: 'active' | 'inactive';
  notes?: string;
}

export interface VendorSummary {
  vendor: Vendor;
  summary: {
    totalBilled: number;
    expenseCount: number;
    totalPaid: number;
    outstanding: number;
    inputGst: number;
    totalPurchases: number;
    purchaseCount: number;
  };
  recentExpenses: Array<{ id: string; date: string; category: string; description: string; amount: number; paymentMethod: string }>;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringExpense {
  id: string;
  description: string;
  amount: number;
  category: string;
  categoryId?: string;
  paymentMethod?: string;
  vendorId?: string;
  vendor?: string;
  isCogs?: boolean;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string;
  nextRunDate: string;
  lastRunDate?: string;
  isPaused: boolean;
  dayOfWeek?: number;
  dayOfMonth?: number;
  notes?: string;
}

export type CashLedgerType = 'opening' | 'cash_in' | 'cash_out' | 'expense' | 'drawer_adjustment' | 'shift_closing' | 'bank_deposit' | 'bank_withdrawal';

export interface CashLedgerEntry {
  id: string;
  date: string;
  type: CashLedgerType;
  amount: number;
  balanceAfter: number;
  refType?: string;
  refId?: string;
  note?: string;
  shiftId?: string;
  countedCash?: number;
  overShort?: number;
  performedBy?: string;
  createdAt: string;
}

export interface FinanceSettings {
  gstEnabled: boolean;
  gstMode: 'inclusive' | 'exclusive';
  defaultCgst: number;
  defaultSgst: number;
  defaultIgst: number;
  defaultCess: number;
  hsnRequired: boolean;
  sacRequired: boolean;
  cogsMode: 'auto' | 'category';
  openingCashDefault: number;
}

export interface FinancePnl {
  period: string;
  startDate: string;
  endDate: string;
  revenue: number;
  refunds: number;
  discounts: number;
  gstCollected: number;
  orders: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  totalExpenses: number;
  margin: number;
  expenseByCategory: Record<string, { amount: number; count: number }>;
}

export interface FinanceSummary {
  period: string;
  startDate: string;
  endDate: string;
  pnl: {
    revenue: number;
    expenses: number;
    cogs: number;
    grossProfit: number;
    netProfit: number;
    margin: number;
    orders: number;
  };
  cash: { balance: number; inflows: number; outflows: number; overShort: number };
  gst: { outputGst: number; inputGst: number; payable: number };
  vendorDues: { total: number; count: number };
  drawerBalance: number;
}

export interface CashFlowRow {
  date: string;
  opening: number;
  cashIn: number;
  cashOut: number;
  expenses: number;
  adjustments: number;
  overShort: number;
  net: number;
  closing: number;
}

// ============================================================
// REPORTS TYPES (Phase 1.8) — backend-generated shapes
// ============================================================

export interface ReportSalesSummary {
  grossSales: number;
  netSales: number;
  orders: number;
  averageOrderValue: number;
  averageItemsPerOrder: number;
  itemsSold: number;
  discounts: number;
  taxes: number;
  cashSales: number;
  nonCashSales: number;
  pointsEarned: number;
  pointsRedeemed: number;
}

export interface ReportComparison {
  previousRevenue: number;
  previousNetRevenue: number;
  previousOrders: number;
  previousItems?: number;
  previousDiscount?: number;
  revenueGrowthPct: number;
  orderGrowthPct: number;
  aovGrowthPct: number;
}

export interface ReportStatus {
  completed: number;
  voided: number;
  refunded: number;
  refundAmount: number;
  cancelled: number;
}

export interface SalesSummaryReport {
  period: { start: string; end: string; previousStart: string; previousEnd: string };
  summary: ReportSalesSummary;
  comparison: ReportComparison;
  status: ReportStatus;
}

export interface SalesTrendPoint {
  date?: string;
  name?: string;
  revenue: number;
  orders: number;
  items?: number;
}

export interface SalesPaymentRow { method: string; amount: number; count: number; }
export interface SalesOrderTypeRow { type: string; count: number; revenue: number; }
export interface SalesCashierRow {
  cashier: string; orders: number; revenue: number; averageBill: number;
  itemsSold: number; discount: number; voidedBills: number; refundedBills: number;
}
export interface SalesHourRow { hour: string; orders: number; revenue: number; }
export interface PeakHoursReport { hourly: SalesHourRow[]; peakHour: SalesHourRow | null; }

export interface ProductReportRow {
  name: string; menuItemId?: string; qty: number; revenue: number;
  discount?: number; orders?: number; averagePrice?: number;
  category?: string; popularityPct?: number; revenuePct?: number;
  quadrant?: string; sharePct?: number; cumulativePct?: number; class?: string;
}

export interface InventoryStockRow {
  name: string; category: string; currentStock: number; unit: string;
  minStock: number; reorderLevel: number; averageCost: number;
  stockValue: number; availability: boolean; status: string;
}

export interface EmployeePerformanceRow {
  employee: string; orders: number; revenue: number; grossRevenue: number;
  averageBill: number; itemsSold: number; averageItemsPerOrder: number;
  discount: number; voidedBills: number; refundedBills: number;
}

export interface ClosingZReport {
  reportType: 'Z';
  generatedAt: string;
  sales: {
    date: string; grossRevenue: number; netRevenue: number; orders: number;
    averageOrderValue: number; discounts: number; taxes: number;
    payments: SalesPaymentRow[];
  };
  cash: {
    openingCash: number; cashSales: number; cashIn: number; cashOut: number;
    expenses: number; adjustments: number; expectedCash: number;
    actualCash: number; overShort: number;
  };
  requiresManagerApproval: boolean;
}

export interface MonthlySummaryRow {
  month: string; totalRevenue: number; totalOrders: number;
  totalItemsSold: number; averageOrderValue: number; cashSales: number;
}

// ============================================================
// RESERVATION & WAITING LIST TYPES
// ============================================================

export type ReservationStatus = 'Confirmed' | 'Seated' | 'Cancelled' | 'No Show';

export interface Reservation {
  id: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  tableId?: string;
  tableNumber?: number;
  status: ReservationStatus;
  branchId?: string;
  notes?: string;
  occasion?: string;
  createdAt: string;
  createdBy?: string;
}

export type WaitingStatus = 'Waiting' | 'Seated' | 'Cancelled';

export interface WaitingEntry {
  id: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  joinedAt: string;
  estimatedWaitMinutes: number;
  status: WaitingStatus;
  branchId?: string;
  notes?: string;
  partyType?: 'adult' | 'family' | 'business';
}

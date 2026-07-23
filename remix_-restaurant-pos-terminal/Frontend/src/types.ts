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
  phone: string;
  name: string;
  email?: string;
  isNew: boolean;
  visits: number;
  points: number;
  birthday?: string;
  lastVisit?: string;
  notes?: string;
  isBlocked?: boolean;
  purchaseHistory: PurchaseHistoryItem[];
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
  customerPhone?: string;
  customerName?: string;
  pointsEarned: number;
  pointsRedeemed: number;
  redeemedRewardTitle?: string;
  milestoneRewardAwarded?: string;
}

export interface Employee {
  id: string;
  username: string;
  name: string;
  role: 'Owner' | 'Manager' | 'Cashier';
  pin: string; // Quick 4-digit PIN for switching cashiers
  status: 'Active' | 'Inactive';
  lastLogin?: string;
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
  guestCount?: number;
  waiterId?: string;
  waiterName?: string;
  runningBill?: number;
  orderId?: string;
  orderSince?: string;
  kitchenStatus?: string;
  paymentStatus?: string;
  reservationName?: string;
  reservationTime?: string;
  priority?: 'normal' | 'high' | 'urgent';
  isOnlineOrder?: boolean;
  platform?: string;
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
  customerPhone?: string;
  customerName?: string;
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
}

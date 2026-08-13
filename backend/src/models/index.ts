/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model barrel export — Import models from here instead of individual files.
 */

export { default as Branch } from './Branch';
export { default as BranchSettings } from './BranchSettings';
export { default as Employee } from './Employee';
export { default as Product } from './Product';
export { default as ProductVariant } from './ProductVariant';
export { default as Customer } from './Customer';
export { default as CustomerVisit } from './CustomerVisit';
export { default as Reward } from './Reward';
export { default as Bill } from './Bill';
export { default as BillItem } from './BillItem';
export { default as Order } from './Order';
export { default as OrderItem } from './OrderItem';
export { default as KOTRecord } from './KOTRecord';
export { default as TimelineEvent } from './TimelineEvent';
export { default as Expense } from './Expense';
export { default as Reservation } from './Reservation';
export { default as WaitingEntry } from './WaitingEntry';
export { default as Table } from './Table';
export { default as Floor } from './Floor';
export { default as TakeawayOrder } from './TakeawayOrder';
export { default as HeldOrder } from './HeldOrder';
export { default as MenuAvailability } from './MenuAvailability';
export { default as OrderAdjustment } from './OrderAdjustment';
export { default as RefundRecord } from './RefundRecord';
export { default as DailySummary } from './DailySummary';
export { default as MonthlySummary } from './MonthlySummary';
export { default as YearlySummary } from './YearlySummary';
export { default as AuditLog } from './AuditLog';
export {
  AuditChainMeta,
  AuditLogArchive,
  AuditExportJob,
  AuditAlert,
  AuditLegalHold,
  AuditSavedSearch,
  AUDIT_META_ID,
} from '../modules/audit/models';
export { default as AIUsageLog } from './AIUsageLog';
export { default as AiQuotaSnapshot } from './AiQuotaSnapshot';
export type { IAiQuotaSnapshot, IQuotaWindow } from './AiQuotaSnapshot';
export { default as InvoiceCounter } from './InvoiceCounter';
export { default as OrderCounter } from './OrderCounter';
export { default as Restaurant } from './Restaurant';
export { default as User } from './User';
export { default as Device } from './Device';
export { default as Subscription } from './Subscription';
export { default as SubscriptionPlan } from './SubscriptionPlan';
export { default as License } from './License';
export { default as WebhookEvent } from './WebhookEvent';
export { default as RefreshToken } from './RefreshToken';
export { default as Authorization } from './Authorization';
export { default as Purchase } from './Purchase';
export { default as InventoryEvent } from './InventoryEvent';
export { default as Supplier } from './Supplier';
export type { ISupplier } from './Supplier';
export { default as LoyaltyTier } from './LoyaltyTier';
export { default as LoyaltySettings } from './LoyaltySettings';
export { default as LoyaltyTransaction } from './LoyaltyTransaction';
export { default as OtpRequest } from './OtpRequest';
export { default as CouponRedemption } from './CouponRedemption';
export { default as CustomerActivity } from './CustomerActivity';
export { default as Referral } from './Referral';
export { default as Campaign } from './Campaign';
export { default as ExpenseCategory } from './ExpenseCategory';
export { default as Vendor } from './Vendor';
export { default as RecurringExpense } from './RecurringExpense';
export { default as CashLedger } from './CashLedger';
export { default as FinanceSettings } from './FinanceSettings';
export { default as RestaurantSettings } from '../modules/settings/models/RestaurantSettings';
export { default as Printer } from '../modules/settings/models/Printer';
export { default as CostSettings } from '../modules/recipes/models/CostSettings';
export type { ICostSettings } from '../modules/recipes/models/CostSettings';
export { default as SupportTicket } from './SupportTicket';
export { default as TicketReply } from './TicketReply';
export { default as TicketCounter } from './TicketCounter';
export { default as Recipe } from '../modules/recipes/models/Recipe';
export { default as RecipeVersion } from '../modules/recipes/models/RecipeVersion';
export { default as RecipeConsumption } from '../modules/recipes/models/RecipeConsumption';

// Phase 2.10 — Admin Reports
export {
  RevenueEvent,
  Refund,
  SubscriptionHistory,
  AIBillingRecord,
  PlatformEvent,
  InactiveRestaurantSnapshot,
  ReportSnapshot,
  ReportExportJob,
} from '../modules/adminReports/models';
export type {
  IRevenueEvent,
  RevenueEventType,
  IRefund,
  RefundStatus,
  ISubscriptionHistory,
  SubscriptionHistoryAction,
  IAIBillingRecord,
  IPlatformEvent,
  IInactiveRestaurantSnapshot,
  IReportSnapshot,
  IReportExportJob,
} from '../modules/adminReports/models';

// Type exports for use in repositories and services
export type { IBranch } from './Branch';
export type { IBranchSettings } from './BranchSettings';
export type { IEmployee } from './Employee';
export type { IProduct } from './Product';
export type { IProductVariant } from './ProductVariant';
export type { ICustomer } from './Customer';
export type { ICustomerVisit } from './CustomerVisit';
export type { IReward } from './Reward';
export type { IBill } from './Bill';
export type { IBillItem } from './BillItem';
export type { IOrder } from './Order';
export type { IOrderItem } from './OrderItem';
export type { IKOTRecord } from './KOTRecord';
export type { ITimelineEvent } from './TimelineEvent';
export type { IExpense } from './Expense';
export type { IReservation } from './Reservation';
export type { IWaitingEntry } from './WaitingEntry';
export type { ITable } from './Table';
export type { IFloor } from './Floor';
export type { ITakeawayOrder } from './TakeawayOrder';
export type { IMenuAvailability, OnlineAvailabilityStatus, AvailabilitySource } from './MenuAvailability';
export type { IOrderAdjustment, OrderAdjustmentAction, AdjustmentLine } from './OrderAdjustment';
export type { IRefundRecord, RefundGateway } from './RefundRecord';
export type { IHeldOrder } from './HeldOrder';
export type { IDailySummary } from './DailySummary';
export type { IMonthlySummary } from './MonthlySummary';
export type { IYearlySummary } from './YearlySummary';
export type { IAuditLog } from './AuditLog';
export type { IAIUsageLog } from './AIUsageLog';
export type { IRestaurant } from './Restaurant';
export type { IUser, UserRole } from './User';
export type { IDevice } from './Device';
export type { ISubscription, SubscriptionStatus } from './Subscription';
export type { ISubscriptionPlan } from './SubscriptionPlan';
export type { ILicense, LicenseType } from './License';
export type { IWebhookEvent } from './WebhookEvent';
export type { IRefreshToken } from './RefreshToken';
export type { IAuthorization, AuthorizationAction } from './Authorization';
export type { CustomerTier, CustomerStatus } from './Customer';
export type { ILoyaltyTier } from './LoyaltyTier';
export type { ILoyaltySettings, PointExpiryMode } from './LoyaltySettings';
export type { ILoyaltyTransaction, LoyaltyTransactionType } from './LoyaltyTransaction';
export type { IOtpRequest, OtpPurpose } from './OtpRequest';
export type { ICouponRedemption } from './CouponRedemption';
export type { ICustomerActivity, CustomerActivityType } from './CustomerActivity';
export type { IReferral, ReferralStatus } from './Referral';
export type { ICampaign, CampaignChannel, CampaignStatus } from './Campaign';
export type { IExpenseCategory } from './ExpenseCategory';
export type { IVendor } from './Vendor';
export type { IRecurringExpense, RecurrenceFrequency } from './RecurringExpense';
export type { ICashLedger, CashLedgerType } from './CashLedger';
export type { IFinanceSettings } from './FinanceSettings';
export type { IExpenseAttachment } from './Expense';
export type { IRestaurantSettings, SettingsScope } from '../modules/settings/models/RestaurantSettings';
export type { IPrinter, PrinterType } from '../modules/settings/models/Printer';
export type { ISupportTicket, TicketCategory, TicketPriority, TicketStatus, TicketSource, TicketAttachmentMeta, TicketTimelineEntry } from './SupportTicket';
export { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TICKET_SOURCES } from './SupportTicket';
export type { ITicketReply } from './TicketReply';
export type { ITicketCounter } from './TicketCounter';
export type { IRecipe, IRecipeComponent, RecipeStatus } from '../modules/recipes/models/Recipe';
export type { IRecipeVersion, IRecipeVersionComponent } from '../modules/recipes/models/RecipeVersion';
export type { IRecipeConsumption, IRecipeConsumptionLine, IRecipeConsumptionItem, ConsumptionStatus } from '../modules/recipes/models/RecipeConsumption';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model barrel export — Import models from here instead of individual files.
 */

export { default as Branch } from './core/Branch';
export { default as BranchSettings } from './core/BranchSettings';
export { default as Employee } from './core/Employee';
export { default as Product } from './catalog/Product';
export { default as ProductVariant } from './catalog/ProductVariant';
export { default as Customer } from './customers/Customer';
export { default as CustomerVisit } from './customers/CustomerVisit';
export { default as Reward } from './customers/Reward';
export { default as Bill } from './intelligence/Bill';
export { default as BillItem } from './intelligence/BillItem';
export { default as Order } from './orders/Order';
export { default as OrderItem } from './orders/OrderItem';
export { default as KOTRecord } from './orders/KOTRecord';
export { default as TimelineEvent } from './orders/TimelineEvent';
export { default as Expense } from './finance/Expense';
export { default as Reservation } from './orders/Reservation';
export { default as WaitingEntry } from './orders/WaitingEntry';
export { default as Table } from './orders/Table';
export { default as Floor } from './orders/Floor';
export { default as TakeawayOrder } from './orders/TakeawayOrder';
export { default as HeldOrder } from './orders/HeldOrder';
export { default as MenuAvailability } from './catalog/MenuAvailability';
export { default as OrderAdjustment } from './orders/OrderAdjustment';
export { default as RefundRecord } from './orders/RefundRecord';
export { default as DailySummary } from './finance/DailySummary';
export { default as DailySummaryEvidence } from './finance/DailySummaryEvidence';
export type { IDailySummaryEvidence } from './finance/DailySummaryEvidence';
export { default as MonthlySummary } from './finance/MonthlySummary';
export { default as YearlySummary } from './finance/YearlySummary';
export { default as AuditLog } from './admin/AuditLog';
export {
  AuditChainMeta,
  AuditLogArchive,
  AuditExportJob,
  AuditAlert,
  AuditLegalHold,
  AuditSavedSearch,
  AUDIT_META_ID,
} from '../modules/audit/models';
export { default as AIUsageLog } from './core/AIUsageLog';
export { default as AiQuotaSnapshot } from './core/AiQuotaSnapshot';
export type { IAiQuotaSnapshot, IQuotaWindow } from './core/AiQuotaSnapshot';
export { default as InvoiceCounter } from './orders/InvoiceCounter';
export { default as OrderCounter } from './orders/OrderCounter';
export { default as Restaurant } from './core/Restaurant';
export { default as User } from './core/User';
export { default as Device } from './core/Device';
export { default as Subscription } from './core/Subscription';
export { default as SubscriptionPlan } from './core/SubscriptionPlan';
export { default as License } from './core/License';
export { default as WebhookEvent } from './orders/WebhookEvent';
export { default as RefreshToken } from './core/RefreshToken';
export { default as Authorization } from './core/Authorization';
export { default as Purchase } from './catalog/Purchase';
export { default as InventoryEvent } from './catalog/InventoryEvent';
export { default as Supplier } from './catalog/Supplier';
export type { ISupplier } from './catalog/Supplier';
export { default as LoyaltyTier } from './customers/LoyaltyTier';
export { default as LoyaltySettings } from './customers/LoyaltySettings';
export { default as LoyaltyTransaction } from './customers/LoyaltyTransaction';
export { default as OtpRequest } from './core/OtpRequest';
export { default as ReceiptFeedback } from './customers/ReceiptFeedback';
export { default as CouponRedemption } from './customers/CouponRedemption';
export { default as CustomerActivity } from './customers/CustomerActivity';
export { default as Referral } from './customers/Referral';
export { default as Campaign } from './marketing/Campaign';
export { default as ExpenseCategory } from './finance/ExpenseCategory';
export { default as Offer } from './marketing/Offer';
export { default as CustomerSegment } from './customers/CustomerSegment';
export { default as Vendor } from './catalog/Vendor';
export { default as RecurringExpense } from './finance/RecurringExpense';
export { default as CashLedger } from './finance/CashLedger';
export { default as FinanceSettings } from './finance/FinanceSettings';
export { default as Shift } from './finance/Shift';
export { default as RestaurantSettings } from '../modules/settings/models/RestaurantSettings';
export { default as Printer } from '../modules/settings/models/Printer';
export { default as CostSettings } from '../modules/recipes/models/CostSettings';
export type { ICostSettings } from '../modules/recipes/models/CostSettings';
export { default as SupportTicket } from './admin/SupportTicket';
export { default as TicketReply } from './admin/TicketReply';
export { default as TicketCounter } from './admin/TicketCounter';
export { default as Recipe } from '../modules/recipes/models/Recipe';
export { default as RecipeVersion } from '../modules/recipes/models/RecipeVersion';
export { default as RecipeConsumption } from '../modules/recipes/models/RecipeConsumption';
export { default as WhatsAppIntegration } from '../modules/whatsapp/models/WhatsAppIntegration';
export { default as WhatsAppIntegrationHistory } from '../modules/whatsapp/models/WhatsAppIntegrationHistory';
export { default as WhatsAppUsage } from '../modules/whatsapp/models/WhatsAppUsage';
export type { IWhatsAppIntegration, WhatsAppIntegrationStatus } from '../modules/whatsapp/models/WhatsAppIntegration';
export type { IWhatsAppIntegrationHistory, IntegrationHistoryStatus } from '../modules/whatsapp/models/WhatsAppIntegrationHistory';
export type { IWhatsAppUsage, WhatsAppMessageCategory, WhatsAppMessageStatus } from '../modules/whatsapp/models/WhatsAppUsage';

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
export type { IBranch } from './core/Branch';
export type { IBranchSettings } from './core/BranchSettings';
export type { IEmployee } from './core/Employee';
export type { IProduct, ProductType } from './catalog/Product';
export type { IProductVariant } from './catalog/ProductVariant';
export type { ICustomer } from './customers/Customer';
export type { ICustomerVisit } from './customers/CustomerVisit';
export type { IReward } from './customers/Reward';
export type { IBill } from './intelligence/Bill';
export type { IBillItem } from './intelligence/BillItem';
export type { IOrder } from './orders/Order';
export type { IOrderItem } from './orders/OrderItem';
export type { IKOTRecord } from './orders/KOTRecord';
export type { ITimelineEvent } from './orders/TimelineEvent';
export type { IExpense } from './finance/Expense';
export type { IReservation } from './orders/Reservation';
export type { IWaitingEntry } from './orders/WaitingEntry';
export type { ITable } from './orders/Table';
export type { IFloor } from './orders/Floor';
export type { ITakeawayOrder } from './orders/TakeawayOrder';
export type { IMenuAvailability, OnlineAvailabilityStatus, AvailabilitySource } from './catalog/MenuAvailability';
export type { IOrderAdjustment, OrderAdjustmentAction, AdjustmentLine } from './orders/OrderAdjustment';
export type { IRefundRecord, RefundGateway } from './orders/RefundRecord';
export type { IHeldOrder } from './orders/HeldOrder';
export type { IDailySummary } from './finance/DailySummary';
export type { IMonthlySummary } from './finance/MonthlySummary';
export type { IYearlySummary } from './finance/YearlySummary';
export type { IAuditLog } from './admin/AuditLog';
export type { IAIUsageLog } from './core/AIUsageLog';
export type { IRestaurant } from './core/Restaurant';
export type { IUser, UserRole } from './core/User';
export type { IDevice } from './core/Device';
export type { ISubscription, SubscriptionStatus } from './core/Subscription';
export type { ISubscriptionPlan } from './core/SubscriptionPlan';
export type { ILicense, LicenseType } from './core/License';
export type { IWebhookEvent } from './orders/WebhookEvent';
export type { IRefreshToken } from './core/RefreshToken';
export type { IAuthorization, AuthorizationAction } from './core/Authorization';
export type { CustomerTier, CustomerStatus } from './customers/Customer';
export type { ILoyaltyTier } from './customers/LoyaltyTier';
export type { ILoyaltySettings, PointExpiryMode } from './customers/LoyaltySettings';
export type { ILoyaltyTransaction, LoyaltyTransactionType } from './customers/LoyaltyTransaction';
export type { IOtpRequest, OtpPurpose } from './core/OtpRequest';
export type { IReceiptFeedback } from './customers/ReceiptFeedback';
export type { ICouponRedemption } from './customers/CouponRedemption';
export type { ICustomerActivity, CustomerActivityType } from './customers/CustomerActivity';
export type { IReferral, ReferralStatus } from './customers/Referral';
export type { ICampaign, CampaignChannel, CampaignStatus } from './marketing/Campaign';
export type { IOffer, OfferType, OfferStatus, OfferRecommendationSource } from './marketing/Offer';
export type { ICustomerSegment, SegmentType } from './customers/CustomerSegment';
export type { ICampaignProposal, CampaignProposalObjective, CampaignProposalStrategy, CampaignProposalApprovalStatus, CampaignProposalExecutionStatus, CampaignProposalChannel, CampaignProposalStatusTransition, AutomationGuardrails, CampaignAutomationMode } from './marketing/CampaignProposal';
export type { IExpenseCategory } from './finance/ExpenseCategory';
export type { IVendor } from './catalog/Vendor';
export type { IRecurringExpense, RecurrenceFrequency } from './finance/RecurringExpense';
export type { ICashLedger, CashLedgerType } from './finance/CashLedger';
export type { IFinanceSettings } from './finance/FinanceSettings';
export type { IExpenseAttachment } from './finance/Expense';
export type { IRestaurantSettings, SettingsScope } from '../modules/settings/models/RestaurantSettings';
export type { IPrinter, PrinterType } from '../modules/settings/models/Printer';
export type { ISupportTicket, TicketCategory, TicketPriority, TicketStatus, TicketSource, TicketAttachmentMeta, TicketTimelineEntry } from './admin/SupportTicket';
export { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TICKET_SOURCES } from './admin/SupportTicket';
export type { ITicketReply } from './admin/TicketReply';
export type { ITicketCounter } from './admin/TicketCounter';
export type { IRecipe, IRecipeComponent, RecipeStatus } from '../modules/recipes/models/Recipe';
export type { IRecipeVersion, IRecipeVersionComponent } from '../modules/recipes/models/RecipeVersion';
export type { IRecipeConsumption, IRecipeConsumptionLine, IRecipeConsumptionItem, ConsumptionStatus } from '../modules/recipes/models/RecipeConsumption';
export type { IShift, ShiftStatus } from './finance/Shift';

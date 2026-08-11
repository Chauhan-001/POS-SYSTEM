/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repository barrel — Instantiates and exports all domain repositories.
 * Import repositories from here instead of individual files.
 *
 * Usage:
 *   import { productRepo, customerRepo } from '../repositories';
 *   const products = await productRepo.findAll();
 */

import { BaseRepository } from './baseRepository';
import { TenantRepository } from './tenantRepository';
import { LegacyAuditAdapter } from '../modules/audit/legacyAuditAdapter';
import {
  Branch, BranchSettings, Employee, Product, ProductVariant,
  Customer, CustomerVisit, Reward,
  Bill, BillItem, Order, OrderItem, KOTRecord, TimelineEvent,
  Expense, Reservation, WaitingEntry, Table, TakeawayOrder, HeldOrder,
  DailySummary, MonthlySummary, YearlySummary, AuditLog, Restaurant, User, Device, Subscription,
  License, RefreshToken, Purchase, InventoryEvent, Supplier, Floor,
  LoyaltyTier, LoyaltySettings, LoyaltyTransaction, OtpRequest,
  CouponRedemption, CustomerActivity, Referral, Campaign,
  ExpenseCategory, Vendor, RecurringExpense, CashLedger, FinanceSettings,
  MenuAvailability, OrderAdjustment, RefundRecord,
} from '../models';

// ─── Repository instances ──────────────────────────────────────────

export const branchRepo = new BaseRepository(Branch);
export const branchSettingsRepo = new BaseRepository(BranchSettings);
export const employeeRepo = new BaseRepository(Employee);
export const productRepo = new BaseRepository(Product);
export const productVariantRepo = new BaseRepository(ProductVariant);
export const customerRepo = new TenantRepository(Customer);
export const customerVisitRepo = new TenantRepository(CustomerVisit);
export const rewardRepo = new BaseRepository(Reward);
export const billRepo = new BaseRepository(Bill);
export const billItemRepo = new BaseRepository(BillItem);
export const orderRepo = new BaseRepository(Order);
export const orderItemRepo = new BaseRepository(OrderItem);
export const kotRecordRepo = new BaseRepository(KOTRecord);
export const timelineEventRepo = new BaseRepository(TimelineEvent);
export const expenseRepo = new TenantRepository(Expense);
export const expenseCategoryRepo = new TenantRepository(ExpenseCategory);
export const vendorRepo = new TenantRepository(Vendor);
export const recurringExpenseRepo = new TenantRepository(RecurringExpense);
export const cashLedgerRepo = new TenantRepository(CashLedger);
export const financeSettingsRepo = new TenantRepository(FinanceSettings);
export const reservationRepo = new BaseRepository(Reservation);
export const waitingEntryRepo = new BaseRepository(WaitingEntry);
export const tableRepo = new BaseRepository(Table);
export const takeawayOrderRepo = new BaseRepository(TakeawayOrder);
export const heldOrderRepo = new BaseRepository(HeldOrder);
export const dailySummaryRepo = new TenantRepository(DailySummary);
export const monthlySummaryRepo = new TenantRepository(MonthlySummary);
export const yearlySummaryRepo = new TenantRepository(YearlySummary);
export const purchaseRepo = new BaseRepository(Purchase);
export const inventoryEventRepo = new BaseRepository(InventoryEvent);
export const supplierRepo = new BaseRepository(Supplier);
export const menuAvailabilityRepo = new BaseRepository(MenuAvailability);
export const orderAdjustmentRepo = new BaseRepository(OrderAdjustment);
export const refundRecordRepo = new BaseRepository(RefundRecord);
export const auditLogRepo = new LegacyAuditAdapter(AuditLog);
export const restaurantRepo = new BaseRepository(Restaurant);export const userRepo = new BaseRepository(User);
export const deviceRepo = new BaseRepository(Device);
export const subscriptionRepo = new BaseRepository(Subscription);
export const licenseRepo = new BaseRepository(License);
export const refreshTokenRepo = new BaseRepository(RefreshToken);
export const floorRepo = new BaseRepository(Floor);
export const loyaltyTierRepo = new TenantRepository(LoyaltyTier);
export const loyaltySettingsRepo = new TenantRepository(LoyaltySettings);
export const loyaltyTransactionRepo = new TenantRepository(LoyaltyTransaction);
export const otpRequestRepo = new TenantRepository(OtpRequest);
export const couponRedemptionRepo = new TenantRepository(CouponRedemption);
export const customerActivityRepo = new TenantRepository(CustomerActivity);
export const referralRepo = new TenantRepository(Referral);
export const campaignRepo = new TenantRepository(Campaign);

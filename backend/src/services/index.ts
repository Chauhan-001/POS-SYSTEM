/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Service barrel — Instantiates and exports all services.
 * Import services from here instead of individual files.
 *
 * Services contain business logic.
 * Repositories contain database logic.
 * Controllers handle request/response.
 */

import { AuthService } from './authService';
import { ProductService } from './productService';
import { OrderService } from './orderService';
import { BillService } from './billService';
import { CustomerService } from './customerService';
import { EmployeeService } from './employeeService';
import { BranchService } from './branchService';
import { ExpenseService } from './expenseService';
import { SyncService } from './syncService';
import { ReservationService } from './reservationService';
import { RewardService } from './rewardService';
import { TableService } from './tableService';
import { FloorService } from './floorService';
import { TakeawayOrderService } from './takeawayOrderService';
import { HeldOrderService } from './heldOrderService';
import { PurchaseService } from './purchaseService';
import { InventoryEventService } from './inventoryEventService';
import { SupplierService } from './supplierService';
import { LoyaltyService } from './loyaltyService';
import { OtpService } from './otpService';
import { ReferralService } from './referralService';
import { CampaignService } from './campaignService';
import { CustomerReportService } from './customerReportService';
import { OfferValidationService } from './offerValidationService';
import { CashLedgerService } from './cashLedgerService';
import { ExpenseCategoryService } from './expenseCategoryService';
import { VendorService } from './vendorService';
import { RecurringExpenseService } from './recurringExpenseService';
import { FinanceService } from './financeService';
import { RestaurantService } from './restaurantService';
import { OwnerService } from './ownerService';
import { PlanService } from './planService';
import { DeviceService } from './deviceService';
export { stockMovementService } from './stockMovementService';
export { sessionService } from './sessionService';
export { tableStateService } from './tableStateService';
export type { TableStatus, ReconcileCtx } from './tableStateService';
export type { StockMovementType, StockMovementInput } from './stockMovementService';

export const authService = new AuthService();
export const productService = new ProductService();
export const orderService = new OrderService();
export const billService = new BillService();
export const customerService = new CustomerService();
export const employeeService = new EmployeeService();
export const branchService = new BranchService();
export const expenseService = new ExpenseService();
export const syncService = new SyncService();
export const reservationService = new ReservationService();
export const rewardService = new RewardService();
export const tableService = new TableService();
export const floorService = new FloorService();
export const takeawayOrderService = new TakeawayOrderService();
export const heldOrderService = new HeldOrderService();
export const purchaseService = new PurchaseService();
export const inventoryEventService = new InventoryEventService();
export const supplierService = new SupplierService();
export const loyaltyService = new LoyaltyService();
export const otpService = new OtpService();
export const referralService = new ReferralService();
export const campaignService = new CampaignService();
export const customerReportService = new CustomerReportService();
export const offerValidationService = new OfferValidationService();
export const cashLedgerService = new CashLedgerService();
export const expenseCategoryService = new ExpenseCategoryService();
export const vendorService = new VendorService();
export const recurringExpenseService = new RecurringExpenseService();
export const financeService = new FinanceService();

export const restaurantService = new RestaurantService();
export const ownerService = new OwnerService();
export const planService = new PlanService();
export const deviceService = new DeviceService();

export type {
  AuthService,
  ProductService,
  OrderService,
  BillService,
  CustomerService,
  EmployeeService,
  BranchService,
  ExpenseService,
  SyncService,
  ReservationService,
  RewardService,
  TableService,
  FloorService,
  TakeawayOrderService,
  HeldOrderService,
  PurchaseService,
  InventoryEventService,
  SupplierService,
  LoyaltyService,
  OtpService,
  ReferralService,
  CampaignService,
  CustomerReportService,
  OfferValidationService,
  CashLedgerService,
  ExpenseCategoryService,
  VendorService,
  RecurringExpenseService,
  FinanceService,
  RestaurantService,
  OwnerService,
  PlanService,
  DeviceService,
};

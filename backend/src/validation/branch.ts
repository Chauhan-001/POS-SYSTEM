import { z } from 'zod';
import { nonEmptyString, optString, optBool, objectId } from './common';

export const createBranchSchema = z.object({
  name: nonEmptyString.max(200),
  address: optString,
  phone: z.string().max(20).optional(),
  isHeadBranch: optBool,
  isActive: optBool,
}).strict();

export const updateBranchSchema = createBranchSchema.partial();

export const branchParamsSchema = z.object({
  id: objectId,
}).strict();

const moduleSettingsSchema = z.object({
  enableTableService: z.boolean().optional(),
  enableWaiterManagement: z.boolean().optional(),
  enableReservations: z.boolean().optional(),
  enableQROrdering: z.boolean().optional(),
  enableDeliveryModule: z.boolean().optional(),
  enableOnlineOrders: z.boolean().optional(),
  enableKitchenDisplay: z.boolean().optional(),
  enableLoyalty: z.boolean().optional(),
  showImagesInBilling: z.boolean().optional(),
  showCashierPerformance: z.boolean().optional(),
  enableMultiBranch: z.boolean().optional(),
  enableOffersPopup: z.boolean().optional(),
  enableAutoPrintKOT: z.boolean().optional(),
  enableQuickSoundAlerts: z.boolean().optional(),
  showItemCodeOnCard: z.boolean().optional(),
  enableGuestCheckout: z.boolean().optional(),
  enableOrderNotes: z.boolean().optional(),
  enableTakeawayModule: z.boolean().optional(),
  enableDineInModule: z.boolean().optional(),
  enableExpenseManagement: z.boolean().optional(),
  enableDiscountOnBilling: z.boolean().optional(),
  callReminderIntervalSec: z.number().int().min(0).max(3600).optional(),
}).optional();

export const updateBranchSettingsSchema = z.object({
  restaurantName: optString,
  gstin: z.string().max(50).optional(),
  address: optString,
  phone: z.string().max(20).optional(),
  currency: z.string().max(10).optional(),
  currencySymbol: z.string().min(1).max(5).optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
  printSize: z.enum(['58mm', '80mm']).optional(),
  brandingColor: z.string().max(20).optional(),
  autoPrintReceipt: z.boolean().optional(),
  invoicePrefix: optString,
  invoiceStartingNumber: z.number().int().min(1).optional(),
  invoiceSuffix: optString,
  receiptFooterMessage: optString,
  moduleSettings: moduleSettingsSchema,
}).strict();

/**
 * 15-settings.ts — Configures all settings for the demo restaurant.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, rand } from './helpers';
import { daysAgo } from './helpers';

export async function seedSettings(db: Db, ctx: SeedContext): Promise<void> {
  console.log('⚙️  Seeding settings...');
  const rid = ctx.restaurantId;

  // Restaurant Settings (POS)
  await db.collection('restaurantssettings').insertOne({
    _id: oid(), restaurantId: rid, scope: 'restaurant',
    settingsVersion: 1,
    settings: {
      restaurantName: 'The Royal Bistro',
      gstin: '09AABCR1234F1Z5',
      address: '42, Hazratganj Main Road, Lucknow',
      phone: '9876543210',
      email: 'contact@royalbistro.in',
      fssai: '10019002000312',
      pan: 'AABCR1234F',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pinCode: '226001',
      invoicePrefix: 'RB-',
      invoiceStartingNumber: 2001,
      invoiceSuffix: '',
      printSize: '80mm',
      defaultTaxRate: 5,
      taxRules: { prepared_food: 5, beverage: 5, packaged: 12, other: 18 },
      openingTime: '08:00',
      closingTime: '23:30',
      showCustomerNameOnReceipt: true,
      showLoyaltyPointsOnReceipt: true,
      showLoyaltyPointsEarnedOnReceipt: true,
      showQrCodeOnReceipt: true,
      showDiscountBreakdownOnReceipt: true,
      printLogoOnReceipt: true,
      roundOffTotal: true,
      showTaxSummaryOnReceipt: true,
      receiptFooterMessage: 'THANK YOU FOR DINING WITH US!',
      sidebarLogoUrl: '/api/media/demo-restaurant-logo.jpg',
      kotOutputMode: 'both',
      printCategoryHeaders: true,
      showItemModifiers: true,
      showOrderTime: true,
      showTableNumber: true,
      groupItemsInKOT: true,
      kotFooterNote: 'Cook with passion!',
      onlineOrderAutoKot: true,
      moduleSettings: {
        enableTableService: true, enableWaiterManagement: true,
        enableReservations: true, enableQROrdering: true,
        enableDeliveryModule: true, enableOnlineOrders: true,
        enableKitchenDisplay: true, enableLoyalty: true,
        showImagesInBilling: true, showCashierPerformance: true,
        enableMultiBranch: true, enableOffersPopup: true,
        enableAutoPrintKOT: false, enableQuickSoundAlerts: true,
        showItemCodeOnCard: false, enableGuestCheckout: true,
        enableOrderNotes: true, enableTakeawayModule: true,
        enableDineInModule: true, enableExpenseManagement: true,
        enableDiscountOnBilling: true, enableProducts: true,
        enableStaff: true, enableOffers: true,
        autoMarkSoldOutFromOrder: false, enableMenuAvailability: true,
        enableAISummary: true, enableAIInventoryHealth: true,
        enableAIPurchaseRecs: true, enableAILowStock: true,
        enableAIWasteAnalysis: true, enableAIVoiceEntry: true,
        enableAIWeather: true, enableAIClosingAssistant: true,
        callReminderIntervalSec: 15,
      },
      theme: { mode: 'light', brandColor: '#004ac6', accentColor: '#10b981', density: 'comfortable', borderRadius: 12 },
      notifications: { lowStock: true, orders: true, sales: true, backups: true, printerErrors: true, syncFailures: true, employeeAlerts: false, channels: ['desktop'] },
      security: { passwordMinLength: 8, sessionTimeoutMinutes: 60, autoLogout: true, failedLoginLockThreshold: 5, twoFactorEnabled: false, loginMethod: 'pin' },
      discount: { maxDiscountPct: 25, managerApprovalAbove: 10, ownerApprovalAbove: 25, reasons: ['Festival offer', 'Customer complaint', 'Complimentary', 'Food quality issue'], allowStacking: false },
    },
    history: [], updatedBy: 'system', createdAt: daysAgo(180), updatedAt: new Date(),
  });

  // Loyalty Settings
  await db.collection('loyaltysettings').insertOne({
    _id: oid(), restaurantId: rid,
    enabled: true, pointsPerCurrency: 1, pointsValueInCurrency: 10,
    welcomePoints: 100, referralReferrerPoints: 200, referralRefereePoints: 100,
    minRedemption: 50, largeRewardThreshold: 500,
    enableTiers: true,
    createdAt: daysAgo(180), updatedAt: new Date(),
  });

  // Loyalty Tiers
  const tiers = [
    { name: 'Bronze', minLifetimeSpend: 0, pointsMultiplier: 1, priority: 1 },
    { name: 'Silver', minLifetimeSpend: 5000, pointsMultiplier: 1.2, priority: 2 },
    { name: 'Gold', minLifetimeSpend: 10000, pointsMultiplier: 1.5, priority: 3 },
    { name: 'Platinum', minLifetimeSpend: 20000, pointsMultiplier: 2, priority: 4 },
  ];
  for (const t of tiers) {
    await db.collection('loyaltytiers').insertOne({
      _id: oid(), restaurantId: rid, ...t, benefits: [], isActive: true, isDeleted: false,
      createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  // Rewards
  const rewards = [
    { title: '10% Off Bill', type: 'percentage', value: 10, pointsRequired: 200, minBillAmount: 300 },
    { title: '₹50 Off', type: 'flat', value: 50, pointsRequired: 500, minBillAmount: 200 },
    { title: 'Free Cold Coffee', type: 'item', value: 0, pointsRequired: 300, rewardItemName: 'Cold Coffee', minBillAmount: 0 },
    { title: 'Free Dessert', type: 'item', value: 0, pointsRequired: 250, rewardItemName: 'Gulab Jamun', minBillAmount: 0 },
    { title: '20% Off Large Bills', type: 'percentage', value: 20, pointsRequired: 800, minBillAmount: 500, isLargeReward: true },
  ];
  for (const r of rewards) {
    await db.collection('rewards').insertOne({
      _id: oid(), restaurantId: rid, ...r, type: r.type,
      description: r.title, isActive: true, isDeleted: false,
      stock: null, redeemedCount: rand(5, 40),
      createdAt: daysAgo(170), updatedAt: new Date(),
    });
  }

  // Finance Settings
  await db.collection('financesettings').insertOne({
    _id: oid(), restaurantId: rid,
    gstRate: 5, cogsEnabled: true, drawerOpeningBalance: 5000,
    gstRegistered: true, gstNumber: '09AABCR1234F1Z5',
    createdAt: daysAgo(180), updatedAt: new Date(),
  });

  // Expense Categories
  const expenseCats = ['Staff Salary', 'Rent', 'Utilities', 'Maintenance', 'Marketing', 'Insurance', 'Raw Materials', 'Packaging', 'Cleaning', 'Miscellaneous'];
  for (const cat of expenseCats) {
    await db.collection('expensecategories').insertOne({
      _id: oid(), restaurantId: rid, name: cat, isActive: true, isDeleted: false,
      createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  // Printers
  await db.collection('printers').insertOne({
    _id: oid(), restaurantId: rid, name: 'Main Receipt Printer',
    type: 'receipt', connection: { kind: 'network', host: '192.168.1.100', port: 9100 },
    paperSize: '80mm', copies: 1, isDefault: true, enabled: true,
    createdAt: daysAgo(180), updatedAt: new Date(),
  });
  await db.collection('printers').insertOne({
    _id: oid(), restaurantId: rid, name: 'Kitchen Printer',
    type: 'kitchen', connection: { kind: 'network', host: '192.168.1.101', port: 9100 },
    paperSize: '80mm', copies: 1, isDefault: false, enabled: true,
    createdAt: daysAgo(180), updatedAt: new Date(),
  });

  // Cost Settings (recipes)
  await db.collection('costsettings').insertOne({
    _id: oid(), restaurantId: rid,
    enableAutoCosting: true, defaultFoodCostTarget: 30,
    createdAt: daysAgo(180), updatedAt: new Date(),
  });

  console.log('   ✅ Settings configured');
}

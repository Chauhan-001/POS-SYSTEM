/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seed data helper for Playwright E2E tests.
 * This script runs in the browser context (page.addInitScript) to populate
 * localStorage before the POS app loads, ensuring deterministic test data.
 */

/**
 * Returns a serializable JavaScript string that seeds localStorage
 * for the standard ordering flow tests (single branch, no multi-branch).
 */
export function getSeedScript(): string {
  return `
    (() => {
      const storage = window.localStorage;

      // ── Employees ──────────────────────────────────────────
      const employees = [
        { id: 'emp_owner', username: 'owner', name: 'Rajesh Kumar', role: 'Owner', pin: '1111', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-20 09:15 AM' },
        { id: 'emp_manager', username: 'manager', name: 'Vansh Patel', role: 'Manager', pin: '2222', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-20 08:30 AM' },
        { id: 'emp_cashier1', username: 'cashier', name: 'Ravi Singh', role: 'Cashier', pin: '3333', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-20 10:00 AM' },
        { id: 'emp_cashier2', username: 'priya', name: 'Priya Sharma', role: 'Cashier', pin: '4444', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-19 02:00 PM' },
      ];
      storage.setItem('pos_employees', JSON.stringify(employees));

      // ── Products ───────────────────────────────────────────
      const products = [
        { id: 'p1', code: 'PZA01', name: 'Margherita Pizza', category: 'Pizzas', price: 249, image: '', availability: true, favorite: true, gst: 5 },
        { id: 'p2', code: 'BRG01', name: 'Classic Burger', category: 'Burgers', price: 179, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p3', code: 'PST01', name: 'White Sauce Pasta', category: 'Pasta', price: 199, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p4', code: 'BEV01', name: 'Cold Coffee', category: 'Beverages', price: 129, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p5', code: 'DES01', name: 'Gulab Jamun', category: 'Desserts', price: 89, image: '', availability: true, favorite: true, gst: 5 },
        { id: 'p6', code: 'APZ01', name: 'French Fries', category: 'Appetizers', price: 99, image: '', availability: true, favorite: false, gst: 5 },
      ];
      storage.setItem('pos_products', JSON.stringify(products));

      // ── Categories ─────────────────────────────────────────
      const categories = ['Pizzas', 'Burgers', 'Pasta', 'Beverages', 'Desserts', 'Appetizers'];
      storage.setItem('pos_categories', JSON.stringify(categories));

      // ── Category Colors ────────────────────────────────────
      const categoryColors = {
        'Pizzas': '#ef4444',
        'Burgers': '#f59e0b',
        'Pasta': '#10b981',
        'Beverages': '#0ea5e9',
        'Desserts': '#ec4899',
        'Appetizers': '#f97316',
      };
      storage.setItem('pos_category_colors', JSON.stringify(categoryColors));

      // ── Customers ──────────────────────────────────────────
      const customers = [
        { id: 'c1', name: 'Amit Sharma', phone: '9876543210', email: 'amit@example.com', totalVisits: 15, totalSpent: 5200, points: 350, createdAt: '2026-01-15' },
        { id: 'c2', name: 'Priya Patel', phone: '9876543211', email: 'priya@example.com', totalVisits: 8, totalSpent: 2800, points: 150, createdAt: '2026-03-10' },
      ];
      storage.setItem('pos_customers', JSON.stringify(customers));

      // ── Rewards ────────────────────────────────────────────
      const rewards = [
        { id: 'r1', type: 'percentage', title: '10% Off', description: '10% discount on total bill', value: 10, pointsRequired: 100, isActive: true },
        { id: 'r2', type: 'flat', title: '₹50 Off', description: '₹50 flat discount', value: 50, pointsRequired: 80, isActive: true },
        { id: 'r3', type: 'item', title: 'Free Drink', description: 'Free beverage on order above ₹300', value: 0, pointsRequired: 60, isActive: true, itemId: 'p4' },
      ];
      storage.setItem('pos_rewards', JSON.stringify(rewards));

      // ── Settings (single branch) ───────────────────────────
      const settings = {
        restaurantName: 'Test Bistro',
        currencySymbol: '₹',
        defaultTaxRate: 5,
        gstRate: 5,
        enableGst: true,
        printerSize: '80mm',
        enableKitchenDisplay: true,
        enableTableService: true,
        enableDeliveryModule: true,
        enableOnlineOrders: true,
        enableLoyalty: true,
        showImagesInBilling: false,
        moduleSettings: {
          enableTableService: true,
          enableLoyalty: true,
          enableKitchenDisplay: true,
          enableDeliveryModule: true,
          enableOnlineOrders: true,
          enableQROrdering: false,
          showImagesInBilling: false,
          enableOrderNotes: true,
          enableDiscountOnBilling: true,
          enableGuestCheckout: true,
          enableExpenseManagement: true,
        },
      };
      storage.setItem('pos_settings', JSON.stringify(settings));

      // ── Bills ──────────────────────────────────────────────
      storage.setItem('pos_bills', JSON.stringify([]));

      // ── Orders ─────────────────────────────────────────────
      storage.setItem('pos_orders', JSON.stringify([]));

      // ── Held Orders ────────────────────────────────────────
      storage.setItem('pos_held_orders', JSON.stringify([]));

      // ── Expenses ───────────────────────────────────────────
      storage.setItem('pos_expenses', JSON.stringify([]));

      // ── Tables ─────────────────────────────────────────────
      const tables = [];
      for (let i = 1; i <= 8; i++) {
        const sections = ['Main Hall', 'Terrace', 'VIP Room', 'Garden'];
        tables.push({
          id: 'table_' + i,
          number: i,
          capacity: i % 4 === 0 ? 8 : i % 3 === 0 ? 6 : 4,
          status: 'Available',
          section: sections[(i - 1) % 4],
        });
      }
      storage.setItem('pos_tables', JSON.stringify(tables));

      // ── Takeaway Orders ────────────────────────────────────
      storage.setItem('pos_takeaway_orders', JSON.stringify([]));

      // ── Reservations ───────────────────────────────────────
      storage.setItem('pos_reservations', JSON.stringify([]));

      // ── Branches (single) ────────────────────────────────────
      const branches = [
        { id: 'branch_main', name: 'Main Branch', address: '123 Main St', phone: '+91-22-22004400', isHeadBranch: true, isActive: true, createdAt: '2026-01-01T00:00:00Z' },
      ];
      storage.setItem('pos_branches', JSON.stringify(branches));
      storage.setItem('pos_current_branch_id', JSON.stringify('branch_main'));

      // ── App Initialization Flag ────────────────────────────
      storage.setItem('pos_initialized_clean_v5', 'true');

      // ── Onboarding ─────────────────────────────────────────
      storage.setItem('pos_onboarding_done', 'true');

      // ── Subscription features (legacy keys — read even without a JWT) ─
      // Phase 1.10: usePOSState reads the non-namespaced cache when no JWT
      // restaurantId is present, so seeding these keys makes plan-gated UI
      // (AI card, Branches, Reports…) render deterministically after a normal
      // form login (which runs in offline fallback mode with no token).
      storage.setItem('pos_subscription_status', JSON.stringify('trial'));
      storage.setItem('pos_subscription_features', JSON.stringify([
        'core_pos', 'basic_reports', 'inventory', 'loyalty', 'multi_branch',
        'analytics', 'expense_tracking', 'ai', 'advanced_reports',
      ]));

      // ── Current Employee (auto-login as Owner) ────────────────
      // Setting this means useAuth initializes with isAuthenticated=true,
      // so the app skips the LoginScreen entirely and renders the POS layout.
      // This is needed because useAuth creates separate standalone instances
      // in App.tsx and LoginScreen.tsx (no shared AuthProvider).
      storage.setItem('pos_current_employee', JSON.stringify({
        id: 'emp_owner',
        username: 'owner',
        name: 'Rajesh Kumar',
        role: 'Owner',
        pin: '1111',
        status: 'Active',
        branchId: 'branch_main',
      }));

      console.log('[E2E Seed] localStorage seeded (single branch)');
    })();
  `;
}

/**
 * Returns a seed script that includes multi-branch configuration.
 * Adds a second branch, enables multi-branch in settings, and
 * assigns employees to the correct branches.
 */
export function getMultiBranchSeedScript(): string {
  return `
    (() => {
      const storage = window.localStorage;

      // ── Employees (split across two branches) ──────────────
      const employees = [
        { id: 'emp_owner', username: 'owner', name: 'Rajesh Kumar', role: 'Owner', pin: '1111', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-20 09:15 AM' },
        { id: 'emp_manager', username: 'manager', name: 'Vansh Patel', role: 'Manager', pin: '2222', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-20 08:30 AM' },
        // Downtown branch employees
        { id: 'emp_cashier1', username: 'cashier', name: 'Ravi Singh', role: 'Cashier', pin: '3333', status: 'Active', branchId: 'branch_downtown', lastLogin: '2026-07-20 10:00 AM' },
        { id: 'emp_cashier_dt', username: 'dtcashier', name: 'Neha Kapoor', role: 'Cashier', pin: '5555', status: 'Active', branchId: 'branch_downtown', lastLogin: '2026-07-20 09:30 AM' },
        { id: 'emp_cashier2', username: 'priya', name: 'Priya Sharma', role: 'Cashier', pin: '4444', status: 'Active', branchId: 'branch_main', lastLogin: '2026-07-19 02:00 PM' },
      ];
      storage.setItem('pos_employees', JSON.stringify(employees));

      // ── Products ───────────────────────────────────────────
      const products = [
        { id: 'p1', code: 'PZA01', name: 'Margherita Pizza', category: 'Pizzas', price: 249, image: '', availability: true, favorite: true, gst: 5 },
        { id: 'p2', code: 'BRG01', name: 'Classic Burger', category: 'Burgers', price: 179, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p3', code: 'PST01', name: 'White Sauce Pasta', category: 'Pasta', price: 199, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p4', code: 'BEV01', name: 'Cold Coffee', category: 'Beverages', price: 129, image: '', availability: true, favorite: false, gst: 5 },
        { id: 'p5', code: 'DES01', name: 'Gulab Jamun', category: 'Desserts', price: 89, image: '', availability: true, favorite: true, gst: 5 },
        { id: 'p6', code: 'APZ01', name: 'French Fries', category: 'Appetizers', price: 99, image: '', availability: true, favorite: false, gst: 5 },
        // Downtown-only product
        { id: 'p7', code: 'SPC01', name: 'Special Downtown Pizza', category: 'Pizzas', price: 349, image: '', availability: true, favorite: false, gst: 5, branchId: 'branch_downtown' },
      ];
      storage.setItem('pos_products', JSON.stringify(products));

      // ── Categories ─────────────────────────────────────────
      const categories = ['Pizzas', 'Burgers', 'Pasta', 'Beverages', 'Desserts', 'Appetizers'];
      storage.setItem('pos_categories', JSON.stringify(categories));
      storage.setItem('pos_category_colors', JSON.stringify({
        'Pizzas': '#ef4444', 'Burgers': '#f59e0b', 'Pasta': '#10b981',
        'Beverages': '#0ea5e9', 'Desserts': '#ec4899', 'Appetizers': '#f97316',
      }));

      // ── Customers ──────────────────────────────────────────
      const customers = [
        { id: 'c1', name: 'Amit Sharma', phone: '9876543210', email: 'amit@example.com', totalVisits: 15, totalSpent: 5200, points: 350, createdAt: '2026-01-15' },
        { id: 'c2', name: 'Priya Patel', phone: '9876543211', email: 'priya@example.com', totalVisits: 8, totalSpent: 2800, points: 150, createdAt: '2026-03-10' },
      ];
      storage.setItem('pos_customers', JSON.stringify(customers));

      // ── Rewards ────────────────────────────────────────────
      const rewards = [
        { id: 'r1', type: 'percentage', title: '10% Off', value: 10, pointsRequired: 100, isActive: true },
        { id: 'r2', type: 'flat', title: '₹50 Off', value: 50, pointsRequired: 80, isActive: true },
        { id: 'r3', type: 'item', title: 'Free Drink', value: 0, pointsRequired: 60, isActive: true, itemId: 'p4' },
      ];
      storage.setItem('pos_rewards', JSON.stringify(rewards));

      // ── Subscription features (legacy keys — read even without a JWT) ─
      // Phase 1.10: the multi-branch tests log in through the form (offline
      // fallback, no token), so plan-gated UI (Branches entry) reads the
      // non-namespaced feature cache. Seeding these keys makes it render.
      storage.setItem('pos_subscription_status', JSON.stringify('trial'));
      storage.setItem('pos_subscription_features', JSON.stringify([
        'core_pos', 'basic_reports', 'inventory', 'loyalty', 'multi_branch',
        'analytics', 'expense_tracking', 'ai', 'advanced_reports',
      ]));

      // ── Settings (multi-branch enabled) ────────────────────
      const settings = {
        restaurantName: 'Test Bistro',
        currencySymbol: '₹',
        defaultTaxRate: 5,
        gstRate: 5,
        enableGst: true,
        printerSize: '80mm',
        enableKitchenDisplay: true,
        enableTableService: true,
        enableDeliveryModule: true,
        enableOnlineOrders: true,
        enableLoyalty: true,
        showImagesInBilling: false,
        moduleSettings: {
          enableTableService: true,
          enableLoyalty: true,
          enableKitchenDisplay: true,
          enableDeliveryModule: true,
          enableOnlineOrders: true,
          enableQROrdering: false,
          showImagesInBilling: false,
          enableOrderNotes: true,
          enableDiscountOnBilling: true,
          enableGuestCheckout: true,
          enableExpenseManagement: true,
          enableMultiBranch: true,
        },
      };
      storage.setItem('pos_settings', JSON.stringify(settings));

      // ── Bills, Orders, Held ────────────────────────────────
      storage.setItem('pos_bills', JSON.stringify([]));
      storage.setItem('pos_orders', JSON.stringify([]));
      storage.setItem('pos_held_orders', JSON.stringify([]));
      storage.setItem('pos_expenses', JSON.stringify([]));
      storage.setItem('pos_reservations', JSON.stringify([]));
      storage.setItem('pos_takeaway_orders', JSON.stringify([]));

      // ── Tables (per branch) ────────────────────────────────
      const mainTables = [];
      for (let i = 1; i <= 6; i++) {
        mainTables.push({
          id: 'table_main_' + i, number: i, capacity: 4,
          status: 'Available', section: 'Main Hall', branchId: 'branch_main',
        });
      }
      storage.setItem('pos_tables', JSON.stringify(mainTables));

      // ── Branches (two) ─────────────────────────────────────
      const branches = [
        { id: 'branch_main', name: 'Main Branch', address: '123 Main St', phone: '+91-22-22004400', isHeadBranch: true, isActive: true, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'branch_downtown', name: 'Downtown Branch', address: '456 Downtown Ave', phone: '+91-22-22005500', isHeadBranch: false, isActive: true, createdAt: '2026-03-15T00:00:00Z' },
      ];
      storage.setItem('pos_branches', JSON.stringify(branches));
      storage.setItem('pos_current_branch_id', JSON.stringify('branch_main'));

      // ── Downtown tables ─────────────────────────────────────
      const downtownTables = [
        { id: 'table_dt_1', number: 1, capacity: 4, status: 'Available', section: 'Main Hall', branchId: 'branch_downtown' },
        { id: 'table_dt_2', number: 2, capacity: 6, status: 'Available', section: 'Terrace', branchId: 'branch_downtown' },
      ];
      storage.setItem('pos_branch_tables', JSON.stringify({
        branch_main: mainTables,
        branch_downtown: downtownTables,
      }));

      // ── Branch-specific pricing ─────────────────────────────
      storage.setItem('pos_branch_product_prices', JSON.stringify({
        branch_downtown: { p1: 299, p2: 199 }, // Margherita Pizza ₹299, Classic Burger ₹199 at Downtown
      }));

      // ── Flags ───────────────────────────────────────────────
      storage.setItem('pos_initialized_clean_v5', 'true');
      storage.setItem('pos_onboarding_done', 'true');
      // ── Current Employee (auto-login as Owner) ────────────────
      storage.setItem('pos_current_employee', JSON.stringify({
        id: 'emp_owner',
        username: 'owner',
        name: 'Rajesh Kumar',
        role: 'Owner',
        pin: '1111',
        status: 'Active',
        branchId: 'branch_main',
      }));

      console.log('[E2E Seed] localStorage seeded (multi-branch)');
    })();
  `;
}

/**
 * Convenience: returns a pre-seeded storageState for Playwright.
 */
export const STORAGE_STATE_PATH = './e2e/helpers/storageState.json';

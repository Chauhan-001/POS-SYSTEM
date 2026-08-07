/**
 * ============================================================================
 * MODULE: Application Constants & Configuration
 * ============================================================================
 * Purpose: Centralizes magic numbers, timeout values, UI layout bounds,
 * payment methods, order types, and default values across the POS terminal.
 *
 * Related Files:
 * - src/types.ts
 * - src/hooks/useBilling.ts
 * - components/CartPanel.tsx
 * ============================================================================
 */

export const APP_CONSTANTS = {
  // Application details
  APP_NAME: 'POS Terminal',
  APP_VERSION: 'v1.4.2',
  DEFAULT_CURRENCY: '₹',

  // Layout & UI defaults
  DEFAULT_CART_WIDTH: 380,
  MIN_CART_WIDTH: 280,
  MAX_CART_WIDTH: 550,
  DEBOUNCE_DELAY_MS: 300,
  TOAST_DURATION_MS: 3000,

  // Payment methods
  PAYMENT_METHODS: ['Cash', 'UPI', 'Card', 'Wallet', 'Split'] as const,

  // Order types
  ORDER_TYPES: ['Dine In', 'Takeaway', 'Delivery', 'Swiggy', 'Zomato', 'Uber Eats', 'Other'] as const,

  // Keyboard shortcut keys
  SHORTCUTS: {
    SEARCH_PRODUCT: 'F1',
    CUSTOMER_MOBILE: 'F2',
    HOLD_ORDER: 'F8',
    PAYMENT_PAY: 'F9',
  },

  // Pagination & limits
  DEFAULT_PAGE_SIZE: 20,
  MAX_RECENT_BILLS: 100,
} as const;

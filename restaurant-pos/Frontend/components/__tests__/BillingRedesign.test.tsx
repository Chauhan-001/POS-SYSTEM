/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for Redesigned POS Ordering UI (BillingProductGrid & CartPanel)
 * Verifies high-visibility category navigation, product grid, vertical order actions, and checkout summary.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import BillingProductGrid from '../BillingProductGrid';
import CartPanel from '../CartPanel';
import type { Product, CartItem, SystemSettings } from '../../src/types';

const mockProducts: Product[] = [
  { id: '1', name: 'Paneer Butter Masala', price: 250, category: 'Main Course', image: 'paneer.jpg', code: 'MAIN1', gstPercent: 5, availability: true, favorite: true },
  { id: '2', name: 'Garlic Naan', price: 50, category: 'Main Course', image: 'naan.jpg', code: 'MAIN2', gstPercent: 5, availability: true, favorite: false },
  { id: '3', name: 'Cold Coffee', price: 120, category: 'Beverages', image: 'coffee.jpg', code: 'BEV1', gstPercent: 5, availability: true, favorite: false },
];

const mockCategories = ['Main Course', 'Beverages', 'Starters', 'Desserts'];

const mockCartItems: CartItem[] = [
  {
    id: 'cart_1',
    product: mockProducts[0],
    quantity: 2,
    price: 250,
  },
];

const mockSettings: SystemSettings = {
  restaurantName: 'Test Restaurant',
  address: '123 Main St',
  phone: '9876543210',
  currency: 'INR',
  currencySymbol: '₹',
  gstin: '27AAAAA0000A1Z5',
  defaultTaxRate: 5,
  loyaltyPointsPerDollar: 1,
  pointsNeededForOneUnitCurrency: 10,
  visitThresholdForBonus: 5,
  bonusPointsPerVisit: 1,
  printSize: '80mm',
  brandingColor: '#2563eb',
  autoPrintReceipt: false,
  otpSimulationEnabled: false,
  receiptFooterMessage: 'Thank you!',
};

describe('Redesigned POS Ordering UI', () => {
  describe('BillingProductGrid Component', () => {
    it('renders large category buttons including ALL ITEMS', () => {
      const mockSetCategory = vi.fn();
      render(
        <BillingProductGrid
          categories={mockCategories}
          billingCategory="All"
          onSetCategory={mockSetCategory}
          billingSearch=""
          onSetSearch={vi.fn()}
          billingSearchRef={{ current: null }}
          onBackToOrders={vi.fn()}
          showFavoritesOnly={false}
          onToggleFavorites={vi.fn()}
          products={mockProducts}
          categoryColors={{}}
          moduleSettings={{ showImagesInBilling: true }}
          currencySymbol="₹"
          onAddProduct={vi.fn()}
        />
      );

      // Verify category navigation buttons render with high-visibility text
      // (category names can also appear on product cards, so use getAllByText)
      expect(screen.getByText('ALL ITEMS')).toBeInTheDocument();
      expect(screen.getAllByText('Main Course').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Beverages').length).toBeGreaterThan(0);

      // Click on a category button (pick the nav-chip instance)
      const beverageButtons = screen.getAllByText('Beverages');
      fireEvent.click(beverageButtons[0]);
      expect(mockSetCategory).toHaveBeenCalledWith('Beverages');
    });

    it('renders product cards with clear prices and + buttons', () => {
      const mockAddProduct = vi.fn();
      render(
        <BillingProductGrid
          categories={mockCategories}
          billingCategory="All"
          onSetCategory={vi.fn()}
          billingSearch=""
          onSetSearch={vi.fn()}
          billingSearchRef={{ current: null }}
          onBackToOrders={vi.fn()}
          showFavoritesOnly={false}
          onToggleFavorites={vi.fn()}
          products={mockProducts}
          categoryColors={{}}
          moduleSettings={{ showImagesInBilling: true }}
          currencySymbol="₹"
          onAddProduct={mockAddProduct}
        />
      );

      expect(screen.getByText('Paneer Butter Masala')).toBeInTheDocument();
      expect(screen.getByText('₹250.00')).toBeInTheDocument();
      expect(screen.getByText('Garlic Naan')).toBeInTheDocument();
      expect(screen.getByText('₹50.00')).toBeInTheDocument();
    });
  });

  describe('CartPanel Component', () => {
    it('renders vertical order actions (KOT, Hold, Clear, More) and CLOSE BILL button', () => {
      const mockShowKOT = vi.fn();
      const mockHoldOrder = vi.fn();
      const mockClearCart = vi.fn();
      const mockShowPayment = vi.fn();

      render(
        <CartPanel
          cartWidth={380}
          startResizeCart={vi.fn()}
          cartItems={mockCartItems}
          activeOrder={null}
          heldOrders={[]}
          onOpenHeldDrawer={vi.fn()}
          settings={mockSettings}
          onPaymentChange={vi.fn()}
          onOrderTypeChange={vi.fn()}
          paymentMethod="Cash"
          orderType="Dine In"
          calculateCartSubtotal={() => 500}
          calculateCartDiscount={() => 0}
          calculateCartTaxes={() => 25}
          calculateCartGrandTotal={() => 525}
          onAdjustQuantity={vi.fn()}
          onDeleteItem={vi.fn()}
          onClearCart={mockClearCart}
          onShowKOT={mockShowKOT}
          onShowPayment={mockShowPayment}
          onHoldOrder={mockHoldOrder}
          products={mockProducts}
          quickFireInput=""
          onQuickFireChange={vi.fn()}
          quickFireSessionCount={0}
          quickFireFlash={null}
          onQuickFireKeyDown={vi.fn()}
          isQuickFireActive={false}
          onToggleQuickFire={vi.fn()}
          isMoreBillingOpen={false}
          onToggleMoreBilling={vi.fn()}
          searchedCustomer={null}
          customerPhone=""
          onCustomerPhoneChange={vi.fn()}
          onOpenOffers={vi.fn()}
          onOpenCustomerSearch={vi.fn()}
          loyaltyPhoneRef={{ current: null }}
          quickFireRef={{ current: null }}
          appliedReward={null}
          splitDetails={{ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 }}
          onOpenSplitPopup={vi.fn()}
          currencySymbol="₹"
          onOpenAddOnModal={vi.fn()}
          onUpdateItemNotes={vi.fn()}
          showToast={vi.fn()}
        />
      );

      // Header check — no active order, so the generic header shows
      expect(screen.getByText('Current Order')).toBeInTheDocument();
      expect(screen.queryByText('Order #101')).not.toBeInTheDocument();

      // Vertical Order Actions check
      const kotButton = screen.getByText('KOT');
      const holdButton = screen.getByText('Hold');
      const clearButton = screen.getByText('Clear');
      const moreButton = screen.getByText('More');

      expect(kotButton).toBeInTheDocument();
      expect(holdButton).toBeInTheDocument();
      expect(clearButton).toBeInTheDocument();
      expect(moreButton).toBeInTheDocument();

      // Action triggers
      fireEvent.click(kotButton);
      expect(mockShowKOT).toHaveBeenCalled();

      fireEvent.click(holdButton);
      expect(mockHoldOrder).toHaveBeenCalled();

      fireEvent.click(clearButton);
      expect(mockClearCart).toHaveBeenCalled();

      // Checkout CLOSE BILL button
      const closeBillBtn = screen.getByText('CLOSE BILL');
      expect(closeBillBtn).toBeInTheDocument();

      fireEvent.click(closeBillBtn);
      expect(mockShowPayment).toHaveBeenCalled();
    });

    it('always shows Clear (never Close) and clears the cart', () => {
      const mockClearCart = vi.fn();
      render(
        <CartPanel
          cartWidth={380}
          startResizeCart={vi.fn()}
          cartItems={mockCartItems}
          activeOrder={{ orderNumber: 101, type: 'Dine In', tableNumber: 4, status: 'New', kotRecords: [] } as any}
          heldOrders={[]}
          onOpenHeldDrawer={vi.fn()}
          settings={mockSettings}
          onPaymentChange={vi.fn()}
          onOrderTypeChange={vi.fn()}
          paymentMethod="Cash"
          orderType="Dine In"
          calculateCartSubtotal={() => 500}
          calculateCartDiscount={() => 0}
          calculateCartTaxes={() => 25}
          calculateCartGrandTotal={() => 525}
          onAdjustQuantity={vi.fn()}
          onDeleteItem={vi.fn()}
          onClearCart={mockClearCart}
          onShowKOT={vi.fn()}
          onShowPayment={vi.fn()}
          onHoldOrder={vi.fn()}
          products={mockProducts}
          quickFireInput=""
          onQuickFireChange={vi.fn()}
          quickFireSessionCount={0}
          quickFireFlash={null}
          onQuickFireKeyDown={vi.fn()}
          isQuickFireActive={false}
          onToggleQuickFire={vi.fn()}
          isMoreBillingOpen={false}
          onToggleMoreBilling={vi.fn()}
          searchedCustomer={null}
          customerPhone=""
          onCustomerPhoneChange={vi.fn()}
          onOpenOffers={vi.fn()}
          onOpenCustomerSearch={vi.fn()}
          loyaltyPhoneRef={{ current: null }}
          quickFireRef={{ current: null }}
          appliedReward={null}
          splitDetails={{ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 }}
          onOpenSplitPopup={vi.fn()}
          currencySymbol="₹"
          onOpenAddOnModal={vi.fn()}
          onUpdateItemNotes={vi.fn()}
          showToast={vi.fn()}
        />
      );

      // Clear is always available — the Close button no longer exists
      expect(screen.getByText('Clear')).toBeInTheDocument();
      expect(screen.queryByText('Close')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Clear'));
      expect(mockClearCart).toHaveBeenCalled();
    });

    it('keeps Clear (never Close) even after a KOT has been sent to the kitchen', () => {
      const mockClearCart = vi.fn();
      render(
        <CartPanel
          cartWidth={380}
          startResizeCart={vi.fn()}
          cartItems={mockCartItems}
          activeOrder={{ orderNumber: 102, type: 'Dine In', tableNumber: 4, status: 'Accepted', kotRecords: [{ id: 'kot_1', kotNumber: 1, type: 'Original', status: 'Accepted', items: [], printedAt: new Date().toISOString() }] } as any}
          heldOrders={[]}
          onOpenHeldDrawer={vi.fn()}
          settings={mockSettings}
          onPaymentChange={vi.fn()}
          onOrderTypeChange={vi.fn()}
          paymentMethod="Cash"
          orderType="Dine In"
          calculateCartSubtotal={() => 500}
          calculateCartDiscount={() => 0}
          calculateCartTaxes={() => 25}
          calculateCartGrandTotal={() => 525}
          onAdjustQuantity={vi.fn()}
          onDeleteItem={vi.fn()}
          onClearCart={mockClearCart}
          onShowKOT={vi.fn()}
          onShowPayment={vi.fn()}
          onHoldOrder={vi.fn()}
          products={mockProducts}
          quickFireInput=""
          onQuickFireChange={vi.fn()}
          quickFireSessionCount={0}
          quickFireFlash={null}
          onQuickFireKeyDown={vi.fn()}
          isQuickFireActive={false}
          onToggleQuickFire={vi.fn()}
          isMoreBillingOpen={false}
          onToggleMoreBilling={vi.fn()}
          searchedCustomer={null}
          customerPhone=""
          onCustomerPhoneChange={vi.fn()}
          onOpenOffers={vi.fn()}
          onOpenCustomerSearch={vi.fn()}
          loyaltyPhoneRef={{ current: null }}
          quickFireRef={{ current: null }}
          appliedReward={null}
          splitDetails={{ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 }}
          onOpenSplitPopup={vi.fn()}
          currencySymbol="₹"
          onOpenAddOnModal={vi.fn()}
          onUpdateItemNotes={vi.fn()}
          showToast={vi.fn()}
        />
      );

      // Clear remains even after a KOT is sent — the Close button no longer exists
      expect(screen.getByText('Clear')).toBeInTheDocument();
      expect(screen.queryByText('Close')).not.toBeInTheDocument();
      expect(screen.queryByText('Locked')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Clear'));
      expect(mockClearCart).toHaveBeenCalled();
    });
  });
});

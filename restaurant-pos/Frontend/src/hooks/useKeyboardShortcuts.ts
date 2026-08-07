/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keyboard shortcuts — F1-F10, Escape
 */

import { useEffect } from 'react';

interface ShortcutDeps {
  currentEmployee: any;
  activeOrder: any;
  cartItems: any[];
  customerPhone: string;
  searchedCustomer: any;
  orderType: any;
  paymentMethod: any;
  appliedReward: any;
  splitDetails: any;
  isQuickFireActive: boolean;
  activeWorkspace: string;
  setActiveWorkspace: (ws: any) => void;
  setBillingSearch: (s: string) => void;
  setCustomerPhone: (s: string) => void;
  setSearchedCustomer: (c: any) => void;
setAppliedReward: (r: any) => void;
  setIsHeldDrawerOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsShortcutOpen: (v: boolean) => void;
  setIsSyncPanelOpen: (v: boolean) => void;
  setIsDailySalesOpen: (v: boolean) => void;
  setIsHistoryFeedOpen: (v: boolean) => void;
  setIsKOTOpen: (v: boolean) => void;
  setIsTimelineOpen: (v: boolean) => void;
  setIsOffersPopupOpen: (v: boolean) => void;
  setIsSplitPopupOpen: (v: boolean) => void;
  setIsPaymentConfirmOpen: (v: boolean) => void;
  setIsZReportOpen: (v: boolean) => void;
  setIsVoidReasonOpen: (v: boolean) => void;
  setIsAddOnModalOpen: (v: boolean) => void;
  setActiveOrder: (o: any) => void;
  setCartItems: (items: any[]) => void;
  setIsQuickFireActive: (v: boolean) => void;
  setQuickFireInput: (s: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  showPaymentConfirm: () => void;
  handleHoldCurrentOrder: () => void;
  billingSearchRef: React.RefObject<HTMLInputElement | null>;
  loyaltyPhoneRef: React.RefObject<HTMLInputElement | null>;
  quickFireRef: React.RefObject<HTMLInputElement | null>;
}

export function useKeyboardShortcuts(deps: ShortcutDeps) {
  const {
    currentEmployee, activeOrder, cartItems, customerPhone, searchedCustomer,
    orderType, paymentMethod, appliedReward, splitDetails, isQuickFireActive,
    activeWorkspace, setActiveWorkspace, setBillingSearch, setCustomerPhone,
    setSearchedCustomer, setAppliedReward, setIsHeldDrawerOpen, setIsShortcutOpen,
    setIsSyncPanelOpen, setIsDailySalesOpen, setIsHistoryFeedOpen, setIsKOTOpen,
    setIsTimelineOpen, setIsOffersPopupOpen, setIsSplitPopupOpen,
    setIsPaymentConfirmOpen, setIsZReportOpen, setIsVoidReasonOpen,
    setIsAddOnModalOpen, setActiveOrder, setCartItems, setIsQuickFireActive,
    setQuickFireInput, showToast, showPaymentConfirm, handleHoldCurrentOrder,
    billingSearchRef, loyaltyPhoneRef, quickFireRef,
  } = deps;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentEmployee) return;

      if (e.key === 'F1') {
        e.preventDefault();
        if (!activeOrder) { showToast('Select or create an order from Order Management first.', 'warning'); return; }
        setActiveWorkspace('Billing');
        setTimeout(() => billingSearchRef.current?.focus(), 50);
        showToast('Search product input focused.', 'info');
      }

      if (e.key === 'F2') {
        e.preventDefault();
        if (!activeOrder) { showToast('Select or create an order from Order Management first.', 'warning'); return; }
        setActiveWorkspace('Billing');
        setTimeout(() => loyaltyPhoneRef.current?.focus(), 50);
        showToast('Loyalty mobile input focused.', 'info');
      }

      if (e.key === 'F3') {
        e.preventDefault();
        if (!activeOrder) { showToast('Select or create an order first.', 'warning'); return; }
        setActiveWorkspace('Billing');
        const next = !isQuickFireActive;
        setIsQuickFireActive(next);
        if (next) {
          setTimeout(() => quickFireRef.current?.focus(), 100);
          showToast('Quick-fire mode ON — type item code + Enter', 'info');
        } else {
          setQuickFireInput('');
          showToast('Quick-fire mode OFF', 'info');
        }
      }

      if (e.key === 'F9') {
        e.preventDefault();
        if (cartItems.length === 0) { showToast('Cannot checkout empty cart.', 'warning'); return; }
        showPaymentConfirm();
      }

      if (e.key === 'F8') {
        e.preventDefault();
        handleHoldCurrentOrder();
      }

if (e.key === 'F10') {
        e.preventDefault();
        setIsHeldDrawerOpen(prev => !prev);
      }

      if (e.key === 'Escape') {
        setBillingSearch('');
        setCustomerPhone('');
        setSearchedCustomer(null);
        setAppliedReward(null);
        setIsHeldDrawerOpen(false);
        setIsShortcutOpen(false);
        setIsSyncPanelOpen(false);
        setIsDailySalesOpen(false);
        setIsHistoryFeedOpen(false);
        setIsKOTOpen(false);
        setIsTimelineOpen(false);
        setIsOffersPopupOpen(false);
        setIsSplitPopupOpen(false);
        setIsPaymentConfirmOpen(false);
        setIsZReportOpen(false);
        setIsVoidReasonOpen(false);
        setIsAddOnModalOpen(false);
        if (activeWorkspace === 'Billing') {
          setActiveWorkspace('Orders');
          setActiveOrder(null);
          setCartItems([]);
          showToast('Returned to Order Management', 'info');
        }
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentEmployee, activeOrder, cartItems, customerPhone, searchedCustomer,
      orderType, paymentMethod, appliedReward, splitDetails, isQuickFireActive,
      activeWorkspace]);
}

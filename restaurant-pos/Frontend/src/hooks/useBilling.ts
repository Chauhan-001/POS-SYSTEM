/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Billing hook — cart items, price calculations, payment processing
 * Data flow: local state is source of truth; all mutations sync to API.
 */

import { useCallback, useRef, useState } from 'react';
import type { CartItem, Product, ProductVariant, LoyaltyReward, SystemSettings, Bill, Employee, Customer, Order } from '../types';
import { setDBData, getDBData } from '../data';
import * as api from '../api/client';
import { debugWarn } from '../utils/debugLog';
import { findLinkedTakeaway } from './useOrders';

interface BillingConfig {
  cartItems: any[];
  setCartItems: (items: any[]) => void;
  activeOrder: any;
  setActiveOrder: (order: any) => void;
  orders: any[];
  setOrders: (orders: any[]) => void;
  customers: Customer[];
  setCustomers: (customers: Customer[]) => void;
  bills: Bill[];
  setBills: (bills: Bill[]) => void;
  searchedCustomer: Customer | null;
  setSearchedCustomer: (c: Customer | null) => void;
  customerPhone: string;
  setCustomerPhone: (p: string) => void;
  appliedReward: LoyaltyReward | null;
  setAppliedReward: (r: LoyaltyReward | null) => void;
  appliedOffer: any | null;
  setAppliedOffer: (o: any | null) => void;
  paymentMethod: string;
  setPaymentMethod: (m: any) => void;
  orderType: string;
  setOrderType: (t: any) => void;
  splitDetails: { cashAmount: number; cardAmount: number; upiAmount: number; walletAmount: number };
  setSplitDetails: (d: any) => void;
  settings: SystemSettings;
  currentEmployee: Employee | null;
  products: Product[];
  heldOrders: any[];
  setHeldOrders: (h: any[]) => void;
  tables: any[];
  setTables: (t: any[]) => void;
  takeawayOrders: any[];
  setTakeawayOrders: (t: any[]) => void;
  refreshDailyStats: (bill?: Bill) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export function useBilling(config: BillingConfig) {
  const {
    cartItems, setCartItems,
    activeOrder, setActiveOrder,
    orders, setOrders,
    customers, setCustomers,
    bills, setBills,
    searchedCustomer, setSearchedCustomer,
    customerPhone, setCustomerPhone,
    appliedReward, setAppliedReward,
    appliedOffer, setAppliedOffer,
    paymentMethod, setPaymentMethod,
    orderType, setOrderType,
    splitDetails, setSplitDetails,
    settings,
    currentEmployee,
    products,
    heldOrders, setHeldOrders,
    tables, setTables,
    takeawayOrders, setTakeawayOrders,
    refreshDailyStats,
    showToast,
  } = config;

  // Manual discount amount for billing (flat amount to subtract from grand total)
  const [manualDiscount, setManualDiscount] = useState(0);

  const isProductMatchingReward = (productName: string, productId: string, rewardItemName?: string, rewardItemId?: string): boolean => {
    if (!rewardItemName && !rewardItemId) return false;
    if (rewardItemId && productId === rewardItemId) return true;
    if (rewardItemName) {
      const pName = productName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      const rName = rewardItemName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      if (pName === rName || pName.includes(rName) || rName.includes(pName)) return true;
    }
    return false;
  };

  const calculateCartSubtotal = useCallback(() => {
    return cartItems.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 0), 0);
  }, [cartItems]);

  const calculateCartDiscount = useCallback(() => {
    let baseDiscount = 0;
    const subtotal = calculateCartSubtotal();
    if (appliedReward) {
      if (appliedReward.type === 'percentage') baseDiscount = (subtotal * appliedReward.value) / 100;
      else if (appliedReward.type === 'item') baseDiscount = appliedReward.value;
      else baseDiscount = Math.min(appliedReward.value, subtotal);
    }
    if (searchedCustomer && settings.visitMilestones) {
      const milestones = settings.visitMilestones;
      // Only reward when the NEW visit count (current visits + 1) matches a milestone
      // This prevents rewarding the same milestone twice (once before and once after)
      const eligibleMilestones = milestones.filter((m: any) =>
        (searchedCustomer.visits + 1) === Number(m.visits)
      );
      for (const m of eligibleMilestones) {
        const itemInCart = cartItems.find((item: any) =>
          isProductMatchingReward(item.product.name, item.product.id, m.rewardItemName, m.rewardItemId)
        );
        if (itemInCart) baseDiscount += itemInCart.price;
      }
    }
    // Server-validated promotion discount (authoritative amount from /offers/validate).
    if (appliedOffer?.discount) baseDiscount += appliedOffer.discount;
    return baseDiscount + manualDiscount;
  }, [cartItems, appliedReward, appliedOffer, searchedCustomer, settings.visitMilestones, calculateCartSubtotal, manualDiscount]);

  const calculateCartTaxes = useCallback(() => {
    const subtotal = calculateCartSubtotal();
    const discount = calculateCartDiscount();
    return cartItems.reduce((taxSum: number, item: any) => {
      const rowTotal = (item.price || 0) * (item.quantity || 0);
      const proportion = subtotal > 0 ? rowTotal / subtotal : 0;
      const rowDiscount = discount * proportion;
      const rowTaxable = Math.max(0, rowTotal - rowDiscount);
      return taxSum + rowTaxable * ((item.product.gstPercent || 0) / 100);
    }, 0);
  }, [cartItems, calculateCartSubtotal, calculateCartDiscount]);

  const calculateCartGrandTotal = useCallback(() => {
    return Math.max(0, calculateCartSubtotal() - calculateCartDiscount() + calculateCartTaxes());
  }, [calculateCartSubtotal, calculateCartDiscount, calculateCartTaxes]);

  const handleAddProductToCart = useCallback((product: Product, selectedVariant?: ProductVariant) => {
    if (!product.availability) { showToast(`${product.name} is sold out!`, 'warning'); return; }
    const rowId = selectedVariant ? `${product.id}_${selectedVariant.name}` : `${product.id}_none`;
    const existingIdx = cartItems.findIndex((item: any) => item.id === rowId);
    if (existingIdx > -1) {
      const updated = [...cartItems];
      updated[existingIdx].quantity += 1;
      setCartItems(updated);
    } else {
      setCartItems([...cartItems, {
        id: rowId, product, selectedVariant, quantity: 1,
        price: selectedVariant ? selectedVariant.price : product.price,
      }]);
    }
    showToast(`${product.name} added to current bill.`, 'success');
  }, [cartItems, setCartItems, showToast]);

  const handleAdjustQuantity = useCallback((cartId: string, delta: number) => {
    const target = cartItems.find((item: any) => item.id === cartId);
    if (target?.kotPrinted) {
      showToast('Item already sent to kitchen — locked', 'warning');
      return;
    }
    setCartItems(cartItems.map((item: any) => {
      if (item.id === cartId) {
        const nextQty = item.quantity + delta;
        return nextQty > 0 ? { ...item, quantity: nextQty } : item;
      }
      return item;
    }).filter((item: any) => item.quantity > 0));
  }, [cartItems, setCartItems, showToast]);

  const handleDeleteCartItem = useCallback((cartId: string) => {
    const target = cartItems.find((item: any) => item.id === cartId);
    if (target?.kotPrinted) {
      showToast('Item already sent to kitchen — locked', 'warning');
      return;
    }
    setCartItems(cartItems.filter((item: any) => item.id !== cartId));
    showToast('Product row voided from bill.', 'warning');
  }, [cartItems, setCartItems, showToast]);

  // Prevent double-click payment — guard ref + UI state
  // The ref is the authoritative guard (synchronous reads).
  // The state triggers re-renders so the Pay button shows "Processing...".
  const isProcessingPayment = useRef(false);
  const [isProcessingPaymentUI, setIsProcessingPaymentUI] = useState(false);

  const customerUpdateQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueueCustomerUpdate = useCallback(async (phone: string, updatedCust: Customer) => {
    // Chain updates so they run sequentially, not in parallel
    customerUpdateQueue.current = customerUpdateQueue.current.then(
      () => api.updateCustomer(phone, updatedCust)
    ).catch(err => debugWarn('useBilling', 'updateCustomer failed:', err));
    await customerUpdateQueue.current;
  }, []);

  /**
   * Get next invoice number — prefer backend atomic counter, fall back to localStorage.
   * The backend uses MongoDB's findOneAndUpdate with $inc for thread-safe increments,
   * preventing duplicate invoice numbers across multiple POS terminals.
   * If the backend is offline, falls back to localStorage-based counter.
   */
  const getNextInvoiceNumber = useCallback(async (): Promise<number> => {
    const serverNum = await api.fetchNextInvoiceNumber();
    if (serverNum !== null && typeof serverNum === 'number') {
      // Also sync localStorage so offline mode stays roughly in sync
      setDBData('pos_next_invoice_number', serverNum + 1);
      return serverNum;
    }
    // Backend offline — fall back to localStorage counter
    const localNum = getDBData<number>('pos_next_invoice_number', 1001);
    setDBData('pos_next_invoice_number', localNum + 1);
    return localNum;
  }, []);

  /**
   * handleCheckoutPayment — Async payment processor with double-click guard.
   * Sets the guard before checkout starts, and only resets it AFTER all
   * async API calls (createBill, updateOrder, enqueueCustomerUpdate) resolve.
   * Returns the Bill on success, or undefined if cancelled/empty.
   */
  const handleCheckoutPayment = useCallback(async (): Promise<Bill | undefined> => {
    if (isProcessingPayment.current) {
      showToast('Payment already in progress. Please wait.', 'warning');
      return;
    }
    if (cartItems.length === 0) { showToast('Please add products to checkout.', 'warning'); return; }

    isProcessingPayment.current = true;
    setIsProcessingPaymentUI(true);
    try {
      const result = await _doCheckoutAsync();
      return result;
    } finally {
      // Guard resets only after ALL async operations complete
      isProcessingPayment.current = false;
      setIsProcessingPaymentUI(false);
    }
  }, [cartItems, setCartItems, activeOrder, setActiveOrder, orders, setOrders, customers, setCustomers, bills, setBills,
      customerPhone, setCustomerPhone, searchedCustomer, setSearchedCustomer, appliedReward, setAppliedReward,
      paymentMethod, orderType, settings, currentEmployee, refreshDailyStats, showToast,
      calculateCartSubtotal, calculateCartDiscount, calculateCartTaxes, calculateCartGrandTotal,
      tables, setTables, enqueueCustomerUpdate]);

  /**
   * Internal: the actual async checkout logic.
   * All state mutations happen synchronously first (bill created, cart cleared),
   * then async API calls fire in the background and are awaited.
   * This ensures the UI updates instantly while the guard prevents duplicates.
   */
  const _doCheckoutAsync = useCallback(async (): Promise<Bill | undefined> => {
    const _now = new Date();
    const subtotal = calculateCartSubtotal();
    const discount = calculateCartDiscount();
    const gst = calculateCartTaxes();
    const grandTotal = calculateCartGrandTotal();
    let pointsAccumulated = Number((grandTotal * settings.loyaltyPointsPerDollar).toFixed(2));
    let pointsDeducted = appliedReward ? appliedReward.pointsRequired : 0;
    let milestoneRewardAwarded: string | undefined;

    const invoiceNumber = await getNextInvoiceNumber();
    const ticketNumber = invoiceNumber;

    const invoiceHistItem = {
      id: `b_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      invoiceNumber: `${settings.invoicePrefix || "INV"}-${new Date().getFullYear()}-${invoiceNumber}`,
      ticketNumber: `TK-${invoiceNumber}`,
      date: _now.toISOString().split('T')[0],
      grandTotal,
      itemsCount: cartItems.length,
      items: cartItems,
      redeemedRewardTitle: appliedReward?.title,
      appliedOfferTitle: appliedOffer?.offer?.title,
      appliedOfferCode: appliedOffer?.offer?.couponCode,
      pointsRedeemed: pointsDeducted > 0 ? pointsDeducted : undefined,
      pointsEarned: pointsAccumulated > 0 ? pointsAccumulated : undefined,
    };

    // ── Collect async promises to await at the end ────────────────
    const asyncOps: Promise<void>[] = [];

    if (searchedCustomer) {
      const updatedCustomers = customers.map((c: Customer) => {
        if (c.phone === searchedCustomer.phone) {
          const nextPoints = Math.max(0, c.points - pointsDeducted + pointsAccumulated);
          const nextVisits = c.visits + 1;
          let bonus = 0;
          if (nextVisits % settings.visitThresholdForBonus === 0) bonus = settings.bonusPointsPerVisit;
          const milestones = settings.visitMilestones || [];
          const matched = milestones.find((m: any) => Number(m.visits) === nextVisits);
          if (matched) milestoneRewardAwarded = matched.rewardItemName;
          return { ...c, visits: nextVisits, points: Number((nextPoints + bonus).toFixed(2)), lastVisit: _now.toISOString().split('T')[0], purchaseHistory: [invoiceHistItem, ...(c.purchaseHistory || [])] };
        }
        return c;
      });
      setCustomers(updatedCustomers);
      const updatedCust = updatedCustomers.find((c: Customer) => c.phone === searchedCustomer.phone);
      if (updatedCust) {
        asyncOps.push(enqueueCustomerUpdate(searchedCustomer.phone, updatedCust));
      }      } else if (customerPhone.trim().length === 10) {
      const existingCustomer = customers.find((c: Customer) => c.phone === customerPhone.trim());
      if (existingCustomer) {
        const updatedExisting = {
          ...existingCustomer,
          visits: existingCustomer.visits + 1,
          points: Number((existingCustomer.points + pointsAccumulated - pointsDeducted).toFixed(2)),
          lastVisit: _now.toISOString().split('T')[0],
          purchaseHistory: [invoiceHistItem, ...(existingCustomer.purchaseHistory || [])],
        };
        setCustomers(customers.map((c: Customer) => c.phone === customerPhone.trim() ? updatedExisting : c));
        asyncOps.push(enqueueCustomerUpdate(customerPhone.trim(), updatedExisting));
      } else {
        const guestObj: Customer = {
          phone: customerPhone.trim(), name: 'Guest Diner', isNew: true, visits: 1, points: pointsAccumulated,
          lastVisit: _now.toISOString().split('T')[0], purchaseHistory: [invoiceHistItem],
        } as Customer;
        setCustomers([guestObj, ...customers]);
        asyncOps.push(
          api.createCustomer(guestObj).then(() => {}).catch(err => debugWarn('useBilling', 'createCustomer failed:', err))
        );
        showToast('Quick Guest loyalty card enrolled successfully.', 'success');
      }
    }

    const finalizedItems = cartItems.map((item: any) => ({
      ...item,
      productName: item.product?.name || '',
      price: (item.isFree || (appliedReward && isProductMatchingReward(item.product.name, item.product.id, appliedReward.rewardItemName, appliedReward.rewardItemId))) ? 0 : item.price,
      isFree: item.isFree || (appliedReward ? isProductMatchingReward(item.product.name, item.product.id, appliedReward.rewardItemName, appliedReward.rewardItemId) : false),
    }));

    const cancelledItems: CartItem[] = activeOrder?.items
      ? activeOrder.items.filter((item: any) => item.cancelled === true).map((item: any) => ({
          ...item,
          cancelled: true,
          cancelReason: item.cancelReason,
        }))
      : [];

    const localBillId = `bill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newBill: Bill = {
      id: localBillId,
      // Phase 1.10 — idempotency key: the backend dedupes on
      // { restaurantId, clientRef } so an offline queue replay can never create
      // a duplicate bill, double-deduct stock, or double-award loyalty points.
      clientRef: localBillId,
      invoiceNumber: `${settings.invoicePrefix || "INV"}-${new Date().getFullYear()}-${invoiceNumber}`,
      ticketNumber: `#${invoiceNumber}`,
      date: _now.toISOString().split("T")[0],
      time: _now.toLocaleTimeString('en-GB', { hour: "2-digit", minute: "2-digit", hourCycle: 'h23' }),
      cashierName: currentEmployee?.name || "System",
      cashierRole: currentEmployee?.role || "Staff",
      items: finalizedItems,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      gst: Math.round(gst * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      paymentMethod: paymentMethod as any,
      orderType: orderType as any,
      customerPhone: customerPhone || undefined,
      customerName: searchedCustomer?.name || undefined,
      // Phase 1.6 — bills reference customerId (phone snapshot kept for historical integrity)
      customerId: (searchedCustomer?._id as string) || (searchedCustomer?.id as string) || undefined,
      // Online-ordering: link the bill to its source order so unavailable-item
      // adjustments can resolve + refund the correct bill (orderId is accepted
      // by the bill schema; optional for dine-in/takeaway).
      orderId: activeOrder?.id || undefined,
      pointsEarned: Math.round(pointsAccumulated * 100) / 100,
      pointsRedeemed: pointsDeducted,
      redeemedRewardTitle: appliedReward?.title,
      milestoneRewardAwarded: milestoneRewardAwarded,
      tableNumber: activeOrder?.tableNumber,
      createdAt: activeOrder?.createdAt,
    };

    // Update order status to Paid and sync to API
    if (activeOrder) {
      const updatedOrder = {
        ...activeOrder,
        status: "Paid",
        paymentMethod,
        paidAt: new Date().toISOString(),
        items: [...finalizedItems, ...cancelledItems],
        subtotal, discount, gst, grandTotal,
      };
      setOrders(orders.map((o: any) => o.id === activeOrder.id ? updatedOrder : o));
      // Only push the Paid transition when the order has a real Mongo id (created
      // while online — temp ids are swapped on create success). Orders created
      // entirely offline keep a temp id that 400s against /orders/:id; their final
      // paid state is pushed on reconnect by the queued createOrder replay, which
      // sends the latest local order.
      const orderServerId = /^[a-fA-F0-9]{24}$/.test(activeOrder.id) ? activeOrder.id : null;
      if (orderServerId) {
        asyncOps.push(
          api.updateOrder(orderServerId, updatedOrder).then(() => {}).catch(err => debugWarn('useBilling', 'updateOrder (paid) failed:', err))
        );
      }
    }

    // Takeaway orders: advance the linked panel row so the Takeaway tab shows
    // the bill is paid and the food is Ready for collection (the cashier taps
    // "Collected" once handed over — which removes it from the active view via
    // the existing completed-order cleanup). Pushes to /api/takeaway-orders so
    // other terminals polling the same restaurant see the same state.
    // Resolved via the shared id→orderNumber helper so legacy rows (stale
    // orderId) advance too.
    if (activeOrder?.type === 'Takeaway') {
      const linkedRow = findLinkedTakeaway(takeawayOrders, { id: activeOrder.id, orderNumber: activeOrder.orderNumber });
      if (linkedRow) {
        const paidAmount = Math.round(grandTotal * 100) / 100;
        const paidRow = {
          ...linkedRow,
          status: 'Ready' as const,
          paymentStatus: 'Paid' as const,
          amount: paidAmount,
          items: finalizedItems,
        };
        setTakeawayOrders(takeawayOrders.map((t: any) => t.id === linkedRow.id ? paidRow : t));
        if (/^[a-fA-F0-9]{24}$/.test(linkedRow.id)) {
          asyncOps.push(
            api.updateTakeawayOrder(linkedRow.id, {
              status: 'Ready',
              paymentStatus: 'Paid',
              amount: paidAmount,
              items: finalizedItems.map((it: any) => ({
                itemName: it.productName || it.product?.name || 'Item',
                quantity: it.quantity ?? 1,
                price: it.price ?? 0,
                variantName: typeof it.selectedVariant === 'string' ? it.selectedVariant : it.selectedVariant?.name,
              })),
            }).then(() => {}).catch(err => debugWarn('useBilling', 'updateTakeawayOrder (paid) failed:', err))
          );
        }
      }
    }

    const updatedBills = [newBill, ...bills];
    setBills(updatedBills);
    asyncOps.push(
      api.createBill(newBill).then(() => {}).catch(err => debugWarn('useBilling', 'createBill failed:', err))
    );
    setDBData("pos_bills", updatedBills);

    // ── Record the promotion redemption server-side (usage ledger + analytics) ─
    // The backend claims the usage slot atomically and idempotently (keyed on
    // billId), so a queued offline replay can never double-count.
    if (appliedOffer?.offer?.id && appliedOffer.discount > 0) {
      asyncOps.push(
        api.applyOffer({
          offerId: appliedOffer.offer.id,
          couponCode: appliedOffer.offer.couponCode,
          customerId: (searchedCustomer?._id as string) || (searchedCustomer?.id as string),
          customerPhone: searchedCustomer?.phone || customerPhone || undefined,
          billSubtotal: subtotal,
          billItems: cartItems.map((item: any) => ({
            id: item.product?.id || item.id,
            name: item.product?.name || item.name || 'Item',
            price: item.price || 0,
            quantity: item.quantity || 1,
            category: item.product?.category,
          })),
          billId: localBillId,
        }).then((r) => {
          if (r && !r.valid && !r.queuedOffline) debugWarn('useBilling', 'applyOffer rejected:', r.reason);
        }).catch(err => debugWarn('useBilling', 'applyOffer failed:', err))
      );
    }

    if (activeOrder?.tableId) {
      setTables(tables.map((t: any) => t.id === activeOrder.tableId ? { ...t, status: "Available", orderSince: undefined, orderId: undefined } : t));
      // BACKEND CALLED — free the table server-side so other terminals see it open.
      if (/^[a-fA-F0-9]{24}$/.test(activeOrder.tableId)) {
        asyncOps.push(
          api.updateTable(activeOrder.tableId, { status: 'Available' }).then(() => {}).catch(err => debugWarn('useBilling', 'updateTable (available) failed:', err))
        );
      }
    }

    refreshDailyStats(newBill);
    setCartItems([]);
    setCustomerPhone("");
    setSearchedCustomer(null);
    setAppliedReward(null);
    setAppliedOffer(null);
    setManualDiscount(0);
    setActiveOrder(null);
    showToast(`Payment of ${settings.currencySymbol}${grandTotal.toFixed(2)} received!`, "success");

    // ── Wait for all async API calls to complete ─────────────────
    // This ensures the processing guard stays locked until all
    // background operations (createBill, updateOrder, customer update)
    // have finished, preventing duplicate bill creation.
    if (asyncOps.length > 0) {
      await Promise.allSettled(asyncOps);
    }

    return newBill;
  }, [cartItems, setCartItems, activeOrder, setActiveOrder, orders, setOrders, customers, setCustomers, bills, setBills,
      customerPhone, setCustomerPhone, searchedCustomer, setSearchedCustomer, appliedReward, setAppliedReward,
      appliedOffer, setAppliedOffer,
      paymentMethod, orderType, settings, currentEmployee, refreshDailyStats, showToast,
      calculateCartSubtotal, calculateCartDiscount, calculateCartTaxes, calculateCartGrandTotal,
      tables, setTables, takeawayOrders, setTakeawayOrders, setManualDiscount, enqueueCustomerUpdate]);

  // Expose the guard for manual reset if needed
  const resetProcessingFlag = useCallback(() => {
    isProcessingPayment.current = false;
    setIsProcessingPaymentUI(false);
  }, []);

  /** Whether payment is currently being processed (for disabling UI buttons) */
  const getIsProcessingPayment = useCallback((): boolean => {
    return isProcessingPaymentUI;
  }, [isProcessingPaymentUI]);

  return {
    calculateCartSubtotal,
    calculateCartDiscount,
    calculateCartTaxes,
    calculateCartGrandTotal,
    manualDiscount,
    setManualDiscount,
    handleAddProductToCart,
    handleAdjustQuantity,
    handleDeleteCartItem,
    handleCheckoutPayment,
    isProductMatchingReward,
    resetProcessingFlag,
    getIsProcessingPayment,
  };
}

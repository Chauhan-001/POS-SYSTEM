/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orders hook — orders, tables, KOT, timeline, payment processing
 * Data flow: local state is source of truth; all mutations sync to API.
 */

import { useCallback } from 'react';
import type { Order, TableInfo, TakeawayOrder, CartItem, KOTType, KOTStatus, KOTRecord, TimelineEvent, TimelineEventType, Bill, Employee, Customer, SystemSettings } from '../types';
import { setDBData, computeDailySales, buildActivityFeed } from '../data';
import * as api from '../api/client';
import { debugWarn } from '../utils/debugLog';
import { computeKOTDelta, mergeIntoSnapshot } from '../utils/kotDelta';
import { printKOT } from '../utils/printKOT';

export function buildOrderOpenState(order: Order) {
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const kotItems = (order.kotRecords || []).flatMap(kot => kot.items || []);

  let snapshot: CartItem[] = order.lastKotSnapshot || [];
  if (!order.lastKotSnapshot && kotItems.length > 0) {
    const merged = new Map<string, CartItem>();
    kotItems.forEach(item => {
      const existing = merged.get(item.id);
      if (existing) existing.quantity += item.quantity;
      else merged.set(item.id, { ...item });
    });
    snapshot = Array.from(merged.values());
  }

  const mergedItems = new Map<string, CartItem>();
  const sourceItems = orderItems.length > 0 ? orderItems : kotItems;
  sourceItems.forEach(item => {
    const existing = mergedItems.get(item.id);
    if (existing) existing.quantity += item.quantity;
    else mergedItems.set(item.id, { ...item });
  });

  // Lock items that have already been sent to the kitchen via any KOT so they
  // can't be edited/voided from the reopened cart.
  const kotSentIds = new Set(kotItems.map(i => i.id));
  const stampLocked = (items: CartItem[]) =>
    items.map(it => kotSentIds.has(it.id) ? { ...it, kotPrinted: true } : it);

  const normalizedOrder: Order = {
    ...order,
    items: stampLocked(orderItems),
    kotRecords: Array.isArray(order.kotRecords) ? order.kotRecords : [],
    timeline: Array.isArray(order.timeline) ? order.timeline : [],
    lastKotSnapshot: snapshot,
  };

  return {
    cartItems: stampLocked(Array.from(mergedItems.values())),
    activeOrder: normalizedOrder,
  };
}

function createTimelineEvent(type: TimelineEventType, description: string, actor?: string): TimelineEvent {
  return {
    id: `te_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(), type, description, actor,
  };
}

interface OrdersConfig {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  tables: TableInfo[];
  setTables: React.Dispatch<React.SetStateAction<TableInfo[]>>;
  takeawayOrders: TakeawayOrder[];
  setTakeawayOrders: React.Dispatch<React.SetStateAction<TakeawayOrder[]>>;
  activeOrder: Order | null;
  setActiveOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  customers: Customer[];
  setCustomers: (customers: Customer[]) => void;
  bills: Bill[];
  setBills: (bills: Bill[]) => void;
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  customerPhone: string;
  setCustomerPhone: (p: string) => void;
  searchedCustomer: Customer | null;
  setSearchedCustomer: (c: Customer | null) => void;
  appliedReward: any;
  setAppliedReward: (r: any) => void;
  orderType: string;
  setOrderType: (t: any) => void;
  paymentMethod: any;
  setPaymentMethod: (m: any) => void;
  splitDetails: any;
  setSplitDetails: (d: any) => void;
  settings: SystemSettings;
  moduleSettings?: Record<string, boolean>;
  currentEmployee: Employee | null;
  products: any[];
  refreshDailyStats: (bill?: Bill) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /** Optional confirmation-dialog helper — used when the cart holds items from another active order. */
  askConfirmation?: (title: string, message: string, onConfirm: () => void) => void;
  setIsKOTOpen: (v: boolean) => void;
  setKotOrder: (order: Order | null) => void;
  setIsKOTPreviewOpen: (v: boolean) => void;
  setActiveWorkspace: (ws: string) => void;
}

export function useOrders(config: OrdersConfig) {
  const {
    orders, setOrders,
    tables, setTables,
    takeawayOrders, setTakeawayOrders,
    activeOrder, setActiveOrder,
    customers, setCustomers,
    bills, setBills,
    cartItems, setCartItems,
    customerPhone, setCustomerPhone,
    searchedCustomer, setSearchedCustomer,
    appliedReward, setAppliedReward,
    orderType, setOrderType,
    paymentMethod, setPaymentMethod,
    splitDetails, setSplitDetails,
    settings, currentEmployee, products,
    moduleSettings, refreshDailyStats, showToast,
    askConfirmation,
    setIsKOTOpen, setKotOrder, setIsKOTPreviewOpen,
    setActiveWorkspace,
  } = config;

  const getNextOrderNumber = () => orders.length + 1001;

  const handleCreateOrder = useCallback((type: Order['type'], tableId?: string) => {
    const orderAlreadyActive = !!activeOrder && activeOrder.status !== 'Paid' && activeOrder.status !== 'Closed' && activeOrder.status !== 'Cancelled';

    // Shared creation routine — invoked directly when the cart is free, or
    // from the confirmation dialog when the user opts to discard the current
    // cart (which belongs to a different active order/table) and start fresh.
    const createOrderNow = (): Order => {
    const orderNumber = getNextOrderNumber();
    const now = new Date().toISOString();
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    let updatedTables = [...tables];
    if (tableId) {
      updatedTables = tables.map(t =>
        t.id === tableId ? {
          ...t, status: 'Occupied' as const, orderSince: now,
          // Link the table to the REAL order id (not a derived orderNumber) so
          // KOT-status → table-status sync and table→order lookups match.
          orderId,
          waiterId: currentEmployee?.id,
          waiterName: currentEmployee?.name,
        } : t
      );
      setTables(updatedTables);
      setDBData('pos_tables', updatedTables);
    }

    const newOrder: Order = {
      id: orderId,
      orderNumber, type, status: 'New',
      tableId, tableNumber: tableId ? (tables.find(t => t.id === tableId)?.number || parseInt(tableId.replace('table_', '')) || undefined) : undefined,
      waiterId: currentEmployee?.id, waiterName: currentEmployee?.name,
      createdAt: now, updatedAt: now, items: [], kotRecords: [],
      timeline: [createTimelineEvent('order_created', `Order #${orderNumber} created as ${type}`, currentEmployee?.name)],
      interimBillPrinted: false, finalBillPrinted: false,
      subtotal: 0, discount: 0, gst: 0, grandTotal: 0,
    };

    const nextOrders = [newOrder, ...orders];
    setOrders(nextOrders);
    setActiveOrder(newOrder);
    setCartItems([]);
    setCustomerPhone('');
    setSearchedCustomer(null);
    setAppliedReward(null);
    setOrderType(type);
    setPaymentMethod('Cash');
    setSplitDetails({ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 });
    // BACKEND CALLED — POST new order to cloud for kitchen/management
    api.createOrder(newOrder)
      .then((created: any) => {
        // Swap the temp local id for the server _id so later updates (KOT, Paid)
        // target the real Mongo id instead of 400ing on an invalid ObjectId.
        const serverId = created?._id || created?.id;
        if (serverId && serverId !== newOrder.id) {
          setOrders(prev => prev.map(o => o.id === newOrder.id ? { ...o, id: serverId } : o));
          setActiveOrder(prev => (prev && prev.id === newOrder.id) ? { ...prev, id: serverId } : prev);
          // Keep the table's orderId pointing at the real (server) order id so
          // KOT-status and table-card lookups keep working after the swap.
          if (tableId) {
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, orderId: serverId } : t));
          }
        }
      })
      .catch(err => debugWarn('useOrders', 'createOrder failed', err));
    // BACKEND CALLED — mark the table Occupied server-side so other terminals
    // see it taken. Server-created (Mongo) ids sync; local-only tables are skipped.
    if (tableId && /^[a-fA-F0-9]{24}$/.test(tableId)) {
      api.updateTable(tableId, { status: 'Occupied' }).catch(err => debugWarn('useOrders', 'updateTable (occupied) failed:', err));
    }
    setActiveWorkspace('Billing');
    showToast(`Order #${orderNumber} created (${type})`, 'success');
    return newOrder;
    };

    // Guard: cart items tied to an ACTIVE order must not be silently dropped.
    // Ask the user first — items stay saved on the existing order, so
    // confirming just switches to a fresh, empty cart for the new order.
    if (cartItems.length > 0 && orderAlreadyActive) {
      if (askConfirmation) {
        const itemCount = cartItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
        const tableNum = activeOrder?.tableNumber ?? (activeOrder?.tableId ? tables.find(t => t.id === activeOrder.tableId || t.orderId === activeOrder.id)?.number : undefined);
        const sourceLabel = tableNum != null ? `Table #${tableNum}` : 'the current order';
        const targetLabel = tableId
          ? `Table #${tables.find(t => t.id === tableId)?.number ?? tableId}`
          : 'a new order';
        askConfirmation(
          'Start a new order?',
          `The current cart has ${itemCount} item(s) from ${sourceLabel}. Start ${targetLabel} with an empty cart? Items remain saved on the current order.`,
          () => createOrderNow()
        );
      } else {
        showToast('Current cart has items. Pay, hold, or clear before creating new order.', 'warning');
      }
      return null;
    }
    // Leftover/stale cart items with no active order must NOT block — clear them.
    if (cartItems.length > 0) {
      setCartItems([]);
    }
    return createOrderNow();
  }, [orders, tables, currentEmployee, setOrders, setActiveOrder, setTables, showToast, setActiveWorkspace, setCartItems, cartItems, activeOrder, setCustomerPhone, setSearchedCustomer, setAppliedReward, setOrderType, setPaymentMethod, setSplitDetails, askConfirmation]);

  const handleOpenOrder = useCallback((order: Order) => {
    const { cartItems: rebuiltCartItems, activeOrder: normalizedOrder } = buildOrderOpenState(order);
    setCartItems(rebuiltCartItems);
    setActiveOrder(normalizedOrder);
    setActiveWorkspace('Billing');
    showToast(`Opened Order #${order.orderNumber}`, 'info');
  }, [setActiveOrder, setCartItems, setActiveWorkspace, showToast]);

  const handleCreateTakeawayOrder = useCallback(() => {
    const orderAlreadyActive = !!activeOrder && activeOrder.status !== 'Paid' && activeOrder.status !== 'Closed' && activeOrder.status !== 'Cancelled';

    // Shared creation routine — same pattern as handleCreateOrder.
    const createTakeawayNow = (): Order => {
    const orderNumber = getNextOrderNumber();
    const now = new Date().toISOString();
    const newOrder: Order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      orderNumber, type: 'Takeaway', status: 'New',
      waiterId: currentEmployee?.id, waiterName: currentEmployee?.name,
      createdAt: now, updatedAt: now, items: [], kotRecords: [],
      timeline: [createTimelineEvent('order_created', `Takeaway Order #${orderNumber} created`, currentEmployee?.name)],
      interimBillPrinted: false, finalBillPrinted: false,
      subtotal: 0, discount: 0, gst: 0, grandTotal: 0,
    };
    const nextOrders = [newOrder, ...orders];
    setOrders(nextOrders);
    setActiveOrder(newOrder);
    setCartItems([]);
    setCustomerPhone('');
    setSearchedCustomer(null);
    setAppliedReward(null);
    setOrderType('Takeaway');
    setPaymentMethod('Cash');
    setSplitDetails({ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 });
    // BACKEND CALLED — POST takeaway order to cloud
    api.createOrder(newOrder)
      .then((created: any) => {
        // Swap the temp local id for the server _id so later updates (KOT, Paid)
        // target the real Mongo id instead of 400ing on an invalid ObjectId.
        const serverId = created?._id || created?.id;
        if (serverId && serverId !== newOrder.id) {
          setOrders(prev => prev.map(o => o.id === newOrder.id ? { ...o, id: serverId } : o));
          setActiveOrder(prev => (prev && prev.id === newOrder.id) ? { ...prev, id: serverId } : prev);
        }
      })
      .catch(err => debugWarn('useOrders', 'createOrder failed:', err));
    // BACKEND CALLED — also track the row in /api/takeaway-orders so the
    // Takeaway panel shows it immediately. The local temp id is swapped for the
    // server _id on success so the next merge doesn't duplicate it.
    const panelOrder: TakeawayOrder = {
      id: `tw_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      orderId: newOrder.id,
      orderNumber,
      customerName: 'Guest',
      status: 'Preparing',
      amount: 0,
      paymentStatus: 'Pending',
      items: [],
      createdAt: now,
      elapsedTime: '',
    };
    setTakeawayOrders((prev: TakeawayOrder[]) => [panelOrder, ...prev]);
    api.createTakeawayOrder({
      orderNumber,
      customerName: 'Guest',
      amount: 0,
      status: 'Preparing',
      paymentStatus: 'Pending',
      items: [],
    }).then((created: any) => {
      const serverId = created?._id || created?.id;
      if (serverId && serverId !== panelOrder.id) {
        setTakeawayOrders((prev: TakeawayOrder[]) =>
          prev.map(t => t.id === panelOrder.id ? { ...t, id: serverId, orderId: serverId } : t)
        );
      }
    }).catch(err => debugWarn('useOrders', 'createTakeawayOrder failed:', err));
    setActiveWorkspace('Billing');
    showToast(`Takeaway Order #${orderNumber} created`, 'success');
    return newOrder;
    };

    // Guard: same as handleCreateOrder — confirm before discarding active cart.
    if (cartItems.length > 0 && orderAlreadyActive) {
      if (askConfirmation) {
        const itemCount = cartItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
        const tableNum = activeOrder?.tableNumber ?? (activeOrder?.tableId ? tables.find(t => t.id === activeOrder.tableId || t.orderId === activeOrder.id)?.number : undefined);
        const sourceLabel = tableNum != null ? `Table #${tableNum}` : 'the current order';
        askConfirmation(
          'Start a takeaway order?',
          `The current cart has ${itemCount} item(s) from ${sourceLabel}. Start a takeaway order with an empty cart? Items remain saved on the current order.`,
          () => createTakeawayNow()
        );
      } else {
        showToast('Current cart has items. Pay, hold, or clear before creating new order.', 'warning');
      }
      return null;
    }
    // Leftover/stale cart items with no active order must NOT block — clear them.
    if (cartItems.length > 0) {
      setCartItems([]);
    }
    return createTakeawayNow();
  }, [orders, currentEmployee, setOrders, setActiveOrder, setTakeawayOrders, showToast, setActiveWorkspace, setCartItems, cartItems, activeOrder, setCustomerPhone, setSearchedCustomer, setAppliedReward, setOrderType, setPaymentMethod, setSplitDetails, askConfirmation]);

  const handleAddTable = useCallback((table: Omit<TableInfo, 'id'>) => {
    const newTable: TableInfo = { ...table, id: `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` };
    setTables(prev => { const next = [...prev, newTable]; setDBData('pos_tables', next); return next; });
    // BACKEND CALLED — persist the new table to /api/tables. The server row
    // becomes canonical on the next fetch (which replaces the local array), so
    // there is no permanent duplicate.
    api.createTable({ number: table.number, capacity: table.capacity, status: table.status, section: table.section })
      .catch(err => debugWarn('useOrders', 'createTable failed:', err));
  }, [setTables]);

  const handleUpdateTable = useCallback((id: string, updates: Partial<TableInfo>) => {
    setTables(prev => { const next = prev.map(t => t.id === id ? { ...t, ...updates } : t); setDBData('pos_tables', next); return next; });
    // BACKEND CALLED — push table edits (number/capacity/status/section) to cloud.
    // Non-Mongo ids (tables created only locally) 404 and are ignored.
    const { id: _ignored, ...backendUpdates } = updates as any;
    api.updateTable(id, backendUpdates).catch(err => debugWarn('useOrders', 'updateTable failed:', err));
  }, [setTables]);

  const handleDeleteTable = useCallback((id: string) => {
    setTables(prev => { const next = prev.filter(t => t.id !== id); setDBData('pos_tables', next); return next; });
    // BACKEND CALLED — soft-delete the table on the server.
    api.deleteTable(id).catch(err => debugWarn('useOrders', 'deleteTable failed:', err));
  }, [setTables]);

  const handleUpdateTakeawayOrder = useCallback((id: string, updates: Partial<TakeawayOrder>) => {
    setTakeawayOrders((prev: TakeawayOrder[]) =>
      prev.map(t => t.id === id ? { ...t, ...updates } : t)
    );
    // BACKEND CALLED — sync takeaway status/payment (e.g. Collected) to cloud.
    // The /api/takeaway-orders schema is strict, so send only backend fields
    // and map CartItem-like items to the {itemName,quantity,price} shape.
    const raw = updates as any;
    const backendUpdates: any = {};
    if (raw.status) backendUpdates.status = raw.status;
    if (raw.paymentStatus) backendUpdates.paymentStatus = raw.paymentStatus;
    if (raw.amount != null) backendUpdates.amount = raw.amount;
    if (raw.customerName) backendUpdates.customerName = raw.customerName;
    if (raw.customerPhone != null) backendUpdates.customerPhone = raw.customerPhone;
    if (Array.isArray(raw.items)) {
      backendUpdates.items = raw.items.map((it: any) => ({
        itemName: it.productName || (typeof it.product === 'string' ? it.product : undefined) || it.name || 'Item',
        quantity: it.quantity ?? 1,
        price: it.price ?? 0,
        variantName: it.selectedVariant,
      }));
    }
    // Only push for rows that exist server-side (Mongo id, swapped on create
    // success). Offline-created rows keep a temp tw_ id that 400s; their final
    // state is covered by the queued create replay reconcile.
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      api.updateTakeawayOrder(id, backendUpdates).catch(err => debugWarn('useOrders', 'updateTakeawayOrder failed:', err));
    }
    showToast('Takeaway order updated.', 'success');
  }, [setTakeawayOrders, showToast]);

  const handleClearCompletedTakeaways = useCallback(() => {
    setTakeawayOrders((prev: TakeawayOrder[]) => {
      const removed = prev.filter(t => t.status === 'Completed' || t.status === 'Collected');
      // BACKEND CALLED — soft-delete each cleared takeaway order on the server.
      removed.forEach(t => {
        if (/^[a-fA-F0-9]{24}$/.test(t.id)) {
          api.deleteTakeawayOrder(t.id).catch(err => debugWarn('useOrders', 'deleteTakeawayOrder failed:', err));
        }
      });
      return prev.filter(t => t.status !== 'Completed' && t.status !== 'Collected');
    });
    showToast('Completed takeaway orders cleared.', 'info');
  }, [setTakeawayOrders, showToast]);

  const handlePrintKOT = useCallback((type: KOTType, items?: CartItem[]) => {
    if (!activeOrder) { showToast('No active order', 'warning'); return; }

    let itemsForKOT: CartItem[];
    let kotType: KOTType;
    const kotNumber = activeOrder.kotRecords.length + 1;

    if (type === 'Reprint') {
      // Reprint: copy items from the last KOT, unchanged
      const lastKot = activeOrder.kotRecords[activeOrder.kotRecords.length - 1];
      if (!lastKot) { showToast('No previous KOT to reprint', 'warning'); return; }
      itemsForKOT = lastKot.items.map(item => ({ ...item }));
      kotType = 'Reprint';
    } else if (activeOrder.kotRecords.length === 0) {
      // First KOT: send all current cart items
      const source = items || cartItems;
      if (source.length === 0) { showToast('No items to send to kitchen', 'warning'); return; }
      itemsForKOT = source.map(item => ({ ...item }));
      kotType = 'Original';
    } else {
      // Additional KOT: compute delta from lastKotSnapshot
      const source = items || cartItems;
      const delta = computeKOTDelta(source, activeOrder.lastKotSnapshot);
      if (delta.toPrint.length === 0) { showToast('No new items to send to kitchen', 'warning'); return; }
      itemsForKOT = delta.toPrint.map(d => ({
        id: d.id,
        product: d.product,
        selectedVariant: d.selectedVariant,
        quantity: d.printQty,
        notes: d.notes,
        price: d.price,
      }));
      kotType = 'Additional';
    }

    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`, kotNumber, type: kotType,
      status: type === 'Reprint' && activeOrder.kotRecords.length > 0
        ? activeOrder.kotRecords[activeOrder.kotRecords.length - 1].status
        : 'Accepted',
      items: itemsForKOT, printedAt: new Date().toLocaleTimeString(),
      printedBy: currentEmployee?.name || 'System',
    };
    const timelineType: TimelineEventType = type === 'Reprint' ? 'kot_reprint' :
      activeOrder.kotRecords.length === 0 ? 'kot_printed' : 'kot_additional_printed';
    const timelineDesc = type === 'Reprint' ? `KOT #${kotNumber} reprinted` :
      activeOrder.kotRecords.length === 0 ? `KOT #${kotNumber} printed (${itemsForKOT.length} items)` :
      `Additional KOT #${kotNumber} printed (${itemsForKOT.length} items)`;
    // Update cumulative snapshot with what was just printed
    // CRITICAL: Do NOT merge reprint items into snapshot — reprint doesn't add new items to kitchen
    const newSnapshot = type !== 'Reprint'
      ? mergeIntoSnapshot(activeOrder.lastKotSnapshot, itemsForKOT)
      : activeOrder.lastKotSnapshot;
    const sentIds = new Set(itemsForKOT.map(i => i.id));
    const updated: Order = {
      ...activeOrder,
      // Items just sent to the kitchen become locked (kotPrinted) — they can no
      // longer be edited/voided from the cart without manager permission.
      items: activeOrder.items.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it),
      kotRecords: [...activeOrder.kotRecords, newKOT],
      lastKotSnapshot: newSnapshot,
      timeline: [...activeOrder.timeline, createTimelineEvent(timelineType, timelineDesc, currentEmployee?.name)],
      updatedAt: new Date().toISOString(),
      status: activeOrder.status === 'New' ? 'Accepted' : activeOrder.status,
    };
    setCartItems(cartItems.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it));
    setOrders(orders.map(o => o.id === activeOrder.id ? updated : o));
    setActiveOrder(updated);
    setKotOrder(updated);
    // Ensure the order's table stays occupied — self-heal if a background table
    // refresh ever reset it while the order was still live.
    if (activeOrder.tableId) {
      setTables(prev => prev.map(t =>
        t.id === activeOrder.tableId
          ? { ...t, status: t.status === 'Available' ? ('Occupied' as const) : t.status, orderSince: t.orderSince || activeOrder.createdAt }
          : t
      ));
    }
    setIsKOTOpen(true);
    // Return automatically to the Order Dashboard after sending the KOT.
    setActiveWorkspace('Orders');
    api.updateOrder(activeOrder.id, updated).catch(err => debugWarn('useOrders', 'updateOrder (KOT) failed:', err));
    // Paper print is local (window.print) and works offline even when the ticket
    // can't reach a remote kitchen display. Gated by the enableAutoPrintKOT setting.
    setTimeout(() => {
      if (moduleSettings?.enableAutoPrintKOT) printKOT(updated, newKOT, settings);
      showToast(`KOT #${kotNumber} sent to kitchen printer`, 'success');
    }, 500);
  }, [activeOrder, cartItems, currentEmployee, orders, settings, moduleSettings, setOrders, setActiveOrder, setTables, setCartItems, setKotOrder, setIsKOTOpen, setActiveWorkspace, showToast]);

  const handleConfirmKOT = useCallback((pendingItems: CartItem[], kotType?: KOTType) => {
    if (!activeOrder) return;
    const kotNumber = activeOrder.kotRecords.length + 1;
    const type: KOTType = kotType || (activeOrder.kotRecords.length === 0 ? 'Original' : 'Additional');
    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`, kotNumber, type,
      status: 'Accepted',
      items: pendingItems, printedAt: new Date().toLocaleTimeString(),
      printedBy: currentEmployee?.name || 'System',
    };
    const timelineType: TimelineEventType = type === 'Reprint' ? 'kot_reprint' :
      activeOrder.kotRecords.length === 0 ? 'kot_printed' : 'kot_additional_printed';
    const desc = type === 'Reprint' ? `KOT #${kotNumber} reprinted` :
      activeOrder.kotRecords.length === 0
        ? `KOT #${kotNumber} printed (${pendingItems.length} items)`
        : `Additional KOT #${kotNumber} printed (${pendingItems.length} items)`;
    // Update cumulative snapshot with what was just printed
    // CRITICAL: Do NOT merge reprint items into snapshot — reprint doesn't add new items to kitchen
    const newSnapshot = type !== 'Reprint'
      ? mergeIntoSnapshot(activeOrder.lastKotSnapshot, pendingItems)
      : activeOrder.lastKotSnapshot;
    const sentIds = new Set(pendingItems.map(i => i.id));
    const updated: Order = {
      ...activeOrder,
      items: activeOrder.items.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it),
      kotRecords: [...activeOrder.kotRecords, newKOT],
      lastKotSnapshot: newSnapshot,
      timeline: [...activeOrder.timeline, createTimelineEvent(timelineType, desc, currentEmployee?.name)],
      updatedAt: new Date().toISOString(),
      status: activeOrder.status === 'New' ? 'Accepted' : activeOrder.status,
    };
    setCartItems(cartItems.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it));
    setOrders(orders.map(o => o.id === activeOrder.id ? updated : o));
    setActiveOrder(updated);
    setKotOrder(updated);
    api.updateOrder(activeOrder.id, updated).catch(err => debugWarn('useOrders', 'updateOrder (KOT confirm) failed:', err));
    // Ensure the order's table stays occupied — self-heal if a background table
    // refresh ever reset it while the order was still live.
    if (activeOrder.tableId) {
      setTables(prev => prev.map(t =>
        t.id === activeOrder.tableId
          ? { ...t, status: t.status === 'Available' ? ('Occupied' as const) : t.status, orderSince: t.orderSince || activeOrder.createdAt }
          : t
      ));
    }
    setIsKOTPreviewOpen(false);
    setIsKOTOpen(true);
    // Return automatically to the Order Dashboard after sending the KOT.
    setActiveWorkspace('Orders');
    setTimeout(() => {
      if (moduleSettings?.enableAutoPrintKOT) printKOT(updated, newKOT, settings);
      showToast(`KOT #${kotNumber} sent to kitchen printer`, 'success');
    }, 500);
  }, [activeOrder, cartItems, currentEmployee, orders, settings, moduleSettings, setOrders, setActiveOrder, setTables, setCartItems, setKotOrder, setIsKOTOpen, setIsKOTPreviewOpen, setActiveWorkspace, showToast]);

  const handleUpdateKOTStatus = useCallback((orderId: string, kotId: string, newStatus: KOTStatus) => {
    setOrders(prev => {
      const order = prev.find(o => o.id === orderId);
      if (!order) return prev;
      const newKotRecords = order.kotRecords.map(k =>
        k.id === kotId ? { ...k, status: newStatus } : k
      );
      const allServed = newKotRecords.every(k => k.status === 'Served');
      const updated: Order = {
        ...order,
        kotRecords: newKotRecords,
        updatedAt: new Date().toISOString(),
        status: allServed ? 'Served' : order.status,
      };
      api.updateOrder(orderId, updated).catch(err => debugWarn('useOrders', 'updateOrder (KOT status) failed:', err));
      return prev.map(o => o.id === orderId ? updated : o);
    });
    setActiveOrder(prev => {
      if (!prev || prev.id !== orderId) return prev;
      const newKotRecords = prev.kotRecords.map(k =>
        k.id === kotId ? { ...k, status: newStatus } : k
      );
      const allServed = newKotRecords.every(k => k.status === 'Served');
      return { ...prev, kotRecords: newKotRecords, updatedAt: new Date().toISOString(), status: allServed ? 'Served' : prev.status };
    });
    // Update table status based on KOT advancement + sync to server.
    // Match by the order's tableId OR the table.orderId (which mirrors the real
    // order id) so the table card reliably reflects Ready/Served.
    const orderForStatus = orders.find(o => o.id === orderId);
    const tableStatus = newStatus === 'Ready' ? ('Food Ready' as const) : newStatus === 'Served' ? ('Served' as const) : null;
    if (tableStatus && (orderForStatus?.tableId || orderForStatus?.id)) {
      setTables((prev: TableInfo[]) => prev.map(t =>
        (t.orderId === orderId || t.id === orderForStatus?.tableId)
          ? { ...t, status: tableStatus }
          : t
      ));
      const tableServerId = orderForStatus?.tableId;
      if (tableServerId && /^[a-fA-F0-9]{24}$/.test(tableServerId)) {
        api.updateTable(tableServerId, { status: tableStatus }).catch(err => debugWarn('useOrders', 'updateTable (KOT status) failed:', err));
      }
    }
  }, [orders, setOrders, setActiveOrder, setTables]);

  const handlePrintPaperKOT = useCallback((kotId: string) => {
    // Manual reprint of an existing KOT — local paper print, works offline.
    const order = activeOrder && activeOrder.kotRecords.some(k => k.id === kotId)
      ? activeOrder
      : orders.find(o => o.kotRecords.some(k => k.id === kotId));
    const kot = order?.kotRecords.find(k => k.id === kotId);
    if (!order || !kot) { showToast('KOT not found', 'warning'); return; }
    printKOT(order, kot, settings);
    showToast(`KOT #${kot.kotNumber} sent to printer`, 'info');
  }, [activeOrder, orders, settings, showToast]);

  return {
    tables, setTables,
    orders, setOrders,
    takeawayOrders, setTakeawayOrders,
    activeOrder, setActiveOrder,
    handleCreateOrder,
    handleOpenOrder,
    handleCreateTakeawayOrder,
    handlePrintKOT,
    handlePrintPaperKOT,
    handleConfirmKOT,
    handleUpdateKOTStatus,
    handleUpdateTakeawayOrder,
    handleClearCompletedTakeaways,
    handleAddTable,
    handleUpdateTable,
    handleDeleteTable,
    getNextOrderNumber,
  };
}

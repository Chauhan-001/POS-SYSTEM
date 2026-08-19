/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orders hook — orders, tables, KOT, timeline, payment processing
 * Data flow: local state is source of truth; all mutations sync to API.
 */

import { useCallback } from 'react';
import type { Order, TableInfo, TakeawayOrder, CartItem, KOTType, KOTStatus, KOTRecord, TimelineEvent, TimelineEventType, Bill, Employee, Customer, SystemSettings } from '../types';
import { setDBData, getDBData, computeDailySales, buildActivityFeed } from '../data';
import * as api from '../api/client';
import { debugWarn } from '../utils/debugLog';
import { computeKOTDelta, mergeIntoSnapshot } from '../utils/kotDelta';
import { printKOT } from '../utils/printKOT';

/**
 * Normalize an order line into the frontend CartItem shape. POS-origin items
 * already carry a full `product` object; backend-created items (website/QR
 * orders, whose items are OrderItem docs with productId/productName only) get
 * the matching catalog product attached so cart/tax code that reads
 * `item.product.gstPercent` never sees undefined.
 */
function toCartItemShape(item: any, productById: Map<string, any>): any {
  if (!item) return item;
  if (item.product && (item.product.id || item.product._id)) return item;
  const productId = item.productId ? String(item.productId) : undefined;
  const product = productId ? productById.get(productId) : undefined;
  return {
    ...item,
    id: item.id || item._id,
    product: product || {
      id: productId,
      name: item.productName || 'Item',
      price: item.price || 0,
      gstPercent: 0,
      availability: true,
    },
  };
}

export function buildOrderOpenState(order: Order) {
  // Attach catalog products to backend-shaped lines (see toCartItemShape).
  let productById: Map<string, any> = new Map();
  try {
    const cached = getDBData<any[]>('pos_products', []);
    if (Array.isArray(cached)) {
      productById = new Map(cached.map((p: any) => [String(p.id || p._id), p]));
    }
  } catch { /* non-fatal — fall back to minimal product objects */ }

  const orderItems = (Array.isArray(order.items) ? order.items : []).map(i => toCartItemShape(i, productById));
  const kotItems = (order.kotRecords || []).flatMap(kot => (kot.items || []).map(i => toCartItemShape(i, productById)));

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

/**
 * Resolve the takeaway panel row linked to an order. Matches by the live
 * `orderId` link first, then falls back to the shared `orderNumber` — legacy
 * rows (created before the row→order link existed) carry the takeaway-orders
 * doc id or null in `orderId`, and a server merge can transiently clobber it
 * before the link push lands. The two docs always share the order-number
 * series (one atomic counter), so the fallback is unambiguous.
 */
export function findLinkedTakeaway(
  rows: TakeawayOrder[],
  order: { id: string; orderNumber: number },
): TakeawayOrder | undefined {
  return rows.find(t => t.orderId === order.id || t.orderNumber === order.orderNumber);
}

/**
 * Derive the order's lifecycle status from its KOT records so the order
 * advances Preparing → Ready → Served in lock-step with the Kitchen Display.
 * - all KOTs served        → 'Served'
 * - any KOT Ready          → 'Ready'
 * - any KOT Preparing      → 'Preparing'
 * - otherwise (all Accepted) → keep the current status (New → Accepted).
 */
export function deriveOrderStatusFromKots(kots: KOTRecord[], fallback: Order['status']): Order['status'] {
  if (!Array.isArray(kots) || kots.length === 0) return fallback;
  const pending = kots.filter(k => k.status !== 'Served');
  if (pending.length === 0) return 'Served';
  if (kots.some(k => k.status === 'Ready')) return 'Ready';
  if (kots.some(k => k.status === 'Preparing')) return 'Preparing';
  return fallback;
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
  /** Table whose billing workspace is open but whose order is not created yet. */
  pendingTableId: string | null;
  setPendingTableId: (id: string | null) => void;
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
    pendingTableId, setPendingTableId,
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

  // ─── KOT output routing ───────────────────────────────────────
  // Where a kitchen ticket goes when sent: 'print' → paper ticket only,
  // 'kds' → kitchen display only, 'both' → both. Auto-print stays gated by
  // the enableAutoPrintKOT module toggle (manual reprints always print).
  const kotOutputMode: 'print' | 'kds' | 'both' = settings.kotOutputMode ?? 'both';
  const kotShouldAutoPrint = (moduleSettings?.enableAutoPrintKOT ?? false) && (kotOutputMode === 'print' || kotOutputMode === 'both');
  const kotDeliveryLabel = kotOutputMode === 'print' ? 'kitchen printer' : kotOutputMode === 'kds' ? 'kitchen display' : 'kitchen printer & display';

  const getNextOrderNumber = useCallback(async (): Promise<number> => {
    // BACKEND CALLED — atomic Mongo counter guarantees a unique order number
    // across all terminals (never repeats, never resets). When the backend is
    // unreachable, fall back to a persisted local counter so offline creation
    // still gets monotonic, ever-increasing numbers.
    const serverNum = await api.fetchNextOrderNumber();
    if (serverNum !== null && typeof serverNum === 'number') {
      // Keep the local fallback roughly in sync so numbers keep advancing if
      // the app goes offline mid-shift (same pattern as the invoice counter).
      setDBData('pos_next_order_number', serverNum + 1);
      return serverNum;
    }
    const maxLocal = [...orders, ...takeawayOrders].reduce((m, o: any) => Math.max(m, o.orderNumber || 0), 1000);
    const stored = getDBData<number>('pos_next_order_number', maxLocal + 1);
    const next = Math.max(maxLocal + 1, stored);
    setDBData('pos_next_order_number', next + 1);
    return next;
  }, [orders, takeawayOrders]);

  const handleCreateOrder = useCallback(async (
    type: Order['type'],
    tableId?: string,
    opts?: {
      preserveCart?: boolean;
      awaitServer?: boolean;
      /** Lazy first-KOT creation: carry the cart items + computed totals so the
       *  order is complete (items/totals/tenant) the moment it is born. */
      seed?: { items: CartItem[]; subtotal: number; discount: number; gst: number; grandTotal: number };
    },
  ): Promise<Order | null> => {
    const orderAlreadyActive = !!activeOrder && activeOrder.status !== 'Paid' && activeOrder.status !== 'Closed' && activeOrder.status !== 'Cancelled';

    // Shared creation routine — invoked directly when the cart is free, or
    // from the confirmation dialog when the user opts to discard the current
    // cart (which belongs to a different active order/table) and start fresh.
    const createOrderNow = async (): Promise<Order> => {
    const orderNumber = await getNextOrderNumber();
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
      createdAt: now, updatedAt: now,
      items: opts?.seed ? opts.seed.items : [], kotRecords: [],
      timeline: [createTimelineEvent('order_created', `Order #${orderNumber} created as ${type}`, currentEmployee?.name)],
      interimBillPrinted: false, finalBillPrinted: false,
      subtotal: opts?.seed ? opts.seed.subtotal : 0,
      discount: opts?.seed ? opts.seed.discount : 0,
      gst: opts?.seed ? opts.seed.gst : 0,
      grandTotal: opts?.seed ? opts.seed.grandTotal : 0,
    };

    const nextOrders = [newOrder, ...orders];
    setOrders(nextOrders);
    setActiveOrder(newOrder);
    if (!opts?.preserveCart) setCartItems([]);
    setCustomerPhone('');
    setSearchedCustomer(null);
    setAppliedReward(null);
    setOrderType(type);
    setPaymentMethod('Cash');
    setSplitDetails({ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 });
    // BACKEND CALLED — POST new order to cloud for kitchen/management.
    // When awaitServer is set (lazy creation at first KOT) the caller needs the
    // real Mongo id synchronously so the KOT update it sends immediately after
    // targets a valid ObjectId; otherwise keep the fire-and-forget swap.
    let finalOrder = newOrder;
    if (opts?.awaitServer) {
      try {
        const created = await api.createOrder(newOrder);
        // Swap the temp local id for the server _id so the follow-up KOT update
        // targets the real Mongo id instead of 400ing on an invalid ObjectId.
        const serverId = created?.data?._id || created?.data?.id;
        if (created?.ok && serverId && serverId !== newOrder.id) {
          finalOrder = { ...newOrder, id: serverId };
          setOrders(prev => prev.map(o => o.id === newOrder.id ? { ...o, id: serverId } : o));
          setActiveOrder(prev => (prev && prev.id === newOrder.id) ? { ...prev, id: serverId } : prev);
          if (tableId) {
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, orderId: serverId } : t));
          }
        }
        if (!created?.ok && created?.status === 409 && created?.code === 'TABLE_ALREADY_OCCUPIED') {
          // A customer QR/website order landed on this table while the cashier
          // was preparing — the server refuses a second live order (one order
          // per table). Roll back the optimistic local order + occupancy so the
          // cashier is not left on a phantom order, and surface the conflict.
          setOrders(prev => prev.filter(o => o.id !== newOrder.id));
          setActiveOrder(prev => (prev && prev.id === newOrder.id) ? null : prev);
          if (tableId) {
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: 'Available' as const, orderSince: undefined, orderId: undefined } : t));
          }
          throw new Error('TABLE_ALREADY_OCCUPIED');
        }
      } catch (err) {
        if ((err as Error)?.message === 'TABLE_ALREADY_OCCUPIED') throw err;
        debugWarn('useOrders', 'createOrder (awaitServer) failed:', err);
      }
    } else {
      api.createOrder(newOrder)
        .then((created: any) => {
          // Swap the temp local id for the server _id so later updates (KOT, Paid)
          // target the real Mongo id instead of 400ing on an invalid ObjectId.
          const serverId = created?.data?._id || created?.data?.id;
          if (created?.ok && serverId && serverId !== newOrder.id) {
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
    }
    // BACKEND CALLED — mark the table Occupied server-side so other terminals
    // see it taken. Server-created (Mongo) ids sync; local-only tables are skipped.
    if (tableId && /^[a-fA-F0-9]{24}$/.test(tableId)) {
      api.updateTable(tableId, { status: 'Occupied' }).catch(err => debugWarn('useOrders', 'updateTable (occupied) failed:', err));
    }
    setActiveWorkspace('Billing');
    showToast(`Order #${orderNumber} created (${type})`, 'success');
    return finalOrder;
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
    // Leftover/stale cart items with no active order must NOT block — clear them
    // unless the caller explicitly wants to keep them (lazy creation at KOT).
    if (cartItems.length > 0 && !opts?.preserveCart) {
      setCartItems([]);
    }
    return createOrderNow();
  }, [orders, tables, currentEmployee, setOrders, setActiveOrder, setTables, showToast, setActiveWorkspace, setCartItems, cartItems, activeOrder, setCustomerPhone, setSearchedCustomer, setAppliedReward, setOrderType, setPaymentMethod, setSplitDetails, askConfirmation, getNextOrderNumber]);

  const handleOpenOrder = useCallback(async (order: Order) => {
    // The orders LIST endpoint returns orders without the assembled `items`
    // array (only GET /orders/:id joins items/kots/timeline). buildOrderOpenState
    // falls back to KOT items, but an online order with auto-KOT disabled has
    // neither — so the reopened cart would be empty and the cashier could not
    // send it to the kitchen. Fetch the full detail when items are missing.
    let full = order;
    const needsDetail = (order.items || []).length === 0 && (order.kotRecords || []).length === 0;
    if (needsDetail && order.id && /^[a-fA-F0-9]{24}$/.test(String(order.id))) {
      try {
        const fetched = await api.fetchOrderById(String(order.id));
        if (fetched) full = fetched;
      } catch (err) {
        debugWarn('useOrders', 'fetchOrderById (open order) failed:', err);
      }
    }
    const { cartItems: rebuiltCartItems, activeOrder: normalizedOrder } = buildOrderOpenState(full);
    setCartItems(rebuiltCartItems);
    setActiveOrder(normalizedOrder);
    setPendingTableId(null);
    setActiveWorkspace('Billing');
    showToast(`Opened Order #${order.orderNumber}`, 'info');
  }, [setActiveOrder, setCartItems, setPendingTableId, setActiveWorkspace, showToast]);

  /**
   * Close the active order WITHOUT payment — the undo for an accidental table
   * tap that created an order. Only allowed BEFORE the first KOT reaches the
   * kitchen; once any KOT is sent the order is locked and cannot be closed
   * (the kitchen is already cooking it). Frees the table and clears the cart.
   */
  const handleCloseOrder = useCallback(() => {
    if (!activeOrder) { showToast('No active order to close', 'warning'); return; }
    // Never close an already-terminal order — overwriting Paid/Closed/Cancelled
    // with Cancelled would corrupt the bill history.
    if (['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'].includes(activeOrder.status)) {
      showToast('This order is already closed', 'warning');
      return;
    }
    const kotSent = (activeOrder.kotRecords || []).length > 0;
    if (kotSent) { showToast('Order already sent to kitchen — cannot close', 'warning'); return; }

    const doClose = () => {
      const orderId = activeOrder.id;
      const tableId = activeOrder.tableId;
      const now = new Date().toISOString();

      // Mark the order cancelled with a timeline event.
      const closedOrder: Order = {
        ...activeOrder,
        status: 'Cancelled',
        updatedAt: now,
        timeline: [...(activeOrder.timeline || []), createTimelineEvent('order_cancelled', `Order #${activeOrder.orderNumber} closed`, currentEmployee?.name)],
      };
      setOrders(orders.map(o => o.id === orderId ? closedOrder : o));
      setActiveOrder(null);
      setCartItems([]);
      setCustomerPhone('');
      setSearchedCustomer(null);
      setAppliedReward(null);

      // Free the table locally + server-side so other terminals see it open.
      // Clear ALL occupancy metadata (same cleanup the tour performs) so the
      // table card doesn't show a stale waiter/guest after the close.
      if (tableId) {
        setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: 'Available' as const, orderSince: undefined, orderId: undefined, guestCount: undefined, waiterId: undefined, waiterName: undefined } : t));
        if (/^[a-fA-F0-9]{24}$/.test(tableId)) {
          api.updateTable(tableId, { status: 'Available' }).catch(err => debugWarn('useOrders', 'updateTable (available on close) failed:', err));
        }
      }

      // Clean up any linked takeaway panel row so a ghost 'Preparing' entry
      // doesn't linger when a takeaway order is closed before its KOT.
      // Match by orderId AND orderNumber so legacy rows (whose orderId still
      // points at the takeaway doc id) are cleaned up too.
      if (activeOrder.type === 'Takeaway' && takeawayOrders.length > 0) {
        const linked = takeawayOrders.filter(t => t.orderId === orderId || t.orderNumber === activeOrder.orderNumber);
        if (linked.length > 0) {
          setTakeawayOrders(prev => prev.filter(t => !linked.some(l => l.id === t.id)));
          linked.forEach(t => {
            if (/^[a-fA-F0-9]{24}$/.test(t.id)) {
              api.deleteTakeawayOrder(t.id).catch(err => debugWarn('useOrders', 'deleteTakeawayOrder (close) failed:', err));
            }
          });
        }
      }

      // BACKEND CALLED — sync the cancelled order (status change also triggers
      // server-side table reconciliation since Cancelled is terminal).
      if (/^[a-fA-F0-9]{24}$/.test(orderId)) {
        api.updateOrder(orderId, closedOrder).catch(err => debugWarn('useOrders', 'updateOrder (close) failed:', err));
      }

      showToast(`Order #${activeOrder.orderNumber} closed`, 'success');
      // Redirect back to the Orders (floor plan / table view) page — the screen
      // the user came from when they tapped the table. Same behaviour as after
      // sending a KOT; otherwise the user is stranded on a Billing screen with
      // no active order and the layout looks broken.
      setActiveWorkspace('Orders');
    };

    if (askConfirmation) {
      const tableNum = activeOrder.tableNumber ?? (activeOrder.tableId ? tables.find(t => t.id === activeOrder.tableId || t.orderId === activeOrder.id)?.number : undefined);
      askConfirmation(
        'Close this order?',
        `Order #${activeOrder.orderNumber}${tableNum != null ? ` (Table #${tableNum})` : ''} will be closed and the table freed. Any items in the cart will be discarded. This cannot be undone.`,
        doClose,
      );
    } else {
      doClose();
    }
  }, [activeOrder, orders, tables, takeawayOrders, setTakeawayOrders, currentEmployee, setOrders, setActiveOrder, setTables, setCartItems, setCustomerPhone, setSearchedCustomer, setAppliedReward, showToast, askConfirmation, setActiveWorkspace]);

  const handleCreateTakeawayOrder = useCallback(async (): Promise<Order | null> => {
    const orderAlreadyActive = !!activeOrder && activeOrder.status !== 'Paid' && activeOrder.status !== 'Closed' && activeOrder.status !== 'Cancelled';

    // Shared creation routine — same pattern as handleCreateOrder.
    const createTakeawayNow = async (): Promise<Order> => {
    const orderNumber = await getNextOrderNumber();
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
    // BACKEND CALLED — POST takeaway order to cloud AND track the row in
    // /api/takeaway-orders so the Takeaway panel shows it immediately. Both
    // creates resolve independently; once BOTH have, the panel row is linked to
    // the REAL order id (the Mongo _id of the /orders doc — NOT the takeaway
    // doc id) so:
    //   1. clicking the takeaway card opens the right order in billing,
    //   2. handleCloseOrder can find + remove the linked row,
    //   3. the backend's OrderService status→takeaway sync (Preparing → Ready
    //      → Collected → Completed) can follow the order lifecycle.
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
    const orderCreate = api.createOrder(newOrder);
    const takeawayCreate = api.createTakeawayOrder({
      orderNumber,
      customerName: 'Guest',
      amount: 0,
      status: 'Preparing',
      paymentStatus: 'Pending',
      items: [],
    });
    Promise.allSettled([orderCreate, takeawayCreate]).then(([oRes, tRes]) => {
      if (oRes.status === 'rejected') debugWarn('useOrders', 'createOrder failed:', oRes.reason);
      if (tRes.status === 'rejected') debugWarn('useOrders', 'createTakeawayOrder failed:', tRes.reason);
      // Swap the temp local ids for the server _ids so later updates (KOT,
      // Paid) target the real Mongo ids instead of 400ing on invalid ObjectIds.
      const orderServerId = oRes.status === 'fulfilled' ? (oRes.value?.data?._id || oRes.value?.data?.id) : undefined;
      const twServerId = tRes.status === 'fulfilled' ? (tRes.value?._id || tRes.value?.id) : undefined;
      if (orderServerId && orderServerId !== newOrder.id) {
        setOrders(prev => prev.map(o => o.id === newOrder.id ? { ...o, id: orderServerId } : o));
        setActiveOrder(prev => (prev && prev.id === newOrder.id) ? { ...prev, id: orderServerId } : prev);
      }
      // Keep the panel row pointing at the ORDER id (never the takeaway id).
      setTakeawayOrders((prev: TakeawayOrder[]) =>
        prev.map(t => t.id === panelOrder.id
          ? { ...t, id: twServerId || t.id, orderId: orderServerId || t.orderId }
          : t)
      );
      // Server-side link so OrderService.update can sync statuses. Only when
      // both ids are Mongo ObjectIds (i.e. online); offline-created rows keep
      // temp ids and the link is established on the queued create replay.
      if (
        orderServerId && /^[a-fA-F0-9]{24}$/.test(orderServerId) &&
        twServerId && /^[a-fA-F0-9]{24}$/.test(twServerId)
      ) {
        api.updateTakeawayOrder(twServerId, { orderId: orderServerId } as any)
          .catch(err => debugWarn('useOrders', 'link takeaway order failed:', err));
      }
    });
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
  }, [orders, currentEmployee, setOrders, setActiveOrder, setTakeawayOrders, showToast, setActiveWorkspace, setCartItems, cartItems, activeOrder, setCustomerPhone, setSearchedCustomer, setAppliedReward, setOrderType, setPaymentMethod, setSplitDetails, askConfirmation, getNextOrderNumber]);

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
        configuration: d.configuration,
        configSummary: d.configSummary,
      }));
      kotType = 'Additional';
    }

    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`, kotNumber, type: kotType,
      status: type === 'Reprint' && activeOrder.kotRecords.length > 0
        ? activeOrder.kotRecords[activeOrder.kotRecords.length - 1].status
        : 'Accepted',
      items: itemsForKOT, printedAt: new Date().toISOString(),
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
      if (kotShouldAutoPrint) printKOT(updated, newKOT, settings);
      showToast(`KOT #${kotNumber} sent to ${kotDeliveryLabel}`, 'success');
    }, 500);
  }, [activeOrder, cartItems, currentEmployee, orders, settings, moduleSettings, setOrders, setActiveOrder, setTables, setCartItems, setKotOrder, setIsKOTOpen, setActiveWorkspace, showToast]);

  const handleConfirmKOT = useCallback(async (pendingItems: CartItem[], kotType?: KOTType) => {
    let order = activeOrder;
    // Lazy order creation — tapping an available table never creates an order;
    // the order (and the table's Occupied state) is born with its FIRST KOT so
    // an accidental table tap can't occupy a table. The cart items are kept.
    if (!order) {
      if (pendingItems.length === 0) { showToast('No items to send to kitchen', 'warning'); return; }
      // The order is born with its first KOT — carry the cart items and the
      // computed totals so the doc is complete (items + totals + tenant) the
      // moment it exists, exactly like a website-origin order.
      const subtotal = pendingItems.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 0), 0);
      const gst = pendingItems.reduce((s: number, i: any) =>
        s + (i.price || 0) * (i.quantity || 0) * ((i.product?.gstPercent || 0) / 100), 0);
      let created: Order | null = null;
      try {
        created = await handleCreateOrder(
          (orderType as Order['type']) || 'Dine In',
          pendingTableId || undefined,
          {
            preserveCart: true,
            awaitServer: true,
            seed: { items: pendingItems, subtotal, discount: 0, gst, grandTotal: subtotal + gst },
          },
        );
      } catch (err) {
        if ((err as Error)?.message === 'TABLE_ALREADY_OCCUPIED') {
          // A customer QR/website order already owns this table — never create
          // a second order. Tell the cashier to open the existing order.
          showToast('This table already has an open online order — refresh to open it', 'warning');
          setPendingTableId(null);
          return;
        }
        throw err;
      }
      if (!created) { showToast('Could not create the order', 'warning'); return; }
      order = { ...created, items: pendingItems.map(i => ({ ...i })) };
      setPendingTableId(null);
    }
    if (!order) return;
    const kotNumber = order.kotRecords.length + 1;
    const type: KOTType = kotType || (order.kotRecords.length === 0 ? 'Original' : 'Additional');
    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`, kotNumber, type,
      status: 'Accepted',
      items: pendingItems, printedAt: new Date().toISOString(),
      printedBy: currentEmployee?.name || 'System',
    };
    const timelineType: TimelineEventType = type === 'Reprint' ? 'kot_reprint' :
      order.kotRecords.length === 0 ? 'kot_printed' : 'kot_additional_printed';
    const desc = type === 'Reprint' ? `KOT #${kotNumber} reprinted` :
      order.kotRecords.length === 0
        ? `KOT #${kotNumber} printed (${pendingItems.length} items)`
        : `Additional KOT #${kotNumber} printed (${pendingItems.length} items)`;
    // Update cumulative snapshot with what was just printed
    // CRITICAL: Do NOT merge reprint items into snapshot — reprint doesn't add new items to kitchen
    const newSnapshot = type !== 'Reprint'
      ? mergeIntoSnapshot(order.lastKotSnapshot, pendingItems)
      : order.lastKotSnapshot;
    const sentIds = new Set(pendingItems.map(i => i.id));
    const updated: Order = {
      ...order,
      items: order.items.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it),
      kotRecords: [...order.kotRecords, newKOT],
      lastKotSnapshot: newSnapshot,
      timeline: [...order.timeline, createTimelineEvent(timelineType, desc, currentEmployee?.name)],
      updatedAt: new Date().toISOString(),
      status: order.status === 'New' ? 'Accepted' : order.status,
    };
    setCartItems(cartItems.map(it => sentIds.has(it.id) ? { ...it, kotPrinted: true } : it));
    // Functional update so a just-created (lazy) order — not yet in the local
    // `orders` closure — still gets its KOT record attached.
    setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
    setActiveOrder(updated);
    setKotOrder(updated);
    api.updateOrder(order.id, updated).catch(err => debugWarn('useOrders', 'updateOrder (KOT confirm) failed:', err));
    // Ensure the order's table stays occupied — self-heal if a background table
    // refresh ever reset it while the order was still live.
    if (order.tableId) {
      setTables(prev => prev.map(t =>
        t.id === order.tableId
          ? { ...t, status: t.status === 'Available' ? ('Occupied' as const) : t.status, orderSince: t.orderSince || order.createdAt }
          : t
      ));
    }
    setIsKOTPreviewOpen(false);
    setIsKOTOpen(true);
    // Return automatically to the Order Dashboard after sending the KOT.
    setActiveWorkspace('Orders');
    setTimeout(() => {
      if (kotShouldAutoPrint) printKOT(updated, newKOT, settings);
      showToast(`KOT #${kotNumber} sent to ${kotDeliveryLabel}`, 'success');
    }, 500);
  }, [activeOrder, pendingTableId, setPendingTableId, handleCreateOrder, orderType, cartItems, currentEmployee, orders, settings, moduleSettings, setOrders, setActiveOrder, setTables, setCartItems, setKotOrder, setIsKOTOpen, setIsKOTPreviewOpen, setActiveWorkspace, showToast]);

  const handleUpdateKOTStatus = useCallback((orderId: string, kotId: string, newStatus: KOTStatus) => {
    setOrders(prev => {
      const order = prev.find(o => o.id === orderId);
      if (!order) return prev;
      const newKotRecords = order.kotRecords.map(k =>
        k.id === kotId ? { ...k, status: newStatus } : k
      );
      const updated: Order = {
        ...order,
        kotRecords: newKotRecords,
        updatedAt: new Date().toISOString(),
        // Advance the order lifecycle in lock-step with the KDS (Preparing →
        // Ready → Served) instead of leaving it stuck on Accepted.
        status: deriveOrderStatusFromKots(newKotRecords, order.status),
      };
      api.updateOrder(orderId, updated).catch(err => debugWarn('useOrders', 'updateOrder (KOT status) failed:', err));
      return prev.map(o => o.id === orderId ? updated : o);
    });
    setActiveOrder(prev => {
      if (!prev || prev.id !== orderId) return prev;
      const newKotRecords = prev.kotRecords.map(k =>
        k.id === kotId ? { ...k, status: newStatus } : k
      );
      return { ...prev, kotRecords: newKotRecords, updatedAt: new Date().toISOString(), status: deriveOrderStatusFromKots(newKotRecords, prev.status) };
    });
    // Keep the linked takeaway panel row in sync with the order lifecycle so
    // the Takeaway tab reflects KDS progress immediately (the server does the
    // same via OrderService.update, but the local row only refreshes on the
    // 30s poll otherwise).
    const syncedOrder = orders.find(o => o.id === orderId);
    if (syncedOrder?.type === 'Takeaway') {
      const derived = deriveOrderStatusFromKots(
        syncedOrder.kotRecords.map(k => k.id === kotId ? { ...k, status: newStatus } : k),
        syncedOrder.status,
      );
      const takeawayStatusMap: Partial<Record<string, TakeawayOrder['status']>> = {
        Preparing: 'Preparing',
        Ready: 'Ready',
        Served: 'Collected',
      };
      const nextTwStatus = takeawayStatusMap[derived];
      if (nextTwStatus) {
        setTakeawayOrders((prev: TakeawayOrder[]) => {
          // No-op when the linked row is absent (avoid creating a stale row).
          if (!findLinkedTakeaway(prev, { id: orderId, orderNumber: syncedOrder.orderNumber })) return prev;
          return prev.map(t =>
            (t.orderId === orderId || t.orderNumber === syncedOrder.orderNumber)
              ? { ...t, status: nextTwStatus }
              : t
          );
        });
      }
    }
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
  }, [orders, setOrders, setActiveOrder, setTables, setTakeawayOrders]);

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
    handleCloseOrder,
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

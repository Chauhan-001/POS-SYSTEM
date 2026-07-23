/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Star, Plus, Minus, Trash, ShoppingCart, User, Lock, Wifi, Printer, 
  Server, Database, HelpCircle, FileText, Settings, LogOut, Award, Layers, 
    Users, TrendingUp, Notebook, Tag, ArrowUpRight, ArrowLeft, ClipboardCheck, Phone, 
    RefreshCw, CheckCircle, Shield, KeyRound, Clock, AlertCircle, Sparkles, Keyboard,
    BarChart, Activity, DollarSign, Receipt,    ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Ban,
    ArrowLeftRight, XCircle, X, MoreHorizontal, Eye, Pizza, Beef, Heart, UtensilsCrossed, Coffee, IceCream, Soup, Sandwich, CookingPot, GlassWater, Cake, PackageCheck, Salad, Grape, CreditCard, Smartphone, Wallet
} from 'lucide-react';

import { 
  Product, Customer, LoyaltyReward, Employee, SystemSettings, Bill, CartItem, ProductVariant,
  DailySales, ActivityEntry, Order, OrderStatus, TableInfo, TakeawayOrder, KOTRecord,
  TimelineEvent, TimelineEventType, KOTType
} from './types';

import { 
  getDBData, setDBData, DEFAULT_PRODUCTS, DEFAULT_CUSTOMERS, DEFAULT_REWARDS, 
  DEFAULT_EMPLOYEES, DEFAULT_SETTINGS, DEFAULT_BILLS, 
  computeDailySales, buildActivityFeed, getActivityFeed, saveActivityFeed 
} from './data';

import { syncEngine } from './lib/syncEngine';

import LoginScreen from '../components/LoginScreen';
import ReceiptModal from '../components/ReceiptModal';
import ShortcutsGuide from '../components/ShortcutsGuide';
import ProductManager from '../components/ProductManager';
import CustomerManager from '../components/CustomerManager';
import OffersManager from '../components/OffersManager';
import ReportsManager from '../components/ReportsManager';
import StaffManager from '../components/StaffManager';
import SettingsManager from '../components/SettingsManager';
import OrderManager from '../components/OrderManager';
import KOTModal from '../components/KOTModal';
import OrderTimeline from '../components/OrderTimeline';

// Module-level seed data for restaurant floor tables (no component dependency)
const DEFAULT_TABLES: TableInfo[] = (() => {
  const sections = ['Main Hall', 'Terrace', 'VIP Room', 'Garden'];
  const tbls: TableInfo[] = [];
  for (let i = 1; i <= 24; i++) {
    const section = sections[Math.floor((i - 1) / 6) % sections.length];
    tbls.push({
      id: `table_${i}`,
      number: i,
      capacity: i % 4 === 0 ? 8 : i % 3 === 0 ? 6 : 4,
      status: 'Available' as const,
      section,
    });
  }
  return tbls;
})();

export default function App() {
  // Load States from LocalStorage / Database Seeds
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => getDBData('pos_current_employee', null));
  const [products, setProducts] = useState<Product[]>(() => getDBData('pos_products', DEFAULT_PRODUCTS));
  const [customers, setCustomers] = useState<Customer[]>(() => getDBData('pos_customers', DEFAULT_CUSTOMERS));
  const [rewards, setRewards] = useState<LoyaltyReward[]>(() => getDBData('pos_rewards', DEFAULT_REWARDS));
  const [employees, setEmployees] = useState<Employee[]>(() => getDBData('pos_employees', DEFAULT_EMPLOYEES));
  const [settings, setSettings] = useState<SystemSettings>(() => getDBData('pos_settings', DEFAULT_SETTINGS));
  const [bills, setBills] = useState<Bill[]>(() => getDBData('pos_bills', DEFAULT_BILLS));

  // Module settings — which features are enabled/disabled
  const moduleSettings = settings.moduleSettings || {
    enableTableService: true,
    enableWaiterManagement: true,
    enableReservations: false,
    enableQROrdering: false,
    enableDeliveryModule: true,
    enableOnlineOrders: true,
    enableKitchenDisplay: true,
    enableLoyalty: true,
  };

  // Sync state
  const [syncState, setSyncState] = useState(() => syncEngine.getSyncState());
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);

  // Subscribe to syncEngine changes
  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(() => {
      setSyncState(syncEngine.getSyncState());
      setProducts(getDBData('pos_products', DEFAULT_PRODUCTS));
      setCustomers(getDBData('pos_customers', DEFAULT_CUSTOMERS));
      setRewards(getDBData('pos_rewards', DEFAULT_REWARDS));
      setSettings(getDBData('pos_settings', DEFAULT_SETTINGS));
      setBills(getDBData('pos_bills', DEFAULT_BILLS));
    });
    return unsubscribe;
  }, []);
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = getDBData<string[] | null>('pos_categories', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  });

  // Dynamic Adjustable Cart Width State (Default: 380px for a premium wide layout)
  const [cartWidth, setCartWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('pos_cart_width');
      return saved ? parseInt(saved, 10) : 380;
    } catch {
      return 380;
    }
  });

  // Drag-to-resize handler for the billing sidebar panel
  const startResizeCart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cartWidth;

    const doDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // Let the width range from 300px to 650px
      const newWidth = Math.max(300, Math.min(650, startWidth - deltaX));
      setCartWidth(newWidth);
    };

    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  // ============================================================
  // ORDER MANAGEMENT STATE
  // ============================================================
  
  // Seed tables for the restaurant floor
  const [tables, setTables] = useState<TableInfo[]>(() => {
    const saved = getDBData<TableInfo[]>('pos_tables', DEFAULT_TABLES);
    // Reset all tables to Available on every app start
    return saved.map(t => ({ ...t, status: 'Available' as const, orderSince: undefined, orderId: undefined, guestCount: undefined, waiterId: undefined, waiterName: undefined }));
  });
  
  const handleAddTable = (table: Omit<TableInfo, 'id'>) => {
    const newTable: TableInfo = {
      ...table,
      id: `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    };
    setTables(prev => {
      const next = [...prev, newTable];
      setDBData('pos_tables', next);
      return next;
    });
  };

  const handleUpdateTable = (id: string, updates: Partial<TableInfo>) => {
    setTables(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...updates } : t);
      setDBData('pos_tables', next);
      return next;
    });
  };

  const handleDeleteTable = (id: string) => {
    setTables(prev => {
      const next = prev.filter(t => t.id !== id);
      setDBData('pos_tables', next);
      return next;
    });
  };
  
  // Orders database
  const [orders, setOrders] = useState<Order[]>(() => getDBData<Order[]>('pos_orders', []));
  
  // Takeaway orders
  const [takeawayOrders, setTakeawayOrders] = useState<TakeawayOrder[]>(() => getDBData<TakeawayOrder[]>('pos_takeaway_orders', []));
  
  // Active order being billed
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  
  // KOT Modal state
  const [isKOTOpen, setIsKOTOpen] = useState(false);
  const [kotOrder, setKotOrder] = useState<Order | null>(null);
  
  // KOT Preview state — show a preview popup before actually sending to kitchen
  const [isKOTPreviewOpen, setIsKOTPreviewOpen] = useState(false);
  const [kotPreviewData, setKotPreviewData] = useState<{
    items: CartItem[];
    kotType: KOTType;
    onConfirm: () => void;
  } | null>(null);
  
  // Timeline Modal state
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  
  // Helper to create timeline events
  const createTimelineEvent = (type: TimelineEventType, description: string): TimelineEvent => ({
    id: `te_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    type,
    description,
    actor: currentEmployee?.name,
  });

  // Current Active Module / View
  const [activeWorkspace, setActiveWorkspace] = useState<'Orders' | 'Billing' | 'Products' | 'Customers' | 'Offers' | 'Reports' | 'Staff' | 'Settings' | 'More'>('Orders');

  // Active Billing Order States
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [customerPhone, setCustomerPhone] = useState('');
  const [searchedCustomer, setSearchedCustomer] = useState<Customer | null>(null);
  const [orderType, setOrderType] = useState<'Dine In' | 'Takeaway' | 'Delivery' | 'Swiggy' | 'Zomato' | 'Uber Eats' | 'Other'>('Dine In');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Card' | 'Wallet' | 'Split'>('Cash');
  const [splitDetails, setSplitDetails] = useState({ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 });

  // Loyalty Reward application
  const [appliedReward, setAppliedReward] = useState<LoyaltyReward | null>(null);

  // Held Orders Database (Simulates tables/suspended orders)
  const [heldOrders, setHeldOrders] = useState<{ id: string; timestamp: string; items: CartItem[]; customer: Customer | null; type: any }[]>([]);

  // Daily Sales & Activity Feed Stats
  const [dailySales, setDailySales] = useState<DailySales>(() => computeDailySales(bills, settings.currencySymbol));
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>(() => getActivityFeed());
  const [isDailySalesOpen, setIsDailySalesOpen] = useState(false);
  const [isHistoryFeedOpen, setIsHistoryFeedOpen] = useState(false);

  const refreshDailyStats = React.useCallback((newBill?: Bill) => {
    const currentBills = newBill ? [newBill, ...bills] : bills;
    const ds = computeDailySales(currentBills, settings.currencySymbol);
    setDailySales(ds);
    const feed = buildActivityFeed(currentBills, 20);
    setActivityFeed(feed);
    saveActivityFeed(feed);
  }, [bills, settings.currencySymbol]);

  // Overlays & Modals
  // Payment confirmation popup state
  const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false);
  
  const [activeReceipt, setActiveReceipt] = useState<Bill | null>(null);
  const [isShortcutOpen, setIsShortcutOpen] = useState(false);
  const [isHeldDrawerOpen, setIsHeldDrawerOpen] = useState(false);
  const [otpVerificationState, setOtpVerificationState] = useState<{ isOpen: boolean; code: string; typedCode: string; reward: LoyaltyReward | null }>({
    isOpen: false,
    code: '',
    typedCode: '',
    reward: null
  });

  // Phase 7: Progressive disclosure toggle for advanced billing actions
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  
  // Offers popup overlay - shows when customer offers are available
  const [isOffersPopupOpen, setIsOffersPopupOpen] = useState(false);
  
  // Split payment popup overlay
  const [isSplitPopupOpen, setIsSplitPopupOpen] = useState(false);

  // Receipt preview popup
  const [previewReceipt, setPreviewReceipt] = useState<Bill | null>(null);

  // Phase 11: Void reason capture
  const [isVoidReasonOpen, setIsVoidReasonOpen] = useState(false);
  const [voidReasonCallback, setVoidReasonCallback] = useState<{ onConfirm: () => void } | null>(null);
  
  // Phase 12: End-of-day Z-Report
  const [isZReportOpen, setIsZReportOpen] = useState(false);

  const voidReasons = [
    { id: 'wrong_item', label: 'Wrong item ordered' },
    { id: 'customer_changed', label: 'Customer changed mind' },
    { id: 'prep_error', label: 'Preparation error' },
    { id: 'duplicate', label: 'Duplicate entry' },
    { id: 'quality_issue', label: 'Quality issue' },
    { id: 'order_cancelled', label: 'Order cancelled' },
    { id: 'other', label: 'Other' },
  ];

  // Toasts notifications queue
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'info' | 'warning' }[]>([]);

  // Custom confirmation dialog
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const askConfirmation = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Search filter inside Billing Category
  const [billingCategory, setBillingCategory] = useState('All');
  const [billingSearch, setBillingSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedCardVariants, setSelectedCardVariants] = useState<Record<string, string>>({});

  // References for keyboard focus binding
  const billingSearchRef = useRef<HTMLInputElement>(null);
  const loyaltyPhoneRef = useRef<HTMLInputElement>(null);
  const quickFireRef = useRef<HTMLInputElement>(null);
  const autoKotRef = useRef(false);
  const [isQuickFireActive, setIsQuickFireActive] = useState(false);
  const [quickFireInput, setQuickFireInput] = useState('');

  // Real-time operator clock
  const [currentTime, setCurrentTime] = useState(new Date());

  // Phase 12: Z-report computed data — depends on today's bills
  const zReportData = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayBills = bills.filter(b => b.date === today);
    return {
      totalSales: todayBills.reduce((s, b) => s + b.grandTotal, 0),
      totalDiscounts: todayBills.reduce((s, b) => s + b.discount, 0),
      totalTax: todayBills.reduce((s, b) => s + b.gst, 0),
      orderCount: todayBills.length,
      itemCount: todayBills.reduce((s, b) => s + b.items.length, 0),
      avgOrderValue: todayBills.length > 0
        ? todayBills.reduce((s, b) => s + b.grandTotal, 0) / todayBills.length
        : 0,
      paymentMethods: todayBills.reduce<Record<string, { count: number; amount: number }>>((acc, b) => {
        const m = b.paymentMethod || 'Cash';
        if (!acc[m]) acc[m] = { count: 0, amount: 0 };
        acc[m].count++;
        acc[m].amount += b.grandTotal;
        return acc;
      }, {}),
      cashiers: todayBills.reduce<Record<string, { orders: number; revenue: number }>>((acc, b) => {
        const n = b.cashierName || 'Unknown';
        if (!acc[n]) acc[n] = { orders: 0, revenue: 0 };
        acc[n].orders++;
        acc[n].revenue += b.grandTotal;
        return acc;
      }, {}),
    };
  }, [bills]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Batch all localStorage writes into one effect — avoids 9 separate layout cycles
  useEffect(() => {
    setDBData('pos_products', products);
    setDBData('pos_customers', customers);
    setDBData('pos_rewards', rewards);
    setDBData('pos_employees', employees);
    setDBData('pos_settings', settings);
    setDBData('pos_bills', bills);
    setDBData('pos_current_employee', currentEmployee);
    setDBData('pos_categories', categories);
    try {
      localStorage.setItem('pos_cart_width', cartWidth.toString());
    } catch (e) {
      // ignore
    }
  }, [products, customers, rewards, employees, settings, bills, currentEmployee, categories, cartWidth]);

  // Compute elapsed time from a creation timestamp
  const getElapsedTime = (createdAt: string): string => {
    const created = new Date(createdAt);
    const now = new Date();
    const diff = Math.floor((now.getTime() - created.getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  };

  // Helper notification toaster
  const showToast = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const toastId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newToast = { id: toastId, message, type };
    setToasts((prev) => [...prev, newToast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 2500);
  }, []);

  // Keyboard shortcut registers
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (!currentEmployee) return;

      // F1 to search product
      if (e.key === 'F1') {
        e.preventDefault();
        if (!activeOrder) {
          showToast('Select or create an order from Order Management first.', 'warning');
          return;
        }
        setActiveWorkspace('Billing');
        setTimeout(() => billingSearchRef.current?.focus(), 50);
        showToast('Search product input focused.', 'info');
      }

      // F2 to check customer phone
      if (e.key === 'F2') {
        e.preventDefault();
        if (!activeOrder) {
          showToast('Select or create an order from Order Management first.', 'warning');
          return;
        }
        setActiveWorkspace('Billing');
        setTimeout(() => loyaltyPhoneRef.current?.focus(), 50);
        showToast('Loyalty mobile input focused.', 'info');
      }

      // F3 to toggle Quick-fire mode — type PLU codes directly without mouse
      if (e.key === 'F3') {
        e.preventDefault();
        if (!activeOrder) {
          showToast('Select or create an order first.', 'warning');
          return;
        }
        setActiveWorkspace('Billing');
        const nextQuickFire = !isQuickFireActive;
        setIsQuickFireActive(nextQuickFire);
        if (nextQuickFire) {
          setTimeout(() => quickFireRef.current?.focus(), 100);
          showToast('Quick-fire mode ON — type item code + Enter', 'info');
        } else {
          setQuickFireInput('');
          showToast('Quick-fire mode OFF', 'info');
        }
      }

      // F9 to pay — goes through payment confirmation popup
      if (e.key === 'F9') {
        e.preventDefault();
        if (cartItems.length === 0) {
          showToast('Cannot checkout empty cart.', 'warning');
          return;
        }
        showPaymentConfirm();
      }

      // F8 to hold
      if (e.key === 'F8') {
        e.preventDefault();
        handleHoldCurrentOrder();
      }

      // F10 to recall held drawer
      if (e.key === 'F10') {
        e.preventDefault();
        setIsHeldDrawerOpen((prev) => !prev);
      }

      // Esc to clear search / overlays
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
        // Navigate to Orders if in Billing view
        if (activeWorkspace === 'Billing') {
          setActiveWorkspace('Orders');
          setActiveOrder(null);
          setCartItems([]);
          showToast('Returned to Order Management', 'info');
        }
        document.activeElement instanceof HTMLElement && document.activeElement.blur();
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [currentEmployee, cartItems, customerPhone, searchedCustomer, orderType, paymentMethod, appliedReward, splitDetails, activeOrder, isQuickFireActive]);

  // ============================================================
  // ORDER MANAGEMENT HANDLERS
  // ============================================================

  // Get next order number
  const getNextOrderNumber = (): number => {
    return orders.length + 1001;
  };

  // Create a new order
  const handleCreateOrder = (type: Order['type'], tableId?: string) => {
    const orderNumber = getNextOrderNumber();
    const now = new Date().toISOString();
    
    // Update table status if table service is enabled
    let updatedTables = [...tables];
    if (tableId) {
      updatedTables = tables.map(t => 
        t.id === tableId ? { 
          ...t, 
          status: 'Occupied' as const, 
          orderSince: now,
          orderId: `order_${orderNumber}`,
          waiterId: currentEmployee?.id,
          waiterName: currentEmployee?.name,
        } : t
      );
      setTables(updatedTables);
    }

    const newOrder: Order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      orderNumber,
      type,
      status: 'New',
      tableId,
      tableNumber: tableId ? parseInt(tableId.replace('table_', '')) : undefined,
      waiterId: currentEmployee?.id,
      waiterName: currentEmployee?.name,
      createdAt: now,
      updatedAt: now,
      items: [],
      kotRecords: [],
      timeline: [createTimelineEvent('order_created', `Order #${orderNumber} created as ${type}`)],
      interimBillPrinted: false,
      finalBillPrinted: false,
      subtotal: 0,
      discount: 0,
      gst: 0,
      grandTotal: 0,
    };

    const updatedOrders = [newOrder, ...orders];
    setOrders(updatedOrders);
    setActiveOrder(newOrder);
    setActiveWorkspace('Billing');
    
    // Load order items into billing cart
    setCartItems([]);
    setOrderType(type as any);
    
    showToast(`Order #${orderNumber} created (${type})`, 'success');
  };

  // Open existing order for billing
  const handleOpenOrder = (order: Order) => {
    setActiveOrder(order);
    setActiveWorkspace('Billing');
    setCartItems(order.items || []);
    setOrderType(order.type as any);
    if (order.customerPhone) {
      setCustomerPhone(order.customerPhone);
      const found = customers.find(c => c.phone === order.customerPhone);
      if (found) setSearchedCustomer(found);
    }
    showToast(`Opened Order #${order.orderNumber}`, 'info');
  };

  // Navigate to billing from order (same as open but to billing specifically)
  const handleOpenBilling = (order: Order) => {
    handleOpenOrder(order);
  };

  // Create new takeaway order
  const handleCreateTakeawayOrder = () => {
    const orderNumber = getNextOrderNumber();
    const now = new Date().toISOString();
    
    const newOrder: Order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      orderNumber,
      type: 'Takeaway',
      status: 'New',
      waiterId: currentEmployee?.id,
      waiterName: currentEmployee?.name,
      createdAt: now,
      updatedAt: now,
      items: [],
      kotRecords: [],
      timeline: [createTimelineEvent('order_created', `Takeaway Order #${orderNumber} created`)],
      interimBillPrinted: false,
      finalBillPrinted: false,
      subtotal: 0,
      discount: 0,
      gst: 0,
      grandTotal: 0,
    };

    setOrders([newOrder, ...orders]);
    
    // Also add takeaway order
    const newTakeaway: TakeawayOrder = {
      id: `takeaway_${Date.now()}`,
      orderId: newOrder.id,
      orderNumber,
      customerName: 'Guest',
      elapsedTime: 'Just now',
      status: 'Preparing',
      amount: 0,
      paymentStatus: 'Pending',
      items: [],
      createdAt: now,
    };
    setTakeawayOrders([newTakeaway, ...takeawayOrders]);
    
    setActiveOrder(newOrder);
    setActiveWorkspace('Billing');
    setCartItems([]);
    setOrderType('Takeaway');
    
    showToast(`Takeaway Order #${orderNumber} created`, 'success');
  };
  
  // Update a takeaway order (e.g. mark as collected, update status)
  const handleUpdateTakeawayOrder = (id: string, updates: Partial<TakeawayOrder>) => {
    setTakeawayOrders(prev => {
      const next = prev.map(to => to.id === id ? { ...to, ...updates } : to);
      setDBData('pos_takeaway_orders', next);
      return next;
    });
  };
  
  // Remove all completed/collected takeaway orders
  const handleClearCompletedTakeaways = () => {
    setTakeawayOrders(prev => {
      const next = prev.filter(to => to.status !== 'Completed' && to.status !== 'Collected');
      setDBData('pos_takeaway_orders', next);
      return next;
    });
    showToast('Cleared completed takeaway orders', 'info');
  };

  // Print KOT
  const handlePrintKOT = (type: KOTType) => {
    if (!activeOrder) {
      showToast('No active order', 'warning');
      return;
    }
    
    // Get items that haven't been sent to KOT yet
    const printedItemIds = new Set<string>();
    activeOrder.kotRecords.forEach(kot => {
      kot.items.forEach(item => printedItemIds.add(item.id));
    });
    
    const newItems = activeOrder.items.filter(item => !printedItemIds.has(item.id));
    
    if (newItems.length === 0 && type !== 'Reprint') {
      showToast('No new items to send to kitchen', 'warning');
      return;
    }

    const itemsForKOT = type === 'Reprint' ? activeOrder.items : newItems;
    
    const kotNumber = activeOrder.kotRecords.length + 1;
    const kotType: KOTType = type === 'Reprint' ? 'Reprint' : 
      activeOrder.kotRecords.length === 0 ? 'Original' : 'Additional';
    
    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`,
      kotNumber,
      type: kotType,
      items: itemsForKOT,
      printedAt: new Date().toLocaleTimeString(),
      printedBy: currentEmployee?.name || 'System',
    };

    const updatedKOTs = [...activeOrder.kotRecords, newKOT];
    const timelineType: TimelineEventType = 
      type === 'Reprint' ? 'kot_reprint' :
      activeOrder.kotRecords.length === 0 ? 'kot_printed' : 'kot_additional_printed';
    
    const timelineDesc = type === 'Reprint' 
      ? `KOT #${kotNumber} reprinted`
      : activeOrder.kotRecords.length === 0 
        ? `KOT #${kotNumber} printed (${itemsForKOT.length} items)`
        : `Additional KOT #${kotNumber} printed (${itemsForKOT.length} items)`;
    
    const updatedTimeline = [...activeOrder.timeline, createTimelineEvent(timelineType, timelineDesc)];
    
    const updatedOrder: Order = {
      ...activeOrder,
      kotRecords: updatedKOTs,
      timeline: updatedTimeline,
      updatedAt: new Date().toISOString(),
      status: activeOrder.status === 'New' ? 'Accepted' as const : activeOrder.status,
    };

    setOrders(orders.map(o => o.id === activeOrder.id ? updatedOrder : o));
    setActiveOrder(updatedOrder);
    setKotOrder(updatedOrder);
    setIsKOTOpen(true);
    
    // Simulate printer
    setTimeout(() => {
      showToast(`KOT #${kotNumber} sent to kitchen printer`, 'success');
    }, 500);
  };

  // Show KOT preview popup before actually printing — lets the user review pending items
  const showKOTPreview = () => {
    if (!activeOrder) {
      showToast('No active order', 'warning');
      return;
    }
    
    // Find items not yet sent to kitchen
    const printedItemIds = new Set<string>();
    activeOrder.kotRecords.forEach(kot => {
      kot.items.forEach(item => printedItemIds.add(item.id));
    });
    
    const pendingItems = activeOrder.items.filter(item => !printedItemIds.has(item.id));
    
    if (pendingItems.length === 0) {
      if (activeOrder.kotRecords.length > 0) {
        showToast('All items already sent to kitchen. Use Reprint to print again.', 'info');
        setKotOrder(activeOrder);
        setIsKOTOpen(true);
      } else {
        showToast('No items in this order to send to kitchen', 'warning');
      }
      return;
    }
    
    setKotPreviewData({
      items: pendingItems,
      kotType: activeOrder.kotRecords.length === 0 ? 'Original' as const : 'Additional' as const,
      onConfirm: () => handleConfirmKOT(pendingItems),
    });
    setIsKOTPreviewOpen(true);
  };
  
  // Execute KOT print after preview confirmation
  const handleConfirmKOT = (items: CartItem[]) => {
    if (!activeOrder) return;
    
    const kotNumber = activeOrder.kotRecords.length + 1;
    const kotType: KOTType = activeOrder.kotRecords.length === 0 ? 'Original' : 'Additional';
    
    const newKOT: KOTRecord = {
      id: `kot_${Date.now()}`,
      kotNumber,
      type: kotType,
      items,
      printedAt: new Date().toLocaleTimeString(),
      printedBy: currentEmployee?.name || 'System',
    };
    
    const updatedKOTs = [...activeOrder.kotRecords, newKOT];
    const timelineType: TimelineEventType = 
      activeOrder.kotRecords.length === 0 ? 'kot_printed' : 'kot_additional_printed';
    
    const timelineDesc = activeOrder.kotRecords.length === 0 
      ? `KOT #${kotNumber} printed (${items.length} items)`
      : `Additional KOT #${kotNumber} printed (${items.length} items)`;
    
    const updatedTimeline = [...activeOrder.timeline, createTimelineEvent(timelineType, timelineDesc)];
    
    const updatedOrder: Order = {
      ...activeOrder,
      kotRecords: updatedKOTs,
      timeline: updatedTimeline,
      updatedAt: new Date().toISOString(),
      status: activeOrder.status === 'New' ? 'Accepted' as const : activeOrder.status,
    };
    
    setOrders(orders.map(o => o.id === activeOrder.id ? updatedOrder : o));
    setActiveOrder(updatedOrder);
    setKotOrder(updatedOrder);
    setIsKOTPreviewOpen(false);
    setIsKOTOpen(true);
    
    // Simulate printer
    setTimeout(() => {
      showToast(`KOT #${kotNumber} sent to kitchen printer`, 'success');
    }, 500);
  };

  // Open KOT modal for specific order (view history)
  const handleOpenKOT = () => {
    if (!activeOrder) {
      showToast('No active order', 'warning');
      return;
    }
    setKotOrder(activeOrder);
    setIsKOTOpen(true);
  };

  // Open timeline for active order
  const handleOpenTimeline = () => {
    if (!activeOrder) {
      showToast('No active order', 'warning');
      return;
    }
    setTimelineEvents(activeOrder.timeline);
    setIsTimelineOpen(true);
  };

  // Open receipt preview for an order
  const handleOpenReceiptPreview = (order: Order) => {
    const now = new Date();
    const previewBill: Bill = {
      id: `preview_${order.id}`,
      invoiceNumber: `PREVIEW-${order.orderNumber}`,
      ticketNumber: `#${order.orderNumber}`,
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cashierName: currentEmployee?.name || 'POS',
      cashierRole: currentEmployee?.role || 'Staff',
      items: order.items.map(item => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        price: item.price,
        selectedVariant: item.selectedVariant,
        notes: item.notes,
        isFree: item.isFree,
        kotPrinted: item.kotPrinted,
        customPrice: item.customPrice,
      })),
      subtotal: order.subtotal,
      discount: order.discount,
      gst: order.gst,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod || 'Cash',
      orderType: order.type,
      customerPhone: order.customerPhone,
      customerName: order.customerName,
      pointsEarned: order.loyaltyPointsEarned || 0,
      pointsRedeemed: order.loyaltyPointsRedeemed || 0,
      redeemedRewardTitle: order.appliedRewardTitle,
      milestoneRewardAwarded: '',
    };
    setPreviewReceipt(previewBill);
  };

  // Sync cart items back to activeOrder whenever they change
  useEffect(() => {
    if (activeOrder) {
      const updated = orders.map(o => 
        o.id === activeOrder.id 
          ? { ...o, items: cartItems, updatedAt: new Date().toISOString() } 
          : o
      );
      setOrders(updated);
      // Also update activeOrder to keep it in sync
      const updatedOrder = updated.find(o => o.id === activeOrder.id);
      if (updatedOrder) {
        setActiveOrder(updatedOrder);
      }
    }
  }, [cartItems]);

  // Persist orders, tables, takeawayOrders
  useEffect(() => { setDBData('pos_orders', orders); }, [orders]);
  useEffect(() => { setDBData('pos_tables', tables); }, [tables]);
  useEffect(() => { setDBData('pos_takeaway_orders', takeawayOrders); }, [takeawayOrders]);

  // Handle Login Authentication
  const handleLoginSuccess = useCallback((employee: Employee) => {
    setCurrentEmployee(employee);
    // Always land on Order Management Hub
    setActiveWorkspace('Orders');
    setActiveOrder(null);
    showToast(`Welcome back, ${employee.name}! Opened shift as ${employee.role}.`, 'success');
  }, []);

  // Handle Quick Terminal Screen Lock (Preserving active shift cart items)
  const handleLockTerminal = useCallback(() => {
    setCurrentEmployee(null);
    showToast('POS Terminal locked.', 'info');
  }, []);

  // Handle Logout Shift Closure
  const handleLogoutShift = useCallback(() => {
    askConfirmation(
      'Close Cashier Shift',
      'Are you sure you want to lock the POS terminal and close your cashier shift? Any active cart item rows will be cleared.',
      () => {
        setCurrentEmployee(null);
        setCartItems([]);
        setCustomerPhone('');
        setSearchedCustomer(null);
        setAppliedReward(null);
        setActiveOrder(null);
        showToast('Cashier shift closed successfully.', 'info');
      }
    );
  }, []);

  // Lookup customer details automatically when a 10-digit mobile number is entered
  const handleCustomerPhoneChange = (phoneVal: string) => {
    const cleaned = phoneVal.replace(/\D/g, '');
    setCustomerPhone(cleaned);

    if (cleaned.length === 10) {
      const found = customers.find((c) => c.phone === cleaned);
      if (found) {
        if (found.isBlocked) {
          showToast(`⚠︝ Member ${found.name} is BLOCKED. Cannot apply loyalty or rewards.`, 'warning');
          setSearchedCustomer(null);
          setAppliedReward(null);
        } else {
          setSearchedCustomer(found);
          showToast(`Loyalty matched: ${found.name}`, 'success');
          
          // Auto-recommend a reward if they have sufficient points and we don't have one applied
          const sortedRewardsByPoints = [...rewards].sort((a,b) => b.pointsRequired - a.pointsRequired);
          const autoRecommend = sortedRewardsByPoints.find(r => r.pointsRequired <= found.points);
          if (autoRecommend && !appliedReward) {
            showToast(`Recommended reward available: ${autoRecommend.title}`, 'info');
          }
        }
      } else {
        setSearchedCustomer(null);
        showToast('New guest detected. Tap Enroll in sidebar or proceed as guest.', 'info');
      }
    } else {
      setSearchedCustomer(null);
      setAppliedReward(null);
    }
  };

  // Add Product to checkout Cart
  const handleAddProductToCart = (product: Product, selectedVariant?: ProductVariant) => {
    if (!product.availability) {
      showToast(`${product.name} is sold out!`, 'warning');
      return;
    }

    // Combine ID based on product and variant for accurate row stacking
    const rowId = selectedVariant ? `${product.id}_${selectedVariant.name}` : `${product.id}_none`;

    const isNewItem = !cartItems.some((item) => item.id === rowId);

    const existingIdx = cartItems.findIndex((item) => item.id === rowId);

    if (existingIdx > -1) {
      const updated = [...cartItems];
      updated[existingIdx].quantity += 1;
      setCartItems(updated);
    } else {
      const newCartItem: CartItem = {
        id: rowId,
        product,
        selectedVariant,
        quantity: 1,
        price: selectedVariant ? selectedVariant.price : product.price
      };
      setCartItems([...cartItems, newCartItem]);
    }
    showToast(`${product.name} added to current bill.`, 'success');

    // Phase 8: Auto-KOT on first item add — if cart was empty and no KOT printed yet, auto-send to kitchen
    if (activeOrder && cartItems.length === 0 && isNewItem && activeOrder.kotRecords.length === 0 && !autoKotRef.current) {
      autoKotRef.current = true;
      setTimeout(() => {
        handlePrintKOT('Original');
        showToast('Auto KOT sent to kitchen.', 'success');
        autoKotRef.current = false;
      }, 400);
    }
    
    // Add timeline event for item addition and sync to orders state
    if (activeOrder && isNewItem) {
      const itemEvent = createTimelineEvent('item_added', `${product.name}${selectedVariant ? ` (${selectedVariant.name})` : ''} added to order`);
      const updatedTimeline = [...activeOrder.timeline, itemEvent];
      setActiveOrder(prev => prev ? { 
        ...prev, 
        timeline: updatedTimeline,
        updatedAt: new Date().toISOString() 
      } : null);
      // Also sync timeline to orders state immediately
      setOrders(prev => prev.map(o => 
        o.id === activeOrder.id 
          ? { ...o, timeline: updatedTimeline, updatedAt: new Date().toISOString() }
          : o
      ));
    }
  };

  // Adjust item quantities inside cart list
  const handleAdjustQuantity = (cartId: string, delta: number) => {
    const updated = cartItems.map((item) => {
      if (item.id === cartId) {
        const nextQty = item.quantity + delta;
        return nextQty > 0 ? { ...item, quantity: nextQty } : item;
      }
      return item;
    }).filter((item) => item.quantity > 0);

    setCartItems(updated);
  };

  // Delete Item Row from cart
  const handleDeleteCartItem = (cartId: string) => {
    setCartItems(cartItems.filter((item) => item.id !== cartId));
    showToast('Product row voided from bill.', 'warning');
  };

  // Attach kitchen or preparation notes on item
  const handleSetItemNotes = (cartId: string, notesVal: string) => {
    setCartItems(cartItems.map((item) => item.id === cartId ? { ...item, notes: notesVal } : item));
  };

  // Helper to check if a product matches a reward/milestone by ID or flexible Name
  const isProductMatchingReward = (productName: string, productId: string, rewardItemName?: string, rewardItemId?: string) => {
    if (!rewardItemName && !rewardItemId) return false;
    if (rewardItemId && productId === rewardItemId) return true;
    if (rewardItemName) {
      const pName = productName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      const rName = rewardItemName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      if (pName === rName) return true;
      if (pName.includes(rName) || rName.includes(pName)) return true;
      
      // Split into words to find any significant word overlap (e.g. "Chocolate" or "Cake" or "Margherita")
      const pWords = pName.split(/\s+/).filter(w => w.length > 2);
      const rWords = rName.split(/\s+/).filter(w => w.length > 2);
      if (pWords.length > 0 && rWords.length > 0) {
        const intersection = pWords.filter(w => rWords.includes(w));
        if (intersection.length > 0) return true;
      }
    }
    return false;
  };

  // Calculations Panel
  const calculateCartSubtotal = () => {
    return cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const calculateCartDiscount = () => {
    let baseDiscount = 0;
    const subtotal = calculateCartSubtotal();

    if (appliedReward) {
      if (appliedReward.type === 'percentage') {
        baseDiscount = (subtotal * appliedReward.value) / 100;
      } else if (appliedReward.type === 'item') {
        // Free item: discount is the price of the free item in the cart, or falls back to its value
        const itemInCart = cartItems.find(item => 
          isProductMatchingReward(item.product.name, item.product.id, appliedReward.rewardItemName, appliedReward.rewardItemId)
        );
        if (itemInCart) {
          baseDiscount = itemInCart.price;
        } else {
          baseDiscount = appliedReward.value;
        }
      } else {
        // Flat value reward (e.g., $10 off)
        baseDiscount = Math.min(appliedReward.value, subtotal);
      }
    }

    // Auto-apply visit milestones rewards if the matching item is in the cart
    if (searchedCustomer) {
      const milestones = settings.visitMilestones || [];
      const eligibleMilestones = milestones.filter(m => 
        (searchedCustomer.visits + 1) === Number(m.visits) || searchedCustomer.visits === Number(m.visits)
      );

      for (const m of eligibleMilestones) {
        // Check if the milestone reward item is in the cart
        const itemInCart = cartItems.find(item => 
          isProductMatchingReward(item.product.name, item.product.id, m.rewardItemName, m.rewardItemId)
        );
        if (itemInCart) {
          // If the applied reward is already discounting this exact item, don't double count it
          const isAlreadyDiscounted = appliedReward && (
            isProductMatchingReward(itemInCart.product.name, itemInCart.product.id, appliedReward.rewardItemName, appliedReward.rewardItemId)
          );
          if (!isAlreadyDiscounted) {
            baseDiscount += itemInCart.price;
          }
        }
      }
    }

    return baseDiscount;
  };

  const calculateCartTaxes = () => {
    const subtotal = calculateCartSubtotal();
    const discount = calculateCartDiscount();
    
    // Allocate discount proportionally to calculate specific item tax
    return cartItems.reduce((taxSum, item) => {
      const rowTotal = item.price * item.quantity;
      const proportion = subtotal > 0 ? rowTotal / subtotal : 0;
      const rowDiscount = discount * proportion;
      const rowTaxableAmount = Math.max(0, rowTotal - rowDiscount);
      return taxSum + rowTaxableAmount * (item.product.gstPercent / 100);
    }, 0);
  };

  const calculateCartGrandTotal = () => {
    const sub = calculateCartSubtotal();
    const disc = calculateCartDiscount();
    const tax = calculateCartTaxes();
    return Math.max(0, sub - disc + tax);
  };

  // Hold current billing list
  const handleHoldCurrentOrder = () => {
    if (cartItems.length === 0) {
      showToast('Cannot hold an empty cart.', 'warning');
      return;
    }

    const newHold = {
      id: `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: currentTime.toLocaleTimeString(),
      items: cartItems,
      customer: searchedCustomer,
      type: orderType
    };

    setHeldOrders([newHold, ...heldOrders]);
    setCartItems([]);
    setCustomerPhone('');
    setSearchedCustomer(null);
    setAppliedReward(null);
    showToast('Active billing held successfully.', 'success');
  };

  // Restore Held bill
  const handleRecallHeldOrder = (holdId: string) => {
    const found = heldOrders.find((h) => h.id === holdId);
    if (found) {
      setCartItems(found.items);
      setOrderType(found.type);
      if (found.customer) {
        setSearchedCustomer(found.customer);
        setCustomerPhone(found.customer.phone);
      } else {
        setSearchedCustomer(null);
        setCustomerPhone('');
      }
      setHeldOrders(heldOrders.filter((h) => h.id !== holdId));
      setIsHeldDrawerOpen(false);
      showToast('Suspended billing successfully recalled.', 'success');
    }
  };



  // Helper to apply reward and handle free item auto-addition to cart
  const applyRewardStateAndCheckCart = (reward: LoyaltyReward | null, isFromOtp = false) => {
    if (!reward) {
      setAppliedReward(null);
      // Restore prices of previously made-free items and remove auto-added free items
      setCartItems(prev => prev.map(item => {
        if (item.isFree && item.originalPrice !== undefined) {
          return {
            ...item,
            price: item.originalPrice,
            isFree: false
          };
        }
        return item;
      }).filter(item => item.notes !== 'Loyalty Free Reward Item'));
      return;
    }

    setAppliedReward(reward);

    // Determine if this reward represents a free item reward
    const rewardItemName = reward.rewardItemName || (
      (reward.type === 'item' || reward.title.toLowerCase().includes('free '))
        ? reward.title.replace(/free\s*/gi, '').replace(/🎝\s*/gi, '').replace(/redeem\s*/gi, '').trim()
        : null
    );
    const rewardItemId = reward.rewardItemId || (rewardItemName ? `prod_fallback_${reward.id}` : null);

    if (rewardItemName) {
      // Check if the item is already in the cart
      const existingItemIndex = cartItems.findIndex(item => 
        isProductMatchingReward(item.product.name, item.product.id, rewardItemName, rewardItemId || undefined)
      );

      if (existingItemIndex === -1) {
        // Find the product in our products catalog
        let prod = products.find(p => 
          isProductMatchingReward(p.name, p.id, rewardItemName, rewardItemId || undefined)
        );
        if (!prod) {
          // Fallback to dynamic / virtual product if the item doesn't exist in the catalog
          prod = {
            id: rewardItemId || `prod_${Date.now()}`,
            name: rewardItemName,
            price: reward.value > 0 ? reward.value : 8.50, // default placeholder price
            category: 'Offers',
            image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
            gstPercent: settings.defaultTaxRate,
            availability: true,
            code: 'OFFER'
          };
        }
        // Add brand new FREE item to cart
        const newCartItem: CartItem = {
          id: `${prod.id}_default`,
          product: prod,
          quantity: 1,
          price: 0, // Set price to 0.00 so it doesn't inflate subtotal/tax of paid items
          originalPrice: prod.price,
          notes: 'Loyalty Free Reward Item',
          isFree: true
        };
        setCartItems(prev => [...prev, newCartItem]);
        showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Added free ${prod.name} to checkout cart!`, 'success');
      } else {
        // Convert existing item in cart to free
        setCartItems(prev => prev.map((item, idx) => {
          if (idx === existingItemIndex) {
            return {
              ...item,
              price: 0, // Set price to 0.00
              originalPrice: item.originalPrice !== undefined ? item.originalPrice : item.price,
              isFree: true
            };
          }
          return item;
        }));
        showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Reward applied! ${rewardItemName} in cart is now FREE.`, 'success');
      }
    } else {
      showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Voucher Applied: ${reward.title}`, 'success');
    }
  };

  // Redeem Customer Points Reward
  const handleRedeemRewardTier = (reward: LoyaltyReward) => {
    if (!searchedCustomer) {
      showToast('Search phone to verify loyalty member profile first.', 'warning');
      return;
    }

    if (appliedReward?.id === reward.id) {
      applyRewardStateAndCheckCart(null);
      showToast(`Voucher removed: ${reward.title}`, 'info');
      return;
    }

    if (searchedCustomer.points < reward.pointsRequired) {
      showToast(`Insufficient loyalty balance! Member needs ${reward.pointsRequired} pts.`, 'warning');
      return;
    }

    const subtotal = calculateCartSubtotal();
    if (subtotal < reward.minBillAmount) {
      showToast(`Minimum order amount for this voucher is ${settings.currencySymbol}${reward.minBillAmount}`, 'warning');
      return;
    }

    // OTP security check on high points
    if (reward.isLargeReward && settings.otpSimulationEnabled) {
      const generatedOTP = Math.floor(1000 + Math.random() * 9000).toString();
      setOtpVerificationState({
        isOpen: true,
        code: generatedOTP,
        typedCode: '',
        reward: reward
      });
      showToast(`SMS Security Code sent to customer: ${generatedOTP}`, 'info');
    } else {
      applyRewardStateAndCheckCart(reward);
    }
  };

  // Verify simulated loyalty redemption OTP code
  const handleVerifyOTP = (e: React.FormEvent) => {
    e.preventDefault();
    if (otpVerificationState.typedCode === otpVerificationState.code || otpVerificationState.typedCode === '9999') {
      if (otpVerificationState.reward) {
        applyRewardStateAndCheckCart(otpVerificationState.reward, true);
      }
      setOtpVerificationState({ isOpen: false, code: '', typedCode: '', reward: null });
    } else {
      showToast('Invalid OTP entered. Try again or check SMS mock code.', 'warning');
    }
  };

  // Show payment confirmation popup before processing
  const showPaymentConfirm = () => {
    if (cartItems.length === 0) {
      showToast('Please add products to checkout.', 'warning');
      return;
    }
    
    // Validate split payment before showing confirmation
    if (paymentMethod === 'Split') {
      const splitSum = (splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0);
      const grandTotal = calculateCartGrandTotal();
      if (Math.abs(splitSum - grandTotal) >= 0.01) {
        showToast(`Split total (${settings.currencySymbol}${splitSum.toFixed(2)}) must equal Net Payable (${settings.currencySymbol}${grandTotal.toFixed(2)})`, 'warning');
        return;
      }
    }
    
    setIsPaymentConfirmOpen(true);
  };
  
  // Actually process payment after confirmation
  const handleConfirmPayment = () => {
    setIsPaymentConfirmOpen(false);
    handleCheckoutPayment();
  };

  // Complete Payment and generate receipt
  const handleCheckoutPayment = () => {
    if (cartItems.length === 0) {
      showToast('Please add products to checkout.', 'warning');
      return;
    }

    const subtotal = calculateCartSubtotal();
    const discount = calculateCartDiscount();
    const gst = calculateCartTaxes();
    const grandTotal = calculateCartGrandTotal();

    if (paymentMethod === 'Split') {
      const splitSum = (splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0);
      if (Math.abs(splitSum - grandTotal) >= 0.01) {
        showToast(`Split total (${settings.currencySymbol}${splitSum.toFixed(2)}) must equal Net Payable (${settings.currencySymbol}${grandTotal.toFixed(2)})`, 'warning');
        return;
      }
    }

    // Point calculations: use floating calculation to give owners absolute decimal precision (e.g., 0.05 points per ₹1 spent)
    let pointsAccumulated = Number((grandTotal * settings.loyaltyPointsPerDollar).toFixed(2));
    let pointsDeducted = appliedReward ? appliedReward.pointsRequired : 0;
    let milestoneRewardAwarded: string | undefined = undefined;

    // Deduct and add points on customer profile if loyalty is checked
    let updatedCustomerName = searchedCustomer?.name;

    const invoiceHistItem = {
      id: `b_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      invoiceNumber: `INV-${new Date().getFullYear()}-${bills.length + 1001}`,
      ticketNumber: `TK-${bills.length + 1001}`,
      date: currentTime.toISOString().split('T')[0],
      grandTotal: grandTotal,
      itemsCount: cartItems.length,
      items: cartItems,
      redeemedRewardTitle: appliedReward ? appliedReward.title : undefined,
      pointsRedeemed: pointsDeducted > 0 ? pointsDeducted : undefined,
      pointsEarned: pointsAccumulated > 0 ? pointsAccumulated : undefined
    };

    let quickGuestObj: Customer | null = null;

    if (searchedCustomer) {
      const updatedCustomers = customers.map((c) => {
        if (c.phone === searchedCustomer.phone) {
          const nextPoints = Math.max(0, c.points - pointsDeducted + pointsAccumulated);
          const nextVisits = c.visits + 1;
          
          // Add visit threshold bonus (legacy points bonus)
          let bonus = 0;
          if (nextVisits % settings.visitThresholdForBonus === 0) {
            bonus = settings.bonusPointsPerVisit;
            pointsAccumulated += bonus;
          }

          // Check custom multi-milestone list for free dishes
          const milestones = settings.visitMilestones || [];
          const matchedMilestone = milestones.find(m => Number(m.visits) === nextVisits);
          if (matchedMilestone) {
            milestoneRewardAwarded = matchedMilestone.rewardItemName;
          }

          return {
            ...c,
            visits: nextVisits,
            points: Number((nextPoints + bonus).toFixed(2)),
            lastVisit: currentTime.toISOString().split('T')[0],
            purchaseHistory: [invoiceHistItem, ...(c.purchaseHistory || [])]
          };
        }
        return c;
      });
      setCustomers(updatedCustomers);
    } else if (customerPhone.trim().length === 10) {
      // Auto register quick Guest loyalty card to speed up cashiers during lunch hour rush
      quickGuestObj = {
        phone: customerPhone.trim(),
        name: 'Guest Diner',
        isNew: true,
        visits: 1,
        points: pointsAccumulated,
        lastVisit: currentTime.toISOString().split('T')[0],
        purchaseHistory: [invoiceHistItem]
      };
      setCustomers([quickGuestObj, ...customers]);
      updatedCustomerName = 'Guest Diner';
      showToast('Quick Guest loyalty card enrolled successfully.', 'success');
    }

    const nextVisits = searchedCustomer ? searchedCustomer.visits + 1 : 1;
    const currentVisits = searchedCustomer ? searchedCustomer.visits : 0;
    const milestones = settings.visitMilestones || [];
    const activeMilestones = searchedCustomer
      ? milestones.filter(m => Number(m.visits) === nextVisits || Number(m.visits) === currentVisits)
      : [];

    const finalizedItems = cartItems.map(item => {
      const isRedeemedViaLoyalty = appliedReward && (
        isProductMatchingReward(item.product.name, item.product.id, appliedReward.rewardItemName, appliedReward.rewardItemId) ||
        (appliedReward.title.toLowerCase().includes('free ') && isProductMatchingReward(item.product.name, item.product.id, appliedReward.title.replace(/free\s*/gi, '').replace(/🎝\s*/gi, '').replace(/redeem\s*/gi, '').trim(), appliedReward.rewardItemId))
      );
      const isRedeemedViaMilestone = activeMilestones.some(m => 
        isProductMatchingReward(item.product.name, item.product.id, m.rewardItemName, m.rewardItemId)
      );
      
      if (isRedeemedViaLoyalty || isRedeemedViaMilestone || item.isFree) {
        return {
          ...item,
          price: 0,
          isFree: true
        };
      }
      return item;
    });

    let finalItemsList = [...finalizedItems];

    // Ensure applied loyalty reward item is present on the final invoice items list
    if (appliedReward) {
      const rewardItemName = appliedReward.rewardItemName || (
        (appliedReward.type === 'item' || appliedReward.title.toLowerCase().includes('free '))
          ? appliedReward.title.replace(/free\s*/gi, '').replace(/🎝\s*/gi, '').replace(/redeem\s*/gi, '').trim()
          : null
      );
      if (rewardItemName) {
        const rewardItemId = appliedReward.rewardItemId || `prod_fallback_${appliedReward.id}`;
        const alreadyExists = finalItemsList.some(item => 
          isProductMatchingReward(item.product.name, item.product.id, rewardItemName, rewardItemId)
        );
        if (!alreadyExists) {
          let prod = products.find(p => 
            isProductMatchingReward(p.name, p.id, rewardItemName, rewardItemId)
          );
          if (!prod) {
            prod = {
              id: rewardItemId,
              name: rewardItemName,
              price: appliedReward.value > 0 ? appliedReward.value : 8.50,
              category: 'Offers',
              image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
              gstPercent: settings.defaultTaxRate,
              availability: true,
              code: 'OFFER'
            };
          }
          finalItemsList.push({
            id: `${prod.id}_checkout_auto`,
            product: prod,
            quantity: 1,
            price: 0,
            originalPrice: prod.price,
            notes: 'Loyalty Free Reward Item',
            isFree: true
          });
        }
      }
    }

    // Create the final bill
    const now = new Date();
    const billId = `bill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const newBill: Bill = {
      id: billId,
      invoiceNumber: `${settings.invoicePrefix || "INV"}-${now.getFullYear()}-${bills.length + 1001}`,
      ticketNumber: `#${bills.length + 1001}`,
      date: currentTime.toISOString().split("T")[0],
      time: currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cashierName: currentEmployee?.name || "System",
      cashierRole: currentEmployee?.role || "Staff",
      items: finalItemsList,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      gst: Math.round(gst * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      paymentMethod: paymentMethod,
      orderType: orderType,
      customerPhone: customerPhone || undefined,
      customerName: updatedCustomerName || undefined,
      pointsEarned: Math.round(pointsAccumulated * 100) / 100,
      pointsRedeemed: pointsDeducted,
      redeemedRewardTitle: appliedReward?.title,
      milestoneRewardAwarded: milestoneRewardAwarded,
    };
    
    if (paymentMethod === "Split") {
      newBill.splitDetails = { ...splitDetails };
    }

    // Update order status to Paid
    if (activeOrder) {
      const paymentEvent = createTimelineEvent("payment_completed", `Payment of ${settings.currencySymbol}${grandTotal.toFixed(2)} received via ${paymentMethod}`);
      setOrders(prev => prev.map(o => 
        o.id === activeOrder.id
          ? { ...o, status: "Paid" as const, paymentMethod, paidAt: new Date().toISOString(), items: finalItemsList, subtotal, discount, gst, grandTotal, timeline: [...o.timeline, paymentEvent] }
          : o
      ));
      setActiveOrder(null);
    }

    // Append bill and persist
    const updatedBills = [newBill, ...bills];
    setBills(updatedBills);
    setDBData("pos_bills", updatedBills);

    // Mark table as available if this was a dine-in
    if (activeOrder?.tableId) {
      setTables(prev => prev.map(t =>
        t.id === activeOrder.tableId ? { ...t, status: "Available" as const, orderSince: undefined, orderId: undefined, waiterId: undefined, waiterName: undefined } : t
      ));
    }
    
    // Mark takeaway order as completed when paid
    if (activeOrder && (activeOrder.type === 'Takeaway' || activeOrder.type === 'Delivery')) {
      setTakeawayOrders(prev => prev.map(to =>
        to.orderId === activeOrder.id
          ? { ...to, status: 'Completed' as const, paymentStatus: 'Paid' as const, elapsedTime: getElapsedTime(activeOrder.createdAt) }
          : to
      ));
    }

    // Refresh daily stats
    refreshDailyStats(newBill);

    // Reset billing state and show receipt, then navigate to Orders
    setCartItems([]);
    setCustomerPhone("");
    setSearchedCustomer(null);
    setAppliedReward(null);
    setSelectedCardVariants({});
    setBillingSearch("");
    setActiveReceipt(newBill);
    setActiveOrder(null);
    
    showToast(`Payment of ${settings.currencySymbol}${grandTotal.toFixed(2)} received!`, "success");
    
    // Navigate back to Orders workspace after payment
    setTimeout(() => {
      setActiveWorkspace("Orders");
    }, 300);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#faf8ff] text-[#191b23] flex flex-col font-sans">

      {/* ========== LOGIN SCREEN ========== */}
      {!currentEmployee ? (
        <LoginScreen employees={employees} onLoginSuccess={handleLoginSuccess} settings={settings} />
      ) : (
        <>

          {/* ========== TITLE BAR ========== */}
          <div className="bg-[#191b23] text-white px-4 py-1.5 flex justify-between items-center text-xs select-none border-b border-[#2e3039] shrink-0">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-[#2563eb]" />
              <span className="font-semibold tracking-wider">{settings.restaurantName || "RESTAURANT POS"} v1.4.2</span>
            </div>
            <div className="flex items-center gap-4 text-gray-400">
              <span>{currentTime.toLocaleDateString()}</span>
              <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
              <span className="text-green-400 flex items-center gap-1"><Wifi className="w-3 h-3" /> ONLINE</span>
              <span className="text-[#2563eb]">● SECURE MODE</span>
            </div>
          </div>

          {/* ========== MAIN LAYOUT ========== */}
          <div className="flex flex-1 overflow-hidden" style={{ direction: "ltr" }}>

            {/* ========== SIDEBAR NAV ========== */}
            {activeWorkspace !== "Billing" && (
            <aside className="w-16 bg-[#191b23] border-r border-[#2e3039] flex flex-col items-center py-3 gap-1 shrink-0 overflow-y-auto">
              {[
                { id: "Orders", icon: ClipboardCheck, label: "Orders" },
                { id: "Billing", icon: ShoppingCart, label: "Billing" },
                { id: "Reports", icon: BarChart, label: "Reports" },
                { id: "Settings", icon: Settings, label: "Settings" },
                { id: "More", icon: MoreHorizontal, label: "More" },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeWorkspace === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveWorkspace(item.id as any)}
                    className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                      isActive
                        ? "bg-[#2563eb] text-white shadow-md"
                        : "text-gray-400 hover:text-white hover:bg-[#2e3039]"
                    }`}
                    title={item.label}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[7px] font-semibold uppercase tracking-wider">{item.label}</span>
                  </button>
                );
              })}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Terminal Lock & Logout */}
              <button
                onClick={handleLockTerminal}
                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-white hover:bg-[#2e3039] transition-all cursor-pointer"
                title="Lock Terminal"
              >
                <Lock className="w-5 h-5" />
                <span className="text-[7px] font-semibold uppercase">Lock</span>
              </button>
              <button
                onClick={handleLogoutShift}
                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-red-400 hover:bg-[#2e3039] transition-all cursor-pointer"
                title="Close Shift"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-[7px] font-semibold uppercase">Exit</span>
              </button>
              <button
                onClick={() => setIsShortcutOpen(true)}
                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-white hover:bg-[#2e3039] transition-all cursor-pointer"
                title="Keyboard Shortcuts"
              >
                <Keyboard className="w-5 h-5" />
                <span className="text-[7px] font-semibold uppercase">Keys</span>
              </button>
            </aside>
            )}

            {/* ========== MAIN CONTENT AREA ========== */}
            <main className="flex-1 overflow-y-auto bg-[#faf8ff]">
              {activeWorkspace === "Orders" && (
                <OrderManager
                  orders={orders}
                  tables={tables}
                  takeawayOrders={takeawayOrders}
                  onOpenOrder={handleOpenOrder}
                  onCreateOrder={handleCreateOrder}
                  onCreateTakeawayOrder={handleCreateTakeawayOrder}
                  onUpdateTakeawayOrder={handleUpdateTakeawayOrder}
                  onClearCompletedTakeaways={handleClearCompletedTakeaways}
                  onOpenBilling={handleOpenBilling}
                  onOpenReceiptPreview={handleOpenReceiptPreview}
                  employees={employees}
                  settings={settings}
                  currentEmployee={currentEmployee}
                  showToast={showToast}
                  onAddTable={handleAddTable}
                  onUpdateTable={handleUpdateTable}
                  onDeleteTable={handleDeleteTable}
                />
              )}
              {activeWorkspace === "Billing" && (
                <div className="flex h-full">
                  {/* Product catalog - left side */}
                  <div className="flex-1 p-4 overflow-y-auto">
                    {/* Category filter chips */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      {["All", ...categories].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setBillingCategory(cat)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                            billingCategory === cat
                              ? "bg-[#004ac6] text-white shadow-sm"
                              : "bg-white text-gray-600 border border-[#e1e2ed] hover:bg-[#f3f3fe]"
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    {/* Search bar with back button */}
                    <div className="flex items-center gap-2 mb-4">
                      <button
                        onClick={() => setActiveWorkspace("Orders")}
                        className="p-2 bg-white border border-[#e1e2ed] rounded-lg text-gray-500 hover:text-[#004ac6] hover:border-[#004ac6]/30 transition-all cursor-pointer shadow-sm shrink-0"
                        title="Back to Order Management"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          ref={billingSearchRef}
                          type="text"
                          placeholder="Search products by name or code... (F1)"
                          value={billingSearch}
                          onChange={(e) => setBillingSearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                        />
                      </div>
                    </div>

                    {/* Favorites toggle */}
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                        className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                          showFavoritesOnly
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : "bg-white text-gray-500 border border-[#e1e2ed] hover:bg-amber-50"
                        }`}
                      >
                        <Star className="w-3.5 h-3.5 fill-current" />
                        Favorites
                      </button>
                    </div>

                    {/* Product grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {products
                        .filter(p => billingCategory === "All" || p.category === billingCategory)
                        .filter(p => !billingSearch || p.name.toLowerCase().includes(billingSearch.toLowerCase()) || p.code.toLowerCase().includes(billingSearch.toLowerCase()))
                        .filter(p => !showFavoritesOnly || p.favorite)
                        .filter(p => p.availability)
                        .map((product) => {
                          const selectedVar = product.variants?.length === 1 ? product.variants[0] : undefined;
                          const currVariantName = selectedCardVariants[product.id];
                          const currVariant = product.variants?.find(v => v.name === currVariantName);
                          return (
                            <div
                              key={product.id}
                              className="bg-white rounded-xl border border-[#e1e2ed] p-3 hover:shadow-md hover:border-[#004ac6]/30 transition-all cursor-pointer group"
                              onClick={() => handleAddProductToCart(product, currVariant)}
                            >
                              <div className="relative w-full h-20 rounded-lg overflow-hidden bg-gray-100 mb-2">
                                <img src={product.image} alt={product.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                {product.favorite && <Star className="absolute top-1 right-1 w-3 h-3 text-amber-400 fill-amber-400" />}
                              </div>
                              <h4 className="text-xs font-bold text-[#191b23] line-clamp-1">{product.name}</h4>
                              <p className="text-[10px] text-gray-400 font-mono mt-0.5">{settings.currencySymbol}{product.price.toFixed(2)}</p>
                              {product.variants && product.variants.length > 1 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {product.variants.map((v) => (
                                    <button
                                      key={v.name}
                                      onClick={(e) => { e.stopPropagation(); setSelectedCardVariants(prev => ({ ...prev, [product.id]: v.name })); }}
                                      className={`text-[8px] px-1.5 py-0.5 rounded font-semibold cursor-pointer ${
                                        currVariantName === v.name ? "bg-[#004ac6] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                      }`}
                                    >
                                      {v.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      }
                    </div>
                  </div>

                  {/* Cart panel - right side */}
                  <div
                    className="bg-white border-l border-[#e1e2ed] flex flex-col shrink-0 relative"
                    style={{ width: cartWidth }}
                  >
                    {/* Resize handle with visible grip button */}
                    <div
                      onMouseDown={startResizeCart}
                      className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-[#004ac6]/10 transition-colors z-10 flex items-center justify-center group"
                    >
                      <div className="w-1 h-8 rounded-full bg-[#c3c6d7] group-hover:bg-[#004ac6] transition-colors" />
                    </div>
                    {/* Visible drag button */}
                    <button
                      onMouseDown={startResizeCart}
                      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 rounded-full bg-white border border-[#c3c6d7] shadow-md flex items-center justify-center cursor-col-resize hover:bg-[#f3f3fe] hover:border-[#004ac6] transition-all z-20 group"
                      title="Drag to resize cart panel"
                    >
                      <ChevronLeft className="w-3 h-3 text-gray-400 group-hover:text-[#004ac6]" />
                      <ChevronRight className="w-3 h-3 text-gray-400 group-hover:text-[#004ac6]" />
                    </button>

                    {/* Cart Header */}
                    <div className="p-3 border-b border-[#e1e2ed] bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <ShoppingCart className="w-4 h-4 text-[#004ac6] shrink-0" />
                          <div className="min-w-0">
                            <h3 className="text-sm font-bold truncate">
                              {activeOrder ? `Order #${activeOrder.orderNumber}` : 'Current Bill'}
                            </h3>
                            {activeOrder && (
                              <p className="text-[9px] text-gray-500 truncate">
                                {activeOrder.type}{activeOrder.tableNumber ? ` · Table ${activeOrder.tableNumber}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {heldOrders.length > 0 && (
                            <button
                              onClick={() => setIsHeldDrawerOpen(true)}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[9px] font-bold transition-all cursor-pointer flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" />
                              {heldOrders.length}
                            </button>
                          )}
                          <span className="text-xs font-mono bg-blue-50 text-[#004ac6] px-2 py-0.5 rounded-full font-bold">{cartItems.length} items</span>
                        </div>
                      </div>
                    </div>

                    {/* Customer phone & loyalty */}
                    <div className="p-3 border-b border-[#e1e2ed] bg-white space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <input
                            ref={loyaltyPhoneRef}
                            type="text"
                            placeholder="Customer mobile for loyalty (F2)"
                            value={customerPhone}
                            onChange={(e) => handleCustomerPhoneChange(e.target.value)}
                            maxLength={10}
                            className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                          />
                        </div>
                        {searchedCustomer && (
                          <button onClick={() => setIsOffersPopupOpen(true)} className="shrink-0 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg flex items-center gap-1 text-[10px] font-semibold transition-all cursor-pointer">
                            <Award className="w-3.5 h-3.5" />
                            Offers & Rewards
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick Fire mode */}
                    {isQuickFireActive && (
                      <div className="p-2 bg-amber-50 border-b border-amber-200">
                        <div className="flex items-center gap-1">
                          <input
                            ref={quickFireRef}
                            type="text"
                            placeholder="Enter item code + Enter..."
                            value={quickFireInput}
                            onChange={(e) => setQuickFireInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && quickFireInput.trim()) {
                                const found = products.find(p => p.code === quickFireInput.trim() || p.name.toLowerCase() === quickFireInput.trim().toLowerCase());
                                if (found) { handleAddProductToCart(found); setQuickFireInput(""); showToast(`Quick added: ${found.name}`, "success"); }
                                else { showToast("Item not found", "warning"); }
                              }
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                            autoFocus
                          />
                          <button onClick={() => { setIsQuickFireActive(false); setQuickFireInput(""); }} className="p-1 text-amber-600 hover:text-amber-800"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <p className="text-[9px] text-amber-700 mt-1">Quick-fire: type PLU code + Enter to add item instantly</p>
                      </div>
                    )}

                    {/* Cart items */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {cartItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                          <ShoppingCart className="w-12 h-12 text-gray-200 mb-3" />
                          <p className="text-xs font-semibold">Empty Bill</p>
                          <p className="text-[10px]">Tap items above to add</p>
                        </div>
                      ) : (
                        cartItems.map((item) => (
                          <div key={item.id} className="bg-gray-50 rounded-lg p-2.5 border border-[#e1e2ed] group hover:border-[#004ac6]/30 transition-all">
                            <div className="flex justify-between items-start">
                              <div className="flex items-start gap-2">
                                <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 border border-[#e1e2ed] bg-white flex items-center justify-center">
                                  {item.product.image ? (
                                    <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-3 h-3 rounded-sm bg-[#004ac6]/10" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-[#191b23] truncate">{item.isFree && <span className="text-emerald-600 mr-1">[FREE]</span>}{item.product.name}</p>
                                  {item.selectedVariant && <p className="text-[9px] text-gray-500">{item.selectedVariant.name}</p>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 ml-2">
                                <button onClick={() => handleAdjustQuantity(item.id, -1)} className="p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded cursor-pointer"><Minus className="w-3.5 h-3.5" /></button>
                                <span className="text-xs font-bold font-mono min-w-[20px] text-center">{item.quantity}</span>
                                <button onClick={() => handleAdjustQuantity(item.id, 1)} className="p-0.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
                                <button onClick={() => handleDeleteCartItem(item.id)} className="p-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded ml-1 cursor-pointer"><Trash className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-[10px] font-mono text-gray-500">{settings.currencySymbol}{item.price.toFixed(2)} × {item.quantity}</span>
                              <span className="text-xs font-bold font-mono">{settings.currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                            {item.notes && <p className="text-[9px] text-gray-400 italic mt-0.5">Note: {item.notes}</p>}
                          </div>
                        ))
                      )}
                    </div>



                    {/* Calculations & Totals */}
                    <div className="p-3 border-t border-[#e1e2ed] bg-white space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Subtotal</span>
                        <span className="font-mono font-bold">{settings.currencySymbol}{calculateCartSubtotal().toFixed(2)}</span>
                      </div>
                      {calculateCartDiscount() > 0 && (
                        <div className="flex justify-between text-xs text-green-600">
                          <span>Discount {appliedReward && `(${appliedReward.title})`}</span>
                          <span className="font-mono font-bold">-{settings.currencySymbol}{calculateCartDiscount().toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>GST</span>
                        <span className="font-mono font-bold">{settings.currencySymbol}{calculateCartTaxes().toFixed(2)}</span>
                      </div>
                      <div className="border-t border-[#e1e2ed] pt-1.5 flex justify-between text-sm font-bold">
                        <span>Grand Total</span>
                        <span className="font-mono text-[#004ac6]">{settings.currencySymbol}{calculateCartGrandTotal().toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Payment controls */}
                    <div className="p-3 border-t border-[#e1e2ed] bg-gray-50 space-y-2">
                      {/* Payment method & order type - compact inline dropdowns */}
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Pay via:</span>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as any)}
                            className="w-full px-2 py-1.5 text-xs border border-[#c3c6d7] rounded-lg font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
                          >
                            <option value="Cash">Cash</option>
                            <option value="UPI">UPI</option>
                            <option value="Card">Card</option>
                            <option value="Wallet">Wallet</option>
                            <option value="Split">Split</option>
                          </select>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Order Type:</span>
                          <select
                            value={orderType}
                            onChange={(e) => setOrderType(e.target.value as any)}
                            className="w-full px-2 py-1.5 text-xs border border-[#c3c6d7] rounded-lg font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
                          >
                            <option value="Dine In">Dine In</option>
                            <option value="Zomato">Zomato</option>
                            <option value="Takeaway">Pick Up</option>
                          </select>
                        </div>
                      </div>

                      {/* Split payment details */}
                      {paymentMethod === "Split" && (
                        <div className="space-y-1.5 bg-white p-2 rounded-lg border border-[#e1e2ed]">
                          <p className="text-[10px] font-bold text-gray-500 uppercase">Split Payment</p>
                          <button onClick={() => setIsSplitPopupOpen(true)} className="w-full py-1.5 bg-[#004ac6] hover:bg-[#003399] text-white rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all cursor-pointer">
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            Open Split Payment Calculator
                          </button>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={handleHoldCurrentOrder}
                          className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Hold (F8)
                        </button>
                        <button
                          onClick={showKOTPreview}
                          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Print KOT
                        </button>
                        <button
                          onClick={showPaymentConfirm}
                          disabled={cartItems.length === 0}
                          className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-md"
                        >
                          Pay (F9)
                        </button>
                      </div>

                    </div>
                  </div>
                </div>
              )}
              {activeWorkspace === "Products" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => setActiveWorkspace("More")} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-[#191b23]">Products</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Catalog Management</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ProductManager
                      products={products}
                      onUpdateProducts={setProducts}
                      currencySymbol={settings.currencySymbol}
                      categories={categories}
                      onUpdateCategories={setCategories}
                    />
                  </div>
                </div>
              )}
              {activeWorkspace === "Customers" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => setActiveWorkspace("More")} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-[#191b23]">Customers</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Loyalty Management</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <CustomerManager
                      customers={customers}
                      onUpdateCustomers={setCustomers}
                      currencySymbol={settings.currencySymbol}
                    />
                  </div>
                </div>
              )}
              {activeWorkspace === "Offers" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => setActiveWorkspace("More")} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-[#191b23]">Offers</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Reward Tiers & Promotions</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <OffersManager
                      rewards={rewards}
                      onUpdateRewards={setRewards}
                      currencySymbol={settings.currencySymbol}
                      settings={settings}
                      onUpdateSettings={setSettings}
                      products={products}
                    />
                  </div>
                </div>
              )}
              {activeWorkspace === "Reports" && (
                <ReportsManager
                  bills={bills}
                  customers={customers}
                  products={products}
                  currencySymbol={settings.currencySymbol}
                  onViewBill={(bill) => setActiveReceipt(bill)}
                  onRefresh={() => {
                    const refreshed = getDBData("pos_bills", []);
                    setBills(refreshed);
                    setDailySales(computeDailySales(refreshed, settings.currencySymbol));
                    showToast("Data refreshed", "info");
                  }}
                />
              )}
              {activeWorkspace === "Staff" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => setActiveWorkspace("More")} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-[#191b23]">Staff</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Employee Management</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <StaffManager
                      employees={employees}
                      onUpdateEmployees={setEmployees}
                      currentEmployee={currentEmployee!}
                    />
                  </div>
                </div>
              )}
              {activeWorkspace === "Settings" && (
                <SettingsManager
                  settings={settings}
                  onUpdateSettings={setSettings}
                />
              )}
              {activeWorkspace === "More" && (
                <div className="p-6 space-y-4">
                  <h2 className="text-xl font-bold">More Options</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <button onClick={() => setActiveWorkspace("Products")} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <Layers className="w-8 h-8 text-orange-600 mb-2" />
                      <p className="text-sm font-bold">Products</p>
                      <p className="text-xs text-gray-500">Catalog management</p>
                    </button>
                    <button onClick={() => setActiveWorkspace("Customers")} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <Users className="w-8 h-8 text-green-600 mb-2" />
                      <p className="text-sm font-bold">Customers</p>
                      <p className="text-xs text-gray-500">Loyalty management</p>
                    </button>
                    <button onClick={() => setActiveWorkspace("Offers")} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <Award className="w-8 h-8 text-amber-600 mb-2" />
                      <p className="text-sm font-bold">Offers</p>
                      <p className="text-xs text-gray-500">Reward tiers</p>
                    </button>
                    <button onClick={() => setActiveWorkspace("Staff")} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <Shield className="w-8 h-8 text-blue-600 mb-2" />
                      <p className="text-sm font-bold">Staff</p>
                      <p className="text-xs text-gray-500">Employee management</p>
                    </button>
                    <button onClick={() => setIsDailySalesOpen(true)} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <DollarSign className="w-8 h-8 text-green-600 mb-2" />
                      <p className="text-sm font-bold">Daily Sales</p>
                      <p className="text-xs text-gray-500">View today revenue</p>
                    </button>
                    <button onClick={() => setIsHistoryFeedOpen(true)} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <Activity className="w-8 h-8 text-blue-600 mb-2" />
                      <p className="text-sm font-bold">Activity Feed</p>
                      <p className="text-xs text-gray-500">Transaction history</p>
                    </button>
                    <button onClick={() => setIsZReportOpen(true)} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <FileText className="w-8 h-8 text-purple-600 mb-2" />
                      <p className="text-sm font-bold">Z-Report</p>
                      <p className="text-xs text-gray-500">End of day report</p>
                    </button>
                    <button onClick={() => setIsSyncPanelOpen(true)} className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md transition-all text-left cursor-pointer">
                      <RefreshCw className="w-8 h-8 text-[#004ac6] mb-2" />
                      <p className="text-sm font-bold">Sync Status</p>
                      <p className="text-xs text-gray-500">Cloud sync panel</p>
                    </button>
                  </div>
                </div>
              )}
            </main>
          </div>
        </>
      )}

      {/* ========== MODAL OVERLAYS ========== */}

      {/* Receipt Preview (after payment, before closing) */}
      {previewReceipt && (
        <ReceiptModal
          bill={previewReceipt}
          settings={settings}
          onClose={() => { setPreviewReceipt(null); setActiveReceipt(null); }}
          onNewOrder={() => { setPreviewReceipt(null); setActiveReceipt(null); }}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
            <h3 className="font-bold text-lg mb-2">{confirmState.title}</h3>
            <p className="text-sm text-gray-600 mb-6">{confirmState.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmState(prev => ({ ...prev, isOpen: false }))} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
              <button onClick={confirmState.onConfirm} className="px-4 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer shadow-sm">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Held Orders Drawer */}
      {isHeldDrawerOpen && (
        <div className="fixed inset-0 z-[40] flex items-start justify-center pt-16 bg-black/40 backdrop-blur-sm" onClick={() => setIsHeldDrawerOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 border border-[#e1e2ed]" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-[#004ac6]" /> Held Orders ({heldOrders.length})</h3>
              <button onClick={() => setIsHeldDrawerOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto space-y-2">
              {heldOrders.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No held orders</p>
              ) : (
                heldOrders.map((hold) => (
                  <div key={hold.id} className="bg-gray-50 rounded-lg p-3 border border-[#e1e2ed] flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold">{hold.items.length} items @ {hold.timestamp}</p>
                      <p className="text-[10px] text-gray-500">{hold.type} {hold.customer ? `- ${hold.customer.name}` : ""}</p>
                    </div>
                    <button onClick={() => handleRecallHeldOrder(hold.id)} className="px-3 py-1 bg-[#004ac6] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] cursor-pointer">Recall</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* OTP Verification Modal */}
      {otpVerificationState.isOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5"><Shield className="w-4 h-4 text-[#004ac6]" /> SMS Verification</h3>
            <p className="text-xs text-gray-600 mb-2">Enter the OTP sent to customer mobile</p>
            <p className="text-[10px] bg-yellow-50 border border-yellow-200 rounded p-2 mb-4 text-yellow-700">Simulated OTP: <strong>{otpVerificationState.code}</strong> (or use 9999)</p>
            <form onSubmit={handleVerifyOTP} className="space-y-3">
              <input
                type="text"
                maxLength={4}
                placeholder="Enter OTP"
                value={otpVerificationState.typedCode}
                onChange={(e) => setOtpVerificationState(prev => ({ ...prev, typedCode: e.target.value.replace(/\D/g, "") }))}
                className="w-full px-3 py-2 text-center text-lg font-mono font-bold border border-[#c3c6d7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setOtpVerificationState({ isOpen: false, code: "", typedCode: "", reward: null })} className="flex-1 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer shadow-sm">Verify</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Daily Sales Summary */}
      {isDailySalesOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsDailySalesOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-sticky">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-green-600" /> Daily Sales Summary</h3>
              <button onClick={() => setIsDailySalesOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-green-50 rounded-lg p-3 border border-green-200"><p className="text-[10px] text-green-700 font-bold uppercase">Revenue</p><p className="text-lg font-bold font-mono text-green-800">{settings.currencySymbol}{dailySales.totalRevenue.toFixed(2)}</p></div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><p className="text-[10px] text-blue-700 font-bold uppercase">Orders</p><p className="text-lg font-bold font-mono text-blue-800">{dailySales.totalOrders}</p></div>
                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><p className="text-[10px] text-purple-700 font-bold uppercase">Items Sold</p><p className="text-lg font-bold font-mono text-purple-800">{dailySales.totalItemsSold}</p></div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><p className="text-[10px] text-amber-700 font-bold uppercase">Avg Order</p><p className="text-lg font-bold font-mono text-amber-800">{settings.currencySymbol}{dailySales.averageOrderValue.toFixed(2)}</p></div>
              </div>
              {dailySales.totalDiscount > 0 && (<p className="text-xs text-gray-500">Total Discounts Given: {settings.currencySymbol}{dailySales.totalDiscount.toFixed(2)}</p>)}
            </div>
          </div>
        </div>
      )}

      {/* Activity Feed */}
      {isHistoryFeedOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsHistoryFeedOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><Activity className="w-4 h-4 text-blue-600" /> Activity Feed</h3>
              <button onClick={() => setIsHistoryFeedOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {activityFeed.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No transactions yet today</p>
              ) : (
                activityFeed.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg border-b border-gray-100 last:border-0">
                    <div className="w-2 h-2 rounded-full mt-1.5 bg-[#004ac6] shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold">{entry.title}</p>
                      <p className="text-[10px] text-gray-500">{entry.description}</p>
                    </div>
                    <span className="text-[9px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Confirmation Popup — two-step verification before processing */}
      {isPaymentConfirmOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="font-bold text-base text-gray-900">Confirm Payment</h2>
                <p className="text-[10px] text-gray-500">Review the bill before processing payment</p>
              </div>
              <button onClick={() => setIsPaymentConfirmOpen(false)} className="ml-auto text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt Preview — matches the formatted receipt from ReceiptModal, respecting all settings */}
            <div className="p-5 max-h-[55vh] overflow-y-auto flex justify-center">
              {(() => {
                const is58mm = settings.printSize === '58mm';
                const currency = settings.currencySymbol || '₹';
                const subtotal = calculateCartSubtotal();
                const discount = calculateCartDiscount();
                const gst = calculateCartTaxes();
                const grandTotal = calculateCartGrandTotal();
                const roundOffActive = settings.roundOffTotal === true;
                const finalTotal = roundOffActive ? Math.round(grandTotal) : grandTotal;
                const roundOff = roundOffActive ? parseFloat((Math.round(grandTotal) - grandTotal).toFixed(2)) : 0;
                const isFivePercent = gst > 0 && cartItems.some(item => item.product.gstPercent === 5);
                const totalTaxRate = isFivePercent ? 5 : 18;
                const halfTaxRate = totalTaxRate / 2;
                const splitTaxAmount = gst / 2;
                
                return (
                  <div className={`bg-white border-2 border-dashed border-gray-300 font-mono text-gray-800 leading-normal ${is58mm ? 'max-w-[210px] p-3 text-[8.5px]' : 'max-w-[280px] p-5 text-[10px]'}`} style={{ wordBreak: 'break-word' }}>
                    {/* Header */}
                    <div className="text-center space-y-1 w-full">
                      <div className="border-b border-dashed border-gray-300 pb-1 mb-2"></div>
                      {settings.printLogoOnReceipt !== false && settings.sidebarLogoUrl && (
                        <div className="flex justify-center mb-2">
                          <img src={settings.sidebarLogoUrl} alt="Logo" className="max-h-12 max-w-[120px] object-contain" referrerPolicy="no-referrer" loading="lazy" decoding="async"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        </div>
                      )}
                      <p className="text-xs font-extrabold tracking-wide uppercase text-gray-900">{settings.restaurantName || 'THE ROYAL BISTRO'}</p>
                      <p className="text-[8px] text-gray-500 leading-tight">{settings.address || '123 Main Street'}</p>
                      <p className="text-[8px] text-gray-500 leading-tight">Phone: {settings.phone || '+91 22 2200 4400'}</p>
                      <p className="text-[8px] text-gray-500 font-bold uppercase">GSTIN: {settings.gstin || '27AAAAA1111A1Z1'}</p>
                      <div className="border-b border-dashed border-gray-300 pt-1"></div>
                    </div>

                    {/* Ticket Info */}
                    <div className="w-full space-y-0.5 pt-1">
                      <div className="flex justify-between">
                        <span>INVOICE:</span>
                        <span className="font-bold">PREVIEW</span>
                      </div>
                      {activeOrder && (
                        <div className="flex justify-between">
                          <span>TICKET:</span>
                          <span className="font-bold">#{activeOrder.orderNumber}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>DATE:</span>
                        <span>{new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CASHIER:</span>
                        <span>{currentEmployee?.name || 'POS'} ({currentEmployee?.role || 'Staff'})</span>
                      </div>
                      <div className="flex justify-between">
                        <span>ORDER TYPE:</span>
                        <span className="font-bold uppercase">{orderType}</span>
                      </div>
                      {settings.showCustomerNameOnReceipt !== false && searchedCustomer && (
                        <div className="flex justify-between font-bold border border-dashed border-black p-1 mt-1">
                          <span>LOYALTY MEMB:</span>
                          <span>{searchedCustomer.name}</span>
                        </div>
                      )}
                      {activeOrder?.tableNumber && (
                        <div className="flex justify-between">
                          <span>TABLE:</span>
                          <span>{activeOrder.tableNumber}</span>
                        </div>
                      )}
                    </div>

                    {/* Items table */}
                    <div className="w-full pt-2 border-t border-dashed border-gray-300">
                      <div className="flex justify-between font-bold text-gray-900 text-[9px] pb-1">
                        <span className="w-1/2 text-left">ITEM</span>
                        <span className="w-1/6 text-center">QTY</span>
                        <span className="w-1/3 text-right">TOTAL</span>
                      </div>
                      <div className="border-b border-dashed border-gray-300 my-1" />
                      <div className="space-y-1.5 py-1">
                        {cartItems.map(item => (
                          <div key={item.id} className="flex justify-between items-start">
                            <span className="w-1/2 text-left font-bold">
                              {item.isFree && <span className="text-emerald-700 font-extrabold mr-1">[FREE]</span>}
                              {item.product.name}
                              {item.selectedVariant && (
                                <span className="block text-[8px] text-gray-500 font-normal">- {item.selectedVariant.name}</span>
                              )}
                              {item.notes && (
                                <span className="block text-[8px] text-gray-400 font-normal italic">*Note: {item.notes}</span>
                              )}
                            </span>
                            <span className="w-1/6 text-center">{item.quantity}</span>
                            <span className="w-1/3 text-right font-bold">
                              {item.isFree ? (
                                <span className="text-emerald-700 font-extrabold">FREE</span>
                              ) : (
                                `${currency}${(item.price * item.quantity).toFixed(2)}`
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cost Calculations */}
                    <div className="w-full pt-2 border-t border-dashed border-gray-300 space-y-1">
                      <div className="flex justify-between">
                        <span>SUBTOTAL:</span>
                        <span>{currency}{subtotal.toFixed(2)}</span>
                      </div>
                      {settings.showDiscountBreakdownOnReceipt !== false && discount > 0 && (
                        <div className="flex justify-between font-bold text-blue-700">
                          <span>DISCOUNT REDEEMED:</span>
                          <span>-{currency}{discount.toFixed(2)}</span>
                        </div>
                      )}
                      {gst > 0 && settings.showTaxSummaryOnReceipt !== false && (
                        <>
                          <div className="flex justify-between text-[8px] text-gray-500">
                            <span>CGST ({halfTaxRate}%):</span>
                            <span>{currency}{splitTaxAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[8px] text-gray-500">
                            <span>SGST ({halfTaxRate}%):</span>
                            <span>{currency}{splitTaxAmount.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {roundOffActive && roundOff !== 0 && (
                        <div className="flex justify-between text-[8px] text-gray-500">
                          <span>ROUND OFF:</span>
                          <span>{currency}{roundOff.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="border-b border-dashed border-gray-300 my-1" />
                      <div className="flex justify-between font-black text-xs text-gray-950 pt-0.5">
                        <span>NET TOTAL:</span>
                        <span>{currency}{finalTotal.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="border-b border-dashed border-gray-300 my-2 w-full" />

                    {/* Payment Type */}
                    <div className="w-full text-left space-y-1">
                      <div className="font-bold">PAYMENT TYPE: {paymentMethod.toUpperCase()}</div>
                      {paymentMethod === 'Split' && (
                        <div className="pl-2 space-y-0.5 text-[8.5px]">
                          {splitDetails.cashAmount > 0 && (
                            <div className="flex justify-between"><span>- CASH:</span><span>{currency}{splitDetails.cashAmount.toFixed(2)}</span></div>
                          )}
                          {splitDetails.upiAmount > 0 && (
                            <div className="flex justify-between"><span>- UPI:</span><span>{currency}{splitDetails.upiAmount.toFixed(2)}</span></div>
                          )}
                          {splitDetails.cardAmount > 0 && (
                            <div className="flex justify-between"><span>- CARD:</span><span>{currency}{splitDetails.cardAmount.toFixed(2)}</span></div>
                          )}
                          {splitDetails.walletAmount > 0 && (
                            <div className="flex justify-between"><span>- WALLET:</span><span>{currency}{splitDetails.walletAmount.toFixed(2)}</span></div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Loyalty summary */}
                    {settings.showCustomerNameOnReceipt !== false && settings.showLoyaltyPointsOnReceipt !== false && searchedCustomer && (
                      <div className="w-full border border-black p-2 rounded text-center my-2 space-y-1 bg-gray-50 text-[8px]">
                        <p className="font-bold tracking-wide">LOYALTY REWARDS SUMMARY</p>
                        <div className="flex justify-between text-[8px] px-1">
                          <span>Points Available:</span>
                          <span className="font-bold">{searchedCustomer.points} pts</span>
                        </div>
                        {appliedReward && (
                          <p className="text-[7.5px] font-semibold text-green-700 uppercase mt-0.5">
                            Redeeming: {appliedReward.title}
                          </p>
                        )}
                      </div>
                    )}

                    {/* QR Code */}
                    {settings.showQrCodeOnReceipt !== false && (
                      <div className="flex flex-col items-center justify-center my-3 text-center w-full">
                        <p className="font-bold mb-1.5 text-[8px] tracking-wide">SCAN TO CLAIM DISCOUNTS & STAMPS</p>
                        <div className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-xs flex items-center justify-center" style={{ width: is58mm ? '64px' : '80px', height: is58mm ? '64px' : '80px' }}>
                          <svg className="w-full h-full" viewBox="0 0 100 100">
                            <rect width="100" height="100" fill="#ffffff" />
                            <rect x="5" y="5" width="25" height="25" fill="#000000" />
                            <rect x="10" y="10" width="15" height="15" fill="#ffffff" />
                            <rect x="13" y="13" width="9" height="9" fill="#000000" />
                            <rect x="70" y="5" width="25" height="25" fill="#000000" />
                            <rect x="75" y="10" width="15" height="15" fill="#ffffff" />
                            <rect x="78" y="13" width="9" height="9" fill="#000000" />
                            <rect x="5" y="70" width="25" height="25" fill="#000000" />
                            <rect x="10" y="75" width="15" height="15" fill="#ffffff" />
                            <rect x="13" y="78" width="9" height="9" fill="#000000" />
                            <rect x="40" y="10" width="5" height="10" fill="#000000" />
                            <rect x="50" y="5" width="10" height="5" fill="#000000" />
                            <rect x="45" y="20" width="15" height="5" fill="#000000" />
                            <rect x="35" y="30" width="5" height="15" fill="#000000" />
                            <rect x="40" y="55" width="10" height="5" fill="#000000" />
                            <rect x="55" y="45" width="15" height="10" fill="#000000" />
                            <rect x="35" y="65" width="15" height="5" fill="#000000" />
                            <rect x="70" y="40" width="10" height="15" fill="#000000" />
                            <rect x="85" y="55" width="10" height="5" fill="#000000" />
                            <rect x="80" y="70" width="15" height="15" fill="#000000" />
                            <rect x="85" y="75" width="5" height="5" fill="#ffffff" />
                          </svg>
                        </div>
                        <p className="text-[7.5px] text-gray-500 mt-1.5 max-w-[180px] mx-auto leading-tight">Open smartphone camera & scan to claim points.</p>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="text-center w-full pt-2 space-y-1.5">
                      {settings.receiptFooterMessage ? (
                        <div className="whitespace-pre-wrap text-[9px] font-bold text-gray-800 leading-normal uppercase">{settings.receiptFooterMessage}</div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 font-bold text-gray-800">
                          <span>THANK YOU FOR DINING WITH US!</span>
                          <Heart className="w-3 h-3 text-red-500 fill-red-500" />
                        </div>
                      )}
                      {settings.receiptFooterImageUrl && (
                        <div className="my-2 max-w-full flex justify-center">
                          <img src={settings.receiptFooterImageUrl} alt="Footer Banner" className="max-h-16 w-auto object-contain rounded border border-gray-200" referrerPolicy="no-referrer" loading="lazy" decoding="async"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        </div>
                      )}
                      <p className="text-[7px] text-gray-400 font-sans">Preview — Not yet paid</p>
                    </div>

                    <div className="border-t border-dashed border-gray-300 pt-1 mt-2 w-full"></div>
                  </div>
                );
              })()}
            </div>

            {/* Action Buttons */}
            <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 space-y-2">
              <button
                onClick={handleConfirmPayment}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <DollarSign className="w-4 h-4" />
                Pay {settings.currencySymbol}{calculateCartGrandTotal().toFixed(2)}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => { setIsPaymentConfirmOpen(false); setActiveWorkspace("Orders"); }}
                  className="flex-1 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-white transition-colors cursor-pointer"
                >
                  Go to Table View
                </button>
                <button
                  onClick={() => setIsPaymentConfirmOpen(false)}
                  className="flex-1 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-500 hover:bg-white transition-colors cursor-pointer"
                >
                  Close for Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Receipt Modal */}
      {activeReceipt && activeReceipt !== previewReceipt && (
        <ReceiptModal 
          bill={activeReceipt} 
          settings={settings} 
          onClose={() => { setActiveReceipt(null); setActiveWorkspace("Orders"); }} 
          onNewOrder={() => { setActiveReceipt(null); setActiveWorkspace("Orders"); }} 
        />
      )}

      {/* Sync Panel */}
      {isSyncPanelOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsSyncPanelOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 border border-[#e1e2ed] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-sm mb-4 flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-[#004ac6]" /> Sync Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center"><span className="text-xs text-gray-600">Status</span><span className="text-xs font-bold text-green-600">● {syncState.online ? "Online" : "Offline"}</span></div>
              <div className="flex justify-between items-center"><span className="text-xs text-gray-600">Last Synced</span><span className="text-xs font-mono">{syncState.lastSynced ? new Date(syncState.lastSynced).toLocaleTimeString() : "Never"}</span></div>
              <div className="flex justify-between items-center"><span className="text-xs text-gray-600">Pending Changes</span><span className="text-xs font-mono">{syncState.pendingChanges}</span></div>
              <button onClick={() => { syncEngine.sync(); showToast("Data synced successfully", "success"); }} className="w-full py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer">Sync Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Shortcuts Guide */}
      {isShortcutOpen && <ShortcutsGuide onClose={() => setIsShortcutOpen(false)} />}

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-[200] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 animate-[popIn_0.3s_ease-out] ${
              t.type === "success" ? "bg-green-600 text-white" :
              t.type === "warning" ? "bg-amber-500 text-white" :
              "bg-[#191b23] text-white"
            }`}
          >
            {t.type === "success" && <CheckCircle className="w-4 h-4" />}
            {t.type === "warning" && <AlertCircle className="w-4 h-4" />}
            {t.message}
          </div>
        ))}
      </div>

      {/* KOT Preview Popup — review items before sending to kitchen */}
      {isKOTPreviewOpen && kotPreviewData && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <Printer className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <h2 className="font-bold text-sm text-gray-900">KOT Preview</h2>
                <p className="text-[10px] text-gray-500">Review items before sending to kitchen</p>
              </div>
              <button onClick={() => { setIsKOTPreviewOpen(false); setKotPreviewData(null); }} className="ml-auto text-gray-400 hover:text-gray-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Preview Content */}
            <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
              {/* KOT type badge */}
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${kotPreviewData.kotType === 'Original' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                  {kotPreviewData.kotType === 'Original' ? 'ORIGINAL KOT' : 'ADDITIONAL KOT'}
                </span>
                <span className="text-[10px] text-gray-400">
                  {kotPreviewData.items.length} item{kotPreviewData.items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Group items by category */}
              {(() => {
                const grouped: Record<string, CartItem[]> = {};
                kotPreviewData.items.forEach(item => {
                  const cat = item.product.category || 'Other';
                  if (!grouped[cat]) grouped[cat] = [];
                  grouped[cat].push(item);
                });
                return Object.entries(grouped).map(([category, catItems]) => (
                  <div key={category}>
                    <h4 className="text-[9px] font-bold uppercase text-gray-500 tracking-wider mb-1.5 border-b border-gray-100 pb-1">{category}</h4>
                    <div className="space-y-1">
                      {catItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 h-5 rounded bg-white border border-[#e1e2ed] flex items-center justify-center shrink-0">
                              {item.product.image ? (
                                <img src={item.product.image} alt="" className="w-full h-full object-cover rounded" />
                              ) : (
                                <div className="w-2 h-2 rounded-sm bg-amber-200" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-800 truncate">{item.product.name}</p>
                              {item.selectedVariant && <p className="text-[9px] text-gray-500">{item.selectedVariant.name}</p>}
                              {item.notes && <p className="text-[9px] text-amber-600 italic">📝 {item.notes}</p>}
                            </div>
                          </div>
                          <span className="text-xs font-bold font-mono text-gray-700 ml-2 shrink-0">x{item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
              <button
                onClick={() => { setIsKOTPreviewOpen(false); setKotPreviewData(null); }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => kotPreviewData.onConfirm()}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Send to Kitchen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KOT Modal */}
      {currentEmployee && kotOrder && (
        <KOTModal
          isOpen={isKOTOpen}
          onClose={() => setIsKOTOpen(false)}
          order={kotOrder}
          kotRecords={kotOrder.kotRecords}
          onPrintKOT={(type) => handlePrintKOT(type)}
          onReprintKOT={(kotId) => { showToast(`KOT ${kotId} reprinted`, "info"); }}
          settings={settings}
          currentEmployee={currentEmployee}
        />
      )}

      {/* Order Timeline */}
      {isTimelineOpen && currentEmployee && (
        <OrderTimeline events={timelineEvents} isOpen={isTimelineOpen} onClose={() => setIsTimelineOpen(false)} />
      )}

      {/* Void Reason Modal */}
      {isVoidReasonOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
            <h3 className="font-bold text-sm mb-4 flex items-center gap-1.5"><Ban className="w-4 h-4 text-red-500" /> Void Reason</h3>
            <div className="space-y-2">
              {voidReasons.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { voidReasonCallback?.onConfirm(); setIsVoidReasonOpen(false); }}
                  className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs font-semibold border border-[#e1e2ed] cursor-pointer transition-all"
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={() => setIsVoidReasonOpen(false)} className="mt-3 w-full py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {/* Z-Report */}
      {isZReportOpen && (
        <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsZReportOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><FileText className="w-4 h-4 text-purple-600" /> End-of-Day Z-Report</h3>
              <button onClick={() => setIsZReportOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><p className="text-[10px] text-purple-700 font-bold uppercase">Total Sales</p><p className="text-lg font-bold font-mono text-purple-800">{settings.currencySymbol}{zReportData.totalSales.toFixed(2)}</p></div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><p className="text-[10px] text-blue-700 font-bold uppercase">Orders</p><p className="text-lg font-bold font-mono text-blue-800">{zReportData.orderCount}</p></div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><p className="text-[10px] text-amber-700 font-bold uppercase">Discounts</p><p className="text-lg font-bold font-mono text-amber-800">{settings.currencySymbol}{zReportData.totalDiscounts.toFixed(2)}</p></div>
                <div className="bg-green-50 rounded-lg p-3 border border-green-200"><p className="text-[10px] text-green-700 font-bold uppercase">Avg Order</p><p className="text-lg font-bold font-mono text-green-800">{settings.currencySymbol}{zReportData.avgOrderValue.toFixed(2)}</p></div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-700 mb-2">Payment Methods</h4>
                <div className="space-y-1">
                  {Object.entries(zReportData.paymentMethods).map(([method, data]) => (
                    <div key={method} className="flex justify-between text-xs"><span className="font-semibold">{method}</span><span className="font-mono">{data.count} orders - {settings.currencySymbol}{data.amount.toFixed(2)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-700 mb-2">Cashier Performance</h4>
                <div className="space-y-1">
                  {Object.entries(zReportData.cashiers).map(([name, data]) => (
                    <div key={name} className="flex justify-between text-xs"><span className="font-semibold">{name}</span><span className="font-mono">{data.orders} orders - {settings.currencySymbol}{data.revenue.toFixed(2)}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== OFFERS POPUP OVERLAY ========== */}
      {isOffersPopupOpen && searchedCustomer && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsOffersPopupOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-white">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                Available Offers & Rewards
              </h3>
              <button onClick={() => setIsOffersPopupOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
                <p className="font-bold text-blue-800 flex items-center gap-1">
                  <User className="w-4 h-4" />
                  {searchedCustomer.name}
                </p>
                <p className="text-blue-600 mt-1">Loyalty Points: <strong>{searchedCustomer.points} pts</strong></p>
                <p className="text-blue-600">Total Visits: <strong>{searchedCustomer.visits}</strong></p>
              </div>
              {rewards.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Award className="w-12 h-12 mx-auto mb-2 text-gray-200" />
                  <p className="text-xs font-semibold">No rewards configured</p>
                  <p className="text-[10px]">Add rewards in the Offers workspace</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Available Reward Tiers</p>
                  {rewards.filter(r => r.pointsRequired <= (searchedCustomer?.points || 0)).map((reward) => (
                    <div key={reward.id} className={"border rounded-lg p-3 transition-all " + (appliedReward?.id === reward.id ? "border-green-300 bg-green-50" : "border-[#e1e2ed] hover:border-[#004ac6]/30 bg-white")}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-xs font-bold">{reward.title}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {reward.type === "percentage" ? reward.value + "% off" : 
                             reward.type === "item" ? "Free: " + (reward.rewardItemName || "Menu Item") : 
                             settings.currencySymbol + reward.value + " off"}
                          </p>
                          {reward.minBillAmount > 0 && (
                            <p className="text-[9px] text-gray-400 mt-0.5">Min. bill: {settings.currencySymbol}{reward.minBillAmount}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-amber-600">{reward.pointsRequired} pts</p>
                          <button
                            onClick={() => handleRedeemRewardTier(reward)}
                            className={"mt-1 px-3 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all " + (appliedReward?.id === reward.id ? "bg-red-100 text-red-700 hover:bg-red-200 border border-red-200" : "bg-[#004ac6] text-white hover:bg-[#003ea8] shadow-sm")}
                          >
                            {appliedReward?.id === reward.id ? "Remove" : "Apply"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searchedCustomer && settings.visitMilestones && settings.visitMilestones.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#e1e2ed]">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Visit Milestones</p>
                  <div className="space-y-1.5">
                    {settings.visitMilestones.map((m) => {
                      const isEligible = (searchedCustomer?.visits || 0) >= Number(m.visits);
                      const isUpcoming = (searchedCustomer?.visits || 0) < Number(m.visits);
                      return (
                        <div key={m.id} className={"flex justify-between items-center p-2 rounded-lg text-xs " + (isEligible ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-100")}>
                          <span className={isEligible ? "text-green-700 font-semibold" : "text-gray-500"}>
                            {isEligible ? "✓ " : "○ "}
                            Visit #{m.visits}: {m.rewardItemName}
                          </span>
                          {isUpcoming && (
                            <span className="text-[9px] text-gray-400">{Number(m.visits) - (searchedCustomer?.visits || 0)} visits away</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== SPLIT PAYMENT POPUP OVERLAY ========== */}
      {isSplitPopupOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsSplitPopupOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 border border-[#e1e2ed]" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <ArrowLeftRight className="w-4 h-4 text-[#004ac6]" />
                Split Payment
              </h3>
              <button onClick={() => setIsSplitPopupOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-600 mb-2">
                Distribute the total of <strong>{settings.currencySymbol}{calculateCartGrandTotal().toFixed(2)}</strong> across payment methods:
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-[#e1e2ed]">
                  <DollarSign className="w-5 h-5 text-gray-400 shrink-0" />
                  <span className="text-xs font-semibold text-gray-700 w-14">Cash</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{settings.currencySymbol}</span>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={splitDetails.cashAmount} onChange={(e) => setSplitDetails(prev => ({ ...prev, cashAmount: Math.max(0, Number(e.target.value)) }))} className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white" />
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-[#e1e2ed]">
                  <CreditCard className="w-5 h-5 text-gray-400 shrink-0" />
                  <span className="text-xs font-semibold text-gray-700 w-14">Card</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{settings.currencySymbol}</span>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={splitDetails.cardAmount} onChange={(e) => setSplitDetails(prev => ({ ...prev, cardAmount: Math.max(0, Number(e.target.value)) }))} className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white" />
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-[#e1e2ed]">
                  <Smartphone className="w-5 h-5 text-gray-400 shrink-0" />
                  <span className="text-xs font-semibold text-gray-700 w-14">UPI</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{settings.currencySymbol}</span>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={splitDetails.upiAmount} onChange={(e) => setSplitDetails(prev => ({ ...prev, upiAmount: Math.max(0, Number(e.target.value)) }))} className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white" />
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-[#e1e2ed]">
                  <Wallet className="w-5 h-5 text-gray-400 shrink-0" />
                  <span className="text-xs font-semibold text-gray-700 w-14">Wallet</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{settings.currencySymbol}</span>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={splitDetails.walletAmount} onChange={(e) => setSplitDetails(prev => ({ ...prev, walletAmount: Math.max(0, Number(e.target.value)) }))} className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white" />
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[#e1e2ed]">
                <span className="text-xs font-semibold text-gray-600">Total Allocated:</span>
                <span className="text-sm font-bold font-mono" style={{color: (() => { const t = (splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0); const g = calculateCartGrandTotal(); return Math.abs(t - g) < 0.01 ? "#16a34a" : "#dc2626"; })()}}>
                  {settings.currencySymbol}{((splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0)).toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => { setIsSplitPopupOpen(false); setPaymentMethod("Split"); showToast("Split payment details set. Complete with Pay (F9)", "info"); }}
                className="w-full py-2.5 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer shadow-sm"
              >
                Set Split Amounts & Proceed
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
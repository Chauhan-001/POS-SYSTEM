/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SettingsManager — Centralized, backend-driven POS configuration (Phase 1.9).
 *
 * The backend (RestaurantSettings) is the source of truth. This component:
 *  - Loads the effective settings via useServerSettings (device → branch →
 *    restaurant merge, cached for offline).
 *  - Saves with optimistic concurrency (baseVersion) + change-reason audit.
 *  - Shows live sync status and resolves 409 conflicts.
 *  - Manages a real printer registry (network/USB/Bluetooth) instead of the
 *    hardcoded fake IPs, with connection tests.
 *  - Adds Receipt templates, Theme, Shortcuts, Notifications, Security,
 *    Backup & Restore, AI, Integrations, and History/Audit tabs.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw, Printer, Trash2, Plus, Info, FileText, CheckCircle,
  Utensils, User, Save, Upload, QrCode, Layers, Shield, Cloud,
  Moon, Sun, Monitor, Keyboard, Bell, Lock, Database, Plug, History, RefreshCw,
  AlertTriangle, CreditCard, Palette, Settings2, TestTube2,
  Image as ImageIcon, Award, Coins, Clock, ListFilter, SlidersHorizontal,
  ArrowDownUp, BadgePercent, ReceiptText, Combine, KeyRound,
  ShieldCheck, LifeBuoy, Globe,
} from 'lucide-react';
import type { SystemSettings, VisitMilestone, RolePermissions, ModuleSettings, Bill, Order, KOTRecord } from '../src/types';
import ThermalReceipt from './ThermalReceipt';
import { computeTaxSummary } from '../src/lib/taxSummary';
import ThermalKOT from './ThermalKOT';
import { printKOT } from '../src/utils/printKOT';
import { MODULE_FEATURE_MAP } from '../src/hooks/usePOSState';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/types';
import RolePermissionsTab from './RolePermissionsTab';

import SubscriptionSettings from './SubscriptionSettings';
import LegalComplianceTab from './LegalComplianceTab';
import HelpFaqTab from './HelpFaqTab';
import {
  fetchPrinters, createPrinter, updatePrinter, deletePrinter, testPrinter,
  fetchSettingsAudit, fetchRestaurantProfile, type PrinterRecord,
} from '../src/api/client';
import { useServerSettings, getDeviceId, type ServerSettingsApi } from '../src/hooks/useServerSettings';

interface SettingsManagerProps {
  settings: SystemSettings;
  onUpdateSettings: (updated: SystemSettings) => void;
  currentBranchId?: string | null;
  /** Subscription plan feature keys — forwarded to the Role Permissions live preview. */
  subscriptionFeatures?: string[];
  /** Whether the signed-in employee can view owner-level legal acceptance stats. */
  isOwner?: boolean;
}

type TabId =
  | 'billing' | 'kitchen' | 'modules' | 'roles' | 'printers'
  | 'qr' | 'theme' | 'notifications' | 'security' | 'backup'
  | 'history' | 'subscription' | 'legal' | 'help';

const DEFAULT_MODULES: ModuleSettings = {
  enableTableService: true, enableWaiterManagement: true, enableReservations: true,
  enableQROrdering: true, enableDeliveryModule: true, enableOnlineOrders: true,
  enableKitchenDisplay: true, enableLoyalty: true, showImagesInBilling: true,
  showCashierPerformance: true, enableMultiBranch: true, enableOffersPopup: true,
  enableAutoPrintKOT: false, enableQuickSoundAlerts: true, showItemCodeOnCard: false,
  enableGuestCheckout: true, enableOrderNotes: true, enableTakeawayModule: true,
  enableDineInModule: true, enableExpenseManagement: true, enableDiscountOnBilling: false,
  enableProducts: true, enableStaff: true, enableOffers: true,
  autoMarkSoldOutFromOrder: false, enableMenuAvailability: true,
  callReminderIntervalSec: 15,
  enableAISummary: true, enableAIInventoryHealth: true, enableAIPurchaseRecs: true,
  enableAILowStock: true, enableAIWasteAnalysis: true, enableAIVoiceEntry: true,
  enableAIWeather: true, enableAIClosingAssistant: true,
};

/**
 * Friendly label + one-line "what this module does" for the (i) hover tooltip
 * shown next to every module name in the Modules tab.
 */
const MODULE_INFO: Record<string, { label: string; desc: string }> = {
  enableTableService: { label: 'Table Service', desc: 'Manage dine-in tables, their status (vacant/occupied), and table transfers during billing.' },
  enableWaiterManagement: { label: 'Waiter Management', desc: 'Assign waiters to tables and orders, and track waiter-wise sales performance.' },
  enableReservations: { label: 'Reservations', desc: 'Let customers book tables ahead of time; owners track and manage upcoming bookings.' },
  enableQROrdering: { label: 'QR Ordering', desc: 'Customers scan the table QR to open your online menu and place orders from their phone.' },
  enableDeliveryModule: { label: 'Delivery', desc: 'Accept delivery orders and route them through the kitchen alongside dine-in tickets.' },
  enableOnlineOrders: { label: 'Online Orders', desc: 'Receive orders placed through your online / public ordering surface.' },
  enableKitchenDisplay: { label: 'Kitchen Display', desc: 'Show new orders on the kitchen screen (KDS) instead of (or alongside) printed tickets.' },
  enableLoyalty: { label: 'Loyalty', desc: 'Points, tiers, rewards and customer segments — recognise and retain repeat guests.' },
  showImagesInBilling: { label: 'Images in Billing', desc: 'Show item photos on billing product cards so cashiers find items faster.' },
  showCashierPerformance: { label: 'Cashier Performance', desc: 'Show per-cashier sales and performance metrics on the dashboard and reports.' },
  enableMultiBranch: { label: 'Multi-Branch', desc: 'Manage multiple branches from one account, with per-branch settings and pricing.' },
  enableOffersPopup: { label: 'Offers Popup', desc: 'Show available offers/discounts as a popup during billing so cashiers can apply them.' },
  enableAutoPrintKOT: { label: 'Auto Print KOT', desc: 'Automatically print kitchen order tickets the moment an order is placed.' },
  enableQuickSoundAlerts: { label: 'Quick Sound Alerts', desc: 'Beep when a new kitchen ticket arrives so staff notice it immediately.' },
  showItemCodeOnCard: { label: 'Item Code on Card', desc: 'Display each item code on its billing card for quick lookup.' },
  enableGuestCheckout: { label: 'Guest Checkout', desc: 'Allow billing without a saved customer — the mobile number becomes optional.' },
  enableOrderNotes: { label: 'Order Notes', desc: 'Let customers or cashiers attach notes (e.g. less spicy) to any order item.' },
  enableTakeawayModule: { label: 'Takeaway', desc: 'Enable takeaway/packaging orders separate from dine-in billing.' },
  enableDineInModule: { label: 'Dine-In', desc: 'Enable the dine-in ordering flow with table selection and kitchen routing.' },
  enableExpenseManagement: { label: 'Expense Management', desc: 'Record daily expenses, categorise them and reconcile them against revenue.' },
  enableDiscountOnBilling: { label: 'Discount on Billing', desc: 'Allow cashiers to apply discounts directly at the billing screen.' },
  enableProducts: { label: 'Products', desc: 'Show the Products/Menu catalogue workspace for managing menu items.' },
  enableStaff: { label: 'Staff', desc: 'Manage staff, roles and attendance from the app.' },
  enableOffers: { label: 'Offers', desc: 'Create and manage promotional offers to drive repeat business.' },
  autoMarkSoldOutFromOrder: { label: 'Auto Mark Sold-Out', desc: 'Automatically mark an item sold out when an order brings its stock to zero.' },
  enableMenuAvailability: { label: 'Menu Availability', desc: 'Control which items are available per day/period and mark items unavailable.' },
  enableAISummary: { label: 'AI Summary', desc: 'AI-generated end-of-day sales summary built from your real billing data.' },
  enableAIInventoryHealth: { label: 'AI Inventory Health', desc: 'AI analysis of inventory health — over/under-stock and wastage insights.' },
  enableAIPurchaseRecs: { label: 'AI Purchase Recommendations', desc: 'AI-suggested purchase quantities based on consumption and stock trends.' },
  enableAILowStock: { label: 'AI Low Stock', desc: 'AI alerts and restocking suggestions when items are running low.' },
  enableAIWasteAnalysis: { label: 'AI Waste Analysis', desc: 'AI breakdown of wastage by item, with cost and usage-variance insights.' },
  enableAIVoiceEntry: { label: 'AI Voice Entry', desc: 'Add inventory items by voice — speak the item name instead of typing it.' },
  enableAIWeather: { label: 'AI Weather', desc: 'Weather-aware suggestions (e.g. hot-day offers) from the live forecast.' },
  enableAIClosingAssistant: { label: 'AI Closing Assistant', desc: 'AI-assisted day-closing — reconciliation help and an end-of-day checklist.' },
};

const NOTIFICATION_EVENTS: Array<{ key: keyof NonNullable<SystemSettings['notifications']>; label: string; desc: string }> = [
  { key: 'lowStock', label: 'Low Stock', desc: 'Alert when stock falls below reorder level' },
  { key: 'orders', label: 'New Orders', desc: 'Incoming order notifications' },
  { key: 'sales', label: 'Sales Milestones', desc: 'Daily sales target reached' },
  { key: 'backups', label: 'Backups', desc: 'Automatic backup completion' },
  { key: 'printerErrors', label: 'Printer Errors', desc: 'Printer offline / connection failures' },
  { key: 'syncFailures', label: 'Sync Failures', desc: 'Offline queue replay failures' },
  { key: 'employeeAlerts', label: 'Employee Alerts', desc: 'Attendance & role changes' },
];

const CHANNELS: Array<'email' | 'sms' | 'whatsapp' | 'push' | 'webhook' | 'desktop'> =
  ['email', 'sms', 'whatsapp', 'push', 'webhook', 'desktop'];

// ─── Centralized tax rules (classification → GST rate) ─────────────
// The registration flow recommends the configured rate per classification;
// null = not configured → the product must confirm tax before registering.
const TAX_RULE_CLASSIFICATIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'prepared_food', label: 'Prepared Restaurant Food', hint: 'Dine-in / kitchen-made dishes' },
  { key: 'beverage', label: 'Beverage', hint: 'Drinks served on premises' },
  { key: 'packaged', label: 'Packaged Food / Product', hint: 'Sealed, retail-packaged goods' },
  { key: 'other', label: 'Other', hint: 'Anything else' },
];

const DEFAULT_TAX_RULES: Record<string, number | null> = {
  prepared_food: 5,
  beverage: 5,
  packaged: 12,
  other: null,
};

function normalizeSettingsTaxRules(rules?: Record<string, number | null> | null): Record<string, number | null> {
  const out: Record<string, number | null> = { ...DEFAULT_TAX_RULES };
  if (rules && typeof rules === 'object') {
    for (const c of TAX_RULE_CLASSIFICATIONS) {
      const v = rules[c.key];
      if (typeof v === 'number' && v >= 0) out[c.key] = v;
      else out[c.key] = null;
    }
  }
  return out;
}

export default function SettingsManager({ settings, onUpdateSettings, currentBranchId, subscriptionFeatures, isOwner }: SettingsManagerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('billing');
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ─── Server sync (Phase 1.9) — backend is the source of truth ──
  const serverSettings: ServerSettingsApi = useServerSettings({
    settings,
    setSettings: (updater) => onUpdateSettings(updater(settingsRef.current) as SystemSettings),
    branchId: currentBranchId,
    deviceId: getDeviceId(),
  });

  const showToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => setLocalToast(null), 3000);
  };

  // ─── Billing & invoice form state ──
  const [restName, setRestName] = useState(settings.restaurantName || '');
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');
  const [gstin, setGstin] = useState(settings.gstin || '');
  const [fssai, setFssai] = useState((settings as any).fssai || '');
  const [pan, setPan] = useState((settings as any).pan || '');
  const [ownerName, setOwnerName] = useState((settings as any).ownerName || '');
  const [email, setEmail] = useState((settings as any).email || '');
  const [city, setCity] = useState((settings as any).city || '');
  const [state, setState] = useState((settings as any).state || '');
  const [pinCode, setPinCode] = useState((settings as any).pinCode || '');
  const [taxRate, setTaxRate] = useState<number>(settings.defaultTaxRate ?? 5);
  const [taxRules, setTaxRules] = useState<Record<string, number | null>>(() => normalizeSettingsTaxRules((settings as any).taxRules));
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix ?? 'INV-');
  const [invoiceStartingNumber, setInvoiceStartingNumber] = useState(settings.invoiceStartingNumber ?? 1024);
  const [invoiceSuffix, setInvoiceSuffix] = useState(settings.invoiceSuffix ?? '');
  const [printSize, setPrintSize] = useState<'58mm' | '80mm'>(settings.printSize || '80mm');
  const [sidebarLogoUrl, setSidebarLogoUrl] = useState(settings.sidebarLogoUrl || '');
  const [isDragging, setIsDragging] = useState(false);
  const [showCustomerName, setShowCustomerName] = useState(settings.showCustomerNameOnReceipt ?? true);
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(settings.showLoyaltyPointsOnReceipt ?? true);
  const [showPointsEarned, setShowPointsEarned] = useState(settings.showLoyaltyPointsEarnedOnReceipt ?? true);
  const [showQrCode, setShowQrCode] = useState(settings.showQrCodeOnReceipt ?? true);
  const [showDiscountBreakdown, setShowDiscountBreakdown] = useState(settings.showDiscountBreakdownOnReceipt ?? true);
  const [printLogoOnReceipt, setPrintLogoOnReceipt] = useState(settings.printLogoOnReceipt ?? true);
  const [roundOffTotal, setRoundOffTotal] = useState(settings.roundOffTotal ?? false);
  const [showTaxSummary, setShowTaxSummary] = useState(settings.showTaxSummaryOnReceipt ?? true);
  const [receiptFooterMessage, setReceiptFooterMessage] = useState(settings.receiptFooterMessage ?? 'THANK YOU FOR DINING WITH US!');
  const [receiptFooterImageUrl, setReceiptFooterImageUrl] = useState(settings.receiptFooterImageUrl ?? '');
  const [openingTime, setOpeningTime] = useState(settings.openingTime ?? '08:00');
  const [closingTime, setClosingTime] = useState(settings.closingTime ?? '23:59');

  // ─── KOT & kitchen state ──
  const [printCategoryHeaders, setPrintCategoryHeaders] = useState(settings.printCategoryHeaders ?? true);
  const [showItemModifiers, setShowItemModifiers] = useState(settings.showItemModifiers ?? true);
  const [showOrderTime, setShowOrderTime] = useState(settings.showOrderTime ?? true);
  const [showTableNumber, setShowTableNumber] = useState(settings.showTableNumber ?? true);
  const [groupItemsInKOT, setGroupItemsInKOT] = useState(settings.groupItemsInKOT ?? true);
  const [kotFooterNote, setKotFooterNote] = useState(settings.kotFooterNote ?? 'Cook with passion!');
  const [kotOutputMode, setKotOutputMode] = useState<'print' | 'kds' | 'both'>(settings.kotOutputMode ?? 'both');
  const [autoKotOnlineOrders, setAutoKotOnlineOrders] = useState(settings.onlineOrderAutoKot ?? true);
  const [routingRules, setRoutingRules] = useState<Array<{ id: string; categoryGroup: string; destinationPrinter: string }>>(
    settings.printerRoutingRules ?? []
  );

  // ─── Modules / roles ──
  const [moduleSettings, setModuleSettings] = useState<ModuleSettings>({ ...DEFAULT_MODULES, ...(settings.moduleSettings || {}) });
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({ ...DEFAULT_ROLE_PERMISSIONS, ...(settings.rolePermissions || {}) });

  // ─── Plan-aware module locks ──
  // When the subscription plan lacks a feature, its module toggles are locked
  // OFF in Settings too (the runtime clamp already forces them off; here we
  // surface that state as disabled + labeled instead of letting the owner
  // toggle a feature the plan does not include).
  const planFeatures = subscriptionFeatures || [];
  const planLockedModules = useMemo(() => {
    const locked = new Set<string>();
    Object.entries(MODULE_FEATURE_MAP).forEach(([moduleKey, features]) => {
      if (planFeatures.length > 0 && !features.some((f) => planFeatures.includes(f))) locked.add(moduleKey);
    });
    return locked;
  }, [subscriptionFeatures]);

  // ─── Phase 1.9 sections ──
  const [theme, setTheme] = useState<NonNullable<SystemSettings['theme']>>(settings.theme || { mode: 'light', brandColor: settings.brandingColor || '#004ac6', accentColor: '#10b981', density: 'comfortable', borderRadius: 12 });
  const [notifications, setNotifications] = useState<NonNullable<SystemSettings['notifications']>>(settings.notifications || { lowStock: true, orders: true, sales: false, backups: true, printerErrors: true, syncFailures: true, employeeAlerts: false, channels: ['desktop'] });
  const [security, setSecurity] = useState<NonNullable<SystemSettings['security']>>(settings.security || { passwordMinLength: 8, sessionTimeoutMinutes: 60, autoLogout: true, failedLoginLockThreshold: 5, twoFactorEnabled: false, loginMethod: 'password', autoLockMinutes: 0 });
  const [integrations, setIntegrations] = useState<NonNullable<SystemSettings['integrations']>>(settings.integrations || { webhook: { enabled: false, url: '', secret: '' } });
  const [discount, setDiscount] = useState<NonNullable<SystemSettings['discount']>>(settings.discount || { maxDiscountPct: 20, managerApprovalAbove: 10, ownerApprovalAbove: 25, reasons: ['Festival offer', 'Customer complaint', 'Complimentary'], allowStacking: false });

  // ─── Printers (real registry) ──
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [printerForm, setPrinterForm] = useState<{ name: string; type: PrinterRecord['type']; kind: 'network' | 'usb' | 'bluetooth'; host: string; port: string; address: string; paperSize: '58mm' | '80mm'; copies: number; isDefault: boolean }>({
    name: '', type: 'kitchen', kind: 'network', host: '', port: '9100', address: '', paperSize: '80mm', copies: 1, isDefault: false,
  });
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [printerTestMsg, setPrinterTestMsg] = useState<Record<string, string>>({});

  // ─── History / audit ──
  const [history, setHistory] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);

  useEffect(() => { void loadPrinters(); }, []);
  useEffect(() => { if (activeTab === 'history') { void loadHistory(); } }, [activeTab]);

  // ─── Auto-fill billing fields from restaurant profile (registration / admin panel data) ──
  useEffect(() => {
    fetchRestaurantProfile().then((profile) => {
      if (!profile) return;
      // Auto-fill only empty fields — never overwrite user edits
      setRestName((prev) => prev || profile.restaurantName || '');
      setAddress((prev) => prev || profile.address || '');
      setPhone((prev) => prev || profile.phone || '');
      setGstin((prev) => prev || profile.gstin || '');
      setFssai((prev) => prev || (profile as any).fssai || '');
      setPan((prev) => prev || (profile as any).pan || '');
      setOwnerName((prev) => prev || (profile as any).ownerName || '');
      setEmail((prev) => prev || (profile as any).email || '');
      setCity((prev) => prev || (profile as any).city || '');
      setState((prev) => prev || (profile as any).state || '');
      setPinCode((prev) => prev || (profile as any).pinCode || '');
    }).catch(() => { /* profile fetch is best-effort */ });
  }, []);

  const loadPrinters = async () => {
    const list = await fetchPrinters({ branchId: currentBranchId || undefined });
    setPrinters(list || []);
  };

  const loadHistory = async () => {
    const h = await serverSettings.history('restaurant', currentBranchId || undefined);
    setHistory(h);
    const a = await fetchSettingsAudit(1, 30);
    setAudit(a);
  };

  // ─── Apply theme live ──
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-color', theme.brandColor || '#004ac6');
    root.style.setProperty('--accent-color', theme.accentColor || '#10b981');
    // 'system' mode follows the OS color-scheme preference (and live changes).
    const applyMode = () => {
      const dark = theme.mode === 'dark'
        || (theme.mode === 'system' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('pos-dark', dark);
    };
    applyMode();
    if (theme.mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', applyMode);
      return () => mq.removeEventListener?.('change', applyMode);
    }
  }, [theme]);

  const toggleModule = (key: keyof ModuleSettings) => {
    if (planLockedModules.has(key)) return; // plan-excluded modules cannot be enabled
    setModuleSettings((p) => ({ ...p, [key]: !p[key] }));
  };

  // Strip plan-locked modules to false before persisting so a stale/local
  // enabled value can never be written back for a feature the plan excludes.
  const sanitizedModuleSettings = useMemo(() => {
    const sanitized: ModuleSettings = { ...moduleSettings };
    planLockedModules.forEach((k) => { (sanitized as unknown as Record<string, boolean>)[k] = false; });
    return sanitized;
  }, [moduleSettings, planLockedModules]);
  // Selecting a print-including KOT output mode also enables Auto Print KOT
  // (Modules tab) so the paper ticket actually fires — the Modules toggle
  // defaults to OFF, which would otherwise make 'print'/'both' a silent no-op.
  const handleKotOutputModeChange = (mode: 'print' | 'kds' | 'both') => {
    setKotOutputMode(mode);
    if (mode !== 'kds') setModuleSettings((p) => ({ ...p, enableAutoPrintKOT: true }));
  };
  const toggleRolePermission = (key: keyof RolePermissions) => setRolePermissions((p) => ({ ...p, [key]: !p[key] }));
  // Apply a ready-made permission set for the Manager role (Full / Recommended / Restricted).
  // Presets only stage the local state — nothing persists until the user hits Save.
  const applyRolePreset = (preset: Partial<RolePermissions>) =>
    setRolePermissions((p) => ({ ...p, ...preset }));

  // ─── Save (server-first with optimistic concurrency) ──
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const updated: SystemSettings = {
      ...settings,
      restaurantName: restName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      gstin: gstin.trim(),
      fssai: fssai.trim(),
      pan: pan.trim(),
      ownerName: ownerName.trim(),
      email: email.trim(),
      city: city.trim(),
      state: state.trim(),
      pinCode: pinCode.trim(),
      defaultTaxRate: Number(taxRate),
      taxRules,
      invoicePrefix: invoicePrefix.trim(),
      invoiceStartingNumber: Number(invoiceStartingNumber),
      invoiceSuffix: invoiceSuffix.trim(),
      printSize,
      sidebarLogoUrl: sidebarLogoUrl.trim(),
      showCustomerNameOnReceipt: showCustomerName,
      showLoyaltyPointsOnReceipt: showLoyaltyPoints,
      showLoyaltyPointsEarnedOnReceipt: showPointsEarned,
      showQrCodeOnReceipt: showQrCode,
      showDiscountBreakdownOnReceipt: showDiscountBreakdown,
      printLogoOnReceipt: printLogoOnReceipt,
      printCategoryHeaders: printCategoryHeaders,
      showItemModifiers: showItemModifiers,
      showOrderTime: showOrderTime,
      showTableNumber: showTableNumber,
      groupItemsInKOT: groupItemsInKOT,
      kotFooterNote: kotFooterNote.trim(),
      kotOutputMode,
      onlineOrderAutoKot: autoKotOnlineOrders,
      printerRoutingRules: routingRules,
      roundOffTotal: roundOffTotal,
      showTaxSummaryOnReceipt: showTaxSummary,
      receiptFooterMessage: receiptFooterMessage.trim(),
      receiptFooterImageUrl: receiptFooterImageUrl.trim(),
      openingTime,
      closingTime,
      moduleSettings: sanitizedModuleSettings,
      rolePermissions,
      theme,
      notifications,
      security,
      integrations,
      discount,
    };

    const ok = await serverSettings.save('restaurant', updated as Record<string, any>, reason.trim() || 'Updated from Settings', currentBranchId || undefined);
    if (ok) {
      showToast(serverSettings.syncStatus === 'offline' ? 'Saved locally — will sync when online' : 'Configuration saved & synced');
    } else {
      showToast('Conflict — another device changed settings');
    }
    setSaving(false);
  };

  const handleDiscardChanges = () => {
    setRestName(settings.restaurantName || '');
    setAddress(settings.address || '');
    setPhone(settings.phone || '');
    setGstin(settings.gstin || '');
    setFssai((settings as any).fssai || '');
    setPan((settings as any).pan || '');
    setOwnerName((settings as any).ownerName || '');
    setEmail((settings as any).email || '');
    setCity((settings as any).city || '');
    setState((settings as any).state || '');
    setPinCode((settings as any).pinCode || '');
    setTaxRate(settings.defaultTaxRate ?? 5);
    setTaxRules(normalizeSettingsTaxRules((settings as any).taxRules));
    setInvoicePrefix(settings.invoicePrefix ?? 'INV-');
    setInvoiceStartingNumber(settings.invoiceStartingNumber ?? 1024);
    setInvoiceSuffix(settings.invoiceSuffix ?? '');
    setPrintSize(settings.printSize || '80mm');
    setSidebarLogoUrl(settings.sidebarLogoUrl || '');
    setShowCustomerName(settings.showCustomerNameOnReceipt ?? true);
    setShowLoyaltyPoints(settings.showLoyaltyPointsOnReceipt ?? true);
    setShowPointsEarned(settings.showLoyaltyPointsEarnedOnReceipt ?? true);
    setShowQrCode(settings.showQrCodeOnReceipt ?? true);
    setShowDiscountBreakdown(settings.showDiscountBreakdownOnReceipt ?? true);
    setPrintLogoOnReceipt(settings.printLogoOnReceipt ?? true);
    setRoundOffTotal(settings.roundOffTotal ?? false);
    setShowTaxSummary(settings.showTaxSummaryOnReceipt ?? true);
    setReceiptFooterMessage(settings.receiptFooterMessage ?? 'THANK YOU FOR DINING WITH US!');
    setReceiptFooterImageUrl(settings.receiptFooterImageUrl ?? '');
    setOpeningTime(settings.openingTime ?? '08:00');
    setClosingTime(settings.closingTime ?? '23:59');
    setPrintCategoryHeaders(settings.printCategoryHeaders ?? true);
    setShowItemModifiers(settings.showItemModifiers ?? true);
    setShowOrderTime(settings.showOrderTime ?? true);
    setShowTableNumber(settings.showTableNumber ?? true);
    setKotOutputMode(settings.kotOutputMode ?? 'both');
    setAutoKotOnlineOrders(settings.onlineOrderAutoKot ?? true);
    setModuleSettings({ ...DEFAULT_MODULES, ...(settings.moduleSettings || {}) });
    setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...(settings.rolePermissions || {}) });
    setTheme(settings.theme || { mode: 'light', brandColor: settings.brandingColor || '#004ac6', accentColor: '#10b981', density: 'comfortable', borderRadius: 12 });
    setNotifications(settings.notifications || { channels: ['desktop'] });
    setSecurity(settings.security || { passwordMinLength: 8, sessionTimeoutMinutes: 60, autoLogout: true, failedLoginLockThreshold: 5, twoFactorEnabled: false });
    setIntegrations(settings.integrations || { webhook: { enabled: false, url: '', secret: '' } });
    setRoutingRules(settings.printerRoutingRules ?? []);
    showToast('Changes discarded');
  };

  // ─── Printer helpers ──
  const handleAddPrinter = async () => {
    if (!printerForm.name.trim()) { showToast('Printer name is required'); return; }
    const payload: any = {
      name: printerForm.name.trim(),
      type: printerForm.type,
      connection: printerForm.kind === 'network'
        ? { kind: 'network', host: printerForm.host.trim(), port: Number(printerForm.port) || 9100 }
        : { kind: printerForm.kind, address: printerForm.address.trim() },
      paperSize: printerForm.paperSize,
      copies: printerForm.copies,
      isDefault: printerForm.isDefault,
      branchId: currentBranchId || undefined,
    };
    if (editingPrinterId) {
      const res = await updatePrinter(editingPrinterId, payload);
      if (res) showToast('Printer updated');
    } else {
      const res = await createPrinter(payload);
      if (res) showToast('Printer added to registry');
      else { showToast('Failed — check the connection details'); }
    }
    setEditingPrinterId(null);
    setPrinterForm({ name: '', type: 'kitchen', kind: 'network', host: '', port: '9100', address: '', paperSize: '80mm', copies: 1, isDefault: false });
    await loadPrinters();
  };

  const handleEditPrinter = (p: PrinterRecord) => {
    setEditingPrinterId(p._id);
    setPrinterForm({
      name: p.name, type: p.type,
      kind: p.connection.kind,
      host: p.connection.host || '', port: String(p.connection.port || 9100),
      address: p.connection.address || '', paperSize: p.paperSize, copies: p.copies, isDefault: p.isDefault,
    });
  };

  const handleDeletePrinter = async (id: string) => {
    await deletePrinter(id);
    await loadPrinters();
    showToast('Printer removed');
  };

  const handleTestPrinter = async (id: string) => {
    setTestingPrinterId(id);
    const res = await testPrinter(id);
    if (res) {
      setPrinterTestMsg((m) => ({ ...m, [id]: `${res.healthStatus === 'online' ? '✅' : res.healthStatus === 'offline' ? '❌' : 'ℹ️'} ${res.message}` }));
    } else {
      setPrinterTestMsg((m) => ({ ...m, [id]: 'Test failed — no response' }));
    }
    setTestingPrinterId(null);
    await loadPrinters();
  };

  // ─── Backup helpers ──
  const handleExportBackup = () => {
    const backup = {
      app: 'restaurant-pos',
      version: 2,
      exportedAt: new Date().toISOString(),
      restaurantId: settings.restaurantName || '',
      settings,
      printerRoutingRules: routingRules,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  };

  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const restored = parsed.settings as SystemSettings;
        if (restored && typeof restored === 'object') {
          onUpdateSettings({ ...settings, ...restored });
          showToast('Backup restored — review and save to sync');
        } else {
          showToast('Invalid backup file');
        }
      } catch {
        showToast('Could not parse backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ─── Thermal preview engine — mirrors the REAL billing-time receipt (ThermalReceipt) ──
  // Mixed tax slabs on purpose: the preview proves the receipt renders a grouped
  // GST SUMMARY (5% + 18%) with the proportional discount allocation intact.
  const previewSubtotal = 2900;
  const previewDiscount = 300; // real discount on the bill; the toggle only hides the printed line
  const previewItems = [
    { id: 'p1', product: { id: 'p1', name: 'Truffle Risotto', price: 1200, category: 'Main Courses', image: '', gstPercent: 5, availability: true, code: 'TR001' }, quantity: 1, price: 1200 },
    { id: 'p2', product: { id: 'p2', name: 'Margherita Pizza', price: 750, category: 'Pizza Station', image: '', gstPercent: 5, availability: true, code: 'MP002' }, quantity: 2, price: 750, notes: 'Extra cheese' },
    { id: 'p3', product: { id: 'p3', name: 'Mango Lassi', price: 200, category: 'Beverages', image: '', gstPercent: 18, availability: true, code: 'ML003' }, quantity: 1, price: 200, selectedVariant: { name: 'Large', price: 200 } },
  ];
  const previewGst = previewItems.reduce((s, it) => {
    const rowTotal = it.price * it.quantity;
    const proportion = rowTotal / previewSubtotal;
    const taxable = Math.max(0, rowTotal - previewDiscount * proportion);
    return s + taxable * ((it.product.gstPercent || 0) / 100);
  }, 0);
  const previewGrandTotal = parseFloat((previewSubtotal - previewDiscount + previewGst).toFixed(2));

  const previewBill: Bill = {
    id: 'settings-preview',
    invoiceNumber: `${invoicePrefix}${invoiceStartingNumber}${invoiceSuffix}`,
    ticketNumber: 'T-0081',
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date().toISOString(),
    cashierName: 'Sarah',
    cashierRole: 'Cashier',
    items: previewItems,
    subtotal: previewSubtotal,
    discount: previewDiscount,
    gst: previewGst,
    grandTotal: previewGrandTotal,
    paymentMethod: 'Cash',
    orderType: 'Dine In',
    customerPhone: '9876543210',
    customerName: 'Rahul Sharma',
    pointsEarned: 86,
    pointsRedeemed: 200,
    redeemedRewardTitle: '20% Off Large Bills',
    milestoneRewardAwarded: 'Free Dessert',
    tableNumber: 4,
    // Demo receipt URL — the preview QR is REAL and scannable; the backend
    // serves a sample landing page for the special `demo` token.
    receiptUrl: `${serverSettings.qrBaseUrl || window.location.origin}/#/r/demo`,
  };

  // Staged settings — so the preview reflects unsaved changes live
  const previewSettings: SystemSettings = {
    ...settings,
    restaurantName: restName,
    address,
    phone,
    gstin,
    fssai,
    pan,
    ownerName,
    email,
    city,
    state,
    pinCode,
    invoiceSuffix,
    printSize,
    sidebarLogoUrl,
    showCustomerNameOnReceipt: showCustomerName,
    showLoyaltyPointsOnReceipt: showLoyaltyPoints,
    showLoyaltyPointsEarnedOnReceipt: showPointsEarned,
    showQrCodeOnReceipt: showQrCode,
    showDiscountBreakdownOnReceipt: showDiscountBreakdown,
    printLogoOnReceipt,
    roundOffTotal,
    showTaxSummaryOnReceipt: showTaxSummary,
    receiptFooterMessage,
    receiptFooterImageUrl,
    printCategoryHeaders,
    showItemModifiers,
    showOrderTime,
    showTableNumber,
  };

  // ─── KOT preview engine — mirrors the REAL printed KOT (ThermalKOT) ──
  const previewKotOrder = {
    orderNumber: 8841,
    tableNumber: 4,
    type: 'Dine In',
    waiterName: 'Sarah',
    customerName: 'Rahul Sharma',
  };
  const previewKot = {
    kotNumber: 1,
    type: 'Original',
    printedAt: new Date().toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    printedBy: 'Sarah (Cashier)',
    items: previewBill.items,
  };
  const previewKotSettings: SystemSettings = {
    ...settings,
    restaurantName: restName,
    printSize,
    kotFooterNote,
    showOrderTime,
    showTableNumber,
    showItemModifiers,
    printCategoryHeaders,
    groupItemsInKOT,
  };

  const printContent = (htmlContent: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0';
    iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`<html><head><title>Thermal Print Job</title><style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');
        body { margin:0; padding:${printSize === '58mm' ? '6px' : '10px'}; font-family:'JetBrains Mono',monospace; font-size:${printSize === '58mm' ? '9px' : '11px'}; color:black; background:white; width:${printSize === '58mm' ? '210px' : '300px'}; }
        * { box-sizing:border-box; } img { max-height:50px; max-width:150px; object-fit:contain; display:block; margin:0 auto; }
        .text-center{text-align:center}.font-bold{font-weight:bold}.font-black{font-weight:950}.flex{display:flex}.justify-between{justify-content:space-between}.border-b{border-bottom:1px dashed black}.my-2{margin-top:8px;margin-bottom:8px}.my-3{margin-top:12px;margin-bottom:12px}.p-2{padding:8px}.bg-gray-50{background-color:#f9fafb}
      </style></head><body>${htmlContent}<script>window.onload=function(){window.print();setTimeout(function(){window.parent.document.body.removeChild(window.frameElement);},500);};</script></body></html>`);
      doc.close();
    }
  };

  const handlePrintTestReceipt = () => {
    const safeLogoUrl = sidebarLogoUrl && sidebarLogoUrl.startsWith('data:image/') ? sidebarLogoUrl : null;
    const sym = settings.currencySymbol || '₹';
    // Multi-slab tax summary — same math as the live ThermalReceipt preview.
    const printTax = computeTaxSummary(previewItems, previewDiscount);
    const printMultiSlab = printTax.rows.length > 1;
    const finalTotal = roundOffTotal ? Math.round(previewGrandTotal) : previewGrandTotal;
    const roundOffDiff = roundOffTotal ? parseFloat((Math.round(previewGrandTotal) - previewGrandTotal).toFixed(2)) : 0;
    const nowDate = new Date().toLocaleDateString();
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const itemsHtml = [
      { name: 'Truffle Risotto', qty: 1, total: 1200, note: '' },
      { name: 'Margherita Pizza', qty: 2, total: 1500, note: 'Extra cheese' },
      { name: 'Mango Lassi (Large)', qty: 1, total: 200, note: '' },
    ]
      .map((it) => `
      <div class="flex justify-between"><span>${it.name}${showItemModifiers && it.note ? `<br/><span style="font-size:8px;color:#666;">*Note: ${it.note}</span>` : ''}</span><span>${it.qty}</span><span>${sym}${it.total.toFixed(2)}</span></div>`)
      .join('');

    const taxHtml = printMultiSlab
      ? `
      <div style="font-size:8px;font-weight:bold;">GST SUMMARY</div>
      <div class="flex justify-between" style="font-size:7px;font-weight:bold;"><span>RATE</span><span>TAXABLE</span><span>CGST</span><span>SGST</span></div>
      ${printTax.rows.map((row) => `<div class="flex justify-between" style="font-size:8px;"><span>${row.rate}%</span><span>${sym}${row.taxableAmount.toFixed(2)}</span><span>${sym}${(row.components[0]?.amount || 0).toFixed(2)}</span><span>${sym}${(row.components[1]?.amount || 0).toFixed(2)}</span></div>`).join('')}
      <div class="flex justify-between" style="font-size:8px;font-weight:bold;"><span>TOTAL TAX:</span><span>${sym}${printTax.totalTax.toFixed(2)}</span></div>`
      : printTax.rows[0]?.rate > 0
        ? `<div class="flex justify-between" style="font-size:9px;"><span>CGST (${printTax.rows[0].components[0]?.rate}%):</span><span>${sym}${(printTax.rows[0].components[0]?.amount || 0).toFixed(2)}</span></div>
      <div class="flex justify-between" style="font-size:9px;"><span>SGST (${printTax.rows[0].components[1]?.rate}%):</span><span>${sym}${(printTax.rows[0].components[1]?.amount || 0).toFixed(2)}</span></div>`
        : '';

    printContent(`
      <div class="text-center"><div class="border-b" style="margin:6px 0;"></div>
        ${printLogoOnReceipt && safeLogoUrl ? `<img src="${safeLogoUrl}" />` : ''}
        <h3 class="font-bold" style="text-transform:uppercase;">${restName || 'RESTAURANT NAME'}</h3>
        <p style="margin:2px 0;">${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''}${pinCode ? ' - ' + pinCode : ''}</p><p style="margin:2px 0;">${phone}${email ? ' | ' + email : ''}</p>
        <p class="font-bold" style="margin:2px 0;">GSTIN: ${gstin || '—'}${fssai ? ' | FSSAI: ' + fssai : ''}</p>
        <div class="border-b my-3"></div></div>
      <div class="flex justify-between"><span>INVOICE:</span><span class="font-bold">${invoicePrefix}${invoiceStartingNumber}${invoiceSuffix}</span></div>
      <div class="flex justify-between"><span>DATE:</span><span>${nowDate}  ${nowTime}</span></div>
      ${showOrderTime ? `<div class="flex justify-between"><span>ORDER TIME:</span><span>${nowTime}</span></div>` : ''}
      ${showTableNumber ? `<div class="flex justify-between font-bold"><span>TABLE:</span><span>T4</span></div>` : ''}
      <div class="flex justify-between"><span>CASHIER:</span><span>Sarah (Cashier)</span></div>
      <div class="flex justify-between"><span>ORDER TYPE:</span><span class="font-bold">DINE IN</span></div>
      ${showCustomerName ? `<div class="flex justify-between font-bold" style="border:1px dashed black;padding:4px;margin-top:4px;"><span>LOYALTY MEMB:</span><span>Rahul Sharma</span></div>` : ''}
      <div class="border-b my-2"></div>
      <div class="flex justify-between font-bold"><span>ITEM</span><span>QTY</span><span>TOTAL</span></div>
      <div class="border-b my-2"></div>
      ${itemsHtml}
      <div class="border-b my-2"></div>
      <div class="flex justify-between"><span>SUBTOTAL:</span><span>${sym}${previewSubtotal.toFixed(2)}</span></div>
      ${showDiscountBreakdown ? `<div class="flex justify-between font-bold"><span>DISCOUNT REDEEMED:</span><span>-${sym}${previewDiscount.toFixed(2)}</span></div>` : ''}
      ${showTaxSummary && previewGst > 0 ? taxHtml : ''}
      ${roundOffTotal && roundOffDiff !== 0 ? `<div class="flex justify-between" style="font-size:9px;"><span>ROUND OFF:</span><span>${sym}${roundOffDiff.toFixed(2)}</span></div>` : ''}
      <div class="border-b my-2"></div>
      <div class="flex justify-between font-bold" style="font-size:13px;"><span>NET TOTAL:</span><span>${sym}${finalTotal.toFixed(2)}</span></div>
      <div class="flex justify-between font-bold"><span>PAYMENT TYPE: CASH</span></div>
      ${showCustomerName && showLoyaltyPoints ? `
      <div style="border:2px dashed #333;padding:8px;margin-top:8px;text-align:center;font-size:8px;">
        <p class="font-bold">LOYALTY REWARDS SUMMARY</p>
        <div class="flex justify-between"><span>Points Redeemed:</span><span>200 pts</span></div>
        ${showPointsEarned ? `<div class="flex justify-between"><span>Points Accumulated:</span><span>+86 pts</span></div>` : ''}
        <p style="font-size:7.5px;font-weight:bold;color:#15803d;text-transform:uppercase;margin-top:2px;">Redeemed: 20% Off Large Bills</p>
      </div>` : ''}
      ${showQrCode ? `<div class="text-center" style="margin-top:12px;">
        <p class="font-bold" style="font-size:8px;">SCAN TO CLAIM DISCOUNTS & STAMPS</p>
        <div style="width:${printSize === '58mm' ? '64px' : '80px'};height:${printSize === '58mm' ? '64px' : '80px'};margin:6px auto;border:1px solid #ccc;padding:6px;">
        <svg width="100%" height="100%" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><rect x="5" y="5" width="25" height="25" fill="#000"/><rect x="70" y="5" width="25" height="25" fill="#000"/><rect x="5" y="70" width="25" height="25" fill="#000"/><rect x="40" y="10" width="5" height="10" fill="#000"/><rect x="50" y="5" width="10" height="5" fill="#000"/><rect x="45" y="20" width="15" height="5" fill="#000"/><rect x="40" y="55" width="10" height="5" fill="#000"/><rect x="55" y="45" width="15" height="10" fill="#000"/><rect x="70" y="40" width="10" height="15" fill="#000"/><rect x="85" y="55" width="10" height="5" fill="#000"/><rect x="80" y="70" width="15" height="15" fill="#000"/></svg>
        </div>
      </div>` : ''}
      <div class="text-center" style="margin-top:10px;">
        <p class="font-bold">${receiptFooterMessage}</p>
        ${receiptFooterImageUrl && receiptFooterImageUrl.startsWith('data:image/') ? `<img src="${receiptFooterImageUrl}" style="max-height:50px;margin:6px auto;" />` : ''}
        <p style="font-size:8px;color:#555;margin-top:6px;">*** END OF TEST RECEIPT ***</p>
      </div>
    `);
  };

  const handlePrintTestKOT = () => {
    // Print through the exact same path as the real billing-time KOT
    printKOT(previewKotOrder as unknown as Order, previewKot as unknown as KOTRecord, previewKotSettings);
  };

  const tabs: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
    { id: 'billing', label: 'BILLING & INVOICE', icon: FileText },
    { id: 'kitchen', label: 'KOT & KITCHEN', icon: Utensils },
    { id: 'modules', label: 'MODULES', icon: Layers },
    { id: 'roles', label: 'ROLE PERMISSIONS', icon: Shield },
    { id: 'printers', label: 'PRINTERS', icon: Printer },

    { id: 'theme', label: 'THEME', icon: Palette },
    { id: 'notifications', label: 'NOTIFICATIONS', icon: Bell },
    { id: 'security', label: 'SECURITY', icon: Lock },
    { id: 'backup', label: 'BACKUP & RESTORE', icon: Database },
    { id: 'history', label: 'HISTORY & AUDIT', icon: History },
    { id: 'subscription', label: 'SUBSCRIPTION', icon: CreditCard },
    { id: 'legal', label: 'LEGAL & COMPLIANCE', icon: ShieldCheck },
    { id: 'help', label: 'HELP & FAQ', icon: LifeBuoy },
  ];

  // Compact online/offline indicator pinned to the right of the tab row
  const syncPill = () => {
    switch (serverSettings.syncStatus) {
      case 'synced':
        return <span title="Online — settings sync to the server" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-emerald-500-solid)]" />ONLINE</span>;
      case 'offline':
        return <span title="Offline — changes are saved locally and sync later" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-600 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-red-500-solid)] animate-pulse" />OFFLINE</span>;
      case 'pending':
        return <span title="Sync pending" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber-500-solid)] animate-pulse" />SYNCING</span>;
      case 'conflict':
        return <span title="Conflict — another device changed settings" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-red-500-solid)]" />CONFLICT</span>;
      default:
        return <span title="Checking connection…" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />…</span>;
    }
  };

  return (
    <div id="settings_workspace_container" className="flex flex-col h-full bg-[var(--color-surface-muted)] select-none overflow-hidden">
      {/* Tab nav — compact online/offline indicator pinned to the right */}
      <div className="bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] flex items-center shrink-0">
        <div className="flex items-center px-4 overflow-x-auto flex-1 min-w-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-3 font-bold text-[10px] tracking-wide transition-all border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === t.id ? 'border-[var(--brand-color)] text-[var(--brand-color)]' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="pl-2 pr-4 shrink-0 flex items-center">
          {syncPill()}
        </div>
      </div>

      {serverSettings.conflict && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-[10px] font-bold shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Another device changed these settings — review before saving.</span>
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('Another device changed these settings. Pull the server version (discard local changes) or keep local? Click OK to pull server, Cancel to keep local.')) {
                await serverSettings.resolveConflict('server');
                showToast('Loaded the latest server configuration');
              } else {
                await serverSettings.resolveConflict('local');
                showToast('Local configuration pushed to server');
              }
            }}
            className="ml-auto px-3 py-1 rounded-lg bg-[var(--color-red-600-solid)] text-white text-[10px] font-bold hover:bg-[var(--color-red-700-solid)] transition-colors cursor-pointer shrink-0"
          >
            Resolve
          </button>
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="flex-1 p-6 flex flex-col gap-4 h-full overflow-hidden">
        {/* Billing/Kitchen: the grid owns the height on desktop so the settings
            column and the live preview scroll independently. Other tabs keep
            the single outer scroll. */}
        <div className={`flex-1 space-y-6 min-h-0 overflow-y-auto ${activeTab === 'billing' || activeTab === 'kitchen' ? 'lg:overflow-hidden' : ''}`}>
          {/* ── BILLING ── */}
          {activeTab === 'billing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
              <div className="lg:col-span-7 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">GST Configuration</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">GSTIN Number</label>
                      <input type="text" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400 uppercase" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Restaurant Name</label>
                      <input type="text" value={restName} onChange={(e) => setRestName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Phone</label>
                      <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Address</label>
                      <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">FSSAI License</label>
                      <input type="text" value={fssai} onChange={(e) => setFssai(e.target.value)} placeholder="FSSAI Number" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">PAN Number</label>
                      <input type="text" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="PAN" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400 uppercase" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Owner Name</label>
                      <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner / Proprietor" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Email</label>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="restaurant@email.com" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">City</label>
                      <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">State</label>
                      <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Pin Code</label>
                      <input type="text" value={pinCode} onChange={(e) => setPinCode(e.target.value)} placeholder="Pin Code" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] placeholder-gray-400" />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-50">
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Tax Rules by Classification</label>
                    <p className="text-[10px] text-gray-400 mb-2">When you register a dish, the POS automatically applies the GST rate configured for its classification. Leave a row empty to make that classification ask for confirmation instead of guessing.</p>
                    <div className="space-y-2">
                      {TAX_RULE_CLASSIFICATIONS.map((c) => (
                        <div key={c.key} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-700">{c.label}</p>
                            <p className="text-[9px] text-gray-400 truncate">{c.hint}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400">GST</span>
                            <input
                              type="number" min={0} max={100}
                              placeholder="—"
                              value={taxRules[c.key] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value === '' ? null : Number(e.target.value);
                                setTaxRules((p) => ({ ...p, [c.key]: v !== null && !isNaN(v) ? Math.max(0, Math.min(100, v)) : null }));
                              }}
                              className="w-16 px-2 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold text-center focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                            />
                            <span className="text-[10px] font-bold text-gray-400">%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Business Hours</h3>
                    <span className="ml-auto text-[9px] text-gray-400">Defines the "today" sales window</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Opening Time</label>
                      <input type="time" value={openingTime} onChange={(e) => setOpeningTime(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Closing Time</label>
                      <input type="time" value={closingTime} onChange={(e) => setClosingTime(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" />
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-[var(--brand-color)]">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="font-bold">Today's revenue, Z-report, hourly charts and "items sold" count sales from <strong>{openingTime || '08:00'}</strong> until <strong>{closingTime || '23:59'}</strong>. Bills before opening time belong to the previous business day (useful for late-night dining).</span>
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Invoice Numbering</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Prefix</label><input type="text" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Starting Number</label><input type="number" value={invoiceStartingNumber} onChange={(e) => setInvoiceStartingNumber(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold font-mono" /></div>
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Suffix</label><input type="text" value={invoiceSuffix} onChange={(e) => setInvoiceSuffix(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center gap-2.5 text-xs text-[var(--brand-color)]">
                    <Info className="w-4 h-4 shrink-0" />
                    <span className="font-bold">Preview: <strong className="font-mono">{invoicePrefix}{invoiceStartingNumber}{invoiceSuffix}</strong></span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Paper Size</label>
                    <div className="flex gap-2">
                      {(['80mm', '58mm'] as const).map((s) => (
                        <button key={s} type="button" onClick={() => setPrintSize(s)} className={`px-4 py-2 rounded-xl font-bold text-xs cursor-pointer ${printSize === s ? 'bg-[var(--brand-color)] text-white' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]'}`}>{s}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Brand Logo</h3>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = (ev) => { if (ev.target?.result) setSidebarLogoUrl(String(ev.target.result)); }; r.readAsDataURL(f); } }}
                      className={`flex-1 w-full border-2 border-dashed rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer ${isDragging ? 'border-[var(--brand-color)] bg-blue-50/50' : 'border-gray-300 hover:border-[var(--brand-color)]'}`}
                      onClick={() => document.getElementById('device-logo-input')?.click()}
                    >
                      <input type="file" id="device-logo-input" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f?.type.startsWith('image/') && f.size <= 2 * 1024 * 1024) { const r = new FileReader(); r.onload = (ev) => { if (ev.target?.result) setSidebarLogoUrl(String(ev.target.result)); }; r.readAsDataURL(f); } }} />
                      <Upload className={`w-6 h-6 mb-1.5 ${isDragging ? 'text-[var(--brand-color)]' : 'text-gray-400'}`} />
                      <p className="text-xs font-bold text-gray-700">Drag & drop logo or <span className="text-[var(--brand-color)] underline">browse</span></p>
                      <p className="text-[9px] text-gray-400 mt-1">PNG, JPG, WEBP, SVG (max 2MB)</p>
                    </div>
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="w-16 h-16 bg-[var(--color-sidebar-bg)] rounded-xl flex items-center justify-center overflow-hidden">
                        {sidebarLogoUrl ? <img src={sidebarLogoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <span className="text-white font-extrabold text-sm">{restName ? restName.split(' ').map((w) => w[0]).join('').substring(0, 3).toUpperCase() : 'POS'}</span>}
                      </div>
                      {sidebarLogoUrl && <button type="button" onClick={() => setSidebarLogoUrl('')} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[9px] font-bold hover:bg-red-100 cursor-pointer flex items-center gap-1"><Trash2 className="w-2.5 h-2.5" />Remove</button>}
                    </div>
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Sections</h3>
                    <span className="ml-auto text-[9px] text-gray-400">Toggle what prints on the bill</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {[
                      { icon: <ImageIcon className="w-3.5 h-3.5" />, label: 'Print Logo', value: printLogoOnReceipt, set: setPrintLogoOnReceipt, hint: 'Brand logo on top' },
                      { icon: <User className="w-3.5 h-3.5" />, label: 'Customer Name', value: showCustomerName, set: setShowCustomerName, hint: 'Loyalty member name' },
                      { icon: <Award className="w-3.5 h-3.5" />, label: 'Loyalty Rewards', value: showLoyaltyPoints, set: setShowLoyaltyPoints, hint: 'Rewards summary box' },
                      { icon: <Coins className="w-3.5 h-3.5" />, label: 'Points Accumulated', value: showPointsEarned, set: setShowPointsEarned, hint: '+pts earned line' },
                      { icon: <QrCode className="w-3.5 h-3.5" />, label: 'QR Code', value: showQrCode, set: setShowQrCode, hint: 'Scan-to-claim QR' },
                      { icon: <BadgePercent className="w-3.5 h-3.5" />, label: 'Discount Breakdown', value: showDiscountBreakdown, set: setShowDiscountBreakdown, hint: 'Discount redeemed line' },
                      { icon: <ReceiptText className="w-3.5 h-3.5" />, label: 'Tax Summary (CGST/SGST)', value: showTaxSummary, set: setShowTaxSummary, hint: 'Tax split lines' },
                      { icon: <Clock className="w-3.5 h-3.5" />, label: 'Order Time', value: showOrderTime, set: setShowOrderTime, hint: 'Order timestamp' },
                      { icon: <Layers className="w-3.5 h-3.5" />, label: 'Table Number', value: showTableNumber, set: setShowTableNumber, hint: 'Dine-in table' },
                      { icon: <SlidersHorizontal className="w-3.5 h-3.5" />, label: 'Item Modifiers', value: showItemModifiers, set: setShowItemModifiers, hint: 'Variants & notes' },
                      { icon: <ListFilter className="w-3.5 h-3.5" />, label: 'Category Headers', value: printCategoryHeaders, set: setPrintCategoryHeaders, hint: 'Group items by category' },
                      { icon: <ArrowDownUp className="w-3.5 h-3.5" />, label: 'Round Off Total', value: roundOffTotal, set: setRoundOffTotal, hint: 'Round to nearest rupee' },
                    ].map((t) => (
                      <div key={t.label} className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl hover:bg-gray-50">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[var(--brand-color)] shrink-0">{t.icon}</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{t.label}</p>
                            <p className="text-[8.5px] text-gray-400 truncate">{t.hint}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => t.set(!t.value)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${t.value ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                          <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Footer</h3>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Footer Message</label>
                    <input type="text" value={receiptFooterMessage} onChange={(e) => setReceiptFooterMessage(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" placeholder="THANK YOU FOR DINING WITH US!" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Footer Image URL</label>
                    <input type="text" value={receiptFooterImageUrl} onChange={(e) => setReceiptFooterImageUrl(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" placeholder="https://…/footer-banner.png" />
                    <p className="text-[9px] text-gray-400 mt-1">Optional banner shown above the thank-you note.</p>
                  </div>
                </div>
              </div>

              {/* Live receipt preview — exact copy of the billing-time receipt (ThermalReceipt) */}
              <div className="lg:col-span-5 bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs flex flex-col overflow-hidden lg:h-full lg:min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Live Receipt Preview</h3>
                  <div className="flex gap-2">
                    <button type="button" onClick={handlePrintTestReceipt} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--brand-color)] text-white text-[10px] font-bold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer"><Printer className="w-3 h-3" />Print</button>
                  </div>
                </div>
                <div className="bg-gray-100 rounded-xl p-4 flex justify-center shadow-inner overflow-y-auto flex-1 min-h-0">
                  <ThermalReceipt bill={previewBill} settings={previewSettings} />
                </div>
                <p className="text-[9px] text-gray-400 mt-3 text-center shrink-0">This is the exact receipt used at billing time — the toggles above update it live.</p>
              </div>
            </div>
          )}

          {/* ── KITCHEN ── */}
          {activeTab === 'kitchen' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
              <div className="lg:col-span-7 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">KOT Layout</h3>
                    <span className="ml-auto text-[9px] text-gray-400">Toggle what prints on the ticket</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {[
                      { icon: <ListFilter className="w-3.5 h-3.5" />, label: 'Print Category Headers', value: printCategoryHeaders, set: setPrintCategoryHeaders, hint: 'Show category dividers' },
                      { icon: <SlidersHorizontal className="w-3.5 h-3.5" />, label: 'Show Item Modifiers', value: showItemModifiers, set: setShowItemModifiers, hint: 'Variants & notes' },
                      { icon: <Clock className="w-3.5 h-3.5" />, label: 'Show Order Time', value: showOrderTime, set: setShowOrderTime, hint: 'Print time on ticket' },
                      { icon: <Layers className="w-3.5 h-3.5" />, label: 'Show Table Number', value: showTableNumber, set: setShowTableNumber, hint: 'Table on order line' },
                      { icon: <Combine className="w-3.5 h-3.5" />, label: 'Group Items in KOT', value: groupItemsInKOT, set: setGroupItemsInKOT, hint: 'Group same-category items' },
                      { icon: <Bell className="w-3.5 h-3.5" />, label: 'Quick Sound Alerts', value: moduleSettings.enableQuickSoundAlerts ?? false, set: () => toggleModule('enableQuickSoundAlerts'), hint: 'Beep when a new kitchen ticket arrives' },
                    ].map((t) => (
                      <div key={t.label} className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl hover:bg-gray-50">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[var(--brand-color)] shrink-0">{t.icon}</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{t.label}</p>
                            <p className="text-[8.5px] text-gray-400 truncate">{t.hint}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => t.set(!t.value)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${t.value ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                          <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">KOT Footer Note</label>
                    <input type="text" value={kotFooterNote} onChange={(e) => setKotFooterNote(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" placeholder="Cook with passion!" />
                  </div>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">KOT Output Mode</h3>
                    <span className="ml-auto text-[9px] text-gray-400">Where kitchen tickets go</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'print' as const, icon: <Printer className="w-4 h-4" />, label: 'Print Only', desc: 'Paper ticket' },
                      { value: 'kds' as const, icon: <Monitor className="w-4 h-4" />, label: 'KDS Only', desc: 'Kitchen screen' },
                      { value: 'both' as const, icon: <Layers className="w-4 h-4" />, label: 'Both', desc: 'Print + screen' },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleKotOutputModeChange(opt.value)}
                        className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl font-bold text-xs transition-all cursor-pointer border-2 ${kotOutputMode === opt.value ? 'bg-[var(--brand-color)]/10 text-[var(--brand-color)] border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] text-gray-500 border-[var(--color-border-default)] hover:border-[var(--brand-color)]/40 hover:text-gray-700'}`}
                      >
                        <span className={kotOutputMode === opt.value ? 'text-[var(--brand-color)]' : 'text-gray-400'}>{opt.icon}</span>
                        <span>{opt.label}</span>
                        <span className={`text-[8.5px] font-semibold ${kotOutputMode === opt.value ? 'text-[var(--brand-color)]/70' : 'text-gray-400'}`}>{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-gray-400">Print modes also switch on Auto Print KOT (Modules tab) so new tickets reach the printer automatically. Manual reprints always go to the printer.</p>
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Online Order KOT</h3>
                    <span className="ml-auto text-[9px] text-gray-400">How website &amp; QR orders reach the kitchen</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl hover:bg-gray-50">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="w-3.5 h-3.5 text-[var(--brand-color)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-gray-800 truncate">Auto-send to kitchen</p>
                        <p className="text-[8.5px] text-gray-400 truncate">Fire the KOT as soon as the order is placed</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setAutoKotOnlineOrders(!autoKotOnlineOrders)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${autoKotOnlineOrders ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                      <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${autoKotOnlineOrders ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                  {!autoKotOnlineOrders && (
                    <p className="text-[9px] text-gray-400 bg-[var(--brand-color)]/5 border border-[var(--brand-color)]/10 rounded-lg px-3 py-2">
                      Off: the order arrives in <b>Orders</b> without a KOT. Open it in the billing workspace to review the items, then press <b>KOT</b> to send it to the kitchen.
                    </p>
                  )}
                </div>

                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Printer Routing Rules</h3>
                    <p className="text-[9px] text-gray-400 ml-auto">Destinations come from the Printer registry</p>
                  </div>
                  {routingRules.length === 0 && <p className="text-[10px] text-gray-400">No routing rules — add one below to route categories to specific printers.</p>}
                  {routingRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2 border border-[var(--color-border-default)] rounded-xl p-2">
                      <select value={rule.categoryGroup} onChange={(e) => setRoutingRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, categoryGroup: e.target.value } : r)))} className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--color-border-input)] text-[10px] font-semibold bg-[var(--color-bg-white)]">
                        {['Food (All)', 'Drinks & Beverages', 'Desserts', 'Appetizers', 'Pizza Station', 'Bakery'].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <select value={rule.destinationPrinter} onChange={(e) => setRoutingRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, destinationPrinter: e.target.value } : r)))} className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--color-border-input)] text-[10px] font-semibold bg-[var(--color-bg-white)]">
                        {printers.length === 0 && <option value="">No printers configured</option>}
                        {printers.filter((p) => p.enabled).map((p) => <option key={p._id} value={p.name}>{p.name} ({p.connection.host || p.connection.address || p.connection.kind})</option>)}
                      </select>
                      <button type="button" onClick={() => setRoutingRules((rs) => rs.filter((r) => r.id !== rule.id))} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRoutingRules((rs) => [...rs, { id: `rule_${Date.now()}`, categoryGroup: 'Food (All)', destinationPrinter: printers.find((p) => p.enabled)?.name || '' }])} className="w-full py-2 border border-dashed border-[var(--color-border-input)] text-[var(--brand-color)] rounded-xl font-bold text-xs cursor-pointer">+ Add Routing Rule</button>
                </div>
              </div>

              {/* Live KOT preview — exact copy of the printed kitchen ticket (ThermalKOT) */}
              <div className="lg:col-span-5 bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs flex flex-col overflow-hidden lg:h-full lg:min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Live KOT Preview</h3>
                  <button type="button" onClick={handlePrintTestKOT} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--brand-color)] text-white text-[10px] font-bold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer"><Printer className="w-3 h-3" />Print KOT</button>
                </div>
                <div className="bg-gray-100 rounded-xl p-4 flex justify-center shadow-inner overflow-auto flex-1 min-h-0">
                  <ThermalKOT
                    order={previewKotOrder}
                    kot={previewKot}
                    settings={previewKotSettings}
                    className="bg-[var(--color-bg-white)] border-2 border-dashed border-gray-300 rounded-lg p-4 shadow-sm"
                  />
                </div>
                <p className="text-[9px] text-gray-400 mt-3 text-center shrink-0">This is the exact KOT sent to the kitchen — the toggles update it live.</p>
              </div>
            </div>
          )}

          {/* ── MODULES ── */}
          {activeTab === 'modules' && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Modules & Features</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {Object.entries(moduleSettings)
                  .filter(([, value]) => typeof value === 'boolean')
                  .map(([key, value]) => {
                  const locked = planLockedModules.has(key);
                  const effValue = locked ? false : value;
                  const moduleInfo = MODULE_INFO[key];
                  const moduleLabel = moduleInfo?.label || key.replace(/^enable/, '').replace(/([A-Z])/g, ' $1').trim();
                  return (
                    <div key={key} className={`flex justify-between items-center py-2 px-3 rounded-xl ${locked ? 'bg-gray-50 opacity-70' : 'hover:bg-gray-50'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs font-bold capitalize ${locked ? 'text-gray-400' : 'text-gray-700'}`}>{moduleLabel}</p>
                          {moduleInfo && (
                            <span className="relative group inline-flex">
                              <Info className="w-3.5 h-3.5 text-gray-400 group-hover:text-[var(--brand-color)] cursor-pointer transition-colors" aria-label={`What does ${moduleLabel} do?`} />
                              <span className="hidden group-hover:block absolute z-50 left-0 top-5 w-64 rounded-lg bg-gray-900 text-white text-[10px] leading-relaxed p-2.5 shadow-lg pointer-events-none">
                                <span className="block font-bold text-[10px] mb-0.5">{moduleLabel}</span>
                                {moduleInfo.desc}
                              </span>
                            </span>
                          )}
                        </div>
                        {locked && <p className="text-[9px] text-amber-600 font-semibold">Locked — not included in your plan</p>}
                      </div>
                      <button type="button" disabled={locked} onClick={() => toggleModule(key as keyof ModuleSettings)} title={locked ? 'Not included in your subscription plan' : undefined} className={`w-11 h-6 rounded-full transition-colors relative ${locked ? 'cursor-not-allowed bg-gray-200' : 'cursor-pointer'} ${effValue ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                        <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${effValue ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {planFeatures.length > 0 && (
                <p className="text-[9px] text-gray-400 pt-1">Modules marked <span className="text-amber-600 font-bold">Locked</span> are excluded from your subscription plan and cannot be enabled.</p>
              )}

              {/* Customer call reminder interval (number setting, not a toggle). */}
              <div className="border-t border-gray-100 pt-4 mt-1">
                <div className="flex items-center gap-2 pb-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Customer Call Reminders</h3>
                </div>
                <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                  Re-notify unacknowledged calls / online orders every
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={moduleSettings.callReminderIntervalSec ?? 15}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(3600, Math.round(Number(e.target.value) || 0)));
                      setModuleSettings((p) => ({ ...p, callReminderIntervalSec: v }));
                    }}
                    className="w-24 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold"
                  />
                  <span className="text-xs font-bold text-gray-500">seconds</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-1.5">
                  When a customer call or online order stays unacknowledged, the POS rings again after this
                  interval (sound + toast). Set to 0 to disable reminders. Applies to the Calls panel.
                </p>
              </div>

              {/* QR table session timeout */}
              <div className="border-t border-gray-100 pt-4 mt-1">
                <div className="flex items-center gap-2 pb-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">QR Table Session</h3>
                </div>
                <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                  Auto-expire QR session after (no order placed)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={moduleSettings.qrSessionTimeoutMinutes ?? 30}
                    onChange={(e) => {
                      const v = Math.max(5, Math.min(120, Math.round(Number(e.target.value) || 30)));
                      setModuleSettings((p) => ({ ...p, qrSessionTimeoutMinutes: v }));
                    }}
                    className="w-24 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold"
                  />
                  <span className="text-xs font-bold text-gray-500">minutes</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-1.5">
                  When a customer scans a table QR but doesn't place an order, the session auto-expires after this
                  duration and the table becomes available again. Once an order is placed, the session is permanent.
                </p>
              </div>
            </div>
          )}

          {/* ── ROLES ── */}
          {activeTab === 'roles' && (
            <RolePermissionsTab rolePermissions={rolePermissions} onToggle={toggleRolePermission} onApplyPreset={applyRolePreset} moduleSettings={moduleSettings} subscriptionFeatures={subscriptionFeatures} />
          )}

          {/* ── PRINTERS ── */}
          {activeTab === 'printers' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Registered Printers</h3>
                  <span className="ml-auto text-[9px] text-gray-400">{printers.length} active</span>
                </div>
                {printers.length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No printers registered. Add your first printer to enable routing & printing.</p>}
                {printers.map((p) => (
                  <div key={p._id} className="flex items-center gap-3 border border-[var(--color-border-default)] rounded-xl p-3">
                    <div className={`p-2.5 rounded-xl ${p.healthStatus === 'online' ? 'bg-emerald-50 text-emerald-600' : p.healthStatus === 'offline' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                      <Printer className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        {p.name}
                        {p.isDefault && <span className="px-1.5 py-0.5 rounded bg-[var(--brand-color)] text-white text-[8px] font-black">DEFAULT</span>}
                        {!p.enabled && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[8px] font-black">DISABLED</span>}
                      </p>
                      <p className="text-[9px] text-gray-400 capitalize">{p.type} · {p.connection.host || p.connection.address || p.connection.kind}{p.connection.port ? `:${p.connection.port}` : ''} · {p.paperSize}</p>
                      {printerTestMsg[p._id] && <p className={`text-[9px] font-bold mt-1 ${p.healthStatus === 'online' ? 'text-emerald-600' : p.healthStatus === 'offline' ? 'text-red-500' : 'text-gray-500'}`}>{printerTestMsg[p._id]}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => handleTestPrinter(p._id)} disabled={!!testingPrinterId} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-[var(--brand-color)] hover:bg-blue-50 cursor-pointer" title="Test connection">
                        {testingPrinterId === p._id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TestTube2 className="w-3.5 h-3.5" />}
                      </button>
                      <button type="button" onClick={() => handleEditPrinter(p)} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-600 hover:bg-gray-50 cursor-pointer" title="Edit"><Settings2 className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => handleDeletePrinter(p._id)} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-red-500 hover:bg-red-50 cursor-pointer" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">{editingPrinterId ? 'Edit Printer' : 'Add Printer'}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Name</label><input type="text" value={printerForm.name} onChange={(e) => setPrinterForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" placeholder="Kitchen Printer" /></div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Type</label>
                    <select value={printerForm.type} onChange={(e) => setPrinterForm((p) => ({ ...p, type: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold bg-[var(--color-bg-white)]">
                      {['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth'].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Connection</label>
                    <select value={printerForm.kind} onChange={(e) => setPrinterForm((p) => ({ ...p, kind: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold bg-[var(--color-bg-white)]">
                      {['network', 'usb', 'bluetooth'].map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
                    </select>
                  </div>
                  {printerForm.kind === 'network' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Host / IP</label><input type="text" value={printerForm.host} onChange={(e) => setPrinterForm((p) => ({ ...p, host: e.target.value }))} placeholder="192.168.1.42" className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                      <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Port</label><input type="number" value={printerForm.port} onChange={(e) => setPrinterForm((p) => ({ ...p, port: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                    </div>
                  ) : (
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Device Address</label><input type="text" value={printerForm.address} onChange={(e) => setPrinterForm((p) => ({ ...p, address: e.target.value }))} placeholder={printerForm.kind === 'bluetooth' ? 'Bluetooth MAC' : 'USB port / VID:PID'} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                  )}
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Paper Size</label>
                    <select value={printerForm.paperSize} onChange={(e) => setPrinterForm((p) => ({ ...p, paperSize: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold bg-[var(--color-bg-white)]">
                      <option value="80mm">80mm</option><option value="58mm">58mm</option>
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Copies</label><input type="number" min={1} max={10} value={printerForm.copies} onChange={(e) => setPrinterForm((p) => ({ ...p, copies: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <button type="button" onClick={() => setPrinterForm((p) => ({ ...p, isDefault: !p.isDefault }))} className={`w-11 h-6 rounded-full transition-colors relative ${printerForm.isDefault ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${printerForm.isDefault ? 'left-6' : 'left-1'}`} />
                  </button>
                  <span className="text-[10px] font-bold text-gray-700">Set as default printer</span>
                </label>
                <button type="button" onClick={handleAddPrinter} className="w-full py-2.5 rounded-xl bg-[var(--brand-color)] text-white font-bold text-xs hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer">
                  {editingPrinterId ? 'Save Printer' : 'Register Printer'}
                </button>
                {editingPrinterId && (
                  <button type="button" onClick={() => { setEditingPrinterId(null); setPrinterForm({ name: '', type: 'kitchen', kind: 'network', host: '', port: '9100', address: '', paperSize: '80mm', copies: 1, isDefault: false }); }} className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs cursor-pointer">Cancel Edit</button>
                )}
              </div>
            </div>
          )}



          {/* ── THEME ── */}
          {activeTab === 'theme' && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Theme</h3>
              </div>
              <div className="flex gap-3">
                {(['dark', 'light', 'system'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setTheme((p) => ({ ...p, mode: m }))} className={`flex-1 py-3 rounded-xl border-2 font-bold text-xs capitalize cursor-pointer flex items-center justify-center gap-2 ${theme.mode === m ? 'border-[var(--brand-color)] bg-blue-50 text-[var(--brand-color)]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {m === 'dark' ? <Moon className="w-4 h-4" /> : m === 'light' ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}{m}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Brand Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={theme.brandColor || '#004ac6'} onChange={(e) => setTheme((p) => ({ ...p, brandColor: e.target.value }))} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={theme.brandColor || ''} onChange={(e) => setTheme((p) => ({ ...p, brandColor: e.target.value }))} className="flex-1 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-mono font-semibold" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Accent Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={theme.accentColor || '#10b981'} onChange={(e) => setTheme((p) => ({ ...p, accentColor: e.target.value }))} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={theme.accentColor || ''} onChange={(e) => setTheme((p) => ({ ...p, accentColor: e.target.value }))} className="flex-1 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-mono font-semibold" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Density</label>
                  <select value={theme.density || 'comfortable'} onChange={(e) => setTheme((p) => ({ ...p, density: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold bg-[var(--color-bg-white)]">
                    <option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="spacious">Spacious</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Border Radius (px)</label>
                  <input type="number" min={0} max={32} value={theme.borderRadius ?? 12} onChange={(e) => setTheme((p) => ({ ...p, borderRadius: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" />
                </div>
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {activeTab === 'notifications' && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Notifications</h3>
              </div>
              <div className="space-y-3">
                {NOTIFICATION_EVENTS.map((ev) => {
                  const val = notifications[ev.key];
                  const isOn = val === undefined ? true : !!val;
                  return (
                    <div key={ev.key} className="flex justify-between items-center py-2 border-b border-gray-50">
                      <div><p className="text-xs font-bold text-gray-900">{ev.label}</p><p className="text-[9px] text-gray-400">{ev.desc}</p></div>
                      <button type="button" onClick={() => setNotifications((p) => ({ ...p, [ev.key]: !isOn }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${isOn ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                        <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${isOn ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-2">Delivery Channels</label>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map((ch) => {
                    const list = notifications.channels || ['desktop'];
                    const active = list.includes(ch);
                    return (
                      <button key={ch} type="button" onClick={() => setNotifications((p) => ({ ...p, channels: active ? list.filter((c) => c !== ch) : [...list, ch] }))} className={`px-3 py-1.5 rounded-xl font-bold text-[10px] capitalize transition-all cursor-pointer ${active ? 'bg-[var(--brand-color)] text-white' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]'}`}>{ch}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Webhook URL (for webhook channel)</label>
                <input type="url" value={notifications.webhookUrl || ''} onChange={(e) => setNotifications((p) => ({ ...p, webhookUrl: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" placeholder="https://hooks.example.com/pos-events" />
              </div>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'security' && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Security Policy</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Min Password Length</label><input type="number" min={6} max={32} value={security.passwordMinLength ?? 8} onChange={(e) => setSecurity((p) => ({ ...p, passwordMinLength: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Session Timeout (minutes)</label><input type="number" min={5} value={security.sessionTimeoutMinutes ?? 60} onChange={(e) => setSecurity((p) => ({ ...p, sessionTimeoutMinutes: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Failed Login Lock Threshold</label><input type="number" min={3} value={security.failedLoginLockThreshold ?? 5} onChange={(e) => setSecurity((p) => ({ ...p, failedLoginLockThreshold: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">PIN Min Length</label><input type="number" min={4} value={security.pinPolicy?.minLength ?? 4} onChange={(e) => setSecurity((p) => ({ ...p, pinPolicy: { ...(p.pinPolicy || {}), minLength: Number(e.target.value) } }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold" /></div>
              </div>
              <div className="space-y-2">
                {[
                  { key: 'autoLogout', label: 'Auto Logout on Session Timeout', value: !!security.autoLogout },
                  { key: 'twoFactorEnabled', label: 'Two-Factor Authentication (Owner login)', value: !!security.twoFactorEnabled },
                ].map((t) => (
                  <div key={t.key} className="flex justify-between items-center py-2 border-b border-gray-50">
                    <p className="text-xs font-bold text-gray-900">{t.label}</p>
                    <button type="button" onClick={() => setSecurity((p) => ({ ...p, [t.key]: !p[t.key] }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${t.value ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}>
                      <div className={`w-4 h-4 bg-[var(--color-bg-white)] rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                ))}
              </div>

              {/* ── POS Sign-in Method ── */}
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2 pb-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">POS Sign-in Method</h3>
                </div>
                <p className="text-[9px] text-gray-400 mb-3">Controls how staff sign in each time the terminal requests a login (at start, after logout, or after an idle auto-lock).</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { v: 'password', label: 'User ID + Password', desc: 'Admin-generated User ID + password', icon: KeyRound },
                    { v: 'role_pin', label: 'Role + PIN', desc: 'Pick Owner/Manager/Cashier, then 4-digit PIN', icon: Keyboard },
                    { v: 'pin', label: 'PIN only', desc: 'Enter PIN; role auto-detected', icon: Lock },
                    { v: 'tap_only', label: 'Tap to open', desc: 'No verification — tap a staff name', icon: Clock },
                  ] as Array<{ v: NonNullable<SystemSettings['security']>['loginMethod']; label: string; desc: string; icon: React.ElementType }>).map((opt) => {
                    const selected = (security.loginMethod || 'password') === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setSecurity((p) => ({ ...p, loginMethod: opt.v }))}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${selected ? 'border-[var(--brand-color)] bg-blue-50 shadow-md' : 'border-gray-200 bg-[var(--color-bg-white)] hover:border-gray-300 hover:bg-gray-50'}`}
                      >
                        <opt.icon className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? 'text-[var(--brand-color)]' : 'text-gray-400'}`} />
                        <div>
                          <p className={`text-[11px] font-bold ${selected ? 'text-[var(--brand-color)]' : 'text-gray-800'}`}>{opt.label}</p>
                          <p className="text-[9px] text-gray-400 mt-0.5">{opt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Auto-Lock Idle Timeout</label>
                  <div className="flex flex-wrap gap-2">
                    {([0, 1, 5, 10, 15] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSecurity((p) => ({ ...p, autoLockMinutes: m }))}
                        className={`px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${(security.autoLockMinutes ?? 0) === m ? 'bg-[var(--brand-color)] text-white' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]'}`}
                      >
                        {m === 0 ? 'Off' : `${m} min`}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[9px] text-gray-400 mt-2">After the idle timeout, the terminal locks and asks for the selected sign-in method to resume. Set to Off to only require login at boot/logout.</p>
              </div>

              <p className="text-[9px] text-gray-400">These policy values are stored server-side and read by the POS. Two-Factor Authentication and session-timeout enforcement are planned for a follow-up phase — the values are persisted now so the POS can enforce them once wired.</p>
            </div>
          )}

          {/* ── BACKUP ── */}
          {activeTab === 'backup' && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Backup & Restore</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button type="button" onClick={handleExportBackup} className="p-5 rounded-2xl border-2 border-dashed border-[var(--brand-color)] text-[var(--brand-color)] hover:bg-blue-50 transition-colors cursor-pointer text-left">
                  <Cloud className="w-6 h-6 mb-2" />
                  <p className="font-bold text-sm">Export Backup</p>
                  <p className="text-[10px] text-gray-400 mt-1">Download settings + configuration as a JSON file</p>
                </button>
                <label className="p-5 rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 hover:border-[var(--brand-color)] hover:bg-gray-50 transition-colors cursor-pointer text-left">
                  <Database className="w-6 h-6 mb-2" />
                  <p className="font-bold text-sm">Restore Backup</p>
                  <p className="text-[10px] text-gray-400 mt-1">Upload a previously exported backup file</p>
                  <input type="file" accept=".json,application/json" className="hidden" onChange={handleRestoreBackup} />
                </label>
              </div>
              <p className="text-[9px] text-gray-400">Backups include restaurant settings, receipt configuration, printer routing, modules and roles. Server data (bills, products, customers) is always available from the backend — this export covers POS configuration for offline/device migration.</p>
            </div>
          )}

          {/* ── HISTORY & AUDIT ── */}
          {activeTab === 'history' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Version History</h3>
                  <span className="ml-auto text-[9px] text-gray-400">current v{history?.settingsVersion ?? '—'}</span>
                </div>
                {(history?.history || []).length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No prior versions yet.</p>}
                {(history?.history || []).map((h: any) => (
                  <div key={h.version} className="flex items-center justify-between border border-[var(--color-border-default)] rounded-xl px-3 py-2">
                    <div>
                      <p className="text-xs font-bold text-gray-900">Version {h.version}</p>
                      <p className="text-[9px] text-gray-400">{h.changeReason || 'Configuration change'} · {h.updatedBy} · {new Date(h.updatedAt).toLocaleString()}</p>
                    </div>
                    <button type="button" onClick={async () => { const ok = await serverSettings.rollback(h.version, `Rolled back from Settings`); if (ok) { showToast(`Rolled back to version ${h.version}`); await loadHistory(); } }} className="px-3 py-1.5 rounded-lg border border-[var(--brand-color)] text-[var(--brand-color)] text-[10px] font-bold hover:bg-blue-50 cursor-pointer">Rollback</button>
                  </div>
                ))}
              </div>
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Audit Trail</h3>
                  <span className="ml-auto text-[9px] text-gray-400">{audit?.total ?? 0} entries</span>
                </div>
                {(audit?.data || []).length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No settings audit entries yet.</p>}
                {(audit?.data || []).map((a: any) => (
                  <div key={a.id} className="border border-[var(--color-border-default)] rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-gray-900">{a.action.replace(/_/g, ' ')}</p>
                      <p className="text-[9px] text-gray-400">{new Date(a.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-0.5">by {a.performedBy}{a.ipAddress ? ` · ${a.ipAddress}` : ''}</p>
                    {a.details?.changedKeys?.length > 0 && (
                      <p className="text-[9px] text-[var(--brand-color)] mt-1 font-bold">Changed: {a.details.changedKeys.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SUBSCRIPTION ── */}
          {activeTab === 'subscription' && (
            <SubscriptionSettings />
          )}

          {/* ── LEGAL & COMPLIANCE ── */}
          {activeTab === 'legal' && (
            <LegalComplianceTab isOwner={isOwner} />
          )}

          {/* ── HELP & FAQ ── */}
          {activeTab === 'help' && (
            <HelpFaqTab />
          )}
        </div>

        {/* Footer actions — hidden for legal/help tabs (they save directly to the backend) */}
        {activeTab !== 'legal' && activeTab !== 'help' && (
        <div className="flex items-center justify-between gap-3 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-2xl p-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Info className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Change reason (recorded in audit log) — e.g. Updated GST rate for new financial year"
              className="flex-1 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] min-w-0"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={handleDiscardChanges} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs hover:bg-gray-50 transition-colors cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" />Discard
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[var(--brand-color)] text-white font-bold text-xs hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save & Sync'}
            </button>
          </div>
        </div>
        )}
      </form>

      {localToast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-bold shadow-lg z-50">
          {localToast}
        </div>
      )}
    </div>
  );
}

// Helper to read a boolean flag from the receipt template without TS complaints
function p0(obj: any, key: string): boolean {
  return !!obj?.[key];
}
// Helper to read an enabled flag from integrations
function p1(obj: any, key: string): boolean {
  return !!(obj?.[key]?.enabled);
}

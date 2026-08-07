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
  Utensils, User, Check, Save, X, Upload, QrCode, Layers, Shield, Brain, Cloud,
  Moon, Sun, Monitor, Keyboard, Bell, Lock, Database, Plug, History, RefreshCw,
  AlertTriangle, CreditCard, Palette, Settings2, ScrollText, TestTube2,
  Image as ImageIcon, Award, Coins, Clock, ListFilter, SlidersHorizontal,
  ArrowDownUp, BadgePercent, ReceiptText, Combine,
} from 'lucide-react';
import type { SystemSettings, VisitMilestone, RolePermissions, ModuleSettings, Bill, Order, KOTRecord } from '../src/types';
import ThermalReceipt from './ThermalReceipt';
import ThermalKOT from './ThermalKOT';
import { printKOT } from '../src/utils/printKOT';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/types';
import RolePermissionsTab from './RolePermissionsTab';
import SubscriptionSettings from './SubscriptionSettings';
import {
  fetchPrinters, createPrinter, updatePrinter, deletePrinter, testPrinter,
  fetchSettingsAudit, type PrinterRecord,
} from '../src/api/client';
import { useServerSettings, getDeviceId, type ServerSettingsApi } from '../src/hooks/useServerSettings';

interface SettingsManagerProps {
  settings: SystemSettings;
  onUpdateSettings: (updated: SystemSettings) => void;
  currentBranchId?: string | null;
  /** Subscription plan feature keys — forwarded to the Role Permissions live preview. */
  subscriptionFeatures?: string[];
}

type TabId =
  | 'billing' | 'kitchen' | 'modules' | 'roles' | 'printers' | 'receipt'
  | 'theme' | 'shortcuts' | 'notifications' | 'security' | 'backup'
  | 'ai' | 'integrations' | 'history' | 'subscription';

const DEFAULT_MODULES: ModuleSettings = {
  enableTableService: true, enableWaiterManagement: true, enableReservations: false,
  enableQROrdering: false, enableDeliveryModule: true, enableOnlineOrders: true,
  enableKitchenDisplay: true, enableLoyalty: true, showImagesInBilling: true,
  showCashierPerformance: true, enableMultiBranch: false, enableOffersPopup: true,
  enableAutoPrintKOT: false, enableQuickSoundAlerts: false, showItemCodeOnCard: false,
  enableGuestCheckout: true, enableOrderNotes: true, enableTakeawayModule: true,
  enableDineInModule: true, enableExpenseManagement: true, enableDiscountOnBilling: false,
  enableAISummary: true, enableAIInventoryHealth: true, enableAIPurchaseRecs: true,
  enableAILowStock: true, enableAIWasteAnalysis: true, enableAIVoiceEntry: true,
  enableAIWeather: true, enableAIClosingAssistant: true,
};

const DEFAULT_SHORTCUTS: Record<string, string> = {
  'New Order': 'Alt+N',
  'Checkout / Pay': 'Ctrl+Enter',
  'Search Items': 'Ctrl+K',
  'Hold Order': 'Ctrl+H',
  'Open Orders': 'Ctrl+O',
  'Open Settings': 'Ctrl+,',
  'Print KOT': 'Ctrl+P',
  'Toggle Kitchen Display': 'F9',
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

export default function SettingsManager({ settings, onUpdateSettings, currentBranchId, subscriptionFeatures }: SettingsManagerProps) {
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
  const [taxRate, setTaxRate] = useState<number>(settings.defaultTaxRate ?? 5);
  const [taxPresets, setTaxPresets] = useState<number[]>([5, 12, 18]);
  const [isAddingTaxPreset, setIsAddingTaxPreset] = useState(false);
  const [newTaxPresetValue, setNewTaxPresetValue] = useState('');
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

  // ─── KOT & kitchen state ──
  const [printCategoryHeaders, setPrintCategoryHeaders] = useState(settings.printCategoryHeaders ?? true);
  const [showItemModifiers, setShowItemModifiers] = useState(settings.showItemModifiers ?? true);
  const [showOrderTime, setShowOrderTime] = useState(settings.showOrderTime ?? true);
  const [showTableNumber, setShowTableNumber] = useState(settings.showTableNumber ?? true);
  const [groupItemsInKOT, setGroupItemsInKOT] = useState(settings.groupItemsInKOT ?? true);
  const [kotFooterNote, setKotFooterNote] = useState(settings.kotFooterNote ?? 'Cook with passion!');
  const [routingRules, setRoutingRules] = useState<Array<{ id: string; categoryGroup: string; destinationPrinter: string }>>(
    settings.printerRoutingRules ?? []
  );

  // ─── Modules / roles ──
  const [moduleSettings, setModuleSettings] = useState<ModuleSettings>({ ...DEFAULT_MODULES, ...(settings.moduleSettings || {}) });
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({ ...DEFAULT_ROLE_PERMISSIONS, ...(settings.rolePermissions || {}) });

  // ─── Phase 1.9 sections ──
  const [receiptTemplate, setReceiptTemplate] = useState<NonNullable<SystemSettings['receiptTemplate']>>(settings.receiptTemplate || { header: '', footer: '', watermark: '', showGstin: true, showFssai: true, fssai: '', customFields: [] });
  const [theme, setTheme] = useState<NonNullable<SystemSettings['theme']>>(settings.theme || { mode: 'system', brandColor: settings.brandingColor || '#004ac6', accentColor: '#10b981', density: 'comfortable', borderRadius: 12 });
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({ ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) });
  const [newShortcutAction, setNewShortcutAction] = useState('');
  const [newShortcutKey, setNewShortcutKey] = useState('');
  const [notifications, setNotifications] = useState<NonNullable<SystemSettings['notifications']>>(settings.notifications || { lowStock: true, orders: true, sales: false, backups: true, printerErrors: true, syncFailures: true, employeeAlerts: false, channels: ['desktop'] });
  const [security, setSecurity] = useState<NonNullable<SystemSettings['security']>>(settings.security || { passwordMinLength: 8, sessionTimeoutMinutes: 60, autoLogout: true, failedLoginLockThreshold: 5, twoFactorEnabled: false });
  const [ai, setAi] = useState<NonNullable<SystemSettings['ai']>>(settings.ai || { enabled: true, dailyLimit: 100, model: 'llama-3.3-70b-versatile' });
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
    if (theme.mode === 'dark') root.classList.add('pos-dark');
    else if (theme.mode === 'light') root.classList.remove('pos-dark');
    else root.classList.remove('pos-dark');
  }, [theme]);

  const toggleModule = (key: keyof ModuleSettings) => setModuleSettings((p) => ({ ...p, [key]: !p[key] }));
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
      defaultTaxRate: Number(taxRate),
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
      printerRoutingRules: routingRules,
      roundOffTotal: roundOffTotal,
      showTaxSummaryOnReceipt: showTaxSummary,
      receiptFooterMessage: receiptFooterMessage.trim(),
      receiptFooterImageUrl: receiptFooterImageUrl.trim(),
      moduleSettings,
      rolePermissions,
      receiptTemplate,
      theme,
      shortcuts,
      notifications,
      security,
      ai,
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
    setTaxRate(settings.defaultTaxRate ?? 5);
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
    setPrintCategoryHeaders(settings.printCategoryHeaders ?? true);
    setShowItemModifiers(settings.showItemModifiers ?? true);
    setShowOrderTime(settings.showOrderTime ?? true);
    setShowTableNumber(settings.showTableNumber ?? true);
    setModuleSettings({ ...DEFAULT_MODULES, ...(settings.moduleSettings || {}) });
    setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...(settings.rolePermissions || {}) });
    setTheme(settings.theme || { mode: 'system', brandColor: settings.brandingColor || '#004ac6', accentColor: '#10b981', density: 'comfortable', borderRadius: 12 });
    setShortcuts({ ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) });
    setNotifications(settings.notifications || { channels: ['desktop'] });
    setSecurity(settings.security || { passwordMinLength: 8, sessionTimeoutMinutes: 60, autoLogout: true, failedLoginLockThreshold: 5, twoFactorEnabled: false });
    setAi(settings.ai || { enabled: true, dailyLimit: 100, model: 'llama-3.3-70b-versatile' });
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

  // ─── Shortcuts helpers ──
  const addShortcut = () => {
    if (!newShortcutAction.trim() || !newShortcutKey.trim()) return;
    const clash = Object.entries(shortcuts).find(([action, key]) => key === newShortcutKey.trim() && action !== newShortcutAction.trim());
    if (clash) { showToast(`Shortcut conflict: "${newShortcutKey}" is already used by "${clash[0]}"`); return; }
    setShortcuts((p) => ({ ...p, [newShortcutAction.trim()]: newShortcutKey.trim() }));
    setNewShortcutAction(''); setNewShortcutKey('');
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
  const previewTaxRate = Number(taxRate) || 5;
  const previewItemGst = previewTaxRate === 5 ? 5 : previewTaxRate;
  const previewSubtotal = 2900;
  const previewDiscount = 300; // real discount on the bill; the toggle only hides the printed line
  const previewTaxable = previewSubtotal - previewDiscount;
  const previewGst = parseFloat(((previewTaxable * previewTaxRate) / 100).toFixed(2));
  const previewGrandTotal = parseFloat((previewTaxable + previewGst).toFixed(2));

  const previewBill: Bill = {
    id: 'settings-preview',
    invoiceNumber: `${invoicePrefix}${invoiceStartingNumber}${invoiceSuffix}`,
    ticketNumber: 'T-0081',
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date().toISOString(),
    cashierName: 'Sarah',
    cashierRole: 'Cashier',
    items: [
      { id: 'p1', product: { id: 'p1', name: 'Truffle Risotto', price: 1200, category: 'Main Courses', image: '', gstPercent: previewItemGst, availability: true, code: 'TR001' }, quantity: 1, price: 1200 },
      { id: 'p2', product: { id: 'p2', name: 'Margherita Pizza', price: 750, category: 'Pizza Station', image: '', gstPercent: previewItemGst, availability: true, code: 'MP002' }, quantity: 2, price: 750, notes: 'Extra cheese' },
      { id: 'p3', product: { id: 'p3', name: 'Mango Lassi', price: 200, category: 'Beverages', image: '', gstPercent: previewItemGst, availability: true, code: 'ML003' }, quantity: 1, price: 200, selectedVariant: { name: 'Large', price: 200 } },
    ],
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
  };

  // Staged settings — so the preview reflects unsaved changes live
  const previewSettings: SystemSettings = {
    ...settings,
    restaurantName: restName,
    address,
    phone,
    gstin,
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
    const splitTax = previewGst / 2;
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

    printContent(`
      <div class="text-center"><div class="border-b" style="margin:6px 0;"></div>
        ${printLogoOnReceipt && safeLogoUrl ? `<img src="${safeLogoUrl}" />` : ''}
        <h3 class="font-bold" style="text-transform:uppercase;">${restName || 'RESTAURANT NAME'}</h3>
        <p style="margin:2px 0;">${address}</p><p style="margin:2px 0;">${phone}</p>
        <p class="font-bold" style="margin:2px 0;">GSTIN: ${gstin || '—'}</p>
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
      ${showTaxSummary && previewGst > 0 ? `
      <div class="flex justify-between" style="font-size:9px;"><span>CGST (${previewTaxRate / 2}%):</span><span>${sym}${splitTax.toFixed(2)}</span></div>
      <div class="flex justify-between" style="font-size:9px;"><span>SGST (${previewTaxRate / 2}%):</span><span>${sym}${splitTax.toFixed(2)}</span></div>` : ''}
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
    { id: 'receipt', label: 'RECEIPT TEMPLATE', icon: ScrollText },
    { id: 'theme', label: 'THEME', icon: Palette },
    { id: 'shortcuts', label: 'SHORTCUTS', icon: Keyboard },
    { id: 'notifications', label: 'NOTIFICATIONS', icon: Bell },
    { id: 'security', label: 'SECURITY', icon: Lock },
    { id: 'backup', label: 'BACKUP & RESTORE', icon: Database },
    { id: 'ai', label: 'AI SETTINGS', icon: Brain },
    { id: 'integrations', label: 'INTEGRATIONS', icon: Plug },
    { id: 'history', label: 'HISTORY & AUDIT', icon: History },
    { id: 'subscription', label: 'SUBSCRIPTION', icon: CreditCard },
  ];

  // Compact online/offline indicator pinned to the right of the tab row
  const syncPill = () => {
    switch (serverSettings.syncStatus) {
      case 'synced':
        return <span title="Online — settings sync to the server" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />ONLINE</span>;
      case 'offline':
        return <span title="Offline — changes are saved locally and sync later" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-600 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />OFFLINE</span>;
      case 'pending':
        return <span title="Sync pending" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />SYNCING</span>;
      case 'conflict':
        return <span title="Conflict — another device changed settings" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-700 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />CONFLICT</span>;
      default:
        return <span title="Checking connection…" className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />…</span>;
    }
  };

  return (
    <div id="settings_workspace_container" className="flex flex-col h-full bg-[#fbfbff] select-none overflow-hidden">
      {/* Tab nav — compact online/offline indicator pinned to the right */}
      <div className="bg-white border-b border-[#e1e2ed] flex items-center shrink-0">
        <div className="flex items-center px-4 overflow-x-auto flex-1 min-w-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-3 font-bold text-[10px] tracking-wide transition-all border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === t.id ? 'border-[#004ac6] text-[#004ac6]' : 'border-transparent text-gray-400 hover:text-gray-600'
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
            className="ml-auto px-3 py-1 rounded-lg bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 transition-colors cursor-pointer shrink-0"
          >
            Resolve
          </button>
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="flex-1 p-6 flex flex-col gap-4 overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
          {/* ── BILLING ── */}
          {activeTab === 'billing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-6">
                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">GST Configuration</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">GSTIN Number</label>
                      <input type="text" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400 uppercase" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Restaurant Name</label>
                      <input type="text" value={restName} onChange={(e) => setRestName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Phone</label>
                      <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Address</label>
                      <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]" />
                    </div>
                  </div>
                  <div className="pt-2">
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Tax Rate Presets</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {taxPresets.map((rate) => (
                        <button key={rate} type="button" onClick={() => setTaxRate(rate)} className={`px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${taxRate === rate ? 'bg-[#004ac6] text-white' : 'bg-[#eae9f5] text-[#474087] hover:bg-[#deddf0]'}`}>{rate}%</button>
                      ))}
                      {isAddingTaxPreset ? (
                        <div className="flex items-center gap-1 border border-[#c3c6d7] rounded-xl p-1 bg-white">
                          <input type="number" min={0} max={100} value={newTaxPresetValue} onChange={(e) => setNewTaxPresetValue(e.target.value)} className="w-16 px-2 py-1 rounded-lg text-xs font-semibold text-center" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(newTaxPresetValue); if (!isNaN(v) && v >= 0 && v <= 100) { if (!taxPresets.includes(v)) setTaxPresets((p) => [...p, v].sort((a, b) => a - b)); setTaxRate(v); setIsAddingTaxPreset(false); setNewTaxPresetValue(''); } } }} />
                          <button type="button" onClick={() => { const v = parseFloat(newTaxPresetValue); if (!isNaN(v) && v >= 0 && v <= 100) { if (!taxPresets.includes(v)) setTaxPresets((p) => [...p, v].sort((a, b) => a - b)); setTaxRate(v); setIsAddingTaxPreset(false); setNewTaxPresetValue(''); } }} className="p-1 bg-blue-50 text-[#004ac6] hover:bg-blue-100 rounded-lg cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => { setIsAddingTaxPreset(false); setNewTaxPresetValue(''); }} className="p-1 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setIsAddingTaxPreset(true)} className="px-3 py-2 border border-dashed border-[#c3c6d7] text-[#004ac6] rounded-xl font-bold text-xs cursor-pointer">+ Add Rate</button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Invoice Numbering</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Prefix</label><input type="text" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Starting Number</label><input type="number" value={invoiceStartingNumber} onChange={(e) => setInvoiceStartingNumber(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold font-mono" /></div>
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Suffix</label><input type="text" value={invoiceSuffix} onChange={(e) => setInvoiceSuffix(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center gap-2.5 text-xs text-[#004ac6]">
                    <Info className="w-4 h-4 shrink-0" />
                    <span className="font-bold">Preview: <strong className="font-mono">{invoicePrefix}{invoiceStartingNumber}{invoiceSuffix}</strong></span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Paper Size</label>
                    <div className="flex gap-2">
                      {(['80mm', '58mm'] as const).map((s) => (
                        <button key={s} type="button" onClick={() => setPrintSize(s)} className={`px-4 py-2 rounded-xl font-bold text-xs cursor-pointer ${printSize === s ? 'bg-[#004ac6] text-white' : 'bg-[#eae9f5] text-[#474087]'}`}>{s}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Brand Logo</h3>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = (ev) => { if (ev.target?.result) setSidebarLogoUrl(String(ev.target.result)); }; r.readAsDataURL(f); } }}
                      className={`flex-1 w-full border-2 border-dashed rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer ${isDragging ? 'border-[#004ac6] bg-blue-50/50' : 'border-gray-300 hover:border-[#004ac6]'}`}
                      onClick={() => document.getElementById('device-logo-input')?.click()}
                    >
                      <input type="file" id="device-logo-input" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f?.type.startsWith('image/') && f.size <= 2 * 1024 * 1024) { const r = new FileReader(); r.onload = (ev) => { if (ev.target?.result) setSidebarLogoUrl(String(ev.target.result)); }; r.readAsDataURL(f); } }} />
                      <Upload className={`w-6 h-6 mb-1.5 ${isDragging ? 'text-[#004ac6]' : 'text-gray-400'}`} />
                      <p className="text-xs font-bold text-gray-700">Drag & drop logo or <span className="text-[#004ac6] underline">browse</span></p>
                      <p className="text-[9px] text-gray-400 mt-1">PNG, JPG, WEBP, SVG (max 2MB)</p>
                    </div>
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="w-16 h-16 bg-[#191b23] rounded-xl flex items-center justify-center overflow-hidden">
                        {sidebarLogoUrl ? <img src={sidebarLogoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <span className="text-white font-extrabold text-sm">{restName ? restName.split(' ').map((w) => w[0]).join('').substring(0, 3).toUpperCase() : 'POS'}</span>}
                      </div>
                      {sidebarLogoUrl && <button type="button" onClick={() => setSidebarLogoUrl('')} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[9px] font-bold hover:bg-red-100 cursor-pointer flex items-center gap-1"><Trash2 className="w-2.5 h-2.5" />Remove</button>}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
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
                          <span className="text-[#004ac6] shrink-0">{t.icon}</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{t.label}</p>
                            <p className="text-[8.5px] text-gray-400 truncate">{t.hint}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => t.set(!t.value)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${t.value ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Footer</h3>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Footer Message</label>
                    <input type="text" value={receiptFooterMessage} onChange={(e) => setReceiptFooterMessage(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="THANK YOU FOR DINING WITH US!" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Footer Image URL</label>
                    <input type="text" value={receiptFooterImageUrl} onChange={(e) => setReceiptFooterImageUrl(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="https://…/footer-banner.png" />
                    <p className="text-[9px] text-gray-400 mt-1">Optional banner shown above the thank-you note.</p>
                  </div>
                </div>
              </div>

              {/* Live receipt preview — exact copy of the billing-time receipt (ThermalReceipt) */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Live Receipt Preview</h3>
                  <div className="flex gap-2">
                    <button type="button" onClick={handlePrintTestReceipt} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#004ac6] text-white text-[10px] font-bold hover:bg-[#003a9c] transition-colors cursor-pointer"><Printer className="w-3 h-3" />Print</button>
                    <button type="button" onClick={handlePrintTestKOT} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#004ac6] text-[#004ac6] text-[10px] font-bold hover:bg-blue-50 transition-colors cursor-pointer"><Utensils className="w-3 h-3" />KOT</button>
                  </div>
                </div>
                <div className="bg-gray-100 rounded-xl p-4 flex justify-center shadow-inner overflow-x-auto">
                  <ThermalReceipt bill={previewBill} settings={previewSettings} />
                </div>
                <p className="text-[9px] text-gray-400 mt-3 text-center">This is the exact receipt used at billing time — the toggles above update it live.</p>
              </div>
            </div>
          )}

          {/* ── KITCHEN ── */}
          {activeTab === 'kitchen' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-6">
                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
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
                    ].map((t) => (
                      <div key={t.label} className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl hover:bg-gray-50">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[#004ac6] shrink-0">{t.icon}</span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{t.label}</p>
                            <p className="text-[8.5px] text-gray-400 truncate">{t.hint}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => t.set(!t.value)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${t.value ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">KOT Footer Note</label>
                    <input type="text" value={kotFooterNote} onChange={(e) => setKotFooterNote(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="Cook with passion!" />
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Printer Routing Rules</h3>
                    <p className="text-[9px] text-gray-400 ml-auto">Destinations come from the Printer registry</p>
                  </div>
                  {routingRules.length === 0 && <p className="text-[10px] text-gray-400">No routing rules — add one below to route categories to specific printers.</p>}
                  {routingRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2 border border-[#e1e2ed] rounded-xl p-2">
                      <select value={rule.categoryGroup} onChange={(e) => setRoutingRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, categoryGroup: e.target.value } : r)))} className="flex-1 px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-[10px] font-semibold bg-white">
                        {['Food (All)', 'Drinks & Beverages', 'Desserts', 'Appetizers', 'Pizza Station', 'Bakery'].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <select value={rule.destinationPrinter} onChange={(e) => setRoutingRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, destinationPrinter: e.target.value } : r)))} className="flex-1 px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-[10px] font-semibold bg-white">
                        {printers.length === 0 && <option value="">No printers configured</option>}
                        {printers.filter((p) => p.enabled).map((p) => <option key={p._id} value={p.name}>{p.name} ({p.connection.host || p.connection.address || p.connection.kind})</option>)}
                      </select>
                      <button type="button" onClick={() => setRoutingRules((rs) => rs.filter((r) => r.id !== rule.id))} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRoutingRules((rs) => [...rs, { id: `rule_${Date.now()}`, categoryGroup: 'Food (All)', destinationPrinter: printers.find((p) => p.enabled)?.name || '' }])} className="w-full py-2 border border-dashed border-[#c3c6d7] text-[#004ac6] rounded-xl font-bold text-xs cursor-pointer">+ Add Routing Rule</button>
                </div>
              </div>

              {/* Live KOT preview — exact copy of the printed kitchen ticket (ThermalKOT) */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Live KOT Preview</h3>
                  <button type="button" onClick={handlePrintTestKOT} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#004ac6] text-white text-[10px] font-bold hover:bg-[#003a9c] transition-colors cursor-pointer"><Printer className="w-3 h-3" />Print KOT</button>
                </div>
                <div className="bg-gray-100 rounded-xl p-4 flex justify-center shadow-inner overflow-x-auto">
                  <ThermalKOT
                    order={previewKotOrder}
                    kot={previewKot}
                    settings={previewKotSettings}
                    className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-4 shadow-sm"
                  />
                </div>
                <p className="text-[9px] text-gray-400 mt-3 text-center">This is the exact KOT sent to the kitchen — the toggles update it live.</p>
              </div>
            </div>
          )}

          {/* ── MODULES ── */}
          {activeTab === 'modules' && (
            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-3 max-w-3xl">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Modules & Features</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(moduleSettings).map(([key, value]) => (
                  <div key={key} className="flex justify-between items-center py-2 px-3 rounded-xl hover:bg-gray-50">
                    <p className="text-xs font-bold text-gray-700 capitalize">{key.replace(/^enable/, '').replace(/([A-Z])/g, ' $1').trim()}</p>
                    <button type="button" onClick={() => toggleModule(key as keyof ModuleSettings)} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${value ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${value ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ROLES ── */}
          {activeTab === 'roles' && (
            <div className="max-w-4xl">
              <RolePermissionsTab rolePermissions={rolePermissions} onToggle={toggleRolePermission} onApplyPreset={applyRolePreset} moduleSettings={moduleSettings} subscriptionFeatures={subscriptionFeatures} />
            </div>
          )}

          {/* ── PRINTERS ── */}
          {activeTab === 'printers' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Registered Printers</h3>
                  <span className="ml-auto text-[9px] text-gray-400">{printers.length} active</span>
                </div>
                {printers.length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No printers registered. Add your first printer to enable routing & printing.</p>}
                {printers.map((p) => (
                  <div key={p._id} className="flex items-center gap-3 border border-[#e1e2ed] rounded-xl p-3">
                    <div className={`p-2.5 rounded-xl ${p.healthStatus === 'online' ? 'bg-emerald-50 text-emerald-600' : p.healthStatus === 'offline' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                      <Printer className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        {p.name}
                        {p.isDefault && <span className="px-1.5 py-0.5 rounded bg-[#004ac6] text-white text-[8px] font-black">DEFAULT</span>}
                        {!p.enabled && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[8px] font-black">DISABLED</span>}
                      </p>
                      <p className="text-[9px] text-gray-400 capitalize">{p.type} · {p.connection.host || p.connection.address || p.connection.kind}{p.connection.port ? `:${p.connection.port}` : ''} · {p.paperSize}</p>
                      {printerTestMsg[p._id] && <p className={`text-[9px] font-bold mt-1 ${p.healthStatus === 'online' ? 'text-emerald-600' : p.healthStatus === 'offline' ? 'text-red-500' : 'text-gray-500'}`}>{printerTestMsg[p._id]}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => handleTestPrinter(p._id)} disabled={!!testingPrinterId} className="p-1.5 rounded-lg border border-[#e1e2ed] text-[#004ac6] hover:bg-blue-50 cursor-pointer" title="Test connection">
                        {testingPrinterId === p._id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TestTube2 className="w-3.5 h-3.5" />}
                      </button>
                      <button type="button" onClick={() => handleEditPrinter(p)} className="p-1.5 rounded-lg border border-[#e1e2ed] text-gray-600 hover:bg-gray-50 cursor-pointer" title="Edit"><Settings2 className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => handleDeletePrinter(p._id)} className="p-1.5 rounded-lg border border-[#e1e2ed] text-red-500 hover:bg-red-50 cursor-pointer" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">{editingPrinterId ? 'Edit Printer' : 'Add Printer'}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Name</label><input type="text" value={printerForm.name} onChange={(e) => setPrinterForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="Kitchen Printer" /></div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Type</label>
                    <select value={printerForm.type} onChange={(e) => setPrinterForm((p) => ({ ...p, type: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold bg-white">
                      {['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth'].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Connection</label>
                    <select value={printerForm.kind} onChange={(e) => setPrinterForm((p) => ({ ...p, kind: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold bg-white">
                      {['network', 'usb', 'bluetooth'].map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
                    </select>
                  </div>
                  {printerForm.kind === 'network' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Host / IP</label><input type="text" value={printerForm.host} onChange={(e) => setPrinterForm((p) => ({ ...p, host: e.target.value }))} placeholder="192.168.1.42" className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                      <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Port</label><input type="number" value={printerForm.port} onChange={(e) => setPrinterForm((p) => ({ ...p, port: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                    </div>
                  ) : (
                    <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Device Address</label><input type="text" value={printerForm.address} onChange={(e) => setPrinterForm((p) => ({ ...p, address: e.target.value }))} placeholder={printerForm.kind === 'bluetooth' ? 'Bluetooth MAC' : 'USB port / VID:PID'} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                  )}
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Paper Size</label>
                    <select value={printerForm.paperSize} onChange={(e) => setPrinterForm((p) => ({ ...p, paperSize: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold bg-white">
                      <option value="80mm">80mm</option><option value="58mm">58mm</option>
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Copies</label><input type="number" min={1} max={10} value={printerForm.copies} onChange={(e) => setPrinterForm((p) => ({ ...p, copies: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <button type="button" onClick={() => setPrinterForm((p) => ({ ...p, isDefault: !p.isDefault }))} className={`w-11 h-6 rounded-full transition-colors relative ${printerForm.isDefault ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${printerForm.isDefault ? 'left-6' : 'left-1'}`} />
                  </button>
                  <span className="text-[10px] font-bold text-gray-700">Set as default printer</span>
                </label>
                <button type="button" onClick={handleAddPrinter} className="w-full py-2.5 rounded-xl bg-[#004ac6] text-white font-bold text-xs hover:bg-[#003a9c] transition-colors cursor-pointer">
                  {editingPrinterId ? 'Save Printer' : 'Register Printer'}
                </button>
                {editingPrinterId && (
                  <button type="button" onClick={() => { setEditingPrinterId(null); setPrinterForm({ name: '', type: 'kitchen', kind: 'network', host: '', port: '9100', address: '', paperSize: '80mm', copies: 1, isDefault: false }); }} className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs cursor-pointer">Cancel Edit</button>
                )}
              </div>
            </div>
          )}

          {/* ── RECEIPT TEMPLATE ── */}
          {activeTab === 'receipt' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Template</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Header Line</label><input type="text" value={receiptTemplate.header || ''} onChange={(e) => setReceiptTemplate((p) => ({ ...p, header: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="Welcome message shown at top" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Watermark</label><input type="text" value={receiptTemplate.watermark || ''} onChange={(e) => setReceiptTemplate((p) => ({ ...p, watermark: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="e.g. COPY" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">FSSAI License No</label><input type="text" value={receiptTemplate.fssai || ''} onChange={(e) => setReceiptTemplate((p) => ({ ...p, fssai: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold uppercase" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Footer</label><input type="text" value={receiptTemplate.footer || ''} onChange={(e) => setReceiptTemplate((p) => ({ ...p, footer: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="Thank you note" /></div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-2">Show on Receipt</label>
                <div className="flex flex-wrap gap-4">
                  {[
                    { key: 'showGstin', label: 'GSTIN' },
                    { key: 'showFssai', label: 'FSSAI' },
                  ].map((t) => (
                    <label key={t.key} className="flex items-center gap-2 cursor-pointer">
                      <button type="button" onClick={() => setReceiptTemplate((p) => ({ ...p, [t.key]: !p[t.key] }))} className={`w-11 h-6 rounded-full transition-colors relative ${p0(receiptTemplate, t.key) ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${p0(receiptTemplate, t.key) ? 'left-6' : 'left-1'}`} />
                      </button>
                      <span className="text-[10px] font-bold text-gray-700">{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-50">
                <div><p className="text-xs font-bold text-gray-900">Custom Footer Fields</p><p className="text-[9px] text-gray-400">Extra key/value lines on the receipt</p></div>
                <button type="button" onClick={() => setReceiptTemplate((p) => ({ ...p, customFields: [...(p.customFields || []), { id: `cf_${Date.now()}`, label: '', value: '' }] }))} className="px-3 py-1.5 rounded-lg border border-dashed border-[#c3c6d7] text-[#004ac6] text-[10px] font-bold cursor-pointer"><Plus className="w-3 h-3 inline mr-1" />Add Field</button>
              </div>
              {(receiptTemplate.customFields || []).map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <input type="text" value={f.label} onChange={(e) => setReceiptTemplate((p) => ({ ...p, customFields: (p.customFields || []).map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)) }))} placeholder="Label" className="flex-1 px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" />
                  <input type="text" value={f.value} onChange={(e) => setReceiptTemplate((p) => ({ ...p, customFields: (p.customFields || []).map((x) => (x.id === f.id ? { ...x, value: e.target.value } : x)) }))} placeholder="Value" className="flex-1 px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" />
                  <button type="button" onClick={() => setReceiptTemplate((p) => ({ ...p, customFields: (p.customFields || []).filter((x) => x.id !== f.id) }))} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}

          {/* ── THEME ── */}
          {activeTab === 'theme' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Theme</h3>
              </div>
              <div className="flex gap-3">
                {(['dark', 'light', 'system'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setTheme((p) => ({ ...p, mode: m }))} className={`flex-1 py-3 rounded-xl border-2 font-bold text-xs capitalize cursor-pointer flex items-center justify-center gap-2 ${theme.mode === m ? 'border-[#004ac6] bg-blue-50 text-[#004ac6]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {m === 'dark' ? <Moon className="w-4 h-4" /> : m === 'light' ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}{m}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Brand Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={theme.brandColor || '#004ac6'} onChange={(e) => setTheme((p) => ({ ...p, brandColor: e.target.value }))} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={theme.brandColor || ''} onChange={(e) => setTheme((p) => ({ ...p, brandColor: e.target.value }))} className="flex-1 px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-mono font-semibold" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Accent Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={theme.accentColor || '#10b981'} onChange={(e) => setTheme((p) => ({ ...p, accentColor: e.target.value }))} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={theme.accentColor || ''} onChange={(e) => setTheme((p) => ({ ...p, accentColor: e.target.value }))} className="flex-1 px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-mono font-semibold" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Density</label>
                  <select value={theme.density || 'comfortable'} onChange={(e) => setTheme((p) => ({ ...p, density: e.target.value as any }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold bg-white">
                    <option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="spacious">Spacious</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Border Radius (px)</label>
                  <input type="number" min={0} max={32} value={theme.borderRadius ?? 12} onChange={(e) => setTheme((p) => ({ ...p, borderRadius: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" />
                </div>
              </div>
            </div>
          )}

          {/* ── SHORTCUTS ── */}
          {activeTab === 'shortcuts' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-1.5 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Keyboard Shortcuts</h3>
                </div>
                <button type="button" onClick={() => { setShortcuts({ ...DEFAULT_SHORTCUTS }); showToast('Shortcuts reset to defaults'); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[10px] font-bold hover:bg-gray-50 cursor-pointer"><RotateCcw className="w-3 h-3" />Reset Defaults</button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1"><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Action</label><input type="text" value={newShortcutAction} onChange={(e) => setNewShortcutAction(e.target.value)} placeholder="e.g. Open Reports" className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                <div className="w-40"><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Shortcut</label><input type="text" value={newShortcutKey} onChange={(e) => setNewShortcutKey(e.target.value)} placeholder="e.g. Ctrl+R" className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-mono font-semibold" /></div>
                <button type="button" onClick={addShortcut} className="px-4 py-2 rounded-xl bg-[#004ac6] text-white font-bold text-xs cursor-pointer">Add</button>
              </div>
              <div className="space-y-2">
                {Object.entries(shortcuts).map(([action, key]) => (
                  <div key={action} className="flex items-center justify-between border border-[#e1e2ed] rounded-xl px-3 py-2">
                    <p className="text-xs font-bold text-gray-700">{action}</p>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 text-[10px] font-mono font-bold">{key}</span>
                      <button type="button" onClick={() => setShortcuts((p) => { const n = { ...p }; delete n[action]; return n; })} className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {activeTab === 'notifications' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Notifications</h3>
              </div>
              <div className="space-y-3">
                {NOTIFICATION_EVENTS.map((ev) => {
                  const val = notifications[ev.key];
                  const isOn = val === undefined ? true : !!val;
                  return (
                    <div key={ev.key} className="flex justify-between items-center py-2 border-b border-gray-50">
                      <div><p className="text-xs font-bold text-gray-900">{ev.label}</p><p className="text-[9px] text-gray-400">{ev.desc}</p></div>
                      <button type="button" onClick={() => setNotifications((p) => ({ ...p, [ev.key]: !isOn }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${isOn ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${isOn ? 'left-6' : 'left-1'}`} />
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
                      <button key={ch} type="button" onClick={() => setNotifications((p) => ({ ...p, channels: active ? list.filter((c) => c !== ch) : [...list, ch] }))} className={`px-3 py-1.5 rounded-xl font-bold text-[10px] capitalize transition-all cursor-pointer ${active ? 'bg-[#004ac6] text-white' : 'bg-[#eae9f5] text-[#474087]'}`}>{ch}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Webhook URL (for webhook channel)</label>
                <input type="url" value={notifications.webhookUrl || ''} onChange={(e) => setNotifications((p) => ({ ...p, webhookUrl: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="https://hooks.example.com/pos-events" />
              </div>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'security' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Security Policy</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Min Password Length</label><input type="number" min={6} max={32} value={security.passwordMinLength ?? 8} onChange={(e) => setSecurity((p) => ({ ...p, passwordMinLength: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Session Timeout (minutes)</label><input type="number" min={5} value={security.sessionTimeoutMinutes ?? 60} onChange={(e) => setSecurity((p) => ({ ...p, sessionTimeoutMinutes: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Failed Login Lock Threshold</label><input type="number" min={3} value={security.failedLoginLockThreshold ?? 5} onChange={(e) => setSecurity((p) => ({ ...p, failedLoginLockThreshold: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">PIN Min Length</label><input type="number" min={4} value={security.pinPolicy?.minLength ?? 4} onChange={(e) => setSecurity((p) => ({ ...p, pinPolicy: { ...(p.pinPolicy || {}), minLength: Number(e.target.value) } }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
              </div>
              <div className="space-y-2">
                {[
                  { key: 'autoLogout', label: 'Auto Logout on Session Timeout', value: !!security.autoLogout },
                  { key: 'twoFactorEnabled', label: 'Two-Factor Authentication (Owner login)', value: !!security.twoFactorEnabled },
                ].map((t) => (
                  <div key={t.key} className="flex justify-between items-center py-2 border-b border-gray-50">
                    <p className="text-xs font-bold text-gray-900">{t.label}</p>
                    <button type="button" onClick={() => setSecurity((p) => ({ ...p, [t.key]: !p[t.key] }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${t.value ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${t.value ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400">These policy values are stored server-side and read by the POS. Two-Factor Authentication and session-timeout enforcement are planned for a follow-up phase — the values are persisted now so the POS can enforce them once wired.</p>
            </div>
          )}

          {/* ── BACKUP ── */}
          {activeTab === 'backup' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Backup & Restore</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button type="button" onClick={handleExportBackup} className="p-5 rounded-2xl border-2 border-dashed border-[#004ac6] text-[#004ac6] hover:bg-blue-50 transition-colors cursor-pointer text-left">
                  <Cloud className="w-6 h-6 mb-2" />
                  <p className="font-bold text-sm">Export Backup</p>
                  <p className="text-[10px] text-gray-400 mt-1">Download settings + configuration as a JSON file</p>
                </button>
                <label className="p-5 rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 hover:border-[#004ac6] hover:bg-gray-50 transition-colors cursor-pointer text-left">
                  <Database className="w-6 h-6 mb-2" />
                  <p className="font-bold text-sm">Restore Backup</p>
                  <p className="text-[10px] text-gray-400 mt-1">Upload a previously exported backup file</p>
                  <input type="file" accept=".json,application/json" className="hidden" onChange={handleRestoreBackup} />
                </label>
              </div>
              <p className="text-[9px] text-gray-400">Backups include restaurant settings, receipt configuration, printer routing, modules and roles. Server data (bills, products, customers) is always available from the backend — this export covers POS configuration for offline/device migration.</p>
            </div>
          )}

          {/* ── AI ── */}
          {activeTab === 'ai' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">AI Settings</h3>
              </div>
              <div className="flex justify-between items-center py-2">
                <div><p className="text-xs font-bold text-gray-900">Enable AI Features</p><p className="text-[9px] text-gray-400">AI summaries, inventory health, purchase recommendations</p></div>
                <button type="button" onClick={() => setAi((p) => ({ ...p, enabled: !p.enabled }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${ai.enabled ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${ai.enabled ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Daily Request Limit</label><input type="number" min={1} value={ai.dailyLimit ?? 100} onChange={(e) => setAi((p) => ({ ...p, dailyLimit: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" /></div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1.5">Model</label>
                  <select value={ai.model || 'llama-3.3-70b-versatile'} onChange={(e) => setAi((p) => ({ ...p, model: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold bg-white">
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gpt-4o-mini">GPT-4o mini</option>
                  </select>
                </div>
              </div>
              <p className="text-[9px] text-gray-400">Usage is logged server-side (AIUsageLog) and counted against the subscription's AI quota. Fallback models are handled automatically by the AI provider layer.</p>
            </div>
          )}

          {/* ── INTEGRATIONS ── */}
          {activeTab === 'integrations' && (
            <div className="max-w-3xl bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Integrations</h3>
                <span className="ml-auto text-[9px] text-gray-400">Secrets stored encrypted server-side</span>
              </div>
              {(['whatsapp', 'sms', 'email', 'webhook'] as const).map((name) => (
                <div key={name} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <div>
                    <p className="text-xs font-bold text-gray-900 capitalize">{name === 'webhook' ? 'Webhook' : name === 'sms' ? 'SMS' : name === 'whatsapp' ? 'WhatsApp' : 'Email'}</p>
                    <p className="text-[9px] text-gray-400">{name === 'webhook' ? 'Push events to a custom endpoint' : `${name === 'sms' ? 'SMS' : name === 'whatsapp' ? 'WhatsApp' : 'Email'} provider connection`}</p>
                  </div>
                  <button type="button" onClick={() => setIntegrations((p) => ({ ...p, [name]: { ...(p[name] || {}), enabled: !(p[name]?.enabled) } }))} className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${p1(integrations, name) ? 'bg-[#004ac6]' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${p1(integrations, name) ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              ))}
              {p1(integrations, 'webhook') && (
                <div className="space-y-3 p-4 rounded-xl bg-gray-50 border border-[#e1e2ed]">
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Webhook URL</label><input type="url" value={integrations.webhook?.url || ''} onChange={(e) => setIntegrations((p) => ({ ...p, webhook: { ...(p.webhook || {}), url: e.target.value } }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="https://api.example.com/webhook" /></div>
                  <div><label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Secret</label><input type="password" value={integrations.webhook?.secret || ''} onChange={(e) => setIntegrations((p) => ({ ...p, webhook: { ...(p.webhook || {}), secret: e.target.value } }))} className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold" placeholder="Shared signing secret (encrypted)" /></div>
                </div>
              )}
              <p className="text-[9px] text-gray-400">WhatsApp, SMS and Email delivery require provider credentials. The webhook channel is fully functional in-repo — enabling it sends a signed test payload.</p>
            </div>
          )}

          {/* ── HISTORY & AUDIT ── */}
          {activeTab === 'history' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Version History</h3>
                  <span className="ml-auto text-[9px] text-gray-400">current v{history?.settingsVersion ?? '—'}</span>
                </div>
                {(history?.history || []).length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No prior versions yet.</p>}
                {(history?.history || []).map((h: any) => (
                  <div key={h.version} className="flex items-center justify-between border border-[#e1e2ed] rounded-xl px-3 py-2">
                    <div>
                      <p className="text-xs font-bold text-gray-900">Version {h.version}</p>
                      <p className="text-[9px] text-gray-400">{h.changeReason || 'Configuration change'} · {h.updatedBy} · {new Date(h.updatedAt).toLocaleString()}</p>
                    </div>
                    <button type="button" onClick={async () => { const ok = await serverSettings.rollback(h.version, `Rolled back from Settings`); if (ok) { showToast(`Rolled back to version ${h.version}`); await loadHistory(); } }} className="px-3 py-1.5 rounded-lg border border-[#004ac6] text-[#004ac6] text-[10px] font-bold hover:bg-blue-50 cursor-pointer">Rollback</button>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Audit Trail</h3>
                  <span className="ml-auto text-[9px] text-gray-400">{audit?.total ?? 0} entries</span>
                </div>
                {(audit?.data || []).length === 0 && <p className="text-[10px] text-gray-400 py-4 text-center">No settings audit entries yet.</p>}
                {(audit?.data || []).map((a: any) => (
                  <div key={a.id} className="border border-[#e1e2ed] rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-gray-900">{a.action.replace(/_/g, ' ')}</p>
                      <p className="text-[9px] text-gray-400">{new Date(a.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-0.5">by {a.performedBy}{a.ipAddress ? ` · ${a.ipAddress}` : ''}</p>
                    {a.details?.changedKeys?.length > 0 && (
                      <p className="text-[9px] text-[#004ac6] mt-1 font-bold">Changed: {a.details.changedKeys.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SUBSCRIPTION ── */}
          {activeTab === 'subscription' && (
            <div className="max-w-3xl">
              <SubscriptionSettings />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 bg-white border border-[#e1e2ed] rounded-2xl p-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Info className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Change reason (recorded in audit log) — e.g. Updated GST rate for new financial year"
              className="flex-1 px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] min-w-0"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={handleDiscardChanges} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs hover:bg-gray-50 transition-colors cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" />Discard
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#004ac6] text-white font-bold text-xs hover:bg-[#003a9c] transition-colors cursor-pointer disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save & Sync'}
            </button>
          </div>
        </div>
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

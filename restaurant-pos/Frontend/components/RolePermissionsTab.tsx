/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RolePermissionsTab — Role & permission matrix for the POS terminal.
 * Rendered inside SettingsManager when the "ROLE PERMISSIONS" tab is active.
 *
 * Role model:
 *   Owner   → full access to every feature, always. Locked.
 *   Manager → access is controlled by the Owner via the `managerCan*` toggles.
 *   Cashier → access is controlled by the Owner via the `cashierCan*` toggles
 *             (all default OFF, so out of the box Cashier keeps the
 *             operational-only base access).
 *
 * The matrix shows every feature side-by-side for all three roles so the
 * exact access of each role is visible at a glance.
 */

import React from 'react';
import {
  Shield, Settings, Users, Package, TrendingDown, BarChart, TrendingUp, BarChart3,
  Layers, User, Award, CalendarClock, Building2, Check, Crown, Wrench, Wallet,
  Lock, Sparkles, CheckCircle2, Gauge, BadgePercent, Eye, EyeOff,
  LayoutDashboard, ClipboardCheck, UtensilsCrossed, MoreHorizontal,
  DollarSign, Activity, FileText, Receipt, RefreshCw,
} from 'lucide-react';
import type { RolePermissions, ModuleSettings } from '../src/types';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/types';

interface RolePermissionsTabProps {
  rolePermissions: RolePermissions;
  onToggle: (key: keyof RolePermissions) => void;
  /** Optional — enables the Manager + Cashier quick-preset buttons (wired from SettingsManager). */
  onApplyPreset?: (preset: Partial<RolePermissions>) => void;
  /** Staged module toggles — the live preview uses these to reflect module-gated menu items. */
  moduleSettings?: ModuleSettings;
  /** Subscription plan feature keys — the live preview uses these for plan-gated More items. */
  subscriptionFeatures?: string[];
}

interface PermissionRow {
  managerKey: keyof RolePermissions;
  cashierKey: keyof RolePermissions;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

/** The 12 configurable workspace features shown in the matrix. */
const PERMISSION_ROWS: PermissionRow[] = [
  { managerKey: 'managerCanAccessSettings', cashierKey: 'cashierCanAccessSettings', label: 'Settings', description: 'System configuration & preferences', icon: Settings, color: 'text-gray-600' },
  { managerKey: 'managerCanManageStaff', cashierKey: 'cashierCanManageStaff', label: 'Staff Management', description: 'Add, edit, or remove employees', icon: Users, color: 'text-blue-600' },
  { managerKey: 'managerCanManageProducts', cashierKey: 'cashierCanManageProducts', label: 'Products', description: 'Menu catalog & pricing', icon: Package, color: 'text-orange-600' },
  { managerKey: 'managerCanManageExpenses', cashierKey: 'cashierCanManageExpenses', label: 'Expenses', description: 'Record & manage operational expenses', icon: TrendingDown, color: 'text-red-600' },
  { managerKey: 'managerCanAccessReports', cashierKey: 'cashierCanAccessReports', label: 'Reports', description: 'Sales reports & analytics', icon: BarChart, color: 'text-purple-600' },
  { managerKey: 'managerCanAccessAnalytics', cashierKey: 'cashierCanAccessAnalytics', label: 'Analytics', description: 'Business intelligence & trends', icon: TrendingUp, color: 'text-indigo-600' },
  { managerKey: 'managerCanAccessFinance', cashierKey: 'cashierCanAccessFinance', label: 'Finance', description: 'Profit & Loss statements', icon: BarChart3, color: 'text-emerald-600' },
  { managerKey: 'managerCanAccessInventory', cashierKey: 'cashierCanAccessInventory', label: 'Inventory', description: 'Stock, purchase & supplier management', icon: Layers, color: 'text-[var(--brand-color)]' },
  { managerKey: 'managerCanManageCustomers', cashierKey: 'cashierCanManageCustomers', label: 'Customers', description: 'Loyalty profiles & history', icon: User, color: 'text-green-600' },
  { managerKey: 'managerCanManageOffers', cashierKey: 'cashierCanManageOffers', label: 'Offers', description: 'Create & manage reward tiers', icon: Award, color: 'text-amber-600' },
  { managerKey: 'managerCanAccessReservations', cashierKey: 'cashierCanAccessReservations', label: 'Reservations', description: 'Table booking & waitlist', icon: CalendarClock, color: 'text-rose-600' },
  { managerKey: 'managerCanAccessBranches', cashierKey: 'cashierCanAccessBranches', label: 'Branches', description: 'Multi-location management', icon: Building2, color: 'text-purple-600' },
];

/** Billing capability shown separately below the workspace matrix. */
const DISCOUNT_ROW: PermissionRow = {
  managerKey: 'managerCanApplyDiscounts',
  cashierKey: 'cashierCanApplyDiscounts',
  label: 'Apply Discounts',
  description: 'Manual discount on bills',
  icon: BadgePercent,
  color: 'text-green-600',
};

/** Operational modules available to EVERY role (part of the core POS flow). */
const BASE_ACCESS_MODULES = [
  'Dashboard', 'Orders', 'Billing', 'Kitchen', 'More',
  'Receipt History', 'Daily Sales', 'Activity Feed', 'Sync Status',
];

const MANAGER_KEYS = [...PERMISSION_ROWS.map((r) => r.managerKey), DISCOUNT_ROW.managerKey] as (keyof RolePermissions)[];
const CASHIER_KEYS = [...PERMISSION_ROWS.map((r) => r.cashierKey), DISCOUNT_ROW.cashierKey] as (keyof RolePermissions)[];
const TOTAL_PERMISSIONS = MANAGER_KEYS.length; // 13

const presetFrom = (keys: (keyof RolePermissions)[], value: boolean): Partial<RolePermissions> =>
  Object.fromEntries(keys.map((k) => [k, value])) as Partial<RolePermissions>;

const managerPreset = (value: boolean) => presetFrom(MANAGER_KEYS, value);
const cashierPreset = (value: boolean) => presetFrom(CASHIER_KEYS, value);

/** Recommended Manager preset = only the manager keys of the defaults (no cross-role leakage). */
const RECOMMENDED_MANAGER: Partial<RolePermissions> = Object.fromEntries(
  MANAGER_KEYS.map((k) => [k, DEFAULT_ROLE_PERMISSIONS[k]]),
) as Partial<RolePermissions>;

interface Preset {
  id: string;
  label: string;
  description: string;
  value: Partial<RolePermissions>;
  icon: React.ElementType;
  color: string;
}

const MANAGER_PRESETS: Preset[] = [
  { id: 'm-full', label: 'Full Access', description: 'All 13 permissions enabled', value: managerPreset(true), icon: Sparkles, color: 'text-emerald-600' },
  { id: 'm-recommended', label: 'Recommended', description: 'Balanced default setup', value: RECOMMENDED_MANAGER, icon: Gauge, color: 'text-[var(--brand-color)]' },
  { id: 'm-restricted', label: 'Restricted', description: 'Billing & operations only', value: managerPreset(false), icon: Lock, color: 'text-amber-600' },
];

const CASHIER_PRESETS: Preset[] = [
  { id: 'c-full', label: 'Full Access', description: 'All 13 permissions enabled', value: cashierPreset(true), icon: Sparkles, color: 'text-emerald-600' },
  { id: 'c-reports-discounts', label: 'Reports & Discounts', description: 'View reports + apply discounts', value: { cashierCanAccessReports: true, cashierCanApplyDiscounts: true }, icon: BarChart, color: 'text-[var(--brand-color)]' },
  { id: 'c-standard', label: 'Standard', description: 'Billing & operations only', value: cashierPreset(false), icon: Lock, color: 'text-amber-600' },
];

function isPresetActive(p: Preset, rolePermissions: RolePermissions): boolean {
  return Object.entries(p.value).every(([k, v]) => rolePermissions[k as keyof RolePermissions] === v);
}

// ─── Small shared cells ──────────────────────────────────────────

function CheckCell({ title }: { title: string }) {
  return (
    <div className="flex justify-center">
      <span className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center" title={title}>
        <Check className="w-3 h-3 text-purple-600" />
      </span>
    </div>
  );
}

function ToggleCell({ enabled, onClick, title }: { enabled: boolean; onClick: () => void; title: string }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${enabled ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${enabled ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_60px_92px_92px] items-center px-3 gap-1';

interface MatrixRowProps {
  row: PermissionRow;
  rolePermissions: RolePermissions;
  onToggle: (key: keyof RolePermissions) => void;
}

function MatrixRow({ row, rolePermissions, onToggle }: MatrixRowProps) {
  const Icon = row.icon;
  // Row reads as "enabled" when either role has the feature turned on.
  const isEnabled = rolePermissions[row.managerKey] || rolePermissions[row.cashierKey];
  return (
    <div
      className={`${GRID} py-2.5 border-b border-[#e1e2ed] last:border-b-0 transition-colors ${
        isEnabled ? 'hover:bg-gray-50/70' : 'bg-gray-50/40 hover:bg-gray-50'
      }`}
    >
      {/* Feature */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`p-1.5 rounded-lg shrink-0 ${isEnabled ? 'bg-blue-50' : 'bg-gray-100'}`}>
          <Icon className={`w-3.5 h-3.5 ${row.color}`} />
        </div>
        <div className="min-w-0">
          <p className={`text-[11px] font-bold truncate ${isEnabled ? 'text-[#191b23]' : 'text-gray-400'}`}>{row.label}</p>
          <p className="text-[9px] text-gray-400 truncate">{row.description}</p>
        </div>
      </div>

      {/* Owner — always allowed */}
      <CheckCell title="Owner — always allowed" />

      {/* Manager — Owner-configurable toggle */}
      <ToggleCell
        enabled={rolePermissions[row.managerKey] === true}
        onClick={() => onToggle(row.managerKey)}
        title={`Manager access to ${row.label}: ${rolePermissions[row.managerKey] ? 'ON' : 'OFF'}`}
      />

      {/* Cashier — Owner-configurable toggle */}
      <ToggleCell
        enabled={rolePermissions[row.cashierKey] === true}
        onClick={() => onToggle(row.cashierKey)}
        title={`Cashier access to ${row.label}: ${rolePermissions[row.cashierKey] ? 'ON' : 'OFF'}`}
      />
    </div>
  );
}

// ─── Live preview data (mirrors AppSidebar + MoreWorkspace gating) ──

interface PreviewItem {
  id: string;
  icon: React.ElementType;
  managerKey?: keyof RolePermissions;
  cashierKey?: keyof RolePermissions;
  /** Hidden from Cashier even with no cashierKey (e.g. Z-Report). */
  cashierHidden?: boolean;
  /** Module + plan gate — when false the item is not part of the menu at all. */
  enabled?: (m: Partial<ModuleSettings>, plan: string[]) => boolean;
}

const SIDEBAR_PREVIEW: PreviewItem[] = [
  { id: 'Dashboard', icon: LayoutDashboard },
  { id: 'Kitchen', icon: UtensilsCrossed, enabled: (m) => m.enableKitchenDisplay !== false },
  { id: 'Orders', icon: ClipboardCheck },
  { id: 'Reports', icon: BarChart, managerKey: 'managerCanAccessReports', cashierKey: 'cashierCanAccessReports' },
  { id: 'Settings', icon: Settings, managerKey: 'managerCanAccessSettings', cashierKey: 'cashierCanAccessSettings' },
  { id: 'More', icon: MoreHorizontal },
];

const MORE_PREVIEW: PreviewItem[] = [
  { id: 'Inventory', icon: Layers, managerKey: 'managerCanAccessInventory', cashierKey: 'cashierCanAccessInventory', enabled: (_m, plan) => plan.includes('inventory') },
  { id: 'Products', icon: Package, managerKey: 'managerCanManageProducts', cashierKey: 'cashierCanManageProducts' },
  { id: 'Expenses', icon: TrendingDown, managerKey: 'managerCanManageExpenses', cashierKey: 'cashierCanManageExpenses', enabled: (m, plan) => m.enableExpenseManagement !== false && plan.includes('expense_tracking') },
  { id: 'Reservations', icon: CalendarClock, managerKey: 'managerCanAccessReservations', cashierKey: 'cashierCanAccessReservations', enabled: (m, plan) => m.enableReservations !== false && plan.includes('reservations') },
  { id: 'Analytics', icon: TrendingUp, managerKey: 'managerCanAccessAnalytics', cashierKey: 'cashierCanAccessAnalytics', enabled: (_m, plan) => plan.includes('analytics') },
  { id: 'Finance', icon: BarChart3, managerKey: 'managerCanAccessFinance', cashierKey: 'cashierCanAccessFinance', enabled: (_m, plan) => plan.includes('analytics') },
  { id: 'Customers', icon: Users, managerKey: 'managerCanManageCustomers', cashierKey: 'cashierCanManageCustomers', enabled: (m, plan) => m.enableLoyalty !== false && plan.includes('loyalty') },
  { id: 'Offers', icon: Award, managerKey: 'managerCanManageOffers', cashierKey: 'cashierCanManageOffers' },
  { id: 'Staff', icon: Shield, managerKey: 'managerCanManageStaff', cashierKey: 'cashierCanManageStaff' },
  { id: 'Branches', icon: Building2, managerKey: 'managerCanAccessBranches', cashierKey: 'cashierCanAccessBranches', enabled: (m, plan) => m.enableMultiBranch === true && plan.includes('multi_branch') },
  { id: 'Daily Sales', icon: DollarSign },
  { id: 'Activity Feed', icon: Activity },
  { id: 'Z-Report', icon: FileText, cashierHidden: true },
  { id: 'Receipt History', icon: Receipt },
  { id: 'Sync Status', icon: RefreshCw },
];

interface PreviewRow extends PreviewItem {
  exists: boolean;
  visible: boolean;
}

interface RoleNavPreviewProps {
  roleLabel: string;
  roleIcon: React.ElementType;
  headerColor: string;
  badge: string;
  sidebar: PreviewRow[];
  more: PreviewRow[];
  discountAllowed: boolean;
}

function RoleNavPreview({ roleLabel, roleIcon: RoleIcon, headerColor, badge, sidebar, more, discountAllowed }: RoleNavPreviewProps) {
  const visibleSidebar = sidebar.filter((s) => s.exists);
  return (
    <div className="rounded-xl border border-[#e1e2ed] bg-white p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <RoleIcon className={`w-3.5 h-3.5 ${headerColor}`} />
        <p className="text-[11px] font-black text-[#191b23]">{roleLabel} view</p>
        <span className="ml-auto px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[8px] font-black uppercase">{badge}</span>
      </div>

      {/* Sidebar rail mock */}
      <div className="bg-[#191b23] rounded-lg p-1.5 space-y-0.5 mb-2.5">
        {visibleSidebar.map((s) => (
          <div key={s.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded ${s.visible ? 'text-gray-200' : 'text-gray-600 line-through decoration-gray-700'}`}>
            <s.icon className="w-3 h-3 shrink-0" />
            <span className="text-[8px] font-bold uppercase tracking-wide">{s.id}</span>
            {!s.visible && <EyeOff className="w-2.5 h-2.5 ml-auto text-gray-600" />}
          </div>
        ))}
        {visibleSidebar.length === 0 && <p className="text-[8px] text-gray-500 px-1.5 py-1">—</p>}
      </div>

      {/* More menu mock */}
      <div className="grid grid-cols-3 gap-1.5">
        {more.map((m) => (
          <div
            key={m.id}
            title={m.exists ? (m.visible ? 'Visible' : 'Hidden by current permissions') : 'Disabled in Modules'}
            className={`rounded-lg border px-1 py-1.5 text-center transition-opacity ${
              !m.exists
                ? 'border-dashed border-gray-200 bg-gray-50/50 opacity-40'
                : m.visible
                  ? 'border-blue-100 bg-blue-50 text-[var(--brand-color)]'
                  : 'border-dashed border-gray-200 bg-gray-50 text-gray-300'
            }`}
          >
            <m.icon className="w-3 h-3 mx-auto mb-0.5" />
            <p className="text-[7px] font-bold leading-tight">{m.id}</p>
          </div>
        ))}
      </div>

      {/* Billing capability footnote */}
      <div className="mt-2.5 pt-2 border-t border-gray-50 flex items-center gap-1.5 text-[9px]">
        <BadgePercent className={`w-3 h-3 ${discountAllowed ? 'text-green-600' : 'text-gray-300'}`} />
        <span className={`font-bold ${discountAllowed ? 'text-green-700' : 'text-gray-400'}`}>Apply Discounts</span>
        <span className="ml-auto text-[10px]">{discountAllowed ? '✅ Allowed' : '🔒 Hidden'}</span>
      </div>
    </div>
  );
}

export default function RolePermissionsTab({ rolePermissions, onToggle, onApplyPreset, moduleSettings, subscriptionFeatures }: RolePermissionsTabProps) {
  const mod: Partial<ModuleSettings> = moduleSettings || {};
  const plan: string[] = subscriptionFeatures || [];
  const managerEnabled = MANAGER_KEYS.filter((k) => rolePermissions[k]).length;
  const cashierEnabled = CASHIER_KEYS.filter((k) => rolePermissions[k]).length;

  // Live preview visibility for each role (mirrors AppSidebar + MoreWorkspace).
  const buildRows = (isCashier: boolean): { sidebar: PreviewRow[]; more: PreviewRow[] } => {
    const sees = (it: PreviewItem) => {
      const exists = !it.enabled || it.enabled(mod, plan);
      const visible = exists && (isCashier
        ? !it.cashierHidden && (!it.cashierKey || rolePermissions[it.cashierKey] === true)
        : !it.managerKey || rolePermissions[it.managerKey] === true);
      return { ...it, exists, visible };
    };
    return { sidebar: SIDEBAR_PREVIEW.map(sees), more: MORE_PREVIEW.map(sees) };
  };
  const mgr = buildRows(false);
  const cash = buildRows(true);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-4xl mx-auto space-y-5 pb-6">
        {/* ── Info header ── */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-[var(--brand-color)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--brand-color)]">
            <p className="font-bold mb-1">Role-Based Access Control</p>
            <p className="text-blue-700/70">
              <strong className="text-[var(--brand-color)]">Owner</strong> always has full access.
              Use the toggles to define exactly what <strong className="text-[var(--brand-color)]">Manager</strong> and{' '}
              <strong className="text-[var(--brand-color)]">Cashier</strong> can access — changes apply instantly and are saved with the rest of your settings.
              Base modules (billing, orders, kitchen) stay available to every role.
            </p>
          </div>
        </div>

        {/* ── Role summary cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-purple-600" />
              <p className="text-xs font-black text-purple-700">Owner</p>
              <span className="ml-auto px-2 py-0.5 rounded-full bg-purple-600 text-white text-[9px] font-black uppercase tracking-wide">Full</span>
            </div>
            <p className="text-[10px] text-purple-600/80">Full access to all {TOTAL_PERMISSIONS} features &amp; settings. Cannot be restricted.</p>
          </div>

          <div className={`p-4 rounded-xl border transition-colors ${managerEnabled > 0 ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Wrench className={`w-4 h-4 ${managerEnabled > 0 ? 'text-blue-600' : 'text-gray-400'}`} />
              <p className="text-xs font-black text-blue-700">Manager</p>
              <span className="ml-auto px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-700 text-[9px] font-black uppercase tracking-wide">
                {managerEnabled}/{TOTAL_PERMISSIONS}
              </span>
            </div>
            <p className="text-[10px] text-blue-600/80">Access is controlled by the Owner via the toggles in the matrix below.</p>
          </div>

          <div className={`p-4 rounded-xl border transition-colors ${cashierEnabled > 0 ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className={`w-4 h-4 ${cashierEnabled > 0 ? 'text-green-600' : 'text-gray-400'}`} />
              <p className="text-xs font-black text-green-700">Cashier</p>
              <span className="ml-auto px-2 py-0.5 rounded-full bg-white border border-green-200 text-green-700 text-[9px] font-black uppercase tracking-wide">
                {cashierEnabled}/{TOTAL_PERMISSIONS}
              </span>
            </div>
            <p className="text-[10px] text-green-600/80">Access is controlled by the Owner via the toggles in the matrix below.</p>
          </div>
        </div>

        {/* ── Manager quick presets ── */}
        {onApplyPreset && (
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-[#191b23]">Manager Quick Presets</h4>
            </div>
            <p className="text-[9px] text-gray-400 mb-3">
              Apply a ready-made permission set to the Manager role, then fine-tune individual toggles below if needed.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {MANAGER_PRESETS.map((p) => {
                const Icon = p.icon;
                const isActive = isPresetActive(p, rolePermissions);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onApplyPreset(p.value)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isActive
                        ? 'border-[var(--brand-color)] bg-blue-50/60 ring-1 ring-[var(--brand-color)]/20'
                        : 'border-[#e1e2ed] hover:border-[var(--brand-color)]/40 hover:bg-blue-50/30'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={`w-3.5 h-3.5 ${p.color}`} />
                      <p className="text-[11px] font-bold text-[#191b23]">{p.label}</p>
                      {isActive && <Check className="w-3 h-3 text-[var(--brand-color)] ml-auto" />}
                    </div>
                    <p className="text-[9px] text-gray-400">{p.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Cashier quick presets ── */}
        {onApplyPreset && (
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-green-600" />
              <h4 className="text-xs font-bold text-[#191b23]">Cashier Quick Presets</h4>
            </div>
            <p className="text-[9px] text-gray-400 mb-3">
              Grant the Cashier role extra access. Out of the box, Cashier only gets the operational base modules.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CASHIER_PRESETS.map((p) => {
                const Icon = p.icon;
                const isActive = isPresetActive(p, rolePermissions);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onApplyPreset(p.value)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isActive
                        ? 'border-[var(--brand-color)] bg-blue-50/60 ring-1 ring-[var(--brand-color)]/20'
                        : 'border-[#e1e2ed] hover:border-[var(--brand-color)]/40 hover:bg-blue-50/30'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={`w-3.5 h-3.5 ${p.color}`} />
                      <p className="text-[11px] font-bold text-[#191b23]">{p.label}</p>
                      {isActive && <Check className="w-3 h-3 text-[var(--brand-color)] ml-auto" />}
                    </div>
                    <p className="text-[9px] text-gray-400">{p.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Permission matrix ── */}
        <div className="bg-white rounded-xl border border-[#e1e2ed] overflow-hidden">
          {/* Header row */}
          <div className={`${GRID} bg-[#f8f8fc] border-b border-[#e1e2ed] py-2.5`}>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Feature</span>
            <span className="flex items-center justify-center gap-1 text-[10px] font-bold text-purple-600" title="Owner — always allowed">
              <Crown className="w-3 h-3" />Owner
            </span>
            <span className="flex items-center justify-center gap-1 text-[10px] font-bold text-blue-600" title="Manager — configurable by Owner">
              <Wrench className="w-3 h-3" />Manager
            </span>
            <span className="flex items-center justify-center gap-1 text-[10px] font-bold text-green-600" title="Cashier — configurable by Owner">
              <Wallet className="w-3 h-3" />Cashier
            </span>
          </div>

          {PERMISSION_ROWS.map((row) => (
            <MatrixRow key={row.managerKey} row={row} rolePermissions={rolePermissions} onToggle={onToggle} />
          ))}

          {/* Billing capabilities section */}
          <div className="px-3 py-2 bg-blue-50/60 border-b border-[#e1e2ed] text-[10px] font-bold text-[var(--brand-color)] uppercase tracking-wider">
            Billing Capabilities
          </div>
          <MatrixRow row={DISCOUNT_ROW} rolePermissions={rolePermissions} onToggle={onToggle} />
        </div>

        {/* ── Live preview ── */}
        <div className="bg-white rounded-xl border border-[#e1e2ed] p-4">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="w-4 h-4 text-[var(--brand-color)]" />
            <h4 className="text-xs font-bold text-[#191b23]">Live Preview</h4>
            <span className="ml-auto text-[9px] text-gray-400">Updates as you toggle</span>
          </div>
          <p className="text-[9px] text-gray-400 mb-3">
            Exactly what the <strong>sidebar</strong> and <strong>More menu</strong> will show for each role. Struck-through / ghosted items are hidden by the current toggles.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RoleNavPreview
              roleLabel="Manager"
              roleIcon={Wrench}
              headerColor="text-blue-600"
              badge={`${managerEnabled}/${TOTAL_PERMISSIONS}`}
              sidebar={mgr.sidebar}
              more={mgr.more}
              discountAllowed={rolePermissions.managerCanApplyDiscounts === true}
            />
            <RoleNavPreview
              roleLabel="Cashier"
              roleIcon={Wallet}
              headerColor="text-green-600"
              badge={`${cashierEnabled}/${TOTAL_PERMISSIONS}`}
              sidebar={cash.sidebar}
              more={cash.more}
              discountAllowed={rolePermissions.cashierCanApplyDiscounts === true}
            />
          </div>
        </div>

        {/* ── Base access (every role) ── */}
        <div className="bg-white rounded-xl border border-[#e1e2ed] p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-bold text-[#191b23]">Base Access — Every Role</h4>
            <span className="ml-auto text-[9px] text-gray-400">Always available</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BASE_ACCESS_MODULES.map((m) => (
              <span key={m} className="px-2 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg text-[10px] font-semibold flex items-center gap-1">
                <Check className="w-2.5 h-2.5" />{m}
              </span>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2.5">
            These operational modules are part of the everyday POS flow and are available to Owner, Manager, and Cashier alike. No configuration needed.
          </p>
        </div>
      </div>
    </div>
  );
}

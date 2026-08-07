import { memo } from 'react';
import { ClipboardCheck, BarChart, Settings, MoreHorizontal, LogOut, Sparkles, Keyboard, UtensilsCrossed, LayoutDashboard } from 'lucide-react';

import type { RolePermissions } from '../src/types';

interface AppSidebarProps {
  activeWorkspace: string;
  onNavigate: (ws: string) => void;
  onLogout: () => void;
  onTour: () => void;
  onKeys: () => void;
  showKitchen?: boolean;
  role?: string;
  rolePermissions?: RolePermissions;
}

const NAV_ITEMS = [
  { id: "Dashboard", icon: LayoutDashboard, label: "Home", shortcut: "Alt+1" },
  { id: "Orders", icon: ClipboardCheck, label: "Orders", shortcut: "Alt+2" },
  { id: "Reports", icon: BarChart, label: "Reports", shortcut: "Alt+3" },
  { id: "Settings", icon: Settings, label: "Settings", shortcut: "Alt+4" },
  { id: "More", icon: MoreHorizontal, label: "More", shortcut: "Alt+5" },
];

const KITCHEN_NAV_ITEM = { id: "Kitchen", icon: UtensilsCrossed, label: "Kitchen", shortcut: "Alt+6" };

// ─── Memoized nav item button ──────────────────────────────────

interface SidebarNavItemProps {
  item: { id: string; icon: any; label: string; shortcut: string };
  isActive: boolean;
  onNavigate: (ws: string) => void;
}

const SidebarNavItem = memo(function SidebarNavItem({ item, isActive, onNavigate }: SidebarNavItemProps) {
  const Icon = item.icon;
  return (
    <button
      onClick={() => onNavigate(item.id)}
      className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
        isActive
          ? "bg-[#2563eb] text-white shadow-md"
          : "text-gray-400 hover:text-white hover:bg-[#2e3039]"
      }`}
      title={`${item.label} (${item.shortcut})`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[7px] font-semibold uppercase tracking-wider">{item.label}</span>
    </button>
  );
});

export default function AppSidebar({ activeWorkspace, onNavigate, onLogout, onTour, onKeys, showKitchen, role, rolePermissions }: AppSidebarProps) {
  // Filter nav items based on role + role permissions
  const isOwner = role === 'Owner';
  const isManager = role === 'Manager';
  const isCashier = role === 'Cashier';
  const perms = rolePermissions;

  // Always visible: Dashboard, Orders, Kitchen
  // Role-restricted: Settings & Reports (Owner only, or Manager if the matching
  // permission toggle is enabled), More (some items filtered inside).
  const restricted = (itemId: string) => {
    if (isOwner) return true; // Owner sees everything
    if (isCashier) {
      // Operational items are always visible; Reports/Settings follow the
      // Owner-configured cashier toggles
      if (['Dashboard', 'Orders', 'Kitchen', 'More'].includes(itemId)) return true;
      if (itemId === 'Reports') return perms?.cashierCanAccessReports === true;
      if (itemId === 'Settings') return perms?.cashierCanAccessSettings === true;
      return false;
    }
    // Manager: gated by the Owner-configured permission toggles so the nav
    // never shows a button that would bounce the user back to the Dashboard.
    if (isManager) {
      if (itemId === 'Settings') return perms?.managerCanAccessSettings === true;
      if (itemId === 'Reports') return perms?.managerCanAccessReports === true;
      return true; // Manager sees everything else
    }
    return true;
  };
  const navItems = showKitchen 
    ? [NAV_ITEMS[0], KITCHEN_NAV_ITEM, ...NAV_ITEMS.slice(1)]
    : NAV_ITEMS;
  const filteredNavItems = navItems.filter(item => restricted(item.id));

  return (
    <aside className="w-16 bg-[#191b23] border-r border-[#2e3039] flex flex-col items-center py-3 gap-1 shrink-0 overflow-y-auto">
      {filteredNavItems.map((item) => (
        <SidebarNavItem
          key={item.id}
          item={item}
          isActive={activeWorkspace === item.id}
          onNavigate={onNavigate}
        />
      ))}

      <div className="flex-1" />

      <button onClick={onLogout}
        className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-red-400 hover:bg-[#2e3039] transition-all cursor-pointer"
        title="Close Shift"
      >
        <LogOut className="w-5 h-5" />
        <span className="text-[7px] font-semibold uppercase">Exit</span>
      </button>
      <button onClick={onTour}
        className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-amber-400 hover:text-amber-300 hover:bg-[#2e3039] transition-all cursor-pointer"
        title="Restart Guided Tour"
      >
        <Sparkles className="w-5 h-5" />
        <span className="text-[7px] font-semibold uppercase">Tour</span>
      </button>
      <button onClick={onKeys}
        className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-white hover:bg-[#2e3039] transition-all cursor-pointer"
        title="Keyboard Shortcuts"
      >
        <Keyboard className="w-5 h-5" />
        <span className="text-[7px] font-semibold uppercase">Keys</span>
      </button>
    </aside>
  );
}

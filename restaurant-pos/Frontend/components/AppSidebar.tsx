import { memo, useState } from 'react';
import {
  ClipboardCheck, BarChart, Settings, MoreHorizontal, LogOut, Keyboard, UtensilsCrossed, LayoutDashboard, Bell,
} from 'lucide-react';
import type { RolePermissions } from '../src/types';

interface AppSidebarProps {
  activeWorkspace: string;
  onNavigate: (ws: string) => void;
  onLogout: () => void;
  onKeys: () => void;
  onTour?: () => void;
  showKitchen?: boolean;
  role?: string;
  rolePermissions?: RolePermissions;
  /** Pending customer service calls (bell) — table / car / pickup. */
  pendingCalls?: number;
  /** Hide the Calls (bell) nav item when QR ordering is disabled. */
  showCalls?: boolean;
}

const NAV_ITEMS = [
  { id: "Dashboard", icon: LayoutDashboard, label: "Home", shortcut: "Alt+1" },
  { id: "Orders", icon: ClipboardCheck, label: "Orders", shortcut: "Alt+2" },
  { id: "Calls", icon: Bell, label: "Calls", shortcut: "Alt+7" },
  { id: "Reports", icon: BarChart, label: "Reports", shortcut: "Alt+3" },
  { id: "Settings", icon: Settings, label: "Settings", shortcut: "Alt+4" },
  { id: "More", icon: MoreHorizontal, label: "More", shortcut: "Alt+5" },
];
const KITCHEN_NAV_ITEM = { id: "Kitchen", icon: UtensilsCrossed, label: "Kitchen", shortcut: "Alt+6" };

interface SidebarNavItemProps {
  item: { id: string; icon: any; label: string; shortcut: string };
  isActive: boolean;
  onNavigate: (ws: string) => void;
  /** Live pending-count badge (customer calls). */
  badge?: number;
}

const SidebarNavItem = memo(function SidebarNavItem({ item, isActive, onNavigate, badge }: SidebarNavItemProps) {
  const Icon = item.icon;
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <button
      onClick={() => onNavigate(item.id)}
      className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
        isActive ? "bg-[#2563eb] text-white shadow-md" : "text-gray-400 hover:text-white hover:bg-[#2e3039]"
      }`}
      title={`${item.label} (${item.shortcut})${showBadge ? ` — ${badge} pending call${badge === 1 ? '' : 's'}` : ''}`}
    >
      <Icon className="w-5 h-5" />
      {showBadge && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow animate-pulse">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
      <span className="text-[7px] font-semibold uppercase tracking-wider">{item.label}</span>
    </button>
  );
});

export default function AppSidebar({ activeWorkspace, onNavigate, onLogout, onKeys, onTour, showKitchen, role, rolePermissions, pendingCalls = 0, showCalls = true }: AppSidebarProps) {
  const isOwner = role === 'Owner';
  const isManager = role === 'Manager';
  const isCashier = role === 'Cashier';
  const perms = rolePermissions;
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  const restricted = (itemId: string) => {
    if (isOwner) return true;
    if (isCashier) {
      if (['Dashboard', 'Orders', 'Kitchen', 'Calls', 'More'].includes(itemId)) return true;
      if (itemId === 'Reports') return perms?.cashierCanAccessReports === true;
      if (itemId === 'Settings') return perms?.cashierCanAccessSettings === true;
      return false;
    }
    if (isManager) {
      if (itemId === 'Settings') return perms?.managerCanAccessSettings === true;
      if (itemId === 'Reports') return perms?.managerCanAccessReports === true;
      return true;
    }
    return true;
  };

  const navItems = showKitchen ? [NAV_ITEMS[0], KITCHEN_NAV_ITEM, ...NAV_ITEMS.slice(1)] : NAV_ITEMS;
  const filteredNavItems = navItems.filter(item => item.id === 'Calls' && !showCalls ? false : restricted(item.id));

  const confirmExit = () => {
    setConfirmExitOpen(false);
    onLogout();
  };

  return (
    <>
      <aside className="w-16 bg-[#191b23] border-r border-[#2e3039] flex flex-col items-center py-3 gap-1 shrink-0 overflow-y-auto">
        {filteredNavItems.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            isActive={activeWorkspace === item.id}
            onNavigate={onNavigate}
            badge={item.id === 'Calls' ? pendingCalls : undefined}
          />
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setConfirmExitOpen(true)}
          className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-red-400 hover:bg-[#2e3039] transition-all cursor-pointer"
          title="Close Shift"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[7px] font-semibold uppercase">Exit</span>
        </button>
        <button
          onClick={onKeys}
          className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-white hover:bg-[#2e3039] transition-all cursor-pointer"
          title="Keyboard Shortcuts"
        >
          <Keyboard className="w-5 h-5" />
          <span className="text-[7px] font-semibold uppercase">Keys</span>
        </button>
      </aside>

      {/* Exit confirmation — styled modal (replaces the old native confirm) */}
      {confirmExitOpen && (
        <div
          className="fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmExitOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
              <LogOut className="w-5 h-5 text-red-600" />
            </div>
            <h4 className="font-black text-gray-900 text-sm">Close shift & exit?</h4>
            <p className="text-xs text-gray-500 leading-relaxed mt-1.5">
              Are you sure you want to close shift and log out? Open bills are kept safe and can be resumed after you sign back in.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setConfirmExitOpen(false)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmExit}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" /> Yes, Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

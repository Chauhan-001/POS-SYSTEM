import { memo } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Store,
  Users,
  CreditCard,
  Monitor,
  BarChart3,
  ScrollText,
  Cpu,
  HeadphonesIcon,
  Settings,
  UserCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Building2,
  Wallet,
  PieChart,
  BadgePercent,
  Shield,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { useSidebar } from '../context/SidebarContext'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Restaurants', icon: Store, to: '/restaurants' },
  { label: 'Customer CRM', icon: Users, to: '/customer-crm' },
  { label: 'Finance', icon: Wallet, to: '/finance' },
  { label: 'Reports', icon: PieChart, to: '/reports' },
  { label: 'Admin Reports', icon: BarChart3, to: '/admin-reports' },
  { label: 'Plans', icon: Building2, to: '/subscription-plans' },
  { label: 'Subscriptions', icon: BadgePercent, to: '/subscriptions' },
  { label: 'Devices', icon: Monitor, to: '/devices' },
  { label: 'Analytics', icon: BarChart3, to: '/analytics' },
  { label: 'Subscription Revenue', icon: CreditCard, to: '/subscription-revenue' },
  { label: 'Security', icon: Shield, to: '/security' },
  { label: 'Audit Log', icon: ScrollText, to: '/audit-log' },
  { label: 'AI Usage', icon: Cpu, to: '/ai-usage' },
  { label: 'Profile', icon: UserCircle, to: '/profile' },
]

interface SidebarNavLinkProps {
  item: typeof navItems[number]
  collapsed: boolean
}

const SidebarNavLink = memo(function SidebarNavLink({ item, collapsed }: SidebarNavLinkProps) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200',
          collapsed && 'justify-center px-2',
        )
      }
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={20} />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  )
})

export const Sidebar = memo(function Sidebar() {
  const { collapsed, toggle } = useSidebar()
  const { logout } = useAuth()

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-surface-200 bg-white transition-all duration-300 dark:border-surface-700 dark:bg-surface-900',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn(
        'flex h-16 items-center border-b border-surface-200 px-4 dark:border-surface-700',
        collapsed ? 'justify-center' : 'justify-between',
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Building2 size={24} className="text-primary-600" />
            <span className="text-lg font-bold text-surface-900 dark:text-surface-100">Admin</span>
          </div>
        )}
        <button
          onClick={toggle}
          className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {navItems.map((item) => (
          <SidebarNavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="border-t border-surface-200 p-2 dark:border-surface-700">
        <button
          onClick={logout}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 hover:text-danger dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-danger',
            collapsed && 'justify-center px-2',
          )}
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut size={20} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  )
})

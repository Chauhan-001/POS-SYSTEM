import { memo } from 'react'
import { Moon, Sun, Bell, Search, Menu } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useSidebar } from '../context/SidebarContext'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'

export const Navbar = memo(function Navbar() {
  const { theme, toggleTheme } = useTheme()
  const { toggle } = useSidebar()
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-surface-200 bg-white/80 px-6 backdrop-blur-sm dark:border-surface-700 dark:bg-surface-900/80">
      <button
        onClick={toggle}
        className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 lg:hidden dark:hover:bg-surface-700 dark:hover:text-surface-300"
      >
        <Menu size={20} />
      </button>

      <div className="hidden md:relative md:flex md:flex-1 md:max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          type="text"
          placeholder="Search..."
          className="w-full rounded-lg border border-surface-300 bg-surface-50 py-2 pl-9 pr-3 text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 dark:placeholder-surface-500"
        />
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>

        <Button variant="ghost" size="sm" className="relative">
          <Bell size={18} />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
        </Button>

        <div className="ml-2 flex items-center gap-3 border-l border-surface-200 pl-3 dark:border-surface-700">
          <div className="text-right">
            <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{user?.name || 'Admin'}</p>
            <p className="text-xs text-surface-500 dark:text-surface-400">{user?.userId || ''}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
            {user?.name?.charAt(0)?.toUpperCase() || 'A'}
          </div>
        </div>
      </div>
    </header>
  )
})

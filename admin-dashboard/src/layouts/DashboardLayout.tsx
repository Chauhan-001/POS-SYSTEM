import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { useSidebar } from '../context/SidebarContext'
import { cn } from '../utils/cn'

export function DashboardLayout() {
  const { collapsed } = useSidebar()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className={cn(
        'flex flex-1 flex-col overflow-hidden transition-all duration-300',
      )}>
        <Navbar />
        <main className="flex-1 overflow-y-auto bg-surface-50 p-6 dark:bg-surface-950">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

import { NavLink } from 'react-router-dom'

type BottomNavItem = {
  to: string
  label: string
  icon: string // material symbols name
}

const items: BottomNavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/rewards-wallet', label: 'Rewards', icon: 'redeem' },
  { to: '/menu', label: 'Menu', icon: 'menu' },
  { to: '/profile', label: 'Profile', icon: 'person' },
]

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex gap-2 border-t border-outline-variant bg-surface px-4 pb-3 pt-2 shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => {
            return [
              'flex flex-1 flex-col items-center justify-end gap-1 rounded-full',
              'transition-colors duration-200',
              isActive ? 'text-primary' : 'text-on-background',
            ].join(' ')
          }}
        >
          <div className="flex h-8 items-center justify-center" aria-hidden="true">
            <span className="material-symbols-outlined">{item.icon}</span>
          </div>

          <p className="text-xs font-bold leading-normal tracking-[0.015em]">
            {item.label}
          </p>
        </NavLink>
      ))}
    </nav>
  )
}

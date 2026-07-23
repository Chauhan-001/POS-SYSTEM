import type { PropsWithChildren } from 'react'

type PageShellProps = PropsWithChildren<{
  className?: string
  /**
   * When true, adds bottom padding to account for the fixed BottomNav.
   */
  withBottomNav?: boolean
}>

export function PageShell({
  children,
  className,
  withBottomNav = false,
}: PageShellProps) {
  return (
    <div className={['min-h-dvh', withBottomNav ? 'pb-24' : '', className ?? ''].join(' ')}>
      {children}
    </div>
  )
}

import type { PropsWithChildren } from 'react'

type GlassCardProps = PropsWithChildren<{
  className?: string
}>

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div
      className={[
        'rounded-xl bg-white/10 backdrop-blur-md border border-white/20',
        'shadow-[0_10px_30px_rgba(0,0,0,0.08)]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

import { cn } from '../../utils/cn'
import { Info } from 'lucide-react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  position?: 'top' | 'bottom'
  showIcon?: boolean
  className?: string
}

export function Tooltip({
  content,
  children,
  position = 'top',
  showIcon = false,
  className,
}: TooltipProps) {
  return (
    <div className={cn('relative group inline-flex items-center gap-1', className)}>
      {children}
      {showIcon && <Info size={12} className="shrink-0 text-surface-400 opacity-0 group-hover:opacity-100 transition-opacity" />}

      {/* Rich popover */}
      <div
        className={cn(
          'absolute z-50 px-2.5 py-1.5 rounded-lg shadow-lg pointer-events-none',
          'bg-surface-900 text-white dark:bg-surface-700',
          'text-[11px] leading-tight max-w-[220px] text-center',
          'opacity-0 group-hover:opacity-100 invisible group-hover:visible',
          'transition-all duration-200 ease-out translate-y-0.5 group-hover:translate-y-0',
          position === 'top'
            ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
            : 'top-full mt-2 left-1/2 -translate-x-1/2',
        )}
      >
        {content}
        {/* Arrow */}
        <div
          className={cn(
            'absolute left-1/2 -translate-x-1/2 border-4',
            position === 'top'
              ? 'top-full border-l-transparent border-r-transparent border-b-transparent border-t-surface-900 dark:border-t-surface-700'
              : 'bottom-full border-l-transparent border-r-transparent border-t-transparent border-b-surface-900 dark:border-b-surface-700',
          )}
        />
      </div>
    </div>
  )
}

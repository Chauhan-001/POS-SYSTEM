import { cn } from '../../utils/cn'

interface ToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Toggle({ enabled, onChange, label, description, disabled, size = 'md' }: ToggleProps) {
  const handleClick = () => {
    if (!disabled) onChange(!enabled)
  }

  return (
    <div className="flex items-center gap-3 cursor-pointer" onClick={handleClick}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900',
          disabled && 'cursor-not-allowed opacity-50',
          size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
          enabled ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out',
            size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5',
            enabled ? (size === 'sm' ? 'translate-x-[14px]' : 'translate-x-5') : 'translate-x-0.5',
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col pointer-events-none">
          {label && (
            <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{label}</span>
          )}
          {description && (
            <span className="text-xs text-surface-500 dark:text-surface-400">{description}</span>
          )}
        </div>
      )}
    </div>
  )
}

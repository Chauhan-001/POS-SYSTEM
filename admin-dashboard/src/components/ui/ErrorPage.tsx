import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './Button'

interface ErrorPageProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorPage({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
}: ErrorPageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 rounded-full bg-danger/10 p-4">
        <AlertTriangle size={32} className="text-danger" />
      </div>
      <h2 className="text-xl font-semibold text-surface-900 dark:text-surface-100">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-surface-500 dark:text-surface-400">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RefreshCw size={16} />
          Try Again
        </Button>
      )}
    </div>
  )
}

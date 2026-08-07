import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './Button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error.message, errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 rounded-full bg-danger/10 p-4">
            <AlertTriangle size={32} className="text-danger" />
          </div>
          <h2 className="text-xl font-semibold text-surface-900 dark:text-surface-100">
            Something went wrong
          </h2>
          <p className="mt-2 max-w-md text-sm text-surface-500 dark:text-surface-400">
            An unexpected error occurred while rendering this page. Please try again.
          </p>
          {this.state.error && (
            <details className="mt-4 max-w-md text-left">
              <summary className="cursor-pointer text-xs text-surface-400 hover:text-surface-600">
                Error details
              </summary>
              <pre className="mt-2 rounded-lg bg-danger/5 p-3 text-xs text-danger font-mono whitespace-pre-wrap break-all border border-danger/20">
                {this.state.error.name}: {this.state.error.message}
              </pre>
            </details>
          )}
          <Button variant="outline" className="mt-6" onClick={this.handleReset}>
            <RefreshCw size={16} /> Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

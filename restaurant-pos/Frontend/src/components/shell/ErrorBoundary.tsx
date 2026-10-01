/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ErrorBoundary — Catches rendering errors in child components
 * and displays a fallback UI instead of crashing the entire app.
 */

import React, { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center h-full min-h-[200px] bg-[var(--color-bg-page)] p-8">
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-red-200 shadow-lg p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-lg font-black text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-2 text-center">
              The application encountered an unexpected error. Please try again or contact support if the problem persists.
            </p>
            <details className="mb-4 text-left">
              <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 font-medium">Show error details</summary>
              <pre className="mt-2 p-2 bg-red-50 rounded-lg text-[10px] text-red-700 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto border border-red-100">
                {this.state.error?.name || 'Error'}: {this.state.error?.message || 'Unknown error'}
              </pre>
            </details>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

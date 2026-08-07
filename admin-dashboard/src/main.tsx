/**
 * =============================================================================
 *  main.tsx — Admin Dashboard Entry Point
 * =============================================================================
 *
 * Purpose:
 *   React application entry point. Sets up all global providers and error handlers.
 *
 * Provider Hierarchy (outer → inner):
 *   StrictMode
 *     ErrorBoundary          — Catches React render errors
 *       QueryClientProvider  — React Query for server state
 *         ThemeProvider      — Dark/light theme
 *           AuthProvider     — Authentication state
 *             SidebarProvider — Sidebar collapse state
 *               RouterProvider — Route definitions
 *               Toaster        — Toast notifications
 *
 * Global Listeners:
 *   - window 'error'               : Uncaught JS errors
 *   - window 'unhandledrejection'  : Unhandled promise rejections
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { SidebarProvider } from './context/SidebarContext'
import { router } from './routes'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import './style.css'

// =============================================================================
// GLOBAL ERROR HANDLERS
// =============================================================================

// Capture async errors and unhandled promise rejections that
// React ErrorBoundary cannot catch.
window.addEventListener('error', (event) => {
  // Ignore resource load failures (Event, not ErrorEvent)
  if (event instanceof ErrorEvent) {
    console.error('[Global] Uncaught error:', event.error?.message || event.message)
  }
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled rejection:', event.reason?.message || event.reason)
})

// =============================================================================
// QUERY CLIENT
// =============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

// =============================================================================
// RENDER
// =============================================================================

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <SidebarProvider>
              <RouterProvider router={router} />
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 4000,
                  style: {
                    borderRadius: '12px',
                    fontSize: '14px',
                  },
                }}
              />
            </SidebarProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

/**
 * =============================================================================
 *  routes/index.tsx — Admin Dashboard Router Configuration
 * =============================================================================
 *
 * Routes:
 *   /login               → Login page (public)
 *   /                    → Protected layout wrapper
 *     /dashboard         → Dashboard (stats overview)
 *     /restaurants       → Restaurant list
 *     /restaurants/:id   → Restaurant detail
 *     /owners            → Owner management
 *     /subscription-plans → Plan management
 *     /devices           → Device management
 *     /analytics         → Analytics charts
 *     /ai-usage          → AI usage stats
 *     /support           → Support search
 *     /settings          → Platform settings
 *     /profile           → Admin profile
 *   *                    → Redirect to /dashboard
 *
 * All routes (except /login) are wrapped in ProtectedRoute + DashboardLayout.
 * All page components are lazy-loaded for code splitting.
 */

import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { ProtectedRoute } from '../components/ui/ProtectedRoute'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

const Login = lazy(() => import('../pages/core/Login'))
const Dashboard = lazy(() => import('../pages/core/Dashboard'))
const Restaurants = lazy(() => import('../pages/restaurants/Restaurants'))
const RestaurantDetails = lazy(() => import('../pages/restaurants/RestaurantDetails'))
const RestaurantCrm = lazy(() => import('../pages/restaurants/RestaurantCrm'))
const CustomerCrm = lazy(() => import('../pages/marketing/CustomerCrm'))
const CalendarManager = lazy(() => import('../pages/marketing/CalendarManager'))
const FinanceConsole = lazy(() => import('../pages/finance/FinanceConsole'))
const RestaurantFinance = lazy(() => import('../pages/restaurants/RestaurantFinance'))
const ReportsConsole = lazy(() => import('../pages/reports/ReportsConsole'))
const RestaurantReports = lazy(() => import('../pages/restaurants/RestaurantReports'))
const AdminReports = lazy(() => import('../pages/reports/AdminReports'))
const Owners = lazy(() => import('../pages/platform/Owners'))
const Subscriptions = lazy(() => import('../pages/platform/Subscriptions'))
const SubscriptionPlans = lazy(() => import('../pages/platform/SubscriptionPlans'))
const SubscriptionRevenue = lazy(() => import('../pages/platform/SubscriptionRevenue'))
const Devices = lazy(() => import('../pages/platform/Devices'))
const Analytics = lazy(() => import('../pages/platform/Analytics'))
// AIUsage page removed (Phase 3 — AI-only admin page)
const Support = lazy(() => import('../pages/admin/Support'))
const AuditLog = lazy(() => import('../pages/admin/AuditLog'))
const Security = lazy(() => import('../pages/admin/Security'))
const Settings = lazy(() => import('../pages/core/Settings'))
const Profile = lazy(() => import('../pages/core/Profile'))

function LazyFallback() {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <LoadingSpinner size="lg" />
    </div>
  )
}

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <DashboardLayout />
    </ProtectedRoute>
  )
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <Login />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: 'dashboard',
        element: <Suspense fallback={<LazyFallback />}><Dashboard /></Suspense>,
      },
      {
        path: 'restaurants',
        element: <Suspense fallback={<LazyFallback />}><Restaurants /></Suspense>,
      },
      {
        path: 'restaurants/:id',
        element: <Suspense fallback={<LazyFallback />}><RestaurantDetails /></Suspense>,
      },
      {
        path: 'restaurants/:id/crm',
        element: <Suspense fallback={<LazyFallback />}><RestaurantCrm /></Suspense>,
      },
      {
        path: 'customer-crm',
        element: <Suspense fallback={<LazyFallback />}><CustomerCrm /></Suspense>,
      },
      {
        path: 'calendar',
        element: <Suspense fallback={<LazyFallback />}><CalendarManager /></Suspense>,
      },
      {
        path: 'restaurants/:id/finance',
        element: <Suspense fallback={<LazyFallback />}><RestaurantFinance /></Suspense>,
      },
      {
        path: 'restaurants/:id/reports',
        element: <Suspense fallback={<LazyFallback />}><RestaurantReports /></Suspense>,
      },
      {
        path: 'finance',
        element: <Suspense fallback={<LazyFallback />}><FinanceConsole /></Suspense>,
      },
      {
        path: 'reports',
        element: <Suspense fallback={<LazyFallback />}><ReportsConsole /></Suspense>,
      },
      {
        path: 'admin-reports',
        element: <Suspense fallback={<LazyFallback />}><AdminReports /></Suspense>,
      },
      {
        path: 'owners',
        element: <Suspense fallback={<LazyFallback />}><Owners /></Suspense>,
      },

      {
        path: 'subscriptions',
        element: <Suspense fallback={<LazyFallback />}><Subscriptions /></Suspense>,
      },
      {
        path: 'subscription-plans',
        element: <Suspense fallback={<LazyFallback />}><SubscriptionPlans /></Suspense>,
      },
      {
        path: 'devices',
        element: <Suspense fallback={<LazyFallback />}><Devices /></Suspense>,
      },
      {
        path: 'analytics',
        element: <Suspense fallback={<LazyFallback />}><Analytics /></Suspense>,
      },
      {
        path: 'subscription-revenue',
        element: <Suspense fallback={<LazyFallback />}><SubscriptionRevenue /></Suspense>,
      },
      // 'ai-usage' route removed (Phase 3 — AI-only admin page)
      {
        path: 'audit-log',
        element: <Suspense fallback={<LazyFallback />}><AuditLog /></Suspense>,
      },
      {
        path: 'security',
        element: <Suspense fallback={<LazyFallback />}><Security /></Suspense>,
      },
      {
        path: 'support',
        element: <Suspense fallback={<LazyFallback />}><Support /></Suspense>,
      },
      {
        path: 'settings',
        element: <Suspense fallback={<LazyFallback />}><Settings /></Suspense>,
      },
      {
        path: 'profile',
        element: <Suspense fallback={<LazyFallback />}><Profile /></Suspense>,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
])

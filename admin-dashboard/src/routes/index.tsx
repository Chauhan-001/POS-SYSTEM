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

const Login = lazy(() => import('../pages/Login'))
const Dashboard = lazy(() => import('../pages/Dashboard'))
const Restaurants = lazy(() => import('../pages/Restaurants'))
const RestaurantDetails = lazy(() => import('../pages/RestaurantDetails'))
const RestaurantCrm = lazy(() => import('../pages/RestaurantCrm'))
const CustomerCrm = lazy(() => import('../pages/CustomerCrm'))
const FinanceConsole = lazy(() => import('../pages/FinanceConsole'))
const RestaurantFinance = lazy(() => import('../pages/RestaurantFinance'))
const ReportsConsole = lazy(() => import('../pages/ReportsConsole'))
const RestaurantReports = lazy(() => import('../pages/RestaurantReports'))
const AdminReports = lazy(() => import('../pages/AdminReports'))
const Owners = lazy(() => import('../pages/Owners'))
const Subscriptions = lazy(() => import('../pages/Subscriptions'))
const SubscriptionPlans = lazy(() => import('../pages/SubscriptionPlans'))
const SubscriptionRevenue = lazy(() => import('../pages/SubscriptionRevenue'))
const Devices = lazy(() => import('../pages/Devices'))
const Analytics = lazy(() => import('../pages/Analytics'))
const AIUsage = lazy(() => import('../pages/AIUsage'))
const Support = lazy(() => import('../pages/Support'))
const AuditLog = lazy(() => import('../pages/AuditLog'))
const VoiceAliasManager = lazy(() => import('../pages/VoiceAliasManager'))
const VoiceInventoryDashboard = lazy(() => import('../pages/VoiceInventoryDashboard'))
const Security = lazy(() => import('../pages/Security'))
const Settings = lazy(() => import('../pages/Settings'))
const Profile = lazy(() => import('../pages/Profile'))

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
        path: 'voice-aliases',
        element: <Suspense fallback={<LazyFallback />}><VoiceAliasManager /></Suspense>,
      },
      {
        path: 'voice-inventory',
        element: <Suspense fallback={<LazyFallback />}><VoiceInventoryDashboard /></Suspense>,
      },
      {
        path: 'analytics',
        element: <Suspense fallback={<LazyFallback />}><Analytics /></Suspense>,
      },
      {
        path: 'subscription-revenue',
        element: <Suspense fallback={<LazyFallback />}><SubscriptionRevenue /></Suspense>,
      },
      {
        path: 'ai-usage',
        element: <Suspense fallback={<LazyFallback />}><AIUsage /></Suspense>,
      },
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

/**
 * =============================================================================
 *  Dashboard.tsx — Admin Dashboard Overview Page (Phase 2.6)
 * =============================================================================
 *
 * Features:
 *   - KPI stat cards (total/active restaurants, owners, devices, subs, AI usage)
 *   - Recent activity feed (latest admin actions)
 *   - Latest registered restaurants list
 *   - Subscription overview breakdown (active/paused/expired/total)
 *   - Growth metrics section with percentage changes
 *   - Device analytics overview (health, platform, status)
 *   - AI analytics overview (requests, success rate, cache hits)
 *   - API request analytics (total, success rate, error rate)
 *   - Activity metrics (logins, users, recent activity)
 *   - Churn metrics (suspended, churn rate, trial conversion)
 *   - Auto-refresh every 60 seconds
 *   - Quick action buttons for common tasks
 *
 * Data Sources:
 *   - GET /admin/analytics/dashboard          → DashboardStats
 *   - GET /admin/analytics/recent-activity    → Activity items
 *   - GET /admin/analytics/latest-restaurants → Recent restaurants
 *   - GET /admin/analytics/ai                 → AIAnalytics
 *   - GET /admin/analytics/devices             → DeviceAnalytics
 *   - GET /admin/analytics/growth              → GrowthMetrics
 *   - GET /admin/analytics/churn               → ChurnMetrics
 *   - GET /admin/analytics/activity            → ActivityMetrics
 *   - GET /admin/analytics/api-requests        → ApiRequestAnalytics
 */

import { useQuery } from '@tanstack/react-query'
import {
  Store,
  Users,
  Monitor,
  CreditCard,
  LogIn,
  Cpu,
  ArrowRight,
  Store as StoreIcon,
  TrendingUp,
  Activity,
  Clock,
  AlertTriangle,
  BarChart3,
  Globe,
  Wifi,
  WifiOff,
  Zap,
  Shield,
  PieChart,
  Smartphone,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { Button } from '../components/ui/Button'
import {
  getDashboardStats,
  getRecentActivity,
  getLatestRestaurants,
  getAIAnalytics,
  getDeviceAnalytics,
  getGrowthMetrics,
  getChurnMetrics,
  getActivityMetrics,
  getApiRequestAnalytics,
} from '../api/analytics'
import { formatDateTime, formatNumber } from '../utils/format'

const REFRESH_INTERVAL = 60_000 // 60 seconds auto-refresh

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  link,
  isLoading,
}: {
  label: string
  value?: number
  icon: any
  color: string
  link: string
  isLoading: boolean
}) {
  return (
    <Link to={link} className="block">
      <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-surface-500 dark:text-surface-400">{label}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">
                {formatNumber(value ?? 0)}
              </p>
            )}
          </div>
          <div className={`rounded-lg p-2.5 ${color}`}>
            <Icon size={20} />
          </div>
        </div>
      </Card>
    </Link>
  )
}

function GrowthBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-surface-400">—</span>
  const isPositive = value > 0
  return (
    <span className={`text-xs font-medium ${isPositive ? 'text-success' : 'text-danger'}`}>
      {isPositive ? '+' : ''}{value}%
    </span>
  )
}

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: getDashboardStats,
    refetchInterval: REFRESH_INTERVAL,
  })

  const recentActivity = useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: getRecentActivity,
    refetchInterval: REFRESH_INTERVAL,
  })

  const latestRestaurants = useQuery({
    queryKey: ['dashboard', 'latest-restaurants'],
    queryFn: getLatestRestaurants,
    refetchInterval: REFRESH_INTERVAL,
  })

  const aiAnalytics = useQuery({
    queryKey: ['dashboard', 'ai-analytics'],
    queryFn: () => getAIAnalytics(7),
    refetchInterval: REFRESH_INTERVAL,
  })

  const deviceAnalytics = useQuery({
    queryKey: ['dashboard', 'device-analytics'],
    queryFn: getDeviceAnalytics,
    refetchInterval: REFRESH_INTERVAL,
  })

  const growth = useQuery({
    queryKey: ['dashboard', 'growth'],
    queryFn: getGrowthMetrics,
    refetchInterval: REFRESH_INTERVAL,
  })

  const churn = useQuery({
    queryKey: ['dashboard', 'churn'],
    queryFn: getChurnMetrics,
    refetchInterval: REFRESH_INTERVAL,
  })

  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: getActivityMetrics,
    refetchInterval: REFRESH_INTERVAL,
  })

  const apiRequests = useQuery({
    queryKey: ['dashboard', 'api-requests'],
    queryFn: () => getApiRequestAnalytics(7),
    refetchInterval: REFRESH_INTERVAL,
  })

  if (stats.error) {
    return <ErrorPage title="Failed to load dashboard" message={stats.error.message} onRetry={() => stats.refetch()} />
  }

  // Subscription counts come directly from the backend now
  const activeSubs = stats.data?.subscriptionCounts?.active ?? 0
  const pausedSubs = stats.data?.subscriptionCounts?.paused ?? 0
  const expiredSubs = stats.data?.subscriptionCounts?.expired ?? 0
  const totalSubs = stats.data?.subscriptionCounts?.total ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Dashboard</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Overview of your platform</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-surface-400">
          <Clock size={14} />
          <span>Auto-refresh 60s</span>
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Restaurants" value={stats.data?.totalRestaurants} icon={Store} color="text-primary-600 bg-primary-50 dark:bg-primary-900/20" link="/restaurants" isLoading={stats.isLoading} />
        <StatCard label="Active Restaurants" value={stats.data?.activeRestaurants} icon={Store} color="text-success bg-success/10" link="/restaurants" isLoading={stats.isLoading} />
        <StatCard label="Total Owners" value={stats.data?.totalOwners} icon={Users} color="text-info bg-info/10" link="/owners" isLoading={stats.isLoading} />
        <StatCard label="Active Devices" value={stats.data?.activeDevices} icon={Monitor} color="text-primary-600 bg-primary-50 dark:bg-primary-900/20" link="/devices" isLoading={stats.isLoading} />
        <StatCard label="Active Subscriptions" value={activeSubs} icon={CreditCard} color="text-success bg-success/10" link="/subscriptions" isLoading={stats.isLoading} />
        <StatCard label="Subscriptions Expiring" value={stats.data?.subscriptionsExpiring} icon={CreditCard} color="text-warning bg-warning/10" link="/subscriptions" isLoading={stats.isLoading} />
        <StatCard label="Today's Logins" value={stats.data?.todayLogins} icon={LogIn} color="text-success bg-success/10" link="/analytics" isLoading={stats.isLoading} />
        <StatCard label="AI Requests" value={stats.data?.aiRequests} icon={Cpu} color="text-info bg-info/10" link="/ai-usage" isLoading={stats.isLoading} />
      </div>

      {/* Growth Metrics */}
      {growth.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><TrendingUp size={16} className="inline mr-2" />Growth Metrics</CardTitle>
              <CardDescription>Period-over-period growth rates</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-2 font-medium text-surface-500">Metric</th>
                  <th className="text-right py-2 font-medium text-surface-500">Daily</th>
                  <th className="text-right py-2 font-medium text-surface-500">Weekly</th>
                  <th className="text-right py-2 font-medium text-surface-500">Monthly</th>
                  <th className="text-right py-2 font-medium text-surface-500">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Restaurants', growth.data.restaurantGrowth],
                  ['Revenue', growth.data.revenueGrowth],
                  ['Users', growth.data.userGrowth],
                  ['Devices', growth.data.deviceGrowth],
                  ['AI Usage', growth.data.aiUsageGrowth],
                ] as const).map(([label, g]) => (
                  <tr key={label} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2.5 font-medium text-surface-700 dark:text-surface-300">{label}</td>
                    <td className="text-right py-2.5"><GrowthBadge value={g.daily} /></td>
                    <td className="text-right py-2.5"><GrowthBadge value={g.weekly} /></td>
                    <td className="text-right py-2.5"><GrowthBadge value={g.monthly} /></td>
                    <td className="text-right py-2.5"><GrowthBadge value={g.yearly} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* AI Analytics Overview */}
      {aiAnalytics.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><Cpu size={16} className="inline mr-2" />AI Analytics (7 days)</CardTitle>
              <CardDescription>AI usage, success rate, and performance</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Total Requests</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(aiAnalytics.data.totalRequests)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Success Rate</p>
                <p className="text-xl font-bold text-success">{aiAnalytics.data.successRate}%</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Failures</p>
                <p className="text-xl font-bold text-danger">{formatNumber(aiAnalytics.data.failures)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Cache Hits</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(aiAnalytics.data.cacheHits)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Fallback Usage</p>
                <p className="text-xl font-bold text-warning">{formatNumber(aiAnalytics.data.fallbackUsage)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Avg Latency</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{aiAnalytics.data.averageLatency}ms</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Device Analytics Overview */}
      {deviceAnalytics.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><Smartphone size={16} className="inline mr-2" />Device Analytics</CardTitle>
              <CardDescription>Device status, health, and platform breakdown</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid gap-6 sm:grid-cols-3">
              {/* Status breakdown */}
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-3">Status</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Active</span><span className="font-semibold text-success">{deviceAnalytics.data.active}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Inactive</span><span className="font-semibold text-surface-700 dark:text-surface-300">{deviceAnalytics.data.inactive}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Pending</span><span className="font-semibold text-warning">{deviceAnalytics.data.pending}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Blocked</span><span className="font-semibold text-danger">{deviceAnalytics.data.blocked}</span></div>
                </div>
              </div>
              {/* Health */}
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-3">Health</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Healthy</span><span className="font-semibold text-success">{deviceAnalytics.data.health.healthy}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Unhealthy</span><span className="font-semibold text-danger">{deviceAnalytics.data.health.unhealthy}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Unknown</span><span className="font-semibold text-surface-400">{deviceAnalytics.data.health.unknown}</span></div>
                </div>
              </div>
              {/* Online/Offline */}
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-3">Connectivity</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-surface-500"><Wifi size={14} /> Online</span><span className="font-semibold text-success">{deviceAnalytics.data.online}</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-surface-500"><WifiOff size={14} /> Offline</span><span className="font-semibold text-danger">{deviceAnalytics.data.offline}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-surface-500">Total</span><span className="font-semibold">{deviceAnalytics.data.total}</span></div>
                </div>
              </div>
            </div>
            {/* Platform breakdown */}
            {deviceAnalytics.data.byPlatform.length > 0 && (
              <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-2">Platforms</p>
                <div className="flex flex-wrap gap-2">
                  {deviceAnalytics.data.byPlatform.map((p: any) => (
                    <Badge key={p.name} variant="neutral">{p.name}: {p.value}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* API Request Analytics */}
      {apiRequests.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><BarChart3 size={16} className="inline mr-2" />API Request Analytics (7 days)</CardTitle>
              <CardDescription>Request volume, success rate, and latency</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Total Requests</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(apiRequests.data.totalRequests)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Success Rate</p>
                <p className="text-xl font-bold text-success">{apiRequests.data.successRate}%</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Error Rate</p>
                <p className="text-xl font-bold text-danger">{apiRequests.data.errorRate}%</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Avg Latency</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{apiRequests.data.averageLatency}ms</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Churn Metrics */}
      {churn.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><AlertTriangle size={16} className="inline mr-2" />Churn & Retention</CardTitle>
              <CardDescription>Subscription churn, trial conversions, and inactive restaurants</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Churn Rate</p>
                <p className="text-xl font-bold text-danger">{churn.data.churnRate}%</p>
                <p className="text-xs text-surface-400">{churn.data.subscriptionChurn.total} subscriptions churned</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Trial Conversion</p>
                <p className="text-xl font-bold text-success">{churn.data.trialConversions.rate}%</p>
                <p className="text-xs text-surface-400">{churn.data.trialConversions.converted} of {churn.data.trialConversions.total + churn.data.trialConversions.converted} converted</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Suspended Restaurants</p>
                <p className="text-xl font-bold text-warning">{formatNumber(churn.data.suspendedRestaurants)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Failed Renewals (30d)</p>
                <p className="text-xl font-bold text-danger">{formatNumber(churn.data.failedRenewals)}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Activity Metrics */}
      {activity.data && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle><Activity size={16} className="inline mr-2" />Activity Metrics</CardTitle>
              <CardDescription>User login and platform activity</CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Active Users</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(activity.data.activeUsers)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Active Owners</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(activity.data.activeOwners)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">Today's Logins</p>
                <p className="text-xl font-bold text-success">{formatNumber(activity.data.dailyLogins)}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider">30d Activity Logs</p>
                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(activity.data.recentActivity)}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Charts & Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions across the platform</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            {recentActivity.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-1 h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : recentActivity.data?.length === 0 ? (
              <div className="py-12 text-center">
                <Activity size={32} className="mx-auto mb-2 text-surface-300 dark:text-surface-600" />
                <p className="text-sm text-surface-400">No recent activity</p>
                <p className="text-xs text-surface-400 mt-1">Activity will appear here as actions are taken</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentActivity.data?.slice(0, 8).map((activity, idx) => (
                  <div
                    key={activity.id || idx}
                    className="flex items-start gap-3 rounded-lg bg-surface-50 p-3 transition-colors hover:bg-surface-100 dark:bg-surface-800/50 dark:hover:bg-surface-800"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
                      <Activity size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-300 truncate">{activity.action}</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        {activity.details} &middot; {formatDateTime(activity.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Latest Restaurants */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Latest Restaurants</CardTitle>
              <CardDescription>Recently registered restaurants</CardDescription>
            </div>
            <Link to="/restaurants">
              <Button variant="ghost" size="sm">
                View All <ArrowRight size={14} />
              </Button>
            </Link>
          </CardHeader>
          <div className="space-y-3">
            {latestRestaurants.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-1 h-3 w-1/3" />
                  </div>
                </div>
              ))
            ) : latestRestaurants.data?.length === 0 ? (
              <div className="py-12 text-center">
                <StoreIcon size={32} className="mx-auto mb-2 text-surface-300 dark:text-surface-600" />
                <p className="text-sm text-surface-400">No restaurants registered</p>
                <p className="text-xs text-surface-400 mt-1">Create your first restaurant to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {latestRestaurants.data?.slice(0, 8).map((restaurant) => (
                  <Link
                    key={restaurant.id}
                    to={`/restaurants/${restaurant.id}`}
                    className="flex items-center gap-3 rounded-lg p-3 transition-all hover:bg-surface-50 dark:hover:bg-surface-800/50"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400">
                      <StoreIcon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-300 truncate">{restaurant.name}</p>
                      <p className="text-xs text-surface-400">{formatDateTime(restaurant.createdAt)}</p>
                    </div>
                    <Badge variant={restaurant.status === 'active' ? 'success' : restaurant.status === 'suspended' ? 'danger' : 'neutral'}>
                      {restaurant.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Subscription Overview */}
      {totalSubs > 0 && (
        <Card className="p-0">
          <div className="px-6 pt-6 pb-4 flex items-center justify-between">
            <div>
              <CardTitle>Subscription Overview</CardTitle>
              <CardDescription>Breakdown of all subscription statuses</CardDescription>
            </div>
            <Link to="/subscriptions">
              <Button variant="ghost" size="sm">
                Manage <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-4 px-6 pb-6">
            <div className="rounded-lg bg-success/5 border border-success/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Active</span>
              </div>
              <p className="text-2xl font-bold text-success">{activeSubs}</p>
              <p className="text-xs text-surface-400 mt-1">{totalSubs > 0 ? Math.round((activeSubs / totalSubs) * 100) : 0}% of total</p>
            </div>
            <div className="rounded-lg bg-warning/5 border border-warning/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-warning" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Paused</span>
              </div>
              <p className="text-2xl font-bold text-warning">{pausedSubs}</p>
              <p className="text-xs text-surface-400 mt-1">{totalSubs > 0 ? Math.round((pausedSubs / totalSubs) * 100) : 0}% of total</p>
            </div>
            <div className="rounded-lg bg-danger/5 border border-danger/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-danger" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Expired</span>
              </div>
              <p className="text-2xl font-bold text-danger">{expiredSubs}</p>
              <p className="text-xs text-surface-400 mt-1">{totalSubs > 0 ? Math.round((expiredSubs / totalSubs) * 100) : 0}% of total</p>
            </div>
            <div className="rounded-lg bg-info/5 border border-info/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-info" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Total</span>
              </div>
              <p className="text-2xl font-bold text-info">{totalSubs}</p>
              <p className="text-xs text-surface-400 mt-1">Across all restaurants</p>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </div>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <Link to="/restaurants"><Button variant="outline" size="sm"><Store size={14} /> Create Restaurant</Button></Link>
          <Link to="/owners"><Button variant="outline" size="sm"><Users size={14} /> Manage Owners</Button></Link>
          <Link to="/subscriptions"><Button variant="outline" size="sm"><CreditCard size={14} /> View Subscriptions</Button></Link>
          <Link to="/analytics"><Button variant="outline" size="sm"><TrendingUp size={14} /> View Analytics</Button></Link>
          <Link to="/support"><Button variant="outline" size="sm"><Activity size={14} /> Support Search</Button></Link>
          <Link to="/ai-usage"><Button variant="outline" size="sm"><Cpu size={14} /> AI Usage</Button></Link>
        </div>
      </Card>
    </div>
  )
}
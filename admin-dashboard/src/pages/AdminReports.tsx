/**
 * =============================================================================
 *  AdminReports.tsx — Platform Reports Hub (Phase 2.10)
 * =============================================================================
 *
 * Central aggregate reporting console across all restaurants, owners and the
 * platform. Consumes the `/api/admin/reports/*` endpoints and renders each
 * report through a data-driven section component (summary cards + a chart +
 * a table) so the hub stays maintainable as new reports are added.
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts'
import {
  TrendingUp, DollarSign, Users, RefreshCw, LayoutDashboard,
  BarChart3, Server, Activity, CreditCard, UserCheck, AlertTriangle,
  Lightbulb, Cpu, Package, Headphones, Store, CheckCircle, Clock,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import {
  getReportSummary,
  getGrowthReport,
  getRevenueReport,
  getSubscriptionReport,
  getAiRevenueReport,
  getSupportReport,
  getDeviceReport,
  getUsageReport,
  getOwnerReport,
  getInactiveReport,
  getFeatureReport,
  createReportExport,
  listSnapshots,
  runSnapshots,
  type ReportQuery,
  type ReportKey,
  type ExportJob,
  downloadExportUrl,
} from '../api/adminReports'
import { formatNumber, formatCurrency, formatDateTime } from '../utils/format'

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']

const PERIODS: { value: string; label: string }[] = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
]

// ─── Shared stat card + section scaffolding ─────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, tone }: {
  label: string
  value: string | number
  sub?: string
  icon: any
  tone?: string
}) {
  const toneCls = tone ?? 'text-primary-600 bg-primary-50 dark:bg-primary-900/20'
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <p className="truncate text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">{label}</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
          {sub && <p className="text-xs text-surface-400 truncate">{sub}</p>}
        </div>
        <div className={`rounded-lg p-2.5 shrink-0 ${toneCls}`}>
          <Icon size={18} />
        </div>
      </div>
    </Card>
  )
}

function SimpleTable({ title, rows, format }: {
  title: string
  rows: Array<Record<string, any>>
  format?: (key: string, value: any, row: Record<string, any>) => string | React.ReactNode
}) {
  if (!rows || rows.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <p className="py-10 text-center text-sm text-surface-400">No data available.</p>
      </Card>
    )
  }
  const keys = Object.keys(rows[0]).filter((k) => k !== 'id')
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700">
              {keys.map((k) => (
                <th key={k} className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400 capitalize">
                  {k.replace(/([A-Z])/g, ' $1')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                {keys.map((k) => (
                  <td key={k} className="py-3 px-4 text-surface-700 dark:text-surface-300">
                    {format ? format(k, row[k], row) : (typeof row[k] === 'number' ? formatNumber(row[k]) : String(row[k] ?? '-'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Individual report sections ────────────────────────────────────────────────

function GrowthProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-growth', query], queryFn: () => getGrowthReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Restaurants" value={formatNumber(data.summary.totalRestaurants)} icon={Users} />
        <KpiCard label="New Restaurants" value={formatNumber(data.summary.newRestaurants)} sub={`${data.summary.growthPct ?? 0}% growth`} icon={TrendingUp} tone="text-success bg-success/10" />
        <KpiCard label="Active" value={formatNumber(data.summary.activeRestaurants)} icon={Activity} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="Activation Rate" value={`${data.summary.activationRate ?? 0}%`} sub={`${formatNumber(data.summary.inactiveRestaurants)} inactive`} icon={BarChart3} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
      </div>
      <Card>
        <CardHeader><CardTitle>Sign-ups over time</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="Top Cities" rows={data.summary.topCities || []} />
        <SimpleTable title="Cohort Retention" rows={data.summary.cohortRetention || []} format={(k, v) => String(v ?? '-')} />
      </div>
    </div>
  )
}

function RevenueProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-revenue', query], queryFn: () => getRevenueReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="MRR" value={formatCurrency(data.summary.mrr)} sub={`${data.summary.mrrGrowthPct ?? 0}% vs prev. period`} icon={DollarSign} />
        <KpiCard label="ARR" value={formatCurrency(data.summary.arr)} icon={TrendingUp} tone="text-success bg-success/10" />
        <KpiCard label="Total Collected" value={formatCurrency(data.summary.totalCollected)} icon={DollarSign} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="Refunded" value={formatCurrency(data.summary.refunded)} sub={`${data.summary.refundRate ?? 0}% refund rate`} icon={CreditCard} tone="text-danger bg-danger/10" />
      </div>
      <Card>
        <CardHeader><CardTitle>Monthly Revenue</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v) || 0)} />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <CardHeader><CardTitle>Revenue Forecast</CardTitle></CardHeader>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.forecast || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v) || 0)} />
              <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <SimpleTable title="Revenue by source" rows={data.breakdown || []} format={(k: string, v: any) => (k === 'amount' ? formatCurrency(Number(v) || 0) : String(v ?? '-'))} />
    </div>
  )
}

function SubscriptionsProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-subscriptions', query], queryFn: () => getSubscriptionReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Subscriptions" value={formatNumber(data.summary.totalSubscriptions)} icon={Users} />
        <KpiCard label="Active" value={formatNumber(data.summary.activeCount)} icon={Activity} tone="text-success bg-success/10" />
        <KpiCard label="Churn Rate" value={`${data.summary.churnRate ?? 0}%`} sub={`${formatNumber(data.summary.churnedCount)} churned`} icon={TrendingUp} tone="text-danger bg-danger/10" />
        <KpiCard label="MRR" value={formatCurrency(data.summary.mrr)} sub={`ARR ${formatCurrency(data.summary.arr)}`} icon={DollarSign} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
      </div>
      <Card>
        <CardHeader><CardTitle>Plan Distribution</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={(data.planDistribution || []).map((p: any) => ({ name: p.plan, value: p.count }))} cx="50%" cy="45%" innerRadius={50} outerRadius={90} dataKey="value" paddingAngle={3}>
                {(data.planDistribution || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="Lifecycle Events" rows={data.lifecycleEvents || []} format={(k: string, v: any) => (k === 'occurredAt' ? formatDateTime(v) : String(v ?? '-'))} />
        <Card>
          <CardHeader><CardTitle>Status Distribution</CardTitle></CardHeader>
          <div className="space-y-3 p-2">
            {(data.statusDistribution || []).map((s: any) => (
              <div key={s.status} className="flex items-center justify-between px-2">
                <span className="text-sm capitalize text-surface-600 dark:text-surface-400">{s.status}</span>
                <span className="text-sm font-semibold text-surface-800 dark:text-surface-200">{s.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function AiRevenueProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-ai-revenue', query], queryFn: () => getAiRevenueReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="AI Cost" value={formatCurrency(data.summary.totalCost)} icon={Cpu} tone="text-danger bg-danger/10" />
        <KpiCard label="AI Revenue" value={formatCurrency(data.summary.totalRevenue)} icon={DollarSign} tone="text-success bg-success/10" />
        <KpiCard label="Profit" value={formatCurrency(data.summary.totalProfit)} sub={`${data.summary.profitMargin ?? 0}% margin`} icon={TrendingUp} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="Requests" value={formatNumber(data.summary.requests)} icon={Activity} tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20" />
      </div>
      <Card>
        <CardHeader><CardTitle>AI revenue vs cost</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.summary.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Area type="monotone" dataKey="cost" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
              <Area type="monotone" dataKey="revenue" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="By feature" rows={data.summary.byFeature || []} format={(k: string, v: any) => (k.includes('revenue') || k === 'cost' || k === 'profit' ? formatCurrency(Number(v) || 0) : String(v ?? '-'))} />
        <SimpleTable title="By model" rows={data.summary.byModel || []} format={(k: string, v: any) => (k === 'revenue' || k === 'cost' || k === 'profit' ? formatCurrency(Number(v) || 0) : String(v ?? '-'))} />
      </div>
    </div>
  )
}

function SupportProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-support', query], queryFn: () => getSupportReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Tickets" value={formatNumber(data.summary.total)} icon={Headphones} />
        <KpiCard label="Open" value={formatNumber(data.summary.openCount)} icon={Activity} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
        <KpiCard label="First Response" value={`${data.summary.avgFirstResponseHours ?? 0}h`} icon={Activity} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="Sat. Score" value={`${data.summary.avgSatisfaction ?? 0}`} sub={`${formatNumber(data.summary.satisfactionCount)} ratings`} icon={UserCheck} tone="text-success bg-success/10" />
      </div>
      <Card>
        <CardHeader><CardTitle>Opened vs resolved</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.summary.trend || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey="opened" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="resolved" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="By priority" rows={data.summary.byPriority || []} />
        <SimpleTable title="By category" rows={data.summary.byCategory || []} />
      </div>
    </div>
  )
}

function DevicesProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-devices', query], queryFn: () => getDeviceReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Devices" value={formatNumber(data.summary.total)} icon={Server} />
        <KpiCard label="Online" value={formatNumber(data.summary.online)} sub={`${data.summary.onlineRate ?? 0}% online rate`} icon={Activity} tone="text-success bg-success/10" />
        <KpiCard label="Blocked" value={formatNumber(data.summary.blocked)} icon={AlertTriangle} tone="text-danger bg-danger/10" />
        <KpiCard label="Pending" value={formatNumber(data.summary.pending)} icon={Clock} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="By platform" rows={data.summary.byPlatform || []} />
        <SimpleTable title="By OS" rows={data.summary.byOs || []} />
        <SimpleTable title="By app version" rows={data.summary.byAppVersion || []} />
        <SimpleTable title="By device type" rows={data.summary.byType || []} />
      </div>
    </div>
  )
}

function UsageProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-usage', query], queryFn: () => getUsageReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Events" value={formatNumber(data.summary.totalEvents)} sub={`${data.summary.eventsGrowthPct ?? 0}% vs prior`} icon={Activity} />
        <KpiCard label="DAU" value={formatNumber(data.summary.dau)} icon={Users} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="WAU" value={formatNumber(data.summary.wau)} icon={Users} tone="text-success bg-success/10" />
        <KpiCard label="MAU" value={formatNumber(data.summary.mau)} sub={`${formatNumber(data.summary.activeRestaurants)} active restaurants`} icon={BarChart3} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
      </div>
      <Card>
        <CardHeader><CardTitle>Events over time</CardTitle></CardHeader>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.summary.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleTable title="Top actions" rows={data.summary.topActions || []} />
        <SimpleTable title="By category" rows={data.summary.byCategory || []} />
      </div>
    </div>
  )
}

function OwnersProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-owners', query], queryFn: () => getOwnerReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Owners" value={formatNumber(data.summary.totalOwners)} icon={Users} />
        <KpiCard label="Active Owners" value={formatNumber(data.summary.activeOwners)} icon={Activity} tone="text-success bg-success/10" />
        <KpiCard label="Owners w/ Restaurants" value={formatNumber(data.summary.ownersWithRestaurants)} icon={Store} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
        <KpiCard label="Avg Restaurants" value={data.summary.avgRestaurantsPerOwner ?? 0} icon={BarChart3} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
      </div>
      <SimpleTable title="Owner breakdown" rows={data.summary.owners || []} format={(k: string, v: any) => (k === 'aiCost' ? formatCurrency(Number(v) || 0) : String(v ?? '-'))} />
    </div>
  )
}

function InactiveProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-inactive', query], queryFn: () => getInactiveReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Inactive Restaurants" value={formatNumber(data.summary.totalInactive)} sub={`${data.summary.inactivePct ?? 0}% of total`} icon={AlertTriangle} tone="text-danger bg-danger/10" />
        <KpiCard label="Newly Inactive" value={formatNumber(data.summary.newInactive)} icon={Activity} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
        <KpiCard label="Reactivated" value={formatNumber(data.summary.reactivated)} icon={TrendingUp} tone="text-success bg-success/10" />
        <KpiCard label="Longest Inactive" value={`${data.summary.longestInactiveDays ?? 0}d`} sub={`threshold ${data.summary.thresholdDays ?? 30}d`} icon={Clock} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
      </div>
      <SimpleTable title="Inactive restaurants" rows={data.summary.entries || []} format={(k: string, v: any) =>
          k === 'inactiveSince' ? formatDateTime(v as string) : String(v ?? '-')} />
    </div>
  )
}

function FeaturesProps({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-features', query], queryFn: () => getFeatureReport(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Features" value={formatNumber(data.summary.totalFeatures)} icon={Lightbulb} />
        <KpiCard label="Adopted" value={formatNumber(data.summary.adoptedFeatures)} icon={CheckCircle} tone="text-success bg-success/10" />
        <KpiCard label="Exploring" value={formatNumber(data.summary.exploringFeatures)} icon={Activity} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
        <KpiCard label="Adoption Rate" value={`${data.summary.adoptionRate ?? 0}%`} sub={`${formatNumber(data.summary.totalRestaurants)} total restaurants`} icon={TrendingUp} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" />
      </div>
      <SimpleTable title="Feature adoption" rows={data.summary.features || []} format={(k: string, v: any) => {
        if (k === 'adoptionStatus') {
          const map: Record<string, any> = { adopted: 'success', exploring: 'warning', never: 'danger' }
          return <Badge variant={map[v] || 'neutral'}>{String(v ?? '-')}</Badge>
        }
        return String(v ?? '-')
      }} />
    </div>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

// ─── Hub tabs configuration —────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'subscriptions', label: 'Subscriptions', icon: Users },
  { id: 'ai-revenue', label: 'AI Revenue', icon: Cpu },
  { id: 'support', label: 'Support', icon: Headphones },
  { id: 'devices', label: 'Devices', icon: Server },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'owners', label: 'Owners', icon: UserCheck },
  { id: 'inactive', label: 'Inactive', icon: AlertTriangle },
  { id: 'features', label: 'Feature Adoption', icon: Lightbulb },
  { id: 'exports', label: 'Exports', icon: Package },
]

export default function AdminReports() {
  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState('30d')

  const query: ReportQuery = { period }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Platform Reports</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Aggregated intelligence across restaurants, owners and the platform — {TABS.find((t) => t.id === tab)?.label.toLowerCase() || 'overview'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-10 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewPeriod query={query} />}
      {tab === 'growth' && <GrowthProps query={query} />}
      {tab === 'revenue' && <RevenueProps query={query} />}
      {tab === 'subscriptions' && <SubscriptionsProps query={query} />}
      {tab === 'ai-revenue' && <AiRevenueProps query={query} />}
      {tab === 'support' && <SupportProps query={query} />}
      {tab === 'devices' && <DevicesProps query={query} />}
      {tab === 'usage' && <UsageProps query={query} />}
      {tab === 'owners' && <OwnersProps query={query} />}
      {tab === 'inactive' && <InactiveProps query={query} />}
      {tab === 'features' && <FeaturesProps query={query} />}
      {tab === 'exports' && <ExportsSection query={query} />}
    </div>
  )
}

function OverviewPeriod({ query }: { query: ReportQuery }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-summary', query], queryFn: () => getReportSummary(query) })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !data) return <SectionSkeleton />
  const cards = [
    { label: 'New Restaurants', value: () => formatNumber(data.growth.newRestaurants ?? 0), icon: TrendingUp as any, tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20' },
    { label: 'MRR', value: () => formatCurrency(data.revenue.mrr ?? 0), icon: DollarSign, tone: 'text-success bg-success/10' },
    { label: 'Active Subscriptions', value: () => formatNumber(data.subscriptions.activeCount ?? 0), icon: Users, tone: 'text-primary-600 bg-primary-50 dark:bg-primary-900/20' },
    { label: 'AI Revenue', value: () => formatCurrency(data.aiRevenue.totalRevenue ?? 0), icon: Cpu, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
    { label: 'Open Tickets', value: () => formatNumber(data.support.openCount ?? 0), icon: Headphones, tone: 'text-danger bg-danger/10' },
    { label: 'Online Devices', value: () => formatNumber(data.devices.online ?? 0), icon: Server, tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20' },
    { label: 'Platform Events', value: () => formatNumber(data.usage.totalEvents ?? 0), icon: Activity, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/20' },
  ]
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value()} icon={c.icon} tone={c.tone} />
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Revenue health (MRR)</CardTitle><CardDescription>{data.period}</CardDescription></CardHeader>
        <p className="text-sm text-surface-500 dark:text-surface-400">Generated {formatDateTime(data.generatedAt)}</p>
      </Card>
    </div>
  )
}

function ExportsSection({ query }: { query: ReportQuery }) {
  const qc = useQueryClient()
  const { data: snapshots, isLoading } = useQuery({ queryKey: ['report-snapshots'], queryFn: listSnapshots })
  const [exporting, setExporting] = useState<ReportKey | null>(null)
  const [job, setJob] = useState<ExportJob | null>(null)
  const [selected, setSelected] = useState<ReportKey>('revenue')

  const m = useMutation({ mutationFn: (key: ReportKey) => createReportExport({ reportKey: key, format: 'csv', query }), onSuccess: (j) => { setJob(j) } })
  const snap = useMutation({ mutationFn: runSnapshots, onSuccess: () => qc.invalidateQueries({ queryKey: ['report-snapshots'] }) })

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Export a report</CardTitle></CardHeader>
          <div className="space-y-4">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value as ReportKey)}
              className="w-full h-10 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {TABS.filter((t) => t.id !== 'overview' && t.id !== 'exports').map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <Button onClick={() => m.mutate(selected)} loading={m.isPending} disabled={m.isPending}>
              <RefreshCw size={16} /> {m.isPending ? 'Creating…' : 'Create CSV Export'}
            </Button>
            {m.error && <p className="text-sm text-danger">{(m.error as any).message}</p>}
          </div>
        </Card>
        {job && (
          <Card>
            <CardHeader><CardTitle>Latest Export Job</CardTitle></CardHeader>
            <div className="space-y-2 text-sm">
              <p><span className="text-surface-500">Report:</span> <span className="font-medium">{job.reportKey}</span></p>
              <p><span className="text-surface-500">Status:</span> <Badge variant={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'info'}>{job.status}</Badge></p>
              <p><span className="text-surface-500">Created:</span> {formatDateTime(job.createdAt)}</p>
              {job.status === 'completed' && (
                <a href={downloadExportUrl(job.id)} className="inline-block mt-2 text-primary-600 hover:underline">Download file</a>
              )}
              {job.error && <p className="text-danger">{job.error}</p>}
            </div>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nightly snapshots</CardTitle>
          <Button variant="outline" size="sm" onClick={() => snap.mutate()} loading={snap.isPending}>
            Run now
          </Button>
        </CardHeader>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <SimpleTable title="Available snapshots" rows={snapshots || []} format={(k: string, v: any) => (k === 'snapshotDate' ? formatDateTime(v as string) : String(v ?? '-'))} />
        )}
      </Card>
    </div>
  )
}
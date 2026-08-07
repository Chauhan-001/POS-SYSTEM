/**
 * =============================================================================
 *  SubscriptionRevenue.tsx — Subscription Payment Revenue Dashboard
 * =============================================================================
 *
 * Shows revenue breakdown between cash/manual payments and Razorpay online
 * payments for subscription renewals.
 *
 * Data Source:
 *   GET /admin/analytics/subscription-revenue  → Aggregated payment data
 *
 * Charts:
 *   - Revenue overview cards (total, cash, razorpay)
 *   - Monthly revenue trend (stacked bar)
 *   - Payment method breakdown (pie)
 *   - Recent payments table
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Wallet, CreditCard, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { getSubscriptionRevenue, type SubscriptionRevenue } from '../api/analytics'
import { formatCurrency, formatDateTime } from '../utils/format'

const PIE_COLORS = ['#22c55e', '#6366f1']

function StatCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string
  value: string
  sub?: string
  icon: typeof Wallet
  color: string
  trend?: { up: boolean; pct: number }
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-surface-500 dark:text-surface-400">{label}</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
          {sub && <p className="text-xs text-surface-400">{sub}</p>}
          {trend && (
            <div className={`flex items-center gap-1 mt-1 text-xs ${trend.up ? 'text-success' : 'text-danger'}`}>
              {trend.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              <span>{trend.pct}% of total</span>
            </div>
          )}
        </div>
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  )
}

export default function SubscriptionRevenuePage() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const dateFilters = {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscription-revenue', startDate, endDate],
    queryFn: () => getSubscriptionRevenue(dateFilters),
  })

  const hasFilters = !!startDate || !!endDate

  if (error) {
    return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  }

  const pieData = data ? [
    { name: 'Cash / Manual', value: data.cash.revenue },
    { name: 'Razorpay Online', value: data.razorpay.revenue },
  ] : []

  const formatMonth = (m: string) => {
    const [y, month] = m.split('-')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[parseInt(month) - 1]} ${y}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Subscription Revenue</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Payment revenue breakdown across all restaurants
          </p>
        </div>

        {/* ─── Date Range Filter ───────────────────────────────── */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            title="Start date"
          />
          <span className="text-xs text-surface-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            title="End date"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStartDate(''); setEndDate('') }}
            >
              <X size={14} className="mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* ─── Revenue Overview Cards ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Revenue"
          value={isLoading ? '...' : formatCurrency(data?.total.revenue ?? 0)}
          sub={`${data?.total.count ?? 0} payments recorded`}
          icon={TrendingUp}
          color="text-primary-600 bg-primary-50 dark:bg-primary-900/20"
        />
        <StatCard
          label="Cash / Manual"
          value={isLoading ? '...' : formatCurrency(data?.cash.revenue ?? 0)}
          sub={`${data?.cash.count ?? 0} payments`}
          icon={Wallet}
          color="text-success bg-success/10"
          trend={data ? { up: (data.cash.percentage ?? 0) >= 50, pct: data.cash.percentage } : undefined}
        />
        <StatCard
          label="Razorpay Online"
          value={isLoading ? '...' : formatCurrency(data?.razorpay.revenue ?? 0)}
          sub={`${data?.razorpay.count ?? 0} payments`}
          icon={CreditCard}
          color="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20"
          trend={data ? { up: (data.razorpay.percentage ?? 0) >= 50, pct: data.razorpay.percentage } : undefined}
        />
        <StatCard
          label="Avg. Payment"
          value={isLoading ? '...' : formatCurrency(data?.total.count ? Math.round((data?.total.revenue ?? 0) / data.total.count) : 0)}
          sub="Per transaction"
          icon={DollarSign}
          color="text-amber-600 bg-amber-50 dark:bg-amber-900/20"
        />
      </div>

      {/* ─── Charts Row ──────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Monthly Revenue Trend */}
        <Card>
          <CardHeader><CardTitle>Monthly Revenue Trend</CardTitle></CardHeader>
          <div className="h-80 px-2">
            {isLoading ? (
              <div className="flex h-full items-center justify-center"><Skeleton className="h-64 w-full" /></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.monthly || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tickFormatter={(v: any) => `₹${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip
                    formatter={(value: any, name: any) => [formatCurrency(Number(value) || 0), name === 'cash' ? 'Cash / Manual' : 'Razorpay']}
                    labelFormatter={(label: any) => formatMonth(String(label))}
                  />
                  <Bar dataKey="cash" name="cash" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="razorpay" name="razorpay" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Payment Method Breakdown */}
        <Card>
          <CardHeader><CardTitle>Payment Method Split</CardTitle></CardHeader>
          <div className="h-80">
            {isLoading ? (
              <div className="flex h-full items-center justify-center"><Skeleton className="h-64 w-full rounded-full" /></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="45%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatCurrency(Number(value) || 0)} />
                  <Legend
                    verticalAlign="bottom"
                    formatter={(value: string) => <span className="text-sm text-surface-700 dark:text-surface-300">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Monthly Breakdown Table ─────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Monthly Breakdown</CardTitle></CardHeader>
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-32 w-full" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Month</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Cash Revenue</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Cash Count</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Razorpay Revenue</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Razorpay Count</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {data?.monthly.map((m) => (
                  <tr key={m.month} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="py-3 px-4 font-medium text-surface-900 dark:text-surface-100">{formatMonth(m.month)}</td>
                    <td className="py-3 px-4 text-right text-success font-mono">{formatCurrency(m.cash)}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{m.cashCount}</td>
                    <td className="py-3 px-4 text-right text-indigo-600 font-mono">{formatCurrency(m.razorpay)}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{m.razorpayCount}</td>
                    <td className="py-3 px-4 text-right font-bold text-surface-900 dark:text-surface-100 font-mono">{formatCurrency(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!data?.monthly || data.monthly.length === 0) && (
              <div className="py-12 text-center text-sm text-surface-400">No payment data available yet.</div>
            )}
          </div>
        )}
      </Card>

      {/* ─── Recent Payments ──────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Recent Payments</CardTitle></CardHeader>
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-32 w-full" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Invoice</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Amount</th>
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Method</th>
                </tr>
              </thead>
              <tbody>
                {data?.recent.map((p) => (
                  <tr key={p.id} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="py-3 px-4 text-surface-600 dark:text-surface-400">{formatDateTime(p.createdAt)}</td>
                    <td className="py-3 px-4 font-medium text-surface-900 dark:text-surface-100">{p.invoiceNumber}</td>
                    <td className="py-3 px-4 text-right font-mono font-medium text-surface-900 dark:text-surface-100">{formatCurrency(p.amount)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.gateway === 'cash' || p.gateway === 'manual'
                          ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400'
                      }`}>
                        {p.gateway === 'cash' || p.gateway === 'manual' ? 'Cash' : 'Razorpay'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!data?.recent || data.recent.length === 0) && (
              <div className="py-12 text-center text-sm text-surface-400">No recent payments found.</div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

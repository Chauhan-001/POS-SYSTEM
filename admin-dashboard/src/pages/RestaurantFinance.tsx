/**
 * =============================================================================
 *  RestaurantFinance.tsx — Restaurant Finance Console (Phase 1.7)
 * =============================================================================
 *
 * Platform-level read-only view into a restaurant's Finance system. Tabs:
 *   Overview — KPIs (revenue, expenses, COGS, gross/net profit, cash, GST,
 *              vendor dues, drawer), monthly profit trend
 *   P&L      — Profit & Loss statement for a period with expense breakdown
 *   Expenses — paged expense register with search & category filter
 *   Vendors  — vendor directory with paid / outstanding balances
 *   Cash     — cash ledger history + daily cash flow
 *   GST      — input/output GST summary
 *   Monthly  — year statement
 *   Branches — branch comparison
 *
 * All data is served by /api/admin/restaurants/:id/finance/* (read-only, admin auth).
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Wallet, TrendingUp, ReceiptText, Truck,
  Banknote, Landmark, CalendarRange, Building2, RefreshCw, Search,
  DollarSign, PieChart as PieIcon,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getFinanceOverview, getFinancePnl, getFinanceExpenses, getFinanceCashLedger,
  getFinanceGst, getFinanceVendors, getFinanceMonthly, getFinanceBranches,
  getFinanceExpenseRegister, type FinancePnlData, type FinanceOverview,
} from '../api/finance'
import { getRestaurant } from '../api/restaurants'
import { formatNumber, formatDate } from '../utils/format'

const CURRENCY = '₹'
const fmt = (n: number) => `${CURRENCY}${formatNumber(Math.round(n))}`

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year',
}

type TabId = 'overview' | 'pnl' | 'expenses' | 'vendors' | 'cash' | 'gst' | 'monthly' | 'branches'

const EXPENSE_PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6']

export default function RestaurantFinance() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const { data: restaurant } = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => getRestaurant(id!),
    enabled: !!id,
    retry: false,
  })

  const overview = useQuery({
    queryKey: ['finance-overview', id],
    queryFn: () => getFinanceOverview(id!),
    enabled: !!id,
  })

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: Wallet },
    { id: 'pnl', label: 'P&L', icon: TrendingUp },
    { id: 'expenses', label: 'Expenses', icon: ReceiptText },
    { id: 'vendors', label: 'Vendors', icon: Truck },
    { id: 'cash', label: 'Cash Ledger', icon: Banknote },
    { id: 'gst', label: 'GST', icon: Landmark },
    { id: 'monthly', label: 'Monthly', icon: CalendarRange },
    { id: 'branches', label: 'Branches', icon: Building2 },
  ]

  if (overview.error) {
    return <ErrorPage message={(overview.error as any).message} onRetry={() => overview.refetch()} />
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-surface-200 shadow-sm dark:bg-surface-900 dark:border-surface-700">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/restaurants/${id}`)}>
            <ArrowLeft size={16} /> Back
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Finance Console</h1>
              <p className="text-xs text-surface-500 mt-0.5">
                {restaurant?.name || 'Restaurant'} · Expenses, Cash Flow, GST &amp; Profit (Phase 1.7)
              </p>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => overview.refetch()} loading={overview.isFetching}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-300'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {overview.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><div className="space-y-3 p-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-8 w-1/2" /></div></Card>
          ))}
        </div>
      ) : (
        <>
          <OverviewTab data={overview.data} />
          {activeTab !== 'overview' && <DetailTab id={id!} tab={activeTab} />}
        </>
      )}
    </div>
  )
}

function OverviewTab({ data }: { data?: FinanceOverview }) {
  if (!data) return null
  const s = data.summary
  const months = data.monthly?.months || []
  const chartData = months.map((m) => ({ label: m.label, revenue: m.revenue, netProfit: m.netProfit }))

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenue" value={fmt(s.pnl.revenue)} sub={`${s.pnl.orders} orders`} color="text-emerald-600" />
        <KpiCard label="Expenses" value={fmt(s.pnl.expenses)} sub="operating" color="text-red-500" />
        <KpiCard label="COGS" value={fmt(s.pnl.cogs)} sub="inventory consumed" color="text-orange-500" />
        <KpiCard label="Net Profit" value={fmt(s.pnl.netProfit)} sub={`${s.pnl.margin.toFixed(1)}% margin`} color={s.pnl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <KpiCard label="Cash Balance" value={fmt(s.cash.balance)} sub={`in ${fmt(s.cash.inflows)} · out ${fmt(s.cash.outflows)}`} color="text-indigo-600" />
        <KpiCard label="GST Payable" value={fmt(s.gst.payable)} sub={`out ${fmt(s.gst.outputGst)} · in ${fmt(s.gst.inputGst)}`} color="text-amber-600" />
        <KpiCard label="Vendor Dues" value={fmt(s.vendorDues.total)} sub={`${s.vendorDues.count} vendors`} color="text-rose-600" />
        <KpiCard label="Drawer Over/Short" value={fmt(s.drawerBalance)} sub="period balance" color={s.drawerBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
      </div>

      {/* Monthly trend */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue vs Net Profit</CardTitle>
          <CardDescription>Year statement derived from bills, expenses &amp; ledger</CardDescription>
        </CardHeader>
        <div className="h-72 px-2 pb-4">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={<PieIcon size={40} />} title="No monthly data yet" description="Finance data will appear once bills and expenses are recorded." />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => formatNumber(Math.round(v / 1000)) + 'k'} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="Net Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Settings summary */}
      <Card>
        <CardHeader>
          <CardTitle>Finance Settings</CardTitle>
          <CardDescription>Restaurant-level configuration</CardDescription>
        </CardHeader>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SettingChip label="COGS Mode" value={data.settings?.cogsMode || 'category'} />
          <SettingChip label="Fiscal Year Start" value={data.settings?.fiscalYearStart || 'April'} />
          <SettingChip label="Cash Drawer" value={data.settings?.enableCashDrawer ? 'Enabled' : 'Disabled'} />
          <SettingChip label="GST Enabled" value={data.settings?.enableGst ? 'Enabled' : 'Disabled'} />
        </div>
      </Card>
    </div>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
        <p className={`mt-1.5 text-xl font-bold ${color}`}>{value}</p>
        <p className="mt-0.5 text-[10px] text-surface-400">{sub}</p>
      </div>
    </Card>
  )
}

function SettingChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-surface-800 dark:text-surface-200">{value}</p>
    </div>
  )
}

function DetailTab({ id, tab }: { id: string; tab: TabId }) {
  switch (tab) {
    case 'pnl': return <PnlTab id={id} />
    case 'expenses': return <ExpensesTab id={id} />
    case 'vendors': return <VendorsTab id={id} />
    case 'cash': return <CashTab id={id} />
    case 'gst': return <GstTab id={id} />
    case 'monthly': return <MonthlyTab id={id} />
    case 'branches': return <BranchesTab id={id} />
    default: return null
  }
}

function PnlTab({ id }: { id: string }) {
  const [period, setPeriod] = useState('month')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-pnl', id, period],
    queryFn: () => getFinancePnl(id, { period }),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const breakdown = data ? Object.entries(data.expenseByCategory || {}) : []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {Object.keys(PERIOD_LABELS).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              period === p ? 'bg-primary-600 text-white' : 'bg-surface-100 text-surface-500 hover:text-surface-700'
            }`}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Revenue" value={fmt(data.revenue)} sub={`${data.orders} orders`} color="text-emerald-600" />
            <KpiCard label="Discounts" value={fmt(data.discounts)} sub="given to customers" color="text-amber-500" />
            <KpiCard label="COGS" value={fmt(data.cogs)} sub="inventory consumed" color="text-orange-500" />
            <KpiCard label="Operating Expenses" value={fmt(data.operatingExpenses)} sub="non-COGS spend" color="text-red-500" />
            <KpiCard label="Gross Profit" value={fmt(data.grossProfit)} sub="revenue − COGS" color={data.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            <KpiCard label="Net Profit" value={fmt(data.netProfit)} sub={`${data.margin.toFixed(1)}% margin`} color={data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            <KpiCard label="GST Collected" value={fmt(data.gstCollected)} sub="output GST" color="text-indigo-600" />
            <KpiCard label="Refunds" value={fmt(data.refunds)} sub="returned to customers" color="text-rose-500" />
          </div>

          {breakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Expense Breakdown by Category</CardTitle>
                <CardDescription>Operating expenses in the selected period</CardDescription>
              </CardHeader>
              <div className="grid gap-6 p-4 lg:grid-cols-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={breakdown.map(([name, v]) => ({ name, value: v.amount }))} dataKey="value" nameKey="name" outerRadius={90} label>
                        {breakdown.map((_, i) => <Cell key={i} fill={EXPENSE_PALETTE[i % EXPENSE_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => fmt(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {breakdown.map(([name, v], i) => (
                    <div key={name} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-sm" style={{ background: EXPENSE_PALETTE[i % EXPENSE_PALETTE.length] }} />
                      <span className="text-sm text-surface-700 dark:text-surface-300 flex-1">{name}</span>
                      <span className="text-sm font-semibold">{fmt(v.amount)}</span>
                      <Badge variant="neutral">{v.count}×</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}

function ExpensesTab({ id }: { id: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-expenses', id, page, search],
    queryFn: () => getFinanceExpenses(id, { page, limit: 20, search: search || undefined }),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const rows = data?.data || []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Expense Register</CardTitle>
            <CardDescription>All expense entries across branches</CardDescription>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search expenses…"
              className="h-9 w-56 pl-9 pr-3 text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <th className="px-4 py-2.5 text-left font-semibold">Date</th>
              <th className="px-4 py-2.5 text-left font-semibold">Description</th>
              <th className="px-4 py-2.5 text-left font-semibold">Category</th>
              <th className="px-4 py-2.5 text-left font-semibold">Vendor</th>
              <th className="px-4 py-2.5 text-left font-semibold">Payment</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {isLoading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={6}><Skeleton className="h-10 mx-4 my-1" /></td></tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-8"><EmptyState icon={<ReceiptText size={40} />} title="No expenses" description="Expenses recorded by the POS will appear here." /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-2.5 whitespace-nowrap text-surface-500">{formatDate(r.date)}</td>
                <td className="px-4 py-2.5 font-medium">{r.description}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="neutral">{r.categoryName || r.category || '—'}</Badge>
                  {r.isCogs && <Badge variant="warning" className="ml-1.5">COGS</Badge>}
                </td>
                <td className="px-4 py-2.5 text-surface-600">{r.vendorName || '—'}</td>
                <td className="px-4 py-2.5 text-surface-500">{r.paymentMethod}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-red-500">-{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data?.totalPages || 0) > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200 dark:border-surface-700">
          <span className="text-xs text-surface-400">{data?.total} total · page {page}/{data?.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={!data?.nextPage} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function VendorsTab({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-vendors', id, page],
    queryFn: () => getFinanceVendors(id, { page, limit: 20 }),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const rows = data?.data || []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendors</CardTitle>
        <CardDescription>Purchase history, paid amounts and outstanding balances</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <th className="px-4 py-2.5 text-left font-semibold">Vendor</th>
              <th className="px-4 py-2.5 text-left font-semibold">GSTIN</th>
              <th className="px-4 py-2.5 text-left font-semibold">Contact</th>
              <th className="px-4 py-2.5 text-right font-semibold">Total Paid</th>
              <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
              <th className="px-4 py-2.5 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {isLoading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={6}><Skeleton className="h-10 mx-4 my-1" /></td></tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-8"><EmptyState icon={<Truck size={40} />} title="No vendors" description="Vendors created by the POS will appear here." /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-surface-500 font-mono text-xs">{r.gstin || '—'}</td>
                <td className="px-4 py-2.5 text-surface-500">{r.phone || r.email || '—'}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{fmt(r.totalPaid)}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${r.outstanding > 0 ? 'text-rose-600' : 'text-surface-500'}`}>{fmt(r.outstanding)}</td>
                <td className="px-4 py-2.5"><Badge variant={r.status === 'Active' ? 'success' : 'neutral'}>{r.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data?.totalPages || 0) > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200 dark:border-surface-700">
          <span className="text-xs text-surface-400">{data?.total} total · page {page}/{data?.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={!data?.nextPage} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function CashTab({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-cash', id, page],
    queryFn: () => getFinanceCashLedger(id, { page, limit: 20 }),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const rows = data?.data || []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash Ledger</CardTitle>
        <CardDescription>Opening cash, cash in/out, expenses, adjustments and closing balances</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <th className="px-4 py-2.5 text-left font-semibold">Date</th>
              <th className="px-4 py-2.5 text-left font-semibold">Type</th>
              <th className="px-4 py-2.5 text-left font-semibold">Note</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {isLoading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={5}><Skeleton className="h-10 mx-4 my-1" /></td></tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-8"><EmptyState icon={<Banknote size={40} />} title="No ledger entries" description="Cash drawer movements will appear here." /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-2.5 whitespace-nowrap text-surface-500">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-2.5"><Badge variant="neutral">{r.type}</Badge></td>
                <td className="px-4 py-2.5 text-surface-600">{r.note || '—'}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${r.amount < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                  {r.amount < 0 ? '-' : '+'}{fmt(Math.abs(r.amount))}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold">{fmt(r.balanceAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data?.totalPages || 0) > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200 dark:border-surface-700">
          <span className="text-xs text-surface-400">{data?.total} total · page {page}/{data?.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={!data?.nextPage} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function GstTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-gst', id],
    queryFn: () => getFinanceGst(id),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading) return <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
  if (!data) return null

  const breakdown: Array<{ name: string; output: number; input: number }> = [
    { name: 'CGST', output: 0, input: data.inputCgst || 0 },
    { name: 'SGST', output: 0, input: data.inputSgst || 0 },
    { name: 'IGST', output: 0, input: data.inputIgst || 0 },
    { name: 'CESS', output: 0, input: data.inputCess || 0 },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Output GST" value={fmt(data.outputGst)} sub={`${data.outputBills || 0} bills`} color="text-indigo-600" />
        <KpiCard label="Input GST" value={fmt(data.inputGst)} sub={`${data.inputExpenses || 0} expense entries`} color="text-emerald-600" />
        <KpiCard label="Net Payable" value={fmt(data.netPayable)} sub="output − input" color={data.netPayable >= 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <KpiCard label="Taxable Output" value={fmt(data.outputTaxableValue || 0)} sub="sales excluding GST" color="text-surface-700" />
      </div>
      <Card>
        <CardHeader><CardTitle>Input GST Split</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Head</th>
                <th className="px-4 py-2.5 text-right font-semibold">Input Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {breakdown.map((r) => (
                <tr key={r.name}>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{fmt(r.input)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function MonthlyTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-monthly', id],
    queryFn: () => getFinanceMonthly(id),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const months = data?.months || []
  const chartData = months.map((m: any) => ({ label: m.label, netProfit: m.netProfit, expenses: m.expenses, revenue: m.revenue }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Monthly Statement {data?.year ? `— ${data.year}` : ''}</CardTitle></CardHeader>
        <div className="h-72 px-2 pb-4">
          {isLoading || months.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              {isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState icon={<CalendarRange size={40} />} title="No statement data" />}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => formatNumber(Math.round(v / 1000)) + 'k'} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Month</th>
                <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-4 py-2.5 text-right font-semibold">Expenses</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net Profit</th>
                <th className="px-4 py-2.5 text-right font-semibold">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {months.map((m: any) => (
                <tr key={m.month} className="hover:bg-surface-50">
                  <td className="px-4 py-2.5 font-medium">{m.label}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600 font-semibold">{fmt(m.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-red-500 font-semibold">{fmt(m.expenses)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(m.netProfit)}</td>
                  <td className="px-4 py-2.5 text-right text-surface-500">{m.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function BranchesTab({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-branches', id],
    queryFn: () => getFinanceBranches(id),
  })
  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  // Backend returns { startDate, endDate, branches: [...] }.
  const rows = data?.branches || []
  const chartData = rows.map((r: any) => ({ name: r.branchId === 'HQ' ? 'HQ' : `Branch ${String(r.branchId).slice(0, 6)}`, revenue: r.revenue, netProfit: r.netProfit, expenses: r.expenses }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Branch Comparison</CardTitle></CardHeader>
        <div className="h-72 px-2 pb-4">
          {isLoading || rows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              {isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState icon={<Building2 size={40} />} title="No branch data" description="Multi-branch comparison will appear once branches record bills and expenses." />}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => formatNumber(Math.round(v / 1000)) + 'k'} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="Net Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Branch</th>
                <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-4 py-2.5 text-right font-semibold">Expenses</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net Profit</th>
                <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {rows.map((r: any) => (
                <tr key={r.branchId || r.name || r.branchName} className="hover:bg-surface-50">
                  <td className="px-4 py-2.5 font-medium">{r.branchId === 'HQ' ? 'HQ (Head Office)' : `Branch ${String(r.branchId).slice(0, 8)}`}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600 font-semibold">{fmt(r.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-red-500 font-semibold">{fmt(r.expenses)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${r.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(r.netProfit)}</td>
                  <td className="px-4 py-2.5 text-right text-surface-500">{r.revenue > 0 ? `${((r.netProfit / r.revenue) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

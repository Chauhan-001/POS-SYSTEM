/**
 * =============================================================================
 *  RestaurantReports.tsx — Per-Restaurant Reports Console (Phase 1.8)
 * =============================================================================
 *
 * Platform-level read-only view into a restaurant's backend reporting engine.
 * Every figure is computed server-side via MongoDB aggregations / materialized
 * summaries — this page only renders. Tabs:
 *   Overview  — Sales KPIs, revenue trend, payment & order-type splits
 *   Products  — Top sellers, category ranking, ABC analysis
 *   Inventory — Stock levels & valuation
 *   Employees — Cashier/employee performance ranking
 *   Closing   — Z-Report (daily closing: cash, over/short)
 *   Monthly   — Materialized monthly summaries
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, BarChart3, Package, Users, ReceiptText, CalendarRange,
  TrendingUp, ShoppingBag, Layers, Award, Wallet, AlertTriangle,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getAdminSalesSummary, getAdminSalesTrend, getAdminSalesPayments,
  getAdminSalesOrderTypes, getAdminSalesCashiers, getAdminProductTop,
  getAdminProductCategories, getAdminProductAbc, getAdminInventoryStock,
  getAdminInventoryValuation, getAdminEmployeePerformance, getAdminClosingZ,
  getAdminSummariesMonthly,
  type SalesSummaryData, type SalesTrendPoint, type SalesPaymentRow,
  type ProductReportRow, type InventoryStockRow, type ClosingZData,
} from '../api/reports'
import { getRestaurant } from '../api/restaurants'
import { formatNumber } from '../utils/format'

const CURRENCY = '₹'
const fmt = (n: number) => `${CURRENCY}${formatNumber(Math.round(n))}`
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const today = () => new Date().toISOString().slice(0, 10)

type TabId = 'overview' | 'products' | 'inventory' | 'employees' | 'closing' | 'monthly'

const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6']

export default function RestaurantReports() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d')
  const startDate = daysAgo(range === '7d' ? 7 : range === '30d' ? 30 : 90)
  const endDate = today()

  const { data: restaurant, isLoading: loadingRestaurant } = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => getRestaurant(id!),
    enabled: !!id,
  })

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'products', label: 'Products', icon: ShoppingBag },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'closing', label: 'Daily Closing', icon: ReceiptText },
    { id: 'monthly', label: 'Monthly', icon: CalendarRange },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/reports')} className="-ml-2">
            <ArrowLeft size={16} /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
              Reports — {loadingRestaurant ? '…' : (restaurant as any)?.name || 'Restaurant'}
            </h1>
            <p className="mt-0.5 text-xs text-surface-400">
              Backend-generated reports · {startDate} → {endDate}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg p-1">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                range === r ? 'bg-primary-600 text-white shadow-sm' : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isActive
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-500 hover:text-surface-800'
              }`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'overview' && <OverviewTab id={id!} startDate={startDate} endDate={endDate} />}
      {activeTab === 'products' && <ProductsTab id={id!} startDate={startDate} endDate={endDate} />}
      {activeTab === 'inventory' && <InventoryTab id={id!} />}
      {activeTab === 'employees' && <EmployeesTab id={id!} startDate={startDate} endDate={endDate} />}
      {activeTab === 'closing' && <ClosingTab id={id!} />}
      {activeTab === 'monthly' && <MonthlyTab id={id!} startDate={startDate} endDate={endDate} />}
    </div>
  )
}

// ─── Overview: KPIs + trend + payments + order types ─────────────
function OverviewTab({ id, startDate, endDate }: { id: string; startDate: string; endDate: string }) {
  const summaryQ = useQuery({ queryKey: ['rpt-summary', id, startDate, endDate], queryFn: () => getAdminSalesSummary(id, { startDate, endDate }) })
  const trendQ = useQuery({ queryKey: ['rpt-trend', id, startDate, endDate], queryFn: () => getAdminSalesTrend(id, { startDate, endDate }) })
  const payQ = useQuery({ queryKey: ['rpt-pay', id, startDate, endDate], queryFn: () => getAdminSalesPayments(id, { startDate, endDate }) })
  const otQ = useQuery({ queryKey: ['rpt-ot', id, startDate, endDate], queryFn: () => getAdminSalesOrderTypes(id, { startDate, endDate }) })

  if (summaryQ.isLoading || trendQ.isLoading || payQ.isLoading || otQ.isLoading) {
    return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <Card key={i}><div className="space-y-3 p-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-8 w-3/4" /></div></Card>)}
    </div>
  }
  if (summaryQ.error || trendQ.error || payQ.error || otQ.error) {
    return <ErrorPage message={(summaryQ.error || trendQ.error || payQ.error || otQ.error as any)?.message} onRetry={() => { summaryQ.refetch(); trendQ.refetch(); payQ.refetch(); otQ.refetch() }} />
  }

  const s: SalesSummaryData | undefined = summaryQ.data
  const trend: SalesTrendPoint[] = trendQ.data || []
  const payments: SalesPaymentRow[] = payQ.data || []
  const orderTypes: Array<{ type: string; count: number; revenue: number }> = otQ.data || []

  const chartData = trend.map((p) => ({ name: p.date || p.name || '', Revenue: p.revenue, Orders: p.orders }))
  const paymentData = payments.map((p) => ({ name: p.method, value: p.amount }))
  const otData = orderTypes.map((o) => ({ name: o.type, value: o.count }))

  const kpis = s ? [
    { label: 'Net Revenue', value: fmt(s.summary.netSales), sub: `${s.summary.orders} orders`, color: 'text-primary-600' },
    { label: 'Gross Sales', value: fmt(s.summary.grossSales), sub: `${fmt(s.summary.discounts)} discounts`, color: 'text-surface-900 dark:text-surface-100' },
    { label: 'Avg Order Value', value: fmt(s.summary.averageOrderValue), sub: `${s.summary.averageItemsPerOrder} items/order`, color: 'text-emerald-600' },
    { label: 'Taxes Collected', value: fmt(s.summary.taxes), sub: `${s.summary.itemsSold} items sold`, color: 'text-amber-600' },
  ] : []

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">{k.label}</p>
              <p className={`mt-1.5 text-2xl font-bold font-mono ${k.color}`}>{k.value}</p>
              <p className="mt-1 text-xs text-surface-400">{k.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Revenue Trend</CardTitle><CardDescription>Daily sales in the selected range</CardDescription></CardHeader>
          <div className="p-4 h-72">
            {chartData.length === 0 ? (
              <EmptyState icon={<BarChart3 size={40} />} title="No sales in range" description="No completed bills match the selected dates." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="rptRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <Tooltip formatter={(v: any) => fmt(Number(v) || 0)} />
                  <Area type="monotone" dataKey="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#rptRev)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment Methods</CardTitle><CardDescription>Net revenue by settlement</CardDescription></CardHeader>
          <div className="p-4 h-72 flex items-center justify-center">
            {paymentData.length === 0 ? (
              <EmptyState icon={<Wallet size={40} />} title="No payments" description="No settlements in range." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentData} cx="50%" cy="45%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                    {paymentData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v) || 0)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Order Channels</CardTitle><CardDescription>Orders by channel with revenue</CardDescription></CardHeader>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 text-left text-xs font-semibold text-surface-400">
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 px-3 text-right">Orders</th>
                <th className="py-2 pl-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {otData.length === 0 ? (
                <tr><td colSpan={3} className="py-8 text-center text-surface-400">No orders in range</td></tr>
              ) : (
                orderTypes.map((o) => (
                  <tr key={o.type}>
                    <td className="py-2 pr-3 font-medium">{o.type}</td>
                    <td className="py-2 px-3 text-right font-mono">{o.count}</td>
                    <td className="py-2 pl-3 text-right font-mono font-semibold">{fmt(o.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Products: top sellers + categories + ABC ─────────────────────
function ProductsTab({ id, startDate, endDate }: { id: string; startDate: string; endDate: string }) {
  const topQ = useQuery({ queryKey: ['rpt-ptop', id, startDate, endDate], queryFn: () => getAdminProductTop(id, { startDate, endDate, limit: 15 }) })
  const catQ = useQuery({ queryKey: ['rpt-pcat', id, startDate, endDate], queryFn: () => getAdminProductCategories(id, { startDate, endDate }) })
  const abcQ = useQuery({ queryKey: ['rpt-pabc', id, startDate, endDate], queryFn: () => getAdminProductAbc(id, { startDate, endDate }) })

  if (topQ.isLoading || catQ.isLoading || abcQ.isLoading) {
    return <Card><div className="space-y-3 p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div></Card>
  }
  if (topQ.error || catQ.error || abcQ.error) {
    return <ErrorPage message={(topQ.error || catQ.error || abcQ.error as any)?.message} onRetry={() => { topQ.refetch(); catQ.refetch(); abcQ.refetch() }} />
  }

  const top: ProductReportRow[] = topQ.data || []
  const categories: Array<{ category: string; qty: number; revenue: number }> = catQ.data || []
  const abc: ProductReportRow[] = abcQ.data || []

  const maxTopQty = Math.max(...top.map((t) => t.qty), 1)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top Selling Products</CardTitle><CardDescription>Ranked by quantity sold</CardDescription></CardHeader>
          <div className="p-4 space-y-2.5">
            {top.length === 0 ? (
              <EmptyState icon={<ShoppingBag size={40} />} title="No sales" description="No items sold in the range." />
            ) : (
              top.slice(0, 10).map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-surface-100 text-surface-500'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold truncate">{p.name}</span>
                      <span className="font-mono text-surface-500 shrink-0 ml-2">{p.qty} sold · {fmt(p.revenue)}</span>
                    </div>
                    <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400" style={{ width: `${(p.qty / maxTopQty) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Category Performance</CardTitle><CardDescription>Revenue by category</CardDescription></CardHeader>
          <div className="p-4 space-y-2.5">
            {categories.length === 0 ? (
              <EmptyState icon={<Layers size={40} />} title="No categories" description="No category sales in the range." />
            ) : (
              categories.map((c, i) => {
                const maxRev = categories[0]?.revenue || 1
                return (
                  <div key={c.category} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold truncate">{c.category}</span>
                        <span className="font-mono text-surface-500 shrink-0 ml-2">{fmt(c.revenue)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.revenue / maxRev) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </div>
                    <span className="text-[10px] text-surface-400 w-8 text-right shrink-0">{c.qty} pcs</span>
                  </div>
                )
              })
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ABC Analysis</CardTitle>
          <CardDescription>A = top 80% revenue share · B = next 15% · C = remaining 5%</CardDescription>
        </CardHeader>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 text-left text-xs font-semibold text-surface-400">
                <th className="py-2 pr-3">Class</th>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 px-3 text-right">Qty</th>
                <th className="py-2 px-3 text-right">Revenue</th>
                <th className="py-2 px-3 text-right">Share %</th>
                <th className="py-2 pl-3 text-right">Cumulative %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {abc.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-surface-400">No product data in range</td></tr>
              ) : (
                abc.slice(0, 20).map((p) => (
                  <tr key={p.name}>
                    <td className="py-2 pr-3">
                      <Badge variant={p.class === 'A' ? 'success' : p.class === 'B' ? 'warning' : 'neutral'}>{p.class}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 px-3 text-right font-mono">{p.qty}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{fmt(p.revenue)}</td>
                    <td className="py-2 px-3 text-right font-mono">{(p.sharePct ?? 0).toFixed(1)}%</td>
                    <td className="py-2 pl-3 text-right font-mono">{(p.cumulativePct ?? 0).toFixed(1)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Inventory: stock levels + valuation ──────────────────────────
function InventoryTab({ id }: { id: string }) {
  const stockQ = useQuery({ queryKey: ['rpt-istock', id], queryFn: () => getAdminInventoryStock(id) })
  const valQ = useQuery({ queryKey: ['rpt-ival', id], queryFn: () => getAdminInventoryValuation(id) })

  if (stockQ.isLoading || valQ.isLoading) {
    return <Card><div className="space-y-3 p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div></Card>
  }
  if (stockQ.error || valQ.error) {
    return <ErrorPage message={(stockQ.error || valQ.error as any)?.message} onRetry={() => { stockQ.refetch(); valQ.refetch() }} />
  }

  const stock: InventoryStockRow[] = stockQ.data || []
  const val = valQ.data || { totalValue: 0, itemCount: 0, categories: [] }
  // Low/out-of-stock derived from the (backend-computed) stock rows.
  const lowStockCount = stock.filter((s) => s.status === 'LOW').length
  const outOfStockCount = stock.filter((s) => s.status === 'OUT' || s.currentStock <= 0).length
  const lowStock = stock.filter((s) => s.status === 'LOW' || s.status === 'OUT' || !s.availability)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Card><div className="p-4"><p className="text-[11px] font-semibold uppercase text-surface-400">Stock Value</p><p className="mt-1.5 text-2xl font-bold font-mono text-primary-600">{fmt(val.totalValue)}</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] font-semibold uppercase text-surface-400">Items</p><p className="mt-1.5 text-2xl font-bold font-mono">{val.itemCount}</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] font-semibold uppercase text-surface-400">Low Stock</p><p className="mt-1.5 text-2xl font-bold font-mono text-amber-600">{lowStockCount}</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] font-semibold uppercase text-surface-400">Out of Stock</p><p className="mt-1.5 text-2xl font-bold font-mono text-rose-600">{outOfStockCount}</p></div></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock Levels</CardTitle>
          <CardDescription>{lowStock.length > 0 ? `${lowStock.length} items need attention` : 'All items healthy'}</CardDescription>
        </CardHeader>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 text-left text-xs font-semibold text-surface-400">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 px-3 text-right">Stock</th>
                <th className="py-2 px-3 text-right">Min</th>
                <th className="py-2 px-3 text-right">Value</th>
                <th className="py-2 pl-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {stock.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-surface-400">No inventory data</td></tr>
              ) : (
                stock.map((s) => (
                  <tr key={s.name} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    <td className="py-2 pr-3 text-xs text-surface-500">{s.category}</td>
                    <td className="py-2 px-3 text-right font-mono">{s.currentStock} {s.unit}</td>
                    <td className="py-2 px-3 text-right font-mono text-surface-500">{s.minStock}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{fmt(s.stockValue)}</td>
                    <td className="py-2 pl-3">
                      <Badge variant={s.status === 'OK' ? 'success' : s.status === 'LOW' ? 'warning' : 'danger'}>{s.status}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Employees: performance ranking ───────────────────────────────
function EmployeesTab({ id, startDate, endDate }: { id: string; startDate: string; endDate: string }) {
  const q = useQuery({ queryKey: ['rpt-emp', id, startDate, endDate], queryFn: () => getAdminEmployeePerformance(id, { startDate, endDate }) })

  if (q.isLoading) return <Card><div className="space-y-3 p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div></Card>
  if (q.error) return <ErrorPage message={(q.error as any).message} onRetry={() => q.refetch()} />

  const rows = q.data || []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Performance</CardTitle>
        <CardDescription>Orders, revenue, voids & refunds per staff member (backend aggregated)</CardDescription>
      </CardHeader>
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 text-left text-xs font-semibold text-surface-400">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Employee</th>
              <th className="py-2 px-3 text-right">Orders</th>
              <th className="py-2 px-3 text-right">Revenue</th>
              <th className="py-2 px-3 text-right">Avg Bill</th>
              <th className="py-2 px-3 text-right">Items</th>
              <th className="py-2 px-3 text-right">Voids</th>
              <th className="py-2 pl-3 text-right">Refunds</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-surface-400">No employee data in range</td></tr>
            ) : (
              rows.map((e, i) => (
                <tr key={e.employee} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                  <td className="py-2 pr-3"><span className={`w-5 h-5 inline-flex items-center justify-center rounded text-[10px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-surface-100 text-surface-500'}`}>{i + 1}</span></td>
                  <td className="py-2 pr-3 font-medium">{e.employee}</td>
                  <td className="py-2 px-3 text-right font-mono">{e.orders}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold">{fmt(e.revenue)}</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(e.averageBill)}</td>
                  <td className="py-2 px-3 text-right font-mono">{e.itemsSold}</td>
                  <td className="py-2 px-3 text-right font-mono text-rose-500">{e.voidedBills}</td>
                  <td className="py-2 pl-3 text-right font-mono text-amber-600">{e.refundedBills}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Closing: Z-Report ────────────────────────────────────────────
function ClosingTab({ id }: { id: string }) {
  const [date, setDate] = useState(today())
  const q = useQuery({ queryKey: ['rpt-z', id, date], queryFn: () => getAdminClosingZ(id, { date }) })

  if (q.isLoading) return <Card><div className="space-y-3 p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div></Card>
  if (q.error) return <ErrorPage message={(q.error as any).message} onRetry={() => q.refetch()} />

  const z: ClosingZData | undefined = q.data
  if (!z) {
    return <EmptyState icon={<ReceiptText size={40} />} title="No closing data" description="No Z-Report data for the selected date." />
  }

  const cashRows = [
    { label: 'Opening Cash', value: z.cash.openingCash },
    { label: 'Cash Sales', value: z.cash.cashSales },
    { label: 'Cash In', value: z.cash.cashIn },
    { label: 'Cash Out', value: z.cash.cashOut },
    { label: 'Cash Expenses', value: z.cash.expenses },
    { label: 'Adjustments', value: z.cash.adjustments },
    { label: 'Expected Cash', value: z.cash.expectedCash, bold: true },
    { label: 'Actual Cash', value: z.cash.actualCash, bold: true },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="h-10 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm" />
        <Badge variant="success">Z-Report</Badge>
        {z.requiresManagerApproval && <Badge variant="warning"><AlertTriangle size={11} className="mr-1" /> Manager approval required</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sales Summary</CardTitle><CardDescription>Generated {new Date(z.generatedAt).toLocaleString()}</CardDescription></CardHeader>
          <div className="p-4 grid grid-cols-2 gap-3">
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Gross Revenue</p><p className="mt-1 text-lg font-bold font-mono">{fmt(z.sales.grossRevenue)}</p></div>
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Net Revenue</p><p className="mt-1 text-lg font-bold font-mono text-emerald-600">{fmt(z.sales.netRevenue)}</p></div>
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Orders</p><p className="mt-1 text-lg font-bold font-mono">{z.sales.orders}</p></div>
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Avg Order</p><p className="mt-1 text-lg font-bold font-mono">{fmt(z.sales.averageOrderValue)}</p></div>
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Discounts</p><p className="mt-1 text-lg font-bold font-mono text-rose-500">{fmt(z.sales.discounts)}</p></div>
            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3"><p className="text-[10px] font-semibold uppercase text-surface-400">Taxes</p><p className="mt-1 text-lg font-bold font-mono">{fmt(z.sales.taxes)}</p></div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cash Drawer</CardTitle><CardDescription>Expected vs actual — over/short</CardDescription></CardHeader>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {cashRows.map((r) => (
                  <tr key={r.label} className={r.bold ? 'bg-surface-50 dark:bg-surface-800' : ''}>
                    <td className="py-2 pr-3 font-medium">{r.label}</td>
                    <td className="py-2 pl-3 text-right font-mono font-semibold">{fmt(r.value)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 dark:bg-emerald-900/20">
                  <td className="py-2.5 pr-3 font-bold text-emerald-700">Over / Short</td>
                  <td className={`py-2.5 pl-3 text-right font-mono font-bold ${z.cash.overShort >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {z.cash.overShort >= 0 ? '+' : ''}{fmt(z.cash.overShort)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ─── Monthly: materialized summaries ──────────────────────────────
function MonthlyTab({ id, startDate, endDate }: { id: string; startDate: string; endDate: string }) {
  const q = useQuery({ queryKey: ['rpt-monthly', id, startDate, endDate], queryFn: () => getAdminSummariesMonthly(id, { startDate, endDate }) })

  if (q.isLoading) return <Card><div className="space-y-3 p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div></Card>
  if (q.error) return <ErrorPage message={(q.error as any).message} onRetry={() => q.refetch()} />

  const rows = q.data || []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Summaries</CardTitle>
        <CardDescription>Materialized per-month aggregates (DailySummary rollups)</CardDescription>
      </CardHeader>
      <div className="p-4 h-80">
        {rows.length === 0 ? (
          <EmptyState icon={<CalendarRange size={40} />} title="No monthly data" description="Summaries will appear once DailySummary records exist." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows.map((r) => ({ name: r.month, Revenue: r.totalRevenue, Orders: r.totalOrders }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <Tooltip formatter={(v: any) => fmt(Number(v) || 0)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

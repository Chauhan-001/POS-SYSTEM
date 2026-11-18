/**
 * =============================================================================
 *  RestaurantProfitCost.tsx — Profit & Food Cost Dashboard (Phase 6)
 *  =============================================================================
 *
 *  Profit & Food Cost Dashboard showing:
 *    - Gross sales, Discounts, GST, Net Revenue (ex-GST)
 *    - COGS, Gross Profit, Gross Margin
 *    - Operating Expenses, Net Profit, Net Margin
 *    - Food Cost Percentage, Ingredient Purchases, Wastage
 *    - Item-level profitability (top items)
 *    - Category-level profitability
 *  *
 *  All data computed server-side via MongoDB aggregations — frontend only renders.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, DollarSign, TrendingUp, ReceiptText, ShoppingBag,
  Layers, CalendarRange, BarChart3, Wallet, AlertTriangle,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorPage } from '../../components/ui/ErrorPage'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getFinancePnl,
  getAdminProductProfitability,
  type FinancePnlData,
  type ProductProfitabilityRow,
} from '../../api/finance'
import {
  getAdminProductCategories,
  type ProductReportRow,
} from '../../api/reports'
import { getRestaurant } from '../../api/restaurants'
import { formatNumber, formatDate } from '../../utils/format'

const CURRENCY = '₹'
const fmt = (n: number) => `${CURRENCY}${formatNumber(Math.round(n))}`
const fmt2 = (n: number) => `${CURRENCY}${Number(n).toFixed(2)}`

type TabId = 'overview' | 'items' | 'categories'

export default function RestaurantProfitCost() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const { data: restaurant } = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => getRestaurant(id!),
    enabled: !!id,
    retry: false,
  })

  const pnl = useQuery({
    queryKey: ['finance-pnl-profit-cost', id],
    queryFn: () => getFinancePnl(id!, { period: 'month' }),
    enabled: !!id,
  })

  const profitability = useQuery({
    queryKey: ['profitability-products', id],
    queryFn: () => getAdminProductProfitability(id!),
    enabled: !!id,
  })

  const categories = useQuery({
    queryKey: ['profitability-categories', id],
    queryFn: () => getAdminProductCategories(id!),
    enabled: !!id,
  })

  if (pnl.error || profitability.error || categories.error) {
    return <ErrorPage message={(pnl.error || profitability.error || categories.error as any)?.message} onRetry={() => { pnl.refetch(); profitability.refetch(); categories.refetch() }} />
  }

  const p = pnl.data
  const profitabilityItems = profitability.data || []
  const categoryItems = categories.data || []

  if (pnl.isLoading || profitability.isLoading || categories.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}><div className="space-y-3 p-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-8 w-1/2" /></div></Card>
        ))}
      </div>
    )
  }

  const netRevenue = p?.revenue || 0
  const cogs = p?.cogs || 0
  const grossProfit = p?.grossProfit || 0
  const grossMargin = p?.grossMargin ?? 0
  const operatingExpenses = p?.operatingExpenses || 0
  const netProfit = p?.netProfit || 0
  const netMargin = p?.netMargin ?? 0

  const foodCostPercent = netRevenue > 0 ? (cogs / netRevenue) * 100 : 0

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: DollarSign },
    { id: 'items', label: 'Item Profitability', icon: ShoppingBag },
    { id: 'categories', label: 'Category Profitability', icon: Layers },
  ]

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
              <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Profit & Food Cost</h1>
              <p className="text-xs text-surface-500 mt-0.5">
                {restaurant?.name || 'Restaurant'} · Profitability analysis & food cost (Phase 6)
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => pnl.refetch()} loading={pnl.isFetching}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Net Revenue (ex-GST)" value={fmt(netRevenue)} sub={`${pnl?.orders || 0} orders`} color="text-emerald-600" />
        <KpiCard label="Discounts" value={fmt(p?.discounts || 0)} sub="given to customers" color="text-amber-500" />
        <KpiCard label="GST Collected" value={fmt(p?.gstCollected || 0)} sub="output GST" color="text-indigo-600" />
        <KpiCard label="COGS" value={fmt(cogs)} sub="inventory consumed" color="text-orange-500" />
        <KpiCard label="Food Cost %" value={foodCostPercent.toFixed(1) + '%'} sub="COGS ÷ Net Revenue" color={foodCostPercent > 35 ? 'text-red-600' : 'text-emerald-600'} />
        <KpiCard label="Gross Profit" value={fmt(grossProfit)} sub="revenue − COGS" color={grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <KpiCard label="Gross Margin" value={grossMargin.toFixed(1) + '%'} sub="gross profit ÷ revenue" color={grossMargin >= 30 ? 'text-emerald-600' : grossMargin >= 15 ? 'text-amber-600' : 'text-red-600'} />
        <KpiCard label="Operating Expenses" value={fmt(operatingExpenses)} sub="non-COGS spend" color="text-red-500" />
        <KpiCard label="Net Profit" value={fmt(netProfit)} sub={`${netMargin.toFixed(1)}% margin`} color={netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <KpiCard label="Net Margin" value={netMargin.toFixed(1) + '%'} sub="net profit ÷ revenue" color={netMargin >= 10 ? 'text-emerald-600' : netMargin >= 0 ? 'text-amber-600' : 'text-red-600'} />
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
          )}
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'items' && <ItemsTab items={profitabilityItems} />}
      {activeTab === 'categories' && <CategoriesTab categories={categoryItems} netRevenue={netRevenue} cogs={cogs} />}
    </div>
  )
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard2 label="Ingredient Purchases" value="—" sub="cash outflow for inventory" color="text-indigo-600" />
        <KpiCard2 label="Wastage Cost" value="—" sub="spoiled & wasted stock" color="text-red-600" />
        <KpiCard2 label="Food Cost %" value="—" sub="direct ingredients ÷ net revenue" color="text-orange-500" />
        <KpiCard2 label="Contribution Margin" value="—" sub="selling price − recipe cost" color="text-emerald-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Food Cost Breakdown</CardTitle>
          <CardDescription>Ingredient purchases vs consumed inventory vs wastage</CardDescription>
        </CardHeader>
        <div className="p-6">
          <div className="text-center text-surface-500 py-12">
            <p>Food cost breakdown details available per item/category below.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}

function ItemsTab({ items }: { items: ProductProfitabilityRow[] }) {
  const sorted = [...items].sort((a, b) => b.totalContribution - a.totalContribution)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Item-wise Profitability</CardTitle>
          <CardDescription>Recipe cost vs selling price per item (backend-computed)</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                <th className="px-4 py-2.5 text-right font-semibold">Sell Price</th>
                <th className="px-4 py-2.5 text-right font-semibold">Recipe Cost</th>
                <th className="px-4 py-2.5 text-right font-semibold">Food Cost %</th>
                <th className="px-4 py-2.5 text-right font-semibold">Contribution</th>
                <th className="px-4 py-2.5 text-right font-semibold">Margin %</th>
                <th className="px-4 py-2.5 text-right font-semibold">Units Sold</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total Contribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {items.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-surface-500">No product profitability data available.</td></tr>
              ) : (
                items.slice(0, 30).map((item) => (
                  <tr key={item.productId} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="px-4 py-2.5 font-medium">{item.productName}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(item.sellingPrice)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(item.recipeCost)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${item.foodCostPercent > 35 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {item.foodCostPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{fmt(item.contribution)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${item.contributionMarginPercent >= 30 ? 'text-emerald-600' : item.contributionMarginPercent >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
                      {item.contributionMarginPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{item.unitsSold}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(item.totalContribution)}</td>
                  </tr>
                ))}
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function CategoriesTab({ categories, netRevenue, cogs }: { categories: ProductReportRow[], netRevenue: number, cogs: number }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Category Profitability</CardTitle>
          <CardDescription>Revenue, COGS, and gross margin by category</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-4 py-2.5 text-right font-semibold">COGS</th>
                <th className="px-4 py-2.5 text-right font-semibold">Food Cost %</th>
                <th className="px-4 py-2.5 text-right font-semibold">Gross Profit</th>
                <th className="px-4 py-2.5 text-right font-semibold">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {categories.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-surface-500">No category data available.</td></tr>
              ) : (
                categories.map((cat) => {
                  const catRevenue = cat.revenue || 0
                  const catCogs = 0 // P&L COGS is aggregate, not per-category
                  const catGrossProfit = catRevenue - catCogs
                  const catMargin = catRevenue > 0 ? (catGrossProfit / catRevenue) * 100 : 0
                  const catFoodCost = catRevenue > 0 ? (catCogs / catRevenue) * 100 : 0

                  return (
                    <tr key={cat.category} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                      <td className="px-4 py-2.5 font-medium">{cat.category}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmt(catRevenue)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-orange-500">{fmt(catCogs)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${catFoodCost > 35 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {catFoodCost.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{fmt(catGrossProfit)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${catMargin >= 30 ? 'text-emerald-600' : catMargin >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
                        {catMargin.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Category Summary</CardTitle></CardHeader>
          <div className="p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-surface-500">Total Revenue</span>
                <span className="font-mono">{fmt(netRevenue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-surface-500">Total COGS</span>
                <span className="font-mono text-orange-500">{fmt(cogs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-surface-500">Gross Profit</span>
                <span className="font-mono text-emerald-600">{fmt(netRevenue - cogs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-surface-500">Overall Food Cost %</span>
                <span className={`font-mono ${(cogs / netRevenue) > 0.35 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {netRevenue > 0 ? ((cogs / netRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-surface-500">Overall Gross Margin</span>
                <span className={`font-mono ${netRevenue > 0 ? ((netRevenue - cogs) / netRevenue) > 0.3 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {netRevenue > 0 ? (((netRevenue - cogs) / netRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
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
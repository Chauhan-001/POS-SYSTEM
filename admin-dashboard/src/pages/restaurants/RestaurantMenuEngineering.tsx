/**
 * =============================================================================
 *  RestaurantMenuEngineering.tsx — Menu Engineering Dashboard (Phase 6)
 *  =============================================================================
 *
 *  Menu Engineering classifies menu items using the BCG matrix:
 *    - STAR: High popularity, High margin — protect & feature
 *    - PLOWHORSE: High popularity, Low margin — review costs & bundle
 *    - PUZZLE: Low popularity, High margin — improve visibility & upsell
 *    - DOG: Low popularity, Low margin — consider removing
 *
 *  Data computed server-side via MongoDB aggregation — frontend only renders.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, ShoppingBag, TrendingUp, AlertTriangle, ShoppingCart,
  CalendarRange, Filter, Lightbulb, Eye,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorPage } from '../../components/ui/ErrorPage'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getAdminMenuEngineering,
  type MenuEngineeringItem,
} from '../../api/reports'
import { getRestaurant } from '../../api/restaurants'
import { formatNumber } from '../../utils/format'

const CURRENCY = '₹'
const fmt = (n: number) => `${CURRENCY}${formatNumber(Math.round(n))}`

export default function RestaurantMenuEngineering() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: restaurant } = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => getRestaurant(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: items, isLoading, error } = useQuery({
    queryKey: ['menu-engineering', id],
    queryFn: () => getAdminMenuEngineering(id!),
    enabled: !!id,
  })

  if (error) {
    return <ErrorPage message={(error as any).message} onRetry={() => { }} />
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}><div className="space-y-3 p-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-8 w-1/2" /></div></Card>
        ))}
      </div>
    )
  }

  const itemsList = items || []

  const counts = {
    stars: itemsList.filter((i) => i.classification === 'STAR').length,
    plowHorses: itemsList.filter((i) => i.classification === 'PLOWHORSE').length,
    puzzles: itemsList.filter((i) => i.classification === 'PUZZLE').length,
    dogs: itemsList.filter((i) => i.classification === 'DOG').length,
  }

  const classificationColors: Record<'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG', string> = {
    STAR: 'text-emerald-600 bg-emerald-50',
    PLOWHORSE: 'text-amber-600 bg-amber-50',
    PUZZLE: 'text-indigo-600 bg-indigo-50',
    DOG: 'text-red-600 bg-red-50',
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
            <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <ShoppingBag size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Menu Engineering</h1>
              <p className="text-xs text-surface-500 mt-0.5">
                {restaurant?.name || 'Restaurant'} · BCG matrix analysis (Phase 6)
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { }} loading={isLoading}>
            <CalendarRange size={14} /> Date Range
          </Button>
        </div>
      </div>

      {/* Classification Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ClassificationCard label="STARS" value={counts.stars} labelText="High popularity, High margin" color="text-emerald-600 bg-emerald-50" icon={<TrendingUp size={14} className="text-emerald-600" />} />
        <ClassificationCard label="PLOWHORSES" value={counts.plowHorses} labelText="High popularity, Low margin" color="text-amber-600 bg-amber-50" icon={<ShoppingCart size={14} className="text-amber-600" />} />
        <ClassificationCard label="PUZZLES" value={counts.puzzles} labelText="Low popularity, High margin" color="text-indigo-600 bg-indigo-50" icon={<Lightbulb size={14} className="text-indigo-600" />} />
        <ClassificationCard label="DOGS" value={counts.dogs} labelText="Low popularity, Low margin" color="text-red-600 bg-red-50" icon={<AlertTriangle size={14} className="text-red-600" />} />
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Menu Item Classification</CardTitle>
              <CardDescription>Items classified by popularity and contribution margin</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={itemsList.some(i => i.missingCost) ? 'danger' : 'success'} size="sm">
                {itemsList.some(i => i.missingCost) ? 'Some items missing cost data' : 'All items have cost data'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
                <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                <th className="px-4 py-2.5 text-right font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Sell Price</th>
                <th className="px-4 py-2.5 text-right font-semibold">Recipe Cost</th>
                <th className="px-4 py-2.5 text-right font-semibold">Contribution</th>
                <th className="px-4 py-2.5 text-right font-semibold">Margin %</th>
                <th className="px-4 py-2.5 text-right font-semibold">Daily Units</th>
                <th className="px-4 py-2.5 text-right font-semibold">Classification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {items.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-surface-500">No menu engineering data available.</td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.productId} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="px-4 py-2.5 font-medium">{item.productName}</td>
                    <td className="px-4 py-2.5 text-right text-surface-500">{item.category}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(item.price)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-orange-500">{fmt(item.recipeCost)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{fmt(item.contribution)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${item.contributionMarginPercent >= 30 ? 'text-emerald-600' : item.contributionMarginPercent >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
                      {item.contributionMarginPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{item.dailyUnits.toFixed(1)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={item.classification === 'STAR' ? 'success' : item.classification === 'PLOWHORSE' ? 'warning' : item.classification === 'PUZZLE' ? 'info' : 'danger'}>
                        {item.classification}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Insights */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
          <div className="p-6 space-y-3">
            {items.filter(i => i.missingCost).map((item) => (
              <div key={item.productId} className="p-3 bg-red-50 rounded-lg border border-red-100">
                <p className="text-sm font-medium text-red-800">{item.productName}</p>
                <p className="text-xs text-red-600">Missing ingredient cost — recipe costing incomplete</p>
              </div>
            ))}
            {items.filter(i => i.classification === 'DOG').map((item) => (
              <div key={item.productId} className="p-3 bg-red-50 rounded-lg border border-red-100">
                <p className="text-sm font-medium text-red-800">{item.productName}</p>
                <p className="text-xs text-red-600">Low popularity & margin — consider removing or repricing</p>
              </div>
            ))}
            {items.filter(i => i.classification === 'PUZZLE').map((item) => (
              <div key={item.productId} className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-sm font-medium text-indigo-800">{item.productName}</p>
                <p className="text-xs text-indigo-600">High margin, low sales — promote & upsell</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ClassificationCard({ label, value, labelText, color, icon }: { label: string; value: number; labelText: string; color: string; icon: React.ReactNode }) {
  return (
    <Card className="rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
          <p className="mt-0.5 text-2xl font-bold {color}">{value}</p>
          <p className="mt-0.5 text-[10px] text-surface-400">{labelText}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${color}`}>
          {icon}
        </div>
      </div>
    </Card>
  )
}
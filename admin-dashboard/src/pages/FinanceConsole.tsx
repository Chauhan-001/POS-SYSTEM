/**
 * =============================================================================
 *  FinanceConsole.tsx — Finance Module Landing (Phase 1.7)
 * =============================================================================
 *
 * Platform-level entry point for the Finance console. Lists restaurants and
 * deep-links into each one's Finance page (/restaurants/:id/finance), where
 * the admin can inspect expenses, vendors, cash ledger, GST, P&L and reports.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, ArrowRight, Store, Wallet } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import { getRestaurants, type RestaurantFilters } from '../api/restaurants'

export default function FinanceConsole() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance-restaurants', search],
    queryFn: () => getRestaurants({ page: 1, limit: 100, search: search || undefined } as RestaurantFilters),
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Finance Console</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Expenses, vendors, cash ledger, GST &amp; Profit &amp; Loss — select a restaurant to view its finance data.
          </p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search restaurants..."
            className="h-10 pl-9 pr-4 text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 w-72"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><div className="space-y-3 p-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /></div></Card>
          ))
        ) : !data || data.data.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={<Store size={48} />}
              title="No restaurants found"
              description="Restaurants will appear here. Open a restaurant's Finance console to see its expenses, cash ledger, GST and P&L."
            />
          </div>
        ) : (
          data.data.map((r: any) => (
            <Card
              key={r.id}
              className="cursor-pointer transition-all hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 group"
              onClick={() => navigate(`/restaurants/${r.id}/finance`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Wallet size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-surface-900 dark:text-surface-100 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors">
                      {r.name}
                    </p>
                    <p className="text-xs text-surface-400">
                      {r.city || '—'}{r.branchCount ? ` · ${r.branchCount} branches` : ''}
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-surface-300 group-hover:text-primary-500 transition-colors shrink-0 mt-1" />
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

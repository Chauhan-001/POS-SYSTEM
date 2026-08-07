/**
 * =============================================================================
 *  CustomerCrm.tsx — Customer CRM Module Landing (Phase 1.6)
 * =============================================================================
 *
 * Platform-level entry point for the Customer Management, Loyalty & CRM
 * console. Lists restaurants and deep-links into each one's CRM page
 * (/restaurants/:id/crm), where the admin can inspect customers, tiers,
 * loyalty settings, offers, rewards, campaigns, referrals and reports.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, Search, ArrowRight, Store, Crown, ShieldAlert } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import { getRestaurants, type RestaurantFilters } from '../api/restaurants'

export default function CustomerCrm() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['crm-restaurants', search],
    queryFn: () => getRestaurants({ page: 1, limit: 100, search: search || undefined } as RestaurantFilters),
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Customer CRM</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Customer Management, Loyalty & CRM console — select a restaurant to view its program.
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
              description="Restaurants with the loyalty feature will appear here. Open a restaurant's CRM console to see its customers, tiers and rewards."
            />
          </div>
        ) : (
          data.data.map((r: any) => {
            const hasLoyalty = r.loyaltyEnabled !== false
            return (
              <Card
                key={r.id}
                className="cursor-pointer transition-all hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 group"
                onClick={() => navigate(`/restaurants/${r.id}/crm`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-lg">
                      {r.name?.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-surface-900 dark:text-surface-100">{r.name}</p>
                      <p className="text-[11px] text-surface-400">{r.city || '—'} · Plan: <span className="capitalize">{r.plan}</span></p>
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-surface-300 group-hover:text-primary-500 transition-colors" />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant={hasLoyalty ? 'success' : 'neutral'} className="text-[10px]">
                    {hasLoyalty ? <><Crown size={10} className="mr-1" /> Loyalty</> : 'Loyalty off'}
                  </Badge>
                  <Badge variant={r.status === 'active' ? 'success' : 'danger'} className="text-[10px] capitalize">
                    {r.status}
                  </Badge>
                  <span className="ml-auto text-[10px] text-surface-400 flex items-center gap-1">
                    <Users size={11} /> {r.branchCount ?? 0} branches
                  </span>
                </div>
              </Card>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-info/10 border border-info/20 p-4 text-sm text-surface-600 dark:text-surface-300">
        <ShieldAlert size={18} className="text-info shrink-0" />
        <p>
          The CRM console is <b>read-only</b> for platform admins. Loyalty rules, tiers and campaigns are owned and managed
          from the restaurant's own POS. This view mirrors exactly what the restaurant sees (multi-tenant scoped).
        </p>
      </div>
    </div>
  )
}

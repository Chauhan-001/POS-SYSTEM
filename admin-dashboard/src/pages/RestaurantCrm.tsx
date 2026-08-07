/**
 * =============================================================================
 *  RestaurantCrm.tsx — Customer CRM Console (Phase 1.6)
 * =============================================================================
 *
 * Platform-level read-only view into a restaurant's Customer Management,
 * Loyalty & CRM system. Tabs:
 *   Overview   — KPIs, tier distribution, segment distribution, growth, top customers
 *   Customers  — paged directory with search + tier/status filters
 *   Loyalty    — engine settings + tier configuration
 *   Offers     — offers & rewards catalog with usage/stock
 *   Campaigns  — CRM campaign list
 *   Referrals  — referral program performance
 *   Reports    — full CRM analytics bundle
 *
 * All data is served by /api/admin/restaurants/:id/crm/* (read-only, admin auth).
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Users, Award, Wallet, TrendingUp, Gift, Megaphone, Share2,
  BarChart3, Search, RefreshCw, Crown, Percent, CalendarClock,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getCrmOverview, getCrmCustomers, getCrmLoyaltySettings, getCrmTiers,
  getCrmCampaigns, getCrmReferrals, getCrmReport, getCrmOffers, getCrmRewards,
  type CrmOverview, type CrmCustomer,
} from '../api/crm'
import { getRestaurant } from '../api/restaurants'
import { formatNumber, formatCurrency, formatDate } from '../utils/format'

const TIER_COLORS: Record<string, string> = {
  Bronze: '#b45309',
  Silver: '#6b7280',
  Gold: '#f59e0b',
  Platinum: '#0ea5e9',
  Diamond: '#6366f1',
}

type TabId = 'overview' | 'customers' | 'loyalty' | 'offers' | 'campaigns' | 'referrals' | 'reports'

export default function RestaurantCrm() {
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
    queryKey: ['crm-overview', id],
    queryFn: () => getCrmOverview(id!),
    enabled: !!id,
  })

  const tierChartData = Object.entries(overview.data?.tierDistribution || {}).map(([name, count]) => ({ name, count }))
  const segmentChartData = (overview.data?.segmentDistribution || []).map((s) => ({ name: s.name, count: s.customerCount }))
  const growthData = overview.data?.growth || []

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'loyalty', label: 'Loyalty & Tiers', icon: Award },
    { id: 'offers', label: 'Offers & Rewards', icon: Gift },
    { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { id: 'referrals', label: 'Referrals', icon: Share2 },
    { id: 'reports', label: 'Reports', icon: TrendingUp },
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
            <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-xl">
              {restaurant?.name?.substring(0, 2).toUpperCase() || '--'}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Customer CRM</h1>
              <p className="text-xs text-surface-500 mt-0.5">
                {restaurant?.name || 'Restaurant'} · Customer Management, Loyalty & CRM console (Phase 1.6)
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => overview.refetch()} loading={overview.isFetching}>
            <RefreshCw size={14} /> Refresh
          </Button>
          {overview.data?.generatedAt && (
            <span className="text-[10px] text-surface-400">Updated {formatDate(overview.data.generatedAt)}</span>
          )}
        </div>
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
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab contents */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid gap-6 md:grid-cols-4">
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"><Users size={20} /></div>
                <div>
                  <p className="text-xs text-surface-500">Total Customers</p>
                  <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
                    {overview.isLoading ? <Skeleton className="h-6 w-12" /> : formatNumber(overview.data?.summary?.totalCustomers ?? 0)}
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-success/10 p-2.5 text-success"><Award size={20} /></div>
                <div>
                  <p className="text-xs text-surface-500">Lifetime Spend</p>
                  <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
                    {overview.isLoading ? <Skeleton className="h-6 w-16" /> : formatCurrency(overview.data?.summary?.lifetimeSpend ?? 0)}
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-info/10 p-2.5 text-info"><Wallet size={20} /></div>
                <div>
                  <p className="text-xs text-surface-500">Points Issued</p>
                  <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
                    {overview.isLoading ? <Skeleton className="h-6 w-12" /> : formatNumber(overview.data?.summary?.totalPointsIssued ?? 0)}
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-warning/10 p-2.5 text-warning"><Gift size={20} /></div>
                <div>
                  <p className="text-xs text-surface-500">Rewards Redeemed</p>
                  <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
                    {overview.isLoading ? <Skeleton className="h-6 w-12" /> : formatNumber(overview.data?.summary?.totalRewardsRedeemed ?? 0)}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Tier distribution */}
            <Card>
              <CardHeader><CardTitle>Tier Distribution</CardTitle></CardHeader>
              <div className="h-64">
                {overview.isLoading ? <Skeleton className="h-full w-full" /> : tierChartData.length === 0 ? (
                  <EmptyState icon={<Award size={40} />} title="No tiers yet" description="Tier distribution will appear once customers earn points." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={tierChartData} dataKey="count" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={3}>
                        {tierChartData.map((entry) => (
                          <Cell key={entry.name} fill={TIER_COLORS[entry.name] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-center pb-4">
                {tierChartData.map((t) => (
                  <Badge key={t.name} className="capitalize">
                    <span className="w-2 h-2 rounded-full mr-1.5 inline-block" style={{ backgroundColor: TIER_COLORS[t.name] || '#94a3b8' }} />
                    {t.name}: {t.count}
                  </Badge>
                ))}
              </div>
            </Card>

            {/* Segment distribution */}
            <Card>
              <CardHeader><CardTitle>Segment Distribution</CardTitle></CardHeader>
              <div className="h-64">
                {overview.isLoading ? <Skeleton className="h-full w-full" /> : segmentChartData.length === 0 ? (
                  <EmptyState icon={<Users size={40} />} title="No segments" description="Segments are computed automatically from customer behavior." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={segmentChartData} layout="vertical" margin={{ left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="#94a3b8" width={110} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Growth */}
            <Card>
              <CardHeader><CardTitle>Customer Growth (monthly)</CardTitle></CardHeader>
              <div className="h-64">
                {overview.isLoading ? <Skeleton className="h-full w-full" /> : growthData.length === 0 ? (
                  <EmptyState icon={<TrendingUp size={40} />} title="No growth data" description="New-customer growth will appear as customers enroll." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={growthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="newCustomers" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Top customers */}
            <Card>
              <CardHeader><CardTitle>Top Customers</CardTitle></CardHeader>
              {overview.isLoading ? (
                <div className="space-y-3 px-6 pb-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : (overview.data?.topCustomers || []).length === 0 ? (
                <EmptyState icon={<Crown size={40} />} title="No customers yet" />
              ) : (
                <div className="divide-y divide-surface-100 dark:divide-surface-800 px-6 pb-4">
                  {(overview.data?.topCustomers || []).map((c) => (
                    <div key={c.phone} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                          {c.name} {c.isVip && <Crown size={12} className="inline text-amber-500" />}
                        </p>
                        <p className="text-[10px] font-mono text-surface-400">{c.phone} · {c.totalOrders} orders · {c.visits} visits</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-surface-900 dark:text-surface-100">{formatCurrency(c.totalSpend)}</p>
                        <Badge variant="info" className="text-[9px] capitalize">{c.tier || 'Bronze'}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'customers' && <CustomersTab restaurantId={id!} />}
      {activeTab === 'loyalty' && <LoyaltyTab restaurantId={id!} />}
      {activeTab === 'offers' && <OffersTab restaurantId={id!} />}
      {activeTab === 'campaigns' && <CampaignsTab restaurantId={id!} />}
      {activeTab === 'referrals' && <ReferralsTab restaurantId={id!} />}
      {activeTab === 'reports' && <ReportsTab restaurantId={id!} />}
    </div>
  )
}

// ─── Customers ───────────────────────────────────────────────────

function CustomersTab({ restaurantId }: { restaurantId: string }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tier, setTier] = useState('')
  const [status, setStatus] = useState('')
  const limit = 15

  // Debounce search
  const [timer, setTimer] = useState<any>(null)
  const onSearch = (v: string) => {
    setSearch(v)
    if (timer) clearTimeout(timer)
    setTimer(setTimeout(() => { setDebounced(v); setPage(1) }, 350))
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['crm-customers', restaurantId, page, debounced, tier, status],
    queryFn: () => getCrmCustomers(restaurantId, { page, limit, search: debounced || undefined, tier: tier || undefined, status: status || undefined }),
    enabled: !!restaurantId,
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle>Customer Directory</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search name / phone / email..."
                className="h-8 pl-8 pr-3 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 w-52"
              />
            </div>
            <select
              value={tier}
              onChange={(e) => { setTier(e.target.value); setPage(1) }}
              className="h-8 px-2 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All tiers</option>
              {['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="h-8 px-2 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="dormant">Dormant</option>
            </select>
          </div>
        </div>
      </CardHeader>

      {isLoading ? (
        <div className="space-y-2 px-6 pb-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState icon={<Users size={40} />} title="No customers found" description="Customers enrolled by the restaurant's POS will appear here." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-6 text-xs text-surface-500 font-semibold">Customer</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Tier</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Points / Wallet</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Lifetime Spend</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Orders / Visits</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Last Visit</th>
                  <th className="text-left py-3 text-xs text-surface-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c: CrmCustomer) => (
                  <tr key={c.id} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                    <td className="py-3 px-6">
                      <p className="font-medium text-surface-900 dark:text-surface-100">{c.name}</p>
                      <p className="text-[10px] font-mono text-surface-400">{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="info" className="capitalize">{c.tier || 'Bronze'}</Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono font-semibold">{formatNumber(c.points ?? 0)} pts</span>
                      <span className="text-xs text-surface-400 block">Wallet {formatCurrency(c.walletBalance ?? 0)}</span>
                    </td>
                    <td className="py-3 pr-4 font-semibold">{formatCurrency(c.totalSpend ?? 0)}</td>
                    <td className="py-3 pr-4 text-surface-600">{c.totalOrders ?? 0} / {c.visits ?? 0}</td>
                    <td className="py-3 pr-4 text-surface-500">{c.lastVisit ? formatDate(c.lastVisit) : '—'}</td>
                    <td className="py-3">
                      <Badge variant={c.isBlocked ? 'danger' : c.status === 'dormant' ? 'warning' : 'success'}>
                        {c.isBlocked ? 'Blocked' : c.status || 'active'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-surface-200 dark:border-surface-700">
              <span className="text-xs text-surface-400">Page {data.page} of {data.totalPages} · {data.total} customers</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ─── Loyalty & Tiers ─────────────────────────────────────────────

function LoyaltyTab({ restaurantId }: { restaurantId: string }) {
  const settings = useQuery({ queryKey: ['crm-settings', restaurantId], queryFn: () => getCrmLoyaltySettings(restaurantId), enabled: !!restaurantId })
  const tiers = useQuery({ queryKey: ['crm-tiers', restaurantId], queryFn: () => getCrmTiers(restaurantId), enabled: !!restaurantId })

  const s: Record<string, any> = settings.data || {}

  const settingsRows = [
    { label: 'Points per currency', value: s.pointsPerCurrency ?? '—' },
    { label: 'Points value (currency)', value: s.pointsValueInCurrency ?? '—' },
    { label: 'Min redemption', value: s.minRedemption ?? '—' },
    { label: 'Max redemption / transaction', value: s.maxRedemptionPerTransaction ?? '—' },
    { label: 'Daily redemption limit', value: s.dailyRedemptionLimit ?? '—' },
    { label: 'Monthly redemption limit', value: s.monthlyRedemptionLimit ?? '—' },
    { label: 'Point expiry mode', value: s.pointExpiryMode || 'none' },
    { label: 'Rolling expiry (months)', value: s.rollingExpiryMonths ?? '—' },
    { label: 'Welcome points', value: s.welcomePoints ?? '—' },
    { label: 'Birthday bonus', value: s.birthdayBonusPoints ?? '—' },
    { label: 'Referral enabled', value: s.referralEnabled ? 'Yes' : 'No' },
    { label: 'Referrer reward (pts)', value: s.referralReferrerPoints ?? '—' },
    { label: 'Referee reward (pts)', value: s.referralRefereePoints ?? '—' },
    { label: 'Wallet enabled', value: s.enableWallet ? 'Yes' : 'No' },
    { label: 'Tiers enabled', value: s.enableTiers ? 'Yes' : 'No' },
    { label: 'OTP enabled', value: s.otpEnabled ? 'Yes' : 'No' },
    { label: 'Large reward threshold', value: s.largeRewardThreshold ?? '—' },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Loyalty Engine Settings</CardTitle></CardHeader>
        {settings.isLoading ? (
          <div className="space-y-2 px-6 pb-6"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : (
          <div className="px-6 pb-6 divide-y divide-surface-100 dark:divide-surface-800">
            {settingsRows.map((r) => (
              <div key={r.label} className="flex justify-between py-2 text-sm">
                <span className="text-surface-500">{r.label}</span>
                <span className="font-semibold text-surface-900 dark:text-surface-100">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Tier Configuration</CardTitle></CardHeader>
        {tiers.isLoading ? (
          <div className="space-y-2 px-6 pb-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : (tiers.data || []).length === 0 ? (
          <EmptyState icon={<Award size={40} />} title="No tiers configured" description="Tiers are created from the restaurant's POS loyalty settings." />
        ) : (
          <div className="space-y-3 px-6 pb-6">
            {(tiers.data || []).map((t: any) => (
              <div key={t.id || t.name} className="rounded-xl border border-surface-200 dark:border-surface-700 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS[t.name] || '#94a3b8' }} />
                    <p className="font-bold text-surface-900 dark:text-surface-100 capitalize">{t.name}</p>
                    {t.isDefault && <Badge variant="info" className="text-[9px]">Default</Badge>}
                    {!t.isActive && <Badge variant="neutral" className="text-[9px]">Inactive</Badge>}
                  </div>
                  <Badge variant="success" className="text-[10px]">×{t.pointsMultiplier ?? 1} pts</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-surface-500">
                  <span>Min spend: <b className="text-surface-900 dark:text-surface-100">{formatCurrency(t.minLifetimeSpend ?? 0)}</b></span>
                  <span>Reward %: <b className="text-surface-900 dark:text-surface-100">{t.rewardPercent ?? 0}%</b></span>
                  <span>Expiry: <b className="text-surface-900 dark:text-surface-100">{t.expiryMonths ?? 0} mo</b></span>
                  <span>Birthday: <b className="text-surface-900 dark:text-surface-100">+{t.birthdayRewardPoints ?? 0} pts</b></span>
                </div>
                {Array.isArray(t.benefits) && t.benefits.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.benefits.map((b: string, i: number) => <Badge key={i} variant="neutral" className="text-[9px]">{b}</Badge>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Offers & Rewards ────────────────────────────────────────────

function OffersTab({ restaurantId }: { restaurantId: string }) {
  const offers = useQuery({ queryKey: ['crm-offers', restaurantId], queryFn: () => getCrmOffers(restaurantId), enabled: !!restaurantId })
  const rewards = useQuery({ queryKey: ['crm-rewards', restaurantId], queryFn: () => getCrmRewards(restaurantId), enabled: !!restaurantId })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Offers & Coupons</CardTitle></CardHeader>
        {offers.isLoading ? (
          <div className="space-y-2 px-6 pb-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : (offers.data || []).length === 0 ? (
          <EmptyState icon={<Percent size={40} />} title="No offers" description="Offers created from the restaurant's POS will appear here." />
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800 px-6 pb-4">
            {(offers.data || []).map((o: any) => (
              <div key={o.id} className="py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{o.title}</p>
                  <Badge variant={o.status === 'active' ? 'success' : 'neutral'} className="text-[9px] capitalize">{o.status}</Badge>
                </div>
                <p className="text-[11px] text-surface-500 mt-0.5">{o.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-surface-500">
                  <span className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-800 capitalize">{o.type}</span>
                  {o.couponCode && <span className="px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-mono font-bold">{o.couponCode}</span>}
                  <span>Value: {o.value}</span>
                  <span>Uses: {o.currentUses ?? 0}/{o.maxUses ?? '∞'}</span>
                  {o.endDate && <span className="flex items-center gap-1"><CalendarClock size={10} /> {formatDate(o.endDate)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Reward Catalog</CardTitle></CardHeader>
        {rewards.isLoading ? (
          <div className="space-y-2 px-6 pb-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : (rewards.data || []).length === 0 ? (
          <EmptyState icon={<Gift size={40} />} title="No rewards" description="Reward tiers configured from the restaurant's POS will appear here." />
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800 px-6 pb-4">
            {(rewards.data || []).map((r: any) => (
              <div key={r.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{r.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-surface-500">
                    <span className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-800 capitalize">{r.type}</span>
                    {r.isLargeReward && <span className="px-1.5 py-0.5 rounded bg-danger/10 text-danger">OTP verified</span>}
                    <span>Redeemed: {r.redeemedCount ?? 0}</span>
                    {r.stock != null && <span>Stock: {r.stock}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-primary-600 dark:text-primary-400">{formatNumber(r.pointsRequired)} pts</p>
                  {r.isActive === false && <Badge variant="neutral" className="text-[9px]">Inactive</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Campaigns ───────────────────────────────────────────────────

function CampaignsTab({ restaurantId }: { restaurantId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['crm-campaigns', restaurantId],
    queryFn: () => getCrmCampaigns(restaurantId, { limit: 25 }),
    enabled: !!restaurantId,
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const STATUS_VARIANT: Record<string, any> = {
    draft: 'neutral', scheduled: 'info', active: 'success', paused: 'warning', completed: 'neutral', cancelled: 'danger',
  }

  return (
    <Card>
      <CardHeader><CardTitle>CRM Campaigns</CardTitle></CardHeader>
      {isLoading ? (
        <div className="space-y-2 px-6 pb-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState icon={<Megaphone size={40} />} title="No campaigns" description="Campaigns built from the restaurant's CRM will appear here." />
      ) : (
        <div className="divide-y divide-surface-100 dark:divide-surface-800 px-6 pb-4">
          {(data.data || []).map((c: any) => (
            <div key={c.id} className="py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{c.name}</p>
                <Badge variant={STATUS_VARIANT[c.status] || 'neutral'} className="text-[9px] capitalize">{c.status}</Badge>
              </div>
              <p className="text-[11px] text-surface-500 mt-0.5">{c.channel} · {c.audienceCount ?? 0} recipients</p>
              {c.scheduledAt && <p className="text-[10px] text-surface-400 mt-0.5">Scheduled: {formatDateTime(c.scheduledAt)}</p>}
              {c.sentAt && <p className="text-[10px] text-surface-400 mt-0.5">Sent: {formatDateTime(c.sentAt)}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Referrals ───────────────────────────────────────────────────

function ReferralsTab({ restaurantId }: { restaurantId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['crm-referrals', restaurantId],
    queryFn: () => getCrmReferrals(restaurantId, { limit: 25 }),
    enabled: !!restaurantId,
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const STATUS_VARIANT: Record<string, any> = {
    pending: 'warning', completed: 'info', rewarded: 'success', voided: 'danger',
  }

  return (
    <Card>
      <CardHeader><CardTitle>Referral Program</CardTitle></CardHeader>
      {isLoading ? (
        <div className="space-y-2 px-6 pb-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState icon={<Share2 size={40} />} title="No referrals" description="Referral activity will appear once customers share referral codes." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-6 text-xs text-surface-500 font-semibold">Code</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Referrer</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Referee</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Rewards (pts)</th>
                  <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Date</th>
                  <th className="text-left py-3 text-xs text-surface-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.data || []).map((r: any) => (
                  <tr key={r.id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-3 px-6 font-mono font-bold text-primary-600 dark:text-primary-400">{r.code}</td>
                    <td className="py-3 pr-4">{r.referrerName || r.referrerPhone}</td>
                    <td className="py-3 pr-4">{r.refereeName || r.refereePhone || '—'}</td>
                    <td className="py-3 pr-4 text-xs">{r.referrerRewardPoints ?? 0} / {r.refereeRewardPoints ?? 0}</td>
                    <td className="py-3 pr-4 text-surface-500">{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                    <td className="py-3"><Badge variant={STATUS_VARIANT[r.status] || 'neutral'} className="text-[9px] capitalize">{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Reports ─────────────────────────────────────────────────────

function ReportsTab({ restaurantId }: { restaurantId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['crm-report', restaurantId],
    queryFn: () => getCrmReport(restaurantId),
    enabled: !!restaurantId,
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const rows: Array<{ label: string; value: any }> = data ? [
    { label: 'Total customers', value: formatNumber(data.summary?.totalCustomers ?? 0) },
    { label: 'Active customers', value: formatNumber(data.summary?.activeCustomers ?? 0) },
    { label: 'Blocked customers', value: formatNumber(data.summary?.blockedCustomers ?? 0) },
    { label: 'Dormant customers', value: formatNumber(data.summary?.dormantCustomers ?? 0) },
    { label: 'Total lifetime spend', value: formatCurrency(data.summary?.lifetimeSpend ?? 0) },
    { label: 'Average spend per customer', value: formatCurrency(data.summary?.averageSpend ?? 0) },
    { label: 'Total points issued', value: formatNumber(data.summary?.totalPointsIssued ?? 0) },
    { label: 'Total points redeemed', value: formatNumber(data.summary?.totalPointsRedeemed ?? 0) },
    { label: 'Rewards redeemed', value: formatNumber(data.summary?.totalRewardsRedeemed ?? 0) },
    { label: 'Coupons used', value: formatNumber(data.summary?.totalCouponsUsed ?? 0) },
    { label: 'Referrals (total)', value: formatNumber(data.referralPerformance?.total ?? 0) },
    { label: 'Referrals rewarded', value: formatNumber(data.referralPerformance?.rewarded ?? 0) },
  ] : []

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>CRM Summary</CardTitle></CardHeader>
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : (
          <div className="px-6 pb-6 divide-y divide-surface-100 dark:divide-surface-800">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between py-2 text-sm">
                <span className="text-surface-500">{r.label}</span>
                <span className="font-semibold text-surface-900 dark:text-surface-100">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Reward & Coupon Usage</CardTitle></CardHeader>
        <div className="h-72 px-4 pb-4">
          {isLoading ? <Skeleton className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                ...(data?.rewardUsage || []).map((r: any) => ({ name: r.title, count: r.redeemedCount ?? 0 })),
                ...(data?.couponUsage || []).map((c: any) => ({ name: `Coupon ${c.code}`, count: c.uses ?? 0 })),
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  )
}

// formatDateTime used by CampaignsTab
function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

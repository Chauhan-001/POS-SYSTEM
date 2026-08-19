/**
 * =============================================================================
 *  Subscriptions.tsx — Subscription List & Management Page
 * =============================================================================
 *
 * Features:
 *   - Paginated table of all restaurant subscriptions
 *   - Search & status filter (all/active/paused/expired)
 *   - Renew / Pause / Resume actions with confirmation dialogs
 *   - Cash payment form for manual renewals (creates Payment + Invoice records)
 *   - Plan name resolution from SubscriptionPlans data
 *
 * Data Sources:
 *   - GET  /admin/subscriptions              → Subscription list
 *   - POST /admin/subscriptions/:id/renew    → Renew (cash payment)
 *   - POST /admin/subscriptions/:id/pause    → Pause
 *   - POST /admin/subscriptions/:id/resume   → Resume
 *   - GET  /admin/subscription-plans         → Plan name mapping
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Card, CardHeader } from '../components/ui/Card'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { ErrorPage } from '../components/ui/ErrorPage'
import { getSubscriptions, renewSubscription, pauseSubscription, resumeSubscription } from '../api/subscriptions'
import { getPlans } from '../api/subscriptionPlans'
import type { Subscription, SubscriptionPlan } from '../types'
import { formatDate, formatCurrency } from '../utils/format'

type PaymentMethod = 'cash' | 'cheque' | 'bank_transfer';

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank Transfer',
};

export default function Subscriptions() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ sub: Subscription; type: 'pause' | 'resume' } | null>(null)
  const [cashPayment, setCashPayment] = useState<{
    sub: Subscription
    amount: number
    paymentMethod: PaymentMethod
    billingPeriod: 'monthly' | 'yearly'
    notes: string
  } | null>(null)
  const [cashResult, setCashResult] = useState<{ invoiceNumber: string; amount: number; paymentMethod: string } | null>(null)
  const [showRenewConfirm, setShowRenewConfirm] = useState(false)

  const { data: plansData } = useQuery({
    queryKey: ['subscription-plans', 'all'],
    queryFn: () => getPlans({ limit: 100 }),
  })
  const plans = plansData?.data || []
  const planMap = new Map(plans.map((p: SubscriptionPlan) => [p.planId, p]))

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscriptions', page, search, statusFilter],
    queryFn: () => getSubscriptions({ page, limit: 10, search, status: statusFilter || undefined }),
  })

  const renewMut = useMutation({
    mutationFn: ({ id, amount, notes, paymentMethod, billingPeriod }: { id: string; amount: number; notes: string; paymentMethod: string; billingPeriod: 'monthly' | 'yearly' }) =>
      renewSubscription(id, { amount, notes, paymentMethod, billingPeriod }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      if (cashPayment) {
        setCashResult({
          invoiceNumber: data.invoiceNumber,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
        })
        setCashPayment(null)
      }
      toast.success('Subscription renewed successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Renewal failed')
    },
  })

  const pauseMut = useMutation({
    mutationFn: (id: string) => pauseSubscription(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription paused') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Operation failed'),
  })

  const resumeMut = useMutation({
    mutationFn: (id: string) => resumeSubscription(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription resumed') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Operation failed'),
  })

  const periodPrice = useCallback((plan: SubscriptionPlan | undefined, period: 'monthly' | 'yearly') => {
    if (period === 'yearly' && plan?.yearlyPrice) return plan.yearlyPrice
    return plan?.price || 0
  }, [])

  const handleOpenCashPayment = useCallback((sub: Subscription) => {
    const plan = planMap.get(sub.plan)
    const period = sub.billingPeriod || 'monthly'
    setCashPayment({
      sub,
      amount: periodPrice(plan, period) || sub.price || 0,
      paymentMethod: 'cash',
      billingPeriod: period,
      notes: '',
    })
  }, [planMap, periodPrice])

  const handleConfirmRenew = useCallback(() => {
    if (!cashPayment) return
    renewMut.mutate({
      id: cashPayment.sub.id,
      amount: cashPayment.amount,
      notes: cashPayment.notes,
      paymentMethod: cashPayment.paymentMethod,
      billingPeriod: cashPayment.billingPeriod,
    })
  }, [cashPayment, renewMut])

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return
    const { sub, type } = confirmAction
    if (type === 'pause') pauseMut.mutate(sub.id)
    else if (type === 'resume') resumeMut.mutate(sub.id)
    setConfirmAction(null)
  }, [confirmAction, pauseMut, resumeMut])

  const columns: Column<Subscription>[] = [
    { key: 'restaurantName', header: 'Restaurant', render: (s) => <span className="font-medium">{s.restaurantName}</span> },
    { key: 'plan', header: 'Plan', render: (s) => {
      const plan = planMap.get(s.plan)
      return <Badge variant="info">{plan?.name || s.plan}</Badge>
    }},
    { key: 'status', header: 'Status', render: (s) => (
      <Badge variant={s.status === 'active' ? 'success' : (s.status === 'paused' || s.status === 'grace') ? 'warning' : s.status === 'expired' ? 'danger' : 'neutral'}>
        {s.status === 'grace' ? 'Warning' : s.status}
      </Badge>
    )},
    { key: 'price', header: 'Price', render: (s) => formatCurrency(s.price), hideOnMobile: true },
    { key: 'billingPeriod', header: 'Billing', render: (s) => (
      <Badge variant={s.billingPeriod === 'yearly' ? 'success' : 'neutral'}>{s.billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}</Badge>
    ), hideOnMobile: true },
    { key: 'expiryDate', header: 'Expiry', render: (s) => {
      // During the 2-day warning window, surface the free-tier countdown instead of the past expiry date.
      if (s.status === 'grace' && s.graceEnd) {
        const days = Math.max(0, Math.ceil((new Date(s.graceEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        return <span className="text-xs font-semibold text-warning">Free in {days}d</span>
      }
      return formatDate(s.expiryDate)
    }, hideOnMobile: true },
    { key: 'maxDevices', header: 'Max Devices', hideOnMobile: true },
    { key: 'aiEnabled', header: 'AI', render: (s) => s.aiEnabled ? <Badge variant="success">Yes</Badge> : <Badge variant="neutral">No</Badge> },
    { key: 'lastPayment', header: 'Last Payment', render: (s) => s.lastPayment ? (
      <div className="text-xs">
        <span className="font-medium text-surface-900 dark:text-surface-100">{formatCurrency(s.lastPayment.amount)}</span>
        <span className="text-surface-400 mx-1">·</span>
        <span className="text-surface-500">{formatDate(s.lastPayment.date)}</span>
        {s.lastPayment.invoiceNumber && (
          <span className="block text-[10px] text-surface-400">{s.lastPayment.invoiceNumber}</span>
        )}
      </div>
    ) : (
      <span className="text-xs text-surface-400">No payments</span>
    ), hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div className="flex items-center gap-1">
          {(s.status === 'active' || s.status === 'expired' || s.status === 'trial' || s.status === 'grace') && (
            <>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenCashPayment(s) }}>
                Renew
              </Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ sub: s, type: 'pause' }) }}>
                Pause
              </Button>
            </>
          )}
          {s.status === 'paused' && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ sub: s, type: 'resume' }) }}>
              Resume
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Subscriptions</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Manage restaurant subscriptions</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search subscriptions..." />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="grace">Warning (grace)</option>
              <option value="paused">Paused</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </CardHeader>
        <Table
          columns={columns}
          data={data?.data || []}
          loading={isLoading}
          page={page}
          totalPages={data?.totalPages || 1}
          onPageChange={setPage}
          keyExtractor={(s) => s.id}
          emptyMessage="No subscriptions found"
        />
      </Card>

      {/* ─── Cash Payment Modal ─────────────────────────────────────── */}
      {cashPayment && (
        <Modal
          open={!!cashPayment}
          onClose={() => { if (!renewMut.isPending) { setCashPayment(null); setCashResult(null) } }}
          title={`Renew Subscription — ${cashPayment.sub.restaurantName}`}
          size="md"
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-surface-400">
                Invoice will be generated after confirmation
              </span>
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={() => { setCashPayment(null); setCashResult(null) }} disabled={renewMut.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setShowRenewConfirm(true)} disabled={renewMut.isPending}>
                  {`Collect ₹${cashPayment.amount?.toLocaleString('en-IN') || '0'} & Renew`}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Plan info summary */}
            <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-700/50">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-surface-500 dark:text-surface-400">Plan</span>
                  <p className="font-medium text-surface-900 dark:text-surface-100">
                    {planMap.get(cashPayment.sub.plan)?.name || cashPayment.sub.plan}
                  </p>
                </div>
                <div>
                  <span className="text-surface-500 dark:text-surface-400">Status</span>
                  <p className="font-medium">
                    <Badge variant="success">{cashPayment.sub.status}</Badge>
                  </p>
                </div>
                <div>
                  <span className="text-surface-500 dark:text-surface-400">Expiry</span>
                  <p className="font-medium text-surface-900 dark:text-surface-100">
                    {cashPayment.sub.expiryDate ? formatDate(cashPayment.sub.expiryDate) : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-surface-500 dark:text-surface-400">Restaurant</span>
                  <p className="font-medium text-surface-900 dark:text-surface-100">{cashPayment.sub.restaurantName}</p>
                </div>
              </div>
            </div>

            {/* Billing Period */}
            <div>
              <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Billing Period
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(['monthly', 'yearly'] as const).map((period) => {
                  const plan = planMap.get(cashPayment.sub.plan)
                  const selected = cashPayment.billingPeriod === period
                  const amount = periodPrice(plan, period)
                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setCashPayment({
                        ...cashPayment,
                        billingPeriod: period,
                        amount: amount > 0 ? amount : cashPayment.amount,
                      })}
                      className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-600'
                          : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                      }`}
                    >
                      <p className={`text-sm font-semibold capitalize ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100'}`}>{period}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                        {amount > 0 ? formatCurrency(amount) : '—'}/{period === 'yearly' ? 'yr' : 'mo'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Amount Received <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500">₹</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={cashPayment.amount}
                  onChange={(e) => setCashPayment({ ...cashPayment, amount: Math.max(1, parseInt(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-surface-300 bg-white pl-8 pr-3 py-2 text-sm text-surface-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
                />
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Payment Method <span className="text-red-500">*</span>
              </label>
              <select
                value={cashPayment.paymentMethod}
                onChange={(e) => setCashPayment({ ...cashPayment, paymentMethod: e.target.value as PaymentMethod })}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
              >
                {(Object.entries(paymentMethodLabels) as [PaymentMethod, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Notes / Remarks */}
            <div>
              <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Notes / Remarks
              </label>
              <textarea
                rows={2}
                value={cashPayment.notes}
                onChange={(e) => setCashPayment({ ...cashPayment, notes: e.target.value })}
                placeholder="Optional: receipt reference, cheque number, or any remarks..."
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Success Result Modal ────────────────────────────────── */}
      {cashResult && (
        <Modal
          open={!!cashResult}
          onClose={() => setCashResult(null)}
          title="✅ Payment Recorded"
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setCashResult(null)}>
              Done
            </Button>
          }
        >
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">Subscription renewed successfully</p>
              <div className="mt-3 space-y-1 text-sm text-surface-600 dark:text-surface-400">
                <p><span className="font-medium">Invoice:</span> {cashResult.invoiceNumber}</p>
                <p><span className="font-medium">Amount:</span> ₹{cashResult.amount?.toLocaleString('en-IN')}</p>
                <p><span className="font-medium">Method:</span> {paymentMethodLabels[cashResult.paymentMethod as PaymentMethod] || cashResult.paymentMethod}</p>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Renew Confirm Dialog ────────────────────────────────── */}
      <ConfirmDialog
        open={showRenewConfirm}
        onClose={() => setShowRenewConfirm(false)}
        onConfirm={() => { setShowRenewConfirm(false); handleConfirmRenew() }}
        title="Confirm Renewal"
        message={
          cashPayment
            ? `Renew the subscription for "${cashPayment.sub.restaurantName}"? This will charge ₹${cashPayment.amount.toLocaleString('en-IN')} via ${paymentMethodLabels[cashPayment.paymentMethod]} and extend the subscription by ${cashPayment.billingPeriod === 'yearly' ? '365' : '30'} days.`
            : 'Proceed with renewal?'
        }
        confirmLabel={`Renew — ₹${cashPayment?.amount.toLocaleString('en-IN') || '0'}`}
        variant="primary"
      />

      {/* ─── Pause / Resume Confirm Dialog ─────────────────────── */}
      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction?.type === 'pause' ? 'Pause Subscription' : 'Resume Subscription'
        }
        message={
          confirmAction?.type === 'pause'
            ? `Pause the subscription for "${confirmAction?.sub.restaurantName}"? The restaurant will temporarily lose access.`
            : `Resume the subscription for "${confirmAction?.sub.restaurantName}"?`
        }
        confirmLabel={confirmAction?.type === 'pause' ? 'Pause' : 'Resume'}
        variant={confirmAction?.type === 'pause' ? 'warning' : 'primary'}
      />
    </div>
  )
}

/**
 * =============================================================================
 *  SubscriptionPlans.tsx — Subscription Plan Management Page
 * =============================================================================
 *
 * Features:
 *   - Paginated table of all subscription plans with feature badges
 *   - Create plan modal (configurable features, limits, pricing)
 *   - Edit plan modal (inline form with all plan properties)
 *   - Delete plan confirmation
 *
 * Data Sources:
 *   - GET    /admin/subscription-plans  → Plan list
 *   - POST   /admin/subscription-plans  → Create plan
 *   - PUT    /admin/subscription-plans/:id → Update plan
 *   - DELETE /admin/subscription-plans/:id → Delete plan
 *
 * Available Features:
 *   core_pos, basic_reports, ai, inventory, loyalty, reservations,
 *   multi_branch, analytics, custom_branding, advanced_reports,
 *   api_access, priority_support
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Table, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Toggle } from '../components/ui/Toggle'
import { ErrorPage } from '../components/ui/ErrorPage'
import { getPlans, createPlan, updatePlan, deletePlan } from '../api/subscriptionPlans'
import type { SubscriptionPlan } from '../types'
import { formatCurrency } from '../utils/format'

const AVAILABLE_FEATURES = [
  'core_pos',
  'basic_reports',
  'ai',
  'inventory',
  'loyalty',
  'reservations',
  'multi_branch',
  'analytics',
  'custom_branding',
  'advanced_reports',
  'api_access',
  'priority_support',
]

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  core_pos: 'Billing, orders, table management, and payment processing',
  basic_reports: 'Daily sales summaries, order history, and performance metrics',
  ai: 'AI-powered menu recommendations and demand forecasting',
  inventory: 'Stock tracking, purchase orders, and low-stock alerts',
  loyalty: 'Customer rewards program, points tracking, and promotions',
  reservations: 'Online and walk-in table booking with availability management',
  multi_branch: 'Centralized management across multiple restaurant locations',
  analytics: 'Advanced data visualizations and business intelligence dashboards',
  custom_branding: 'White-label experience with custom logo and branding',
  advanced_reports: 'Profit & loss, tax reports, and custom exportable data',
  api_access: 'REST API access for third-party integrations and custom tools',
  priority_support: 'Dedicated support with priority ticketing and SLAs',
}

const DEFAULT_LIMITS = {
  maxBranches: 1,
  maxDevices: 3,
  maxEmployees: 10,
}

const emptyForm = {
  planId: '',
  name: '',
  description: '',
  price: 0,
  maxUsers: 5,
  maxDevices: 1,
  features: ['core_pos', 'basic_reports'],
  aiEnabled: false,
  trialDays: 14,
  sortOrder: 0,
  isActive: true,
  isDefault: false,
  limits: { ...DEFAULT_LIMITS },
}

export default function SubscriptionPlans() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({ ...emptyForm })
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionPlan | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscription-plans', page],
    queryFn: () => getPlans({ page, limit: 50 }),
  })

  const createMutation = useMutation({
    mutationFn: () => createPlan(formData as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] })
      setShowCreateModal(false)
      setFormData({ ...emptyForm })
      toast.success('Plan created')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create plan'),
  })

  const editMutation = useMutation({
    mutationFn: () => updatePlan(editingPlan!.id, formData as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] })
      setShowEditModal(false)
      setEditingPlan(null)
      toast.success('Plan updated')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update plan'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] })
      setDeleteTarget(null)
      toast.success('Plan deleted')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to delete plan'),
  })

  const handleEdit = useCallback((plan: SubscriptionPlan) => {
    setEditingPlan(plan)
    setFormData({
      planId: plan.planId,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      maxUsers: plan.maxUsers,
      maxDevices: plan.maxDevices,
      features: plan.features,
      aiEnabled: plan.aiEnabled,
      trialDays: plan.trialDays,
      sortOrder: plan.sortOrder,
      isActive: plan.isActive,
      isDefault: plan.isDefault,
      limits: plan.limits || { ...DEFAULT_LIMITS },
    })
    setShowEditModal(true)
  }, [])

  const toggleFeature = (feature: string) => {
    setFormData((prev: Record<string, any>) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f: string) => f !== feature)
        : [...prev.features, feature],
    }))
  }

  const planForm = (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Input label="Plan ID (key)" value={formData.planId} onChange={(e) => setFormData({ ...formData, planId: e.target.value })} placeholder="e.g. premium" disabled={!!editingPlan} />
        <Input label="Display Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Premium Plan" />
        <Input label="Price (monthly)" type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Description</label>
          <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={1}
            className="block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
            placeholder="Describe what this plan includes..."
          />
        </div>
        <Input label="Sort Order" type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Input label="Max Users" type="number" value={formData.maxUsers} onChange={(e) => setFormData({ ...formData, maxUsers: parseInt(e.target.value) || 1 })} />
        <Input label="Max Devices" type="number" value={formData.maxDevices} onChange={(e) => setFormData({ ...formData, maxDevices: parseInt(e.target.value) || 1 })} />
        <Input label="Trial Days" type="number" value={formData.trialDays} onChange={(e) => setFormData({ ...formData, trialDays: parseInt(e.target.value) || 0 })} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Input label="Max Branches (0=unlimited)" type="number" value={formData.limits?.maxBranches ?? 1} onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxBranches: parseInt(e.target.value) || 0 } })} />
        <Input label="Max Devices (limit)" type="number" value={formData.limits?.maxDevices ?? 3} onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxDevices: parseInt(e.target.value) || 1 } })} />
        <Input label="Max Employees" type="number" value={formData.limits?.maxEmployees ?? 10} onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxEmployees: parseInt(e.target.value) || 1 } })} />
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Features</label>
        <div className="grid grid-cols-4 gap-3">
          {AVAILABLE_FEATURES.map((f) => (
            <Toggle
              key={f}
              enabled={formData.features.includes(f)}
              onChange={() => toggleFeature(f)}
              label={f.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
              description={FEATURE_DESCRIPTIONS[f]}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <Toggle
          enabled={formData.aiEnabled}
          onChange={(v) => setFormData({ ...formData, aiEnabled: v })}
          label="AI Enabled"
        />
        <Toggle
          enabled={formData.isDefault}
          onChange={(v) => setFormData({ ...formData, isDefault: v })}
          label="Default Plan"
        />
        <Toggle
          enabled={formData.isActive}
          onChange={(v) => setFormData({ ...formData, isActive: v })}
          label="Active"
        />
      </div>
    </div>
  )

  const columns: Column<SubscriptionPlan>[] = [
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'planId', header: 'Plan ID', render: (p) => <code className="text-xs text-surface-500">{p.planId}</code>, hideOnMobile: true },
    { key: 'price', header: 'Price', render: (p) => formatCurrency(p.price), hideOnMobile: true },
    { key: 'maxDevices', header: 'Devices', render: (p) => `${p.maxUsers} users / ${p.maxDevices} devices`, hideOnMobile: true },
    { key: 'features', header: 'Features', render: (p) => (
      <div className="flex flex-wrap gap-1">
        {p.features.slice(0, 3).map((f) => <Badge key={f} variant="info">{f.replace(/_/g, ' ')}</Badge>)}
        {p.features.length > 3 && <Badge variant="neutral">+{p.features.length - 3}</Badge>}
      </div>
    )},
    { key: 'isDefault', header: 'Default', render: (p) => p.isDefault ? <Badge variant="success">Yes</Badge> : null },
    { key: 'isActive', header: 'Status', render: (p) => p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge> },    {
      key: 'limits', header: 'Limits', hideOnMobile: true,
      render: (p) => (
        <div className="flex flex-wrap gap-1 text-[11px] text-surface-500">
          <span>{p.limits?.maxBranches === 0 ? 'Unlimited' : `${p.limits?.maxBranches || 1}`} branches</span>
          <span className="mx-1">·</span>
          <span>{p.limits?.maxDevices || p.maxDevices} devices</span>
          <span className="mx-1">·</span>
          <span>{p.limits?.maxEmployees || p.maxUsers} employees</span>
        </div>
      ),
    },
    { key: 'actions', header: '',
      render: (p) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleEdit(p) }}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p) }}>Delete</Button>
        </div>
      ),
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Subscription Plans</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Define and manage subscription tiers with configurable capabilities</p>
        </div>
        <Button onClick={() => { setFormData({ ...emptyForm }); setShowCreateModal(true) }}>
          <Plus size={16} /> Create Plan
        </Button>
      </div>

      <Card>
        <CardHeader>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {data?.total || 0} plan{data?.total !== 1 ? 's' : ''} configured
          </p>
        </CardHeader>
        <Table
          columns={columns}
          data={data?.data || []}
          loading={isLoading}
          page={page}
          totalPages={data?.totalPages || 1}
          onPageChange={setPage}
          keyExtractor={(p) => p.id}
          emptyMessage="No subscription plans yet. Create your first plan to get started."
        />
      </Card>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Subscription Plan" size="2xl">
        {planForm}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>Create Plan</Button>
        </div>
      </Modal>

      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Subscription Plan" size="2xl">
        {planForm}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
          <Button onClick={() => editMutation.mutate()} loading={editMutation.isPending}>Save Changes</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.id)}
        title="Delete Plan"
        message={`Permanently delete "${deleteTarget?.name}" plan? This will NOT affect existing subscriptions using this plan.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  )
}

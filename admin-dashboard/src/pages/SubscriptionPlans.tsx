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

import { FEATURE_CATALOG, FEATURE_GROUPS } from '../constants/planFeatures'

const AVAILABLE_FEATURES = FEATURE_CATALOG.map((f) => f.key)

const DEFAULT_LIMITS = {
  maxBranches: 1,
  maxDevicesPerBranch: 3,
}

/**
 * Best-available error message from the backend. Validation middleware returns
 * { error, details: [...] } (no message), auth returns { error }, controllers
 * return { message } — so try them all instead of showing a generic toast.
 */
function planErrorMessage(err: any): string {
  const data = err?.response?.data
  if (data?.message) return data.message
  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details
      .map((d: any) => `${d.path ? `${d.path}: ` : ''}${d.message}`)
      .join('; ')
  }
  if (data?.error) return data.error
  return err?.message || 'Failed to save plan'
}

const emptyForm = {
  planId: '',
  name: '',
  description: '',
  price: 0,
  yearlyPrice: 0,
  maxUsers: 5,
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
    onError: (err: any) => toast.error(planErrorMessage(err)),
  })

  // Client-side guard so the backend's required fields are never hit blank.
  const handleCreate = () => {
    if (!formData.planId?.trim()) {
      toast.error('Plan ID is required')
      return
    }
    if (!formData.name?.trim()) {
      toast.error('Display Name is required')
      return
    }
    createMutation.mutate()
  }

  const editMutation = useMutation({
    mutationFn: () => updatePlan(editingPlan!.id, formData as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] })
      setShowEditModal(false)
      setEditingPlan(null)
      toast.success('Plan updated')
    },
    onError: (err: any) => toast.error(planErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] })
      setDeleteTarget(null)
      toast.success('Plan deleted')
    },
    onError: (err: any) => toast.error(planErrorMessage(err)),
  })

  const handleEdit = useCallback((plan: SubscriptionPlan) => {
    setEditingPlan(plan)
    setFormData({
      planId: plan.planId,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      yearlyPrice: plan.yearlyPrice ?? 0,
      maxUsers: plan.maxUsers,
      features: plan.features,
      aiEnabled: plan.aiEnabled,
      trialDays: plan.trialDays,
      sortOrder: plan.sortOrder,
      isActive: plan.isActive,
      isDefault: plan.isDefault,
      limits: {
        maxBranches: plan.limits?.maxBranches ?? DEFAULT_LIMITS.maxBranches,
        // Legacy plans may still carry the device limit under the old names.
        maxDevicesPerBranch: plan.limits?.maxDevicesPerBranch ?? (plan.limits as any)?.maxDevices ?? plan.maxDevices ?? DEFAULT_LIMITS.maxDevicesPerBranch,
      },
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
        <Input label="Monthly Price" type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
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
        <Input label="Trial Days" type="number" value={formData.trialDays} onChange={(e) => setFormData({ ...formData, trialDays: parseInt(e.target.value) || 0 })} />
        <Input label="Yearly Price" type="number" value={formData.yearlyPrice} onChange={(e) => setFormData({ ...formData, yearlyPrice: parseFloat(e.target.value) || 0 })} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Input label="Max Branches (0=unlimited)" type="number" value={formData.limits?.maxBranches ?? 1} onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxBranches: parseInt(e.target.value) || 0 } })} />
        <Input label="Max Devices per Branch (0=unlimited)" type="number" value={formData.limits?.maxDevicesPerBranch ?? 3} onChange={(e) => setFormData({ ...formData, limits: { ...formData.limits, maxDevicesPerBranch: parseInt(e.target.value) || 0 } })} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Features</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFormData({ ...formData, features: AVAILABLE_FEATURES })}
              className="px-2 py-1 rounded-md text-[11px] font-semibold bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700 transition-colors cursor-pointer">Select All</button>
            <button type="button" onClick={() => setFormData({ ...formData, features: ['core_pos'] })}
              className="px-2 py-1 rounded-md text-[11px] font-semibold bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700 transition-colors cursor-pointer">Clear</button>
          </div>
        </div>
        <p className="text-[11px] text-surface-400">Features not included in the plan are hidden in the restaurant's POS for every role.</p>
        <div className="max-h-80 overflow-y-auto rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-4">
          {FEATURE_GROUPS.map((group) => (
            <div key={group}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-surface-400 mb-2">{group}</p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {FEATURE_CATALOG.filter((f) => f.group === group).map((f) => {
                  const locked = f.required
                  const checked = formData.features.includes(f.key)
                  return (
                    <Toggle
                      key={f.key}
                      enabled={checked || locked}
                      onChange={() => !locked && toggleFeature(f.key)}
                      label={locked ? `${f.label} (required)` : f.label}
                      description={f.description}
                    />
                  )
                })}
              </div>
            </div>
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
    { key: 'price', header: 'Pricing', render: (p) => (
      <div className="text-xs text-surface-500">
        <span>{formatCurrency(p.price)}/mo</span>
        {p.yearlyPrice > 0 && <><span className="mx-1">·</span><span>{formatCurrency(p.yearlyPrice)}/yr</span></>}
      </div>
    ), hideOnMobile: true },
    { key: 'maxUsers', header: 'Users', render: (p) => p.maxUsers, hideOnMobile: true },
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
          <span>{p.maxUsers} users</span>
          <span className="mx-1">·</span>
          <span>{p.limits?.maxBranches === 0 ? 'Unlimited' : `${p.limits?.maxBranches || 1}`} branches</span>
          <span className="mx-1">·</span>
          <span>{p.limits?.maxDevicesPerBranch ?? (p.limits as any)?.maxDevices ?? p.maxDevices ?? 3} devices / branch</span>
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
          <Button onClick={handleCreate} loading={createMutation.isPending}>Create Plan</Button>
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

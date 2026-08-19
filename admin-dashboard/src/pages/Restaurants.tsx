/**
 * =============================================================================
 *  Restaurants.tsx — Restaurant List & Management Page
 * =============================================================================
 *
 * Features:
 *   - Paginated restaurant table with search & status filter
 *   - Create restaurant modal (form with owner details, plan, pricing)
 *   - Edit restaurant modal (inline form)
 *   - Suspend / Activate / Delete actions with confirmation dialogs
 *   - Copy owner credentials after creation
 *
 * Data Sources:
 *   - GET /admin/restaurants           → Restaurant list (paginated)
 *   - GET /admin/subscription-plans    → Available plans for dropdown
 *   - POST/DELETE/PUT /admin/restaurants/:id → Mutations
 *
 * Hooks:
 *   - useQuery: fetch restaurants + plans
 *   - useMutation: create, update, suspend, activate, delete
 */

import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Copy, Check, CheckCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { ErrorPage } from '../components/ui/ErrorPage'
import { Tooltip } from '../components/ui/Tooltip'
import { getRestaurants, createRestaurant, updateRestaurant, deleteRestaurant, suspendRestaurant, activateRestaurant, restoreRestaurant, permanentDeleteRestaurant } from '../api/restaurants'
import { getPlans } from '../api/subscriptionPlans'
import type { Restaurant, SubscriptionPlan } from '../types'
import { formatDate, formatNumber, formatCurrency } from '../utils/format'
import { ALL_FEATURE_KEYS, FEATURE_BY_KEY } from '../constants/planFeatures'

const AVAILABLE_FEATURES = ALL_FEATURE_KEYS

const FEATURE_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  ALL_FEATURE_KEYS.map((k) => [k, FEATURE_BY_KEY[k]?.description || '']),
)

export default function Restaurants() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    ownerEmail: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    country: '',
    gst: '',
    plan: 'basic',
    maxDevices: 1,
    aiEnabled: false,
    onboardingMode: 'cash',
  })

  const { data: plansData } = useQuery({
    queryKey: ['subscription-plans', 'active'],
    queryFn: () => getPlans({ active: 'true', limit: 100 }),
  })
  const plans = plansData?.data || []
  const defaultPlanId = plans.length > 0 ? plans[0].planId : 'basic'

  // Auto-set form plan to the first available plan when plans load (for create modal)
  useEffect(() => {
    if (plans.length > 0 && formData.plan === 'basic' && !showEditModal) {
      const firstPlan = plans[0]
      setFormData(prev => ({
        ...prev,
        plan: firstPlan.planId,
        maxDevices: (firstPlan.limits?.maxDevicesPerBranch ?? firstPlan.maxDevices) || 1,
        aiEnabled: (firstPlan.features || []).includes('ai'),
      }))
    }
  }, [plans.length > 0])
  const [confirmAction, setConfirmAction] = useState<{ restaurant: Restaurant; type: 'delete' | 'suspend' | 'activate' | 'restore' | 'permanent-delete' } | null>(null)
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; ownerUserId: string; ownerPin: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['restaurants', page, search, statusFilter, includeDeleted],
    queryFn: () => getRestaurants({ page, limit: 10, search, status: statusFilter || undefined, deleted: includeDeleted ? 'true' : undefined }),
  })

  const createMutation = useMutation({
    mutationFn: () => createRestaurant(formData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      setShowCreateModal(false)
      setFormData({
        name: '', ownerName: '', ownerEmail: '', phone: '', email: '',
        address: '', city: '', state: '', country: '', gst: '',
        plan: defaultPlanId, maxDevices: (() => {
          const p = plans.length > 0 ? plans[0] : null
          return (p?.limits?.maxDevicesPerBranch ?? p?.maxDevices) || 1
        })(),
        aiEnabled: plans.length > 0 ? (plans[0].features || []).includes('ai') : false,
        onboardingMode: 'cash',
      })

      // Show invoice toast for cash payments
      if (data.invoice?.number) {
        toast.success(
          `${data.name} created · Invoice ${data.invoice.number} for ${formatCurrency(data.invoice.amount)} (+ ${formatCurrency(data.invoice.tax)} GST)`,
          { duration: 6000 }
        )
      } else {
        toast.success('Restaurant created successfully')
      }

      if (data.ownerUserId && data.ownerPin) {
        setCreatedCredentials({ name: data.name, ownerUserId: data.ownerUserId, ownerPin: data.ownerPin })
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create restaurant'),
  })

  const editMutation = useMutation({
    mutationFn: () => updateRestaurant(editingRestaurant!.id, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant updated successfully')
      setShowEditModal(false)
      setEditingRestaurant(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update restaurant'),
  })

  const suspendMutation = useMutation({
    mutationFn: (id: string) => suspendRestaurant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant suspended')
    },
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateRestaurant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant activated')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRestaurant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant deleted')
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreRestaurant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant restored')
    },
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => permanentDeleteRestaurant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
      toast.success('Restaurant permanently deleted')
    },
  })

  const handleEdit = useCallback((restaurant: Restaurant) => {
    setEditingRestaurant(restaurant)
    // Derive maxDevices and aiEnabled from the plan (source of truth)
    const p = plans.find((pl: SubscriptionPlan) => pl.planId === restaurant.plan)
    setFormData({
      name: restaurant.name,
      ownerName: restaurant.ownerName || '',
      ownerEmail: restaurant.ownerEmail || '',
      phone: restaurant.phone,
      email: restaurant.email || '',
      address: restaurant.address || '',
      city: restaurant.city || '',
      state: restaurant.state || '',
      country: restaurant.country || '',
      gst: restaurant.gst || '',
      plan: restaurant.plan,
      maxDevices: (p?.limits?.maxDevicesPerBranch ?? p?.maxDevices) || restaurant.maxDevices,
      aiEnabled: p ? (p.features || []).includes('ai') : restaurant.aiEnabled,
      onboardingMode: 'cash',
    })
    setShowEditModal(true)
  }, [plans])

  const columns: Column<Restaurant>[] = [
    { key: 'name', header: 'Name', render: (r) => (
      <button onClick={() => navigate(`/restaurants/${r.id}`)} className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
        {r.name}
      </button>
    )},
    { key: 'ownerName', header: 'Owner', hideOnMobile: true },
    { key: 'phone', header: 'Phone', hideOnMobile: true },
    { key: 'plan', header: 'Plan', render: (r) => <Badge variant="info">{r.plan}</Badge> },
    { key: 'status', header: 'Status', render: (r) => (
      <Badge variant={r.status === 'active' ? 'success' : r.status === 'suspended' ? 'danger' : 'neutral'}>
        {r.status}
      </Badge>
    )},
    { key: 'devices', header: 'Devices', render: (r) => `${formatNumber(r.devices)} / ${formatNumber(r.maxDevices)}` },
    { key: 'lastActive', header: 'Last Active', render: (r) => r.lastActive ? <span className="text-xs text-surface-500">{formatDate(r.lastActive)}</span> : <span className="text-xs text-surface-400">Never</span>, hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleEdit(r) }}>Edit</Button>
          {includeDeleted ? (
            <>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ restaurant: r, type: 'restore' }) }}>Restore</Button>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={(e) => { e.stopPropagation(); setConfirmAction({ restaurant: r, type: 'permanent-delete' }) }}>Delete Forever</Button>
            </>
          ) : r.status === 'active' ? (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ restaurant: r, type: 'suspend' }) }}>Suspend</Button>
          ) : r.status === 'suspended' || r.status === 'inactive' ? (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ restaurant: r, type: 'activate' }) }}>Activate</Button>
          ) : null}
          {!includeDeleted && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ restaurant: r, type: 'delete' }) }}>Delete</Button>
          )}
        </div>
      ),
    },
  ]

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return
    const { restaurant: r, type } = confirmAction
    if (type === 'delete') deleteMutation.mutate(r.id)
    else if (type === 'suspend') suspendMutation.mutate(r.id)
    else if (type === 'activate') activateMutation.mutate(r.id)
    else if (type === 'restore') restoreMutation.mutate(r.id)
    else if (type === 'permanent-delete') permanentDeleteMutation.mutate(r.id)
    setConfirmAction(null)
  }, [confirmAction, deleteMutation, suspendMutation, activateMutation, restoreMutation, permanentDeleteMutation])

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Restaurants</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Manage all registered restaurants</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus size={16} /> Add Restaurant
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search restaurants..." />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-surface-600 dark:text-surface-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => { setIncludeDeleted(e.target.checked); setPage(1) }}
                className="rounded border-surface-300 text-primary-600"
              />
              Deleted
            </label>
          </div>
        </CardHeader>
        <Table
          columns={columns}
          data={data?.data || []}
          loading={isLoading}
          page={page}
          totalPages={data?.totalPages || 1}
          onPageChange={setPage}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => navigate(`/restaurants/${r.id}`)}
          emptyMessage="No restaurants found"
        />
      </Card>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Restaurant" size="xl">
        <div className="space-y-4">
          {/* Onboarding Mode Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Onboarding Mode</label>
            <div className="grid grid-cols-3 gap-3">
              <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                formData.onboardingMode === 'cash'
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
              }`}>
                <input type="radio" name="onboardingMode" value="cash" checked={formData.onboardingMode === 'cash'}
                  onChange={(e) => setFormData({ ...formData, onboardingMode: e.target.value })}
                  className="mt-0.5 text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">Paid (Cash)</p>
                  <p className="text-xs text-surface-500 mt-0.5">Collect payment on the spot. Restaurant is fully activated immediately.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                formData.onboardingMode === 'create_only'
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
              }`}>
                <input type="radio" name="onboardingMode" value="create_only" checked={formData.onboardingMode === 'create_only'}
                  onChange={(e) => setFormData({ ...formData, onboardingMode: e.target.value })}
                  className="mt-0.5 text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">Create Only</p>
                  <p className="text-xs text-surface-500 mt-0.5">Create credentials only. Owner logs in and sees Plans page to select & pay.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                formData.onboardingMode === 'trial'
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
              }`}>
                <input type="radio" name="onboardingMode" value="trial" checked={formData.onboardingMode === 'trial'}
                  onChange={(e) => setFormData({ ...formData, onboardingMode: e.target.value })}
                  className="mt-0.5 text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">7-Day Free Trial</p>
                  <p className="text-xs text-surface-500 mt-0.5">All features unlocked for 7 days. Converts to Create Only after trial ends.</p>
                </div>
              </label>
            </div>
            {formData.onboardingMode === 'cash' && (
              <p className="text-xs text-success flex items-center gap-1">
                <CheckCircle size={12} /> Restaurant will be fully active — mark payment as received in cash.
              </p>
            )}
            {formData.onboardingMode === 'create_only' && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle size={12} /> Owner must select a plan in the POS before they can use the system.
              </p>
            )}
            {formData.onboardingMode === 'trial' && (
              <p className="text-xs text-info flex items-center gap-1">
                <CheckCircle size={12} /> Full access for 7 days. A reminder will be shown before trial ends.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Restaurant Name *" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter restaurant name" />
            <Input label="Phone *" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="Phone number" />
            {formData.onboardingMode === 'cash' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Plan</label>
                <select value={formData.plan} onChange={(e) => {
                  const p = plans.find((pl: SubscriptionPlan) => pl.planId === e.target.value)
                  setFormData({
                    ...formData,
                    plan: e.target.value,
                    maxDevices: (p?.limits?.maxDevicesPerBranch ?? p?.maxDevices) || 1,
                    aiEnabled: (p?.features || []).includes('ai'),
                  })
                }} className="block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100">
                  {plans.length === 0 && <option value="basic">Basic</option>}
                  {plans.map((p: SubscriptionPlan) => (
                    <option key={p.id} value={p.planId}>{p.name} {p.price > 0 ? `- ${formatCurrency(p.price)}/mo` : ''}{p.yearlyPrice > 0 ? ` · ${formatCurrency(p.yearlyPrice)}/yr` : ''}</option>
                  ))}
                </select>
              </div>
            )}
            {formData.onboardingMode !== 'cash' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Plan</label>
                <div className="flex h-[38px] items-center rounded-lg border border-surface-200 bg-surface-100 px-3 text-sm text-surface-400 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-500">
                  Selected by owner at POS
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Owner Name" value={formData.ownerName} onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })} placeholder="Owner full name" />
            <Input label="Owner Email" type="email" value={formData.ownerEmail} onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })} placeholder="owner@restaurant.com" />
            <Input label="Restaurant Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="info@restaurant.com" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Input label="Street Address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street address" />
            </div>
            <Input label="GST / Tax ID" value={formData.gst} onChange={(e) => setFormData({ ...formData, gst: e.target.value })} placeholder="GST number" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="City" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="City" />
            <Input label="State" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} placeholder="State" />
            <Input label="Country" value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })} placeholder="Country" />
          </div>

          {formData.onboardingMode === 'cash' && formData.plan && (() => {
            const p = plans.find((pl: SubscriptionPlan) => pl.planId === formData.plan)
            if (!p) return null
            return (
              <div className="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
                <p className="text-xs text-surface-500">
                  {p.maxUsers} users · {p.limits?.maxBranches === 0 ? 'Unlimited' : `${p.limits?.maxBranches || 1}`} branches ·{' '}
                  {p.limits?.maxDevicesPerBranch ?? p.maxDevices ?? 3} devices per branch
                </p>
                {p.description && <p className="text-xs text-surface-400 italic">{p.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_FEATURES.map((f) => {
                    const enabled = (p.features || []).includes(f)
                    return (
                      <Tooltip key={f} content={FEATURE_DESCRIPTIONS[f]}>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          enabled ? 'bg-success/10 text-success' : 'bg-surface-200 text-surface-400 dark:bg-surface-700 dark:text-surface-500'
                        }`}>
                          {f.replace(/_/g, ' ')}
                        </span>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>Create</Button>
        </div>
      </Modal>

      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Restaurant" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Input label="Restaurant Name *" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            <Input label="Phone *" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Plan</label>
              <select value={formData.plan} onChange={(e) => {
                const p = plans.find((pl: SubscriptionPlan) => pl.planId === e.target.value)
                setFormData({
                  ...formData,
                  plan: e.target.value,
                  maxDevices: (p?.limits?.maxDevicesPerBranch ?? p?.maxDevices) || 1,
                  aiEnabled: (p?.features || []).includes('ai'),
                })
              }} className="block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100">
                {plans.length === 0 && <option value="basic">Basic</option>}
                {plans.map((p: SubscriptionPlan) => (
                  <option key={p.id} value={p.planId}>{p.name} {p.price > 0 ? `- ${formatCurrency(p.price)}/mo` : ''}{p.yearlyPrice > 0 ? ` · ${formatCurrency(p.yearlyPrice)}/yr` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Owner Name" value={formData.ownerName} onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })} />
            <Input label="Owner Email" type="email" value={formData.ownerEmail} onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })} />
            <Input label="Restaurant Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Input label="Street Address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            </div>
            <Input label="GST / Tax ID" value={formData.gst} onChange={(e) => setFormData({ ...formData, gst: e.target.value })} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="City" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
            <Input label="State" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
            <Input label="Country" value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })} />
          </div>

          {formData.plan && (() => {
            const p = plans.find((pl: SubscriptionPlan) => pl.planId === formData.plan)
            if (!p) return null
            return (
              <div className="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
                <p className="text-xs text-surface-500">
                  {p.maxUsers} users · {p.limits?.maxBranches === 0 ? 'Unlimited' : `${p.limits?.maxBranches || 1}`} branches ·{' '}
                  {p.limits?.maxDevicesPerBranch ?? p.maxDevices ?? 3} devices per branch
                </p>
                {p.description && <p className="text-xs text-surface-400 italic">{p.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_FEATURES.map((f) => {
                    const enabled = (p.features || []).includes(f)
                    return (
                      <Tooltip key={f} content={FEATURE_DESCRIPTIONS[f]}>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          enabled ? 'bg-success/10 text-success' : 'bg-surface-200 text-surface-400 dark:bg-surface-700 dark:text-surface-500'
                        }`}>
                          {f.replace(/_/g, ' ')}
                        </span>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
          <Button onClick={() => editMutation.mutate()} loading={editMutation.isPending}>Save Changes</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction?.type === 'delete' ? 'Delete Restaurant' :
          confirmAction?.type === 'suspend' ? 'Suspend Restaurant' :
          confirmAction?.type === 'restore' ? 'Restore Restaurant' :
          confirmAction?.type === 'permanent-delete' ? 'Permanently Delete Restaurant' :
          'Activate Restaurant'
        }
        message={
          confirmAction?.type === 'delete'
            ? `Delete "${confirmAction?.restaurant.name}"? This soft-deletes the restaurant, disconnects its POS terminals and hides it from the list. You can restore it later from the Deleted view.`
            : confirmAction?.type === 'suspend'
            ? `Suspend "${confirmAction?.restaurant.name}"? All POS terminals will be disconnected.`
            : confirmAction?.type === 'restore'
            ? `Restore "${confirmAction?.restaurant.name}"? It will become active again with its devices and subscription reactivated.`
            : confirmAction?.type === 'permanent-delete'
            ? `Permanently delete "${confirmAction?.restaurant.name}"? This erases ALL tenant data (users, employees, branches, devices, bills, licenses) and CANNOT be undone.`
            : `Reactivate "${confirmAction?.restaurant.name}"?`
        }
        confirmLabel={
          confirmAction?.type === 'delete' ? 'Delete' :
          confirmAction?.type === 'suspend' ? 'Suspend' :
          confirmAction?.type === 'restore' ? 'Restore' :
          confirmAction?.type === 'permanent-delete' ? 'Delete Forever' :
          'Activate'
        }
        variant={confirmAction?.type === 'delete' || confirmAction?.type === 'suspend' || confirmAction?.type === 'permanent-delete' ? 'danger' : 'primary'}
      />

      <Modal open={!!createdCredentials} onClose={() => setCreatedCredentials(null)} title="Restaurant Created — Owner Credentials">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Restaurant <strong>{createdCredentials?.name}</strong> has been created. Share these credentials with the owner:
          </p>
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800/50">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400">USER ID</p>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-surface-100">{createdCredentials?.ownerUserId}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400">PIN / PASSWORD</p>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-surface-100">{createdCredentials?.ownerPin}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (createdCredentials) {
                  navigator.clipboard.writeText(`User ID: ${createdCredentials.ownerUserId}\nPIN: ${createdCredentials.ownerPin}`)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Credentials'}
            </Button>
          </div>
          <div className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
            <strong>Important:</strong> The owner can change their PIN after first login. After that, the new PIN will not be visible here.
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setCreatedCredentials(null)}>Done</Button>
        </div>
      </Modal>
    </div>
  )
}

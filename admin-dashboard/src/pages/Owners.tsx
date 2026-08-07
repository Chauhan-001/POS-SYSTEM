/**
 * =============================================================================
 *  Owners.tsx — Owner Management Page (Phase 2.3)
 * =============================================================================
 *
 * Full owner lifecycle surfaced in the admin console:
 *   - Paginated list with server-side search (name/email/phone), status filter,
 *     deleted toggle, sorting and real pagination.
 *   - Create owner (atomic onboarding) with optional restaurant assignment and
 *     one-time credential reveal.
 *   - Edit owner profile.
 *   - Suspend / Activate, Lock / Unlock, soft delete, restore and permanent
 *     delete with confirmation dialogs.
 *   - Reset password (secure — the API never returns a plaintext PIN).
 *   - Detail modal with tabs: Overview & Statistics, Restaurants, Sessions,
 *     Devices and Login History.
 *
 * Data Sources (all backend-driven, RBAC-protected):
 *   - GET  /admin/owners                       → list
 *   - POST /admin/owners                       → create
 *   - GET  /admin/owners/:id                   → detail
 *   - PUT  /admin/owners/:id                   → update
 *   - POST /admin/owners/:id/{suspend|activate|lock|unlock|restore|
 *           permanent-delete|reset-password}   → lifecycle
 *   - DELETE /admin/owners/:id                 → soft delete
 *   - GET /admin/owners/:id/{restaurants|sessions|devices|login-history|statistics}
 *   - POST/DELETE /admin/owners/:id/restaurants/:restaurantId
 *   - POST /admin/owners/:id/sessions/:sessionId/revoke, /sessions/revoke-all
 *   - POST /admin/owners/:id/devices/:deviceId/{block|unblock}, DELETE devices/:deviceId
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Copy, Check, User as UserIcon, Store, MonitorSmartphone,
  History, KeyRound, Lock, Unlock, RotateCcw, Trash2, ShieldOff, Ban, ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { ErrorPage } from '../components/ui/ErrorPage'
import {
  getOwners, getOwner, createOwner, updateOwner, deleteOwner, restoreOwner,
  permanentDeleteOwner, suspendOwner, activateOwner, lockOwner, unlockOwner,
  resetOwnerPassword, getOwnerRestaurants, assignRestaurant, unassignRestaurant,
  getOwnerSessions, revokeOwnerSession, revokeAllOwnerSessions,
  getOwnerDevices, blockOwnerDevice, unblockOwnerDevice, removeOwnerDevice,
  getOwnerLoginHistory, getOwnerStatistics,
} from '../api/owners'
import { getRestaurants } from '../api/restaurants'
import type { Owner, OwnerDetail } from '../types'
import { formatDate, formatDateTime } from '../utils/format'

type OwnerStatus = Owner['status']

const STATUS_VARIANT: Record<OwnerStatus, 'success' | 'danger' | 'neutral' | 'warning'> = {
  active: 'success',
  inactive: 'neutral',
  suspended: 'danger',
  deleted: 'danger',
}

const STATUS_LABEL: Record<OwnerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
  deleted: 'Deleted',
}

type ConfirmKind =
  | 'suspend' | 'activate' | 'unlock' | 'delete' | 'restore' | 'permanent-delete' | 'resetPwd'

interface ConfirmState {
  owner: Owner
  kind: ConfirmKind
}

const SORTS = [
  { value: 'createdAt', label: 'Created' },
  { value: 'name', label: 'Name' },
  { value: 'lastLogin', label: 'Last Login' },
  { value: 'lastActivity', label: 'Last Activity' },
]

export default function Owners() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Create / edit
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [assignedRestaurantIds, setAssignedRestaurantIds] = useState<string[]>([])
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; userId: string; tempPassword: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [editOwner, setEditOwner] = useState<Owner | null>(null)
  const [editData, setEditData] = useState({ name: '', email: '', phone: '' })

  // Detail modal
  const [detailOwnerId, setDetailOwnerId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'overview' | 'restaurants' | 'sessions' | 'devices' | 'login'>('overview')

  // Lock reason
  const [lockTarget, setLockTarget] = useState<Owner | null>(null)
  const [lockReason, setLockReason] = useState('')

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['owners', page, search, statusFilter, includeDeleted, sortBy, sortOrder],
    queryFn: () => getOwners({
      page, limit: 10, search, status: statusFilter || undefined,
      deleted: includeDeleted ? 'true' : undefined,
      sortBy, sortOrder,
    }),
  })

  // Restaurant options for create/assign pickers
  const { data: restaurantsData } = useQuery({
    queryKey: ['restaurants', 'picker'],
    queryFn: () => getRestaurants({ limit: 100 }),
  })
  const restaurantOptions = restaurantsData?.data || []

  // ─── Detail queries (lazy — only when the modal is open) ──────
  const detailEnabled = !!detailOwnerId
  const { data: detail } = useQuery({
    queryKey: ['owners', detailOwnerId, 'detail'],
    queryFn: () => getOwner(detailOwnerId!),
    enabled: detailEnabled && detailTab === 'overview',
  })
  const { data: statistics } = useQuery({
    queryKey: ['owners', detailOwnerId, 'statistics'],
    queryFn: () => getOwnerStatistics(detailOwnerId!),
    enabled: detailEnabled && detailTab === 'overview',
  })
  const { data: ownerRestaurants } = useQuery({
    queryKey: ['owners', detailOwnerId, 'restaurants'],
    queryFn: () => getOwnerRestaurants(detailOwnerId!),
    enabled: detailEnabled && detailTab === 'restaurants',
  })
  const { data: sessionsData } = useQuery({
    queryKey: ['owners', detailOwnerId, 'sessions'],
    queryFn: () => getOwnerSessions(detailOwnerId!),
    enabled: detailEnabled && detailTab === 'sessions',
  })
  const { data: devicesData } = useQuery({
    queryKey: ['owners', detailOwnerId, 'devices'],
    queryFn: () => getOwnerDevices(detailOwnerId!),
    enabled: detailEnabled && detailTab === 'devices',
  })
  const { data: loginHistoryData } = useQuery({
    queryKey: ['owners', detailOwnerId, 'login-history'],
    queryFn: () => getOwnerLoginHistory(detailOwnerId!, { limit: 50 }),
    enabled: detailEnabled && detailTab === 'login',
  })

  const invalidateOwner = useCallback((id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['owners'] })
    if (id) {
      queryClient.invalidateQueries({ queryKey: ['owners', id] })
      queryClient.invalidateQueries({ queryKey: ['restaurants'] })
    }
  }, [queryClient])

  // ─── Mutations ─────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => createOwner({
      name: createForm.name,
      email: createForm.email || undefined,
      phone: createForm.phone || undefined,
      password: createForm.password || undefined,
      restaurantIds: assignedRestaurantIds.length > 0 ? assignedRestaurantIds : undefined,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['owners'] })
      setShowCreateModal(false)
      setCreateForm({ name: '', email: '', phone: '', password: '' })
      setAssignedRestaurantIds([])
      if (data.tempPassword) {
        setCreatedCredentials({ name: data.name, userId: data.userId || '', tempPassword: data.tempPassword })
      }
      toast.success('Owner created successfully')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create owner'),
  })

  const updateMutation = useMutation({
    mutationFn: () => updateOwner(editOwner!.id, editData),
    onSuccess: () => { invalidateOwner(editOwner?.id); toast.success('Owner updated'); setEditOwner(null) },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update owner'),
  })

  const runAction = useCallback((kind: ConfirmKind, owner: Owner) => {
    setConfirmState({ owner, kind })
  }, [])

  const handleConfirm = useCallback(() => {
    if (!confirmState) return
    const { owner, kind } = confirmState
    setConfirmState(null)

    const optsMsg = (msg: string) => ({
      onSuccess: () => { invalidateOwner(owner.id); toast.success(msg) },
      onError: (err: any) => toast.error(err?.response?.data?.message || msg),
    })

    switch (kind) {
      case 'suspend': suspendMutation.mutate(owner.id, optsMsg('Owner suspended')); break
      case 'activate': activateMutation.mutate(owner.id, optsMsg('Owner activated')); break
      case 'unlock': unlockMutation.mutate(owner.id, optsMsg('Owner unlocked')); break
      case 'delete': deleteMutation.mutate(owner.id, optsMsg('Owner deleted')); break
      case 'restore': restoreMutation.mutate(owner.id, optsMsg('Owner restored')); break
      case 'permanent-delete': permanentDeleteMutation.mutate(owner.id, optsMsg('Owner permanently deleted')); break
      case 'resetPwd': resetPwdMutation.mutate(owner.id, optsMsg('Password reset successfully')); break
    }
  }, [confirmState, invalidateOwner])

  const suspendMutation = useMutation({ mutationFn: (id: string) => suspendOwner(id) })
  const activateMutation = useMutation({ mutationFn: (id: string) => activateOwner(id) })
  const unlockMutation = useMutation({ mutationFn: (id: string) => unlockOwner(id) })
  const deleteMutation = useMutation({ mutationFn: (id: string) => deleteOwner(id) })
  const restoreMutation = useMutation({ mutationFn: (id: string) => restoreOwner(id) })
  const permanentDeleteMutation = useMutation({ mutationFn: (id: string) => permanentDeleteOwner(id) })
  const resetPwdMutation = useMutation({ mutationFn: (id: string) => resetOwnerPassword(id) })
  const lockMutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) => lockOwner(payload.id, payload.reason),
    onSuccess: () => { invalidateOwner(lockTarget?.id); toast.success('Owner account locked'); setLockTarget(null); setLockReason('') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to lock account'),
  })

  // Owner-scoped sub-actions
  const assignMutation = useMutation({
    mutationFn: (rid: string) => assignRestaurant(detailOwnerId!, rid),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId] }); toast.success('Restaurant assigned') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to assign restaurant'),
  })
  const unassignMutation = useMutation({
    mutationFn: (rid: string) => unassignRestaurant(detailOwnerId!, rid),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId] }); toast.success('Restaurant unassigned') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to unassign restaurant'),
  })
  const revokeSessionMutation = useMutation({
    mutationFn: (sid: string) => revokeOwnerSession(detailOwnerId!, sid),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId, 'sessions'] }); toast.success('Session revoked') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to revoke session'),
  })
  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllOwnerSessions(detailOwnerId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId, 'sessions'] }); toast.success('All sessions revoked') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to revoke sessions'),
  })
  const blockDeviceMutation = useMutation({
    mutationFn: (did: string) => blockOwnerDevice(detailOwnerId!, did),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId, 'devices'] }); toast.success('Device blocked') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to block device'),
  })
  const unblockDeviceMutation = useMutation({
    mutationFn: (did: string) => unblockOwnerDevice(detailOwnerId!, did),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId, 'devices'] }); toast.success('Device unblocked') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to unblock device'),
  })
  const removeDeviceMutation = useMutation({
    mutationFn: (did: string) => removeOwnerDevice(detailOwnerId!, did),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owners', detailOwnerId, 'devices'] }); toast.success('Device removed') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to remove device'),
  })

  // ─── Columns ───────────────────────────────────────────────────
  const columns: Column<Owner>[] = [
    { key: 'name', header: 'Name', render: (o) => (
      <button onClick={() => { setDetailOwnerId(o.id); setDetailTab('overview') }} className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
        {o.name}
      </button>
    )},
    { key: 'email', header: 'Email', render: (o) => o.email || <span className="text-surface-400">—</span>, hideOnMobile: true },
    { key: 'phone', header: 'Phone', hideOnMobile: true },
    { key: 'restaurants', header: 'Restaurants', render: (o) => o.restaurants },
    { key: 'devices', header: 'Devices', render: (o) => o.devices ?? 0, hideOnMobile: true },
    { key: 'lastLogin', header: 'Last Login', render: (o) => o.lastLogin ? <span className="text-xs text-surface-500">{formatDate(o.lastLogin)}</span> : <span className="text-xs text-surface-400">Never</span>, hideOnMobile: true },
    { key: 'status', header: 'Status', render: (o) => (
      <Badge variant={STATUS_VARIANT[o.status]}>{STATUS_LABEL[o.status]}</Badge>
    )},
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailOwnerId(o.id); setDetailTab('overview') }}>View</Button>
          {includeDeleted ? (
            <>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runAction('restore', o) }}>Restore</Button>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={(e) => { e.stopPropagation(); runAction('permanent-delete', o) }}>Delete Forever</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditOwner(o); setEditData({ name: o.name, email: o.email || '', phone: o.phone || '' }) }}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runAction('resetPwd', o) }} title="Reset password (secure — no PIN shown)">Reset Pwd</Button>
              {o.status === 'active' && (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runAction('suspend', o) }}>Suspend</Button>
              )}
              {(o.status === 'suspended' || o.status === 'inactive') && (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runAction('activate', o) }}>Activate</Button>
              )}
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLockTarget(o); setLockReason('') }}>Lock</Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runAction('delete', o) }}>Delete</Button>
            </>
          )}
        </div>
      ),
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const detailOwner: OwnerDetail | undefined = detail

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Owners</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Manage restaurant owners and their access</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus size={16} /> Add Owner
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search owners... (name, email, phone)" />
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
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select
              value={sortOrder}
              onChange={(e) => { setSortOrder(e.target.value as 'asc' | 'desc'); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
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
          keyExtractor={(o) => o.id}
          emptyMessage="No owners found"
        />
      </Card>

      {/* ─── Create Owner ────────────────────────────────────────── */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add Owner" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full Name *" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Owner full name" />
            <Input label="Phone" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="Phone number" />
            <Input label="Email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} placeholder="owner@restaurant.com" />
            <Input label="Password / PIN (optional)" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Leave blank to auto-generate" helperText="Auto-generated when blank — shown once after creation." />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Assign Restaurants</label>
            {restaurantOptions.length === 0 ? (
              <p className="text-sm text-surface-400">No restaurants available</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-lg border border-surface-200 p-2 dark:border-surface-700">
                {restaurantOptions.map((r) => {
                  const checked = assignedRestaurantIds.includes(r.id)
                  return (
                    <label key={r.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-all ${
                      checked
                        ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                        : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
                    }`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAssignedRestaurantIds((prev) =>
                          checked ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                        )}
                        className="rounded border-surface-300 text-primary-600"
                      />
                      <span className="text-surface-700 dark:text-surface-300">{r.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!createForm.name.trim()}>Create Owner</Button>
        </div>
      </Modal>

      {/* ─── Created credentials (one-time reveal) ───────────────── */}
      <Modal open={!!createdCredentials} onClose={() => setCreatedCredentials(null)} title="Owner Created — Credentials">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Owner <strong>{createdCredentials?.name}</strong> has been created. Share these credentials with them:
          </p>
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800/50">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400">USER ID</p>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-surface-100">{createdCredentials?.userId}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400">PIN / PASSWORD</p>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-surface-100">{createdCredentials?.tempPassword}</p>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (createdCredentials) {
                navigator.clipboard.writeText(`User ID: ${createdCredentials.userId}\nPIN: ${createdCredentials.tempPassword}`)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Credentials'}
          </Button>
          <div className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
            <strong>Important:</strong> This is the only time the PIN is shown. The owner can change it after first login.
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setCreatedCredentials(null)}>Done</Button>
        </div>
      </Modal>

      {/* ─── Edit Owner ──────────────────────────────────────────── */}
      <Modal open={!!editOwner} onClose={() => setEditOwner(null)} title={`Edit ${editOwner?.name}`}>
        <div className="space-y-4">
          <Input label="Name" value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} />
          <Input label="Email" type="email" value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} />
          <Input label="Phone" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setEditOwner(null)}>Cancel</Button>
          <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>Save</Button>
        </div>
      </Modal>

      {/* ─── Lock Account (with reason) ──────────────────────────── */}
      <Modal open={!!lockTarget} onClose={() => setLockTarget(null)} title={`Lock ${lockTarget?.name}'s Account`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Locking the account immediately revokes all active sessions and prevents sign-in until manually unlocked.
          </p>
          <Input label="Reason (optional)" value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="e.g. Suspicious activity" />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setLockTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => lockMutation.mutate({ id: lockTarget!.id, reason: lockReason })} loading={lockMutation.isPending}>
            <Lock size={14} /> Lock Account
          </Button>
        </div>
      </Modal>

      {/* ─── Owner Detail Modal ──────────────────────────────────── */}
      <Modal
        open={!!detailOwnerId}
        onClose={() => setDetailOwnerId(null)}
        title={detailOwner ? `Owner — ${detailOwner.name}` : 'Owner Details'}
        size="2xl"
      >
        {detailOwner && (
          <div className="space-y-5">
            {/* Status banner */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-600/10 text-primary-600">
                  <UserIcon size={22} />
                </div>
                <div>
                  <p className="text-lg font-semibold text-surface-900 dark:text-surface-100">{detailOwner.name}</p>
                  <p className="text-sm text-surface-500">{detailOwner.email || 'No email'} · {detailOwner.phone || 'No phone'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[detailOwner.status]}>{STATUS_LABEL[detailOwner.status]}</Badge>
                {detailOwner.lockedAt && <Badge variant="danger">Locked</Badge>}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 border-b border-surface-200 dark:border-surface-700">
              {([
                ['overview', 'Overview', UserIcon],
                ['restaurants', 'Restaurants', Store],
                ['sessions', 'Sessions', MonitorSmartphone],
                ['devices', 'Devices', History],
                ['login', 'Login History', KeyRound],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setDetailTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                    detailTab === id
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {detailTab === 'overview' && (
              <div className="space-y-5">
                {/* Statistics cards (backend-generated) */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Restaurants', value: statistics?.restaurantsOwned ?? detailOwner.restaurants, icon: Store },
                    { label: 'Branches', value: statistics?.totalBranches ?? detailOwner.branches ?? 0, icon: Store },
                    { label: 'Devices', value: statistics?.totalDevices ?? detailOwner.devices ?? 0, icon: MonitorSmartphone },
                    { label: 'Active Sessions', value: statistics?.activeSessions ?? detailOwner.activeSessions ?? 0, icon: History },
                    { label: 'Employees', value: statistics?.totalEmployees ?? 0, icon: UserIcon },
                    { label: 'Active Restaurants', value: statistics?.activeRestaurants ?? detailOwner.activeRestaurants ?? 0, icon: ShieldCheck },
                    { label: 'Suspended Restaurants', value: statistics?.suspendedRestaurants ?? detailOwner.suspendedRestaurants ?? 0, icon: ShieldOff },
                    { label: 'Last Login', value: formatDate(statistics?.lastLogin ?? detailOwner.lastLogin), icon: KeyRound },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
                      <Icon size={16} className="text-primary-600 mb-1.5" />
                      <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
                      <p className="text-xs text-surface-500">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Profile details */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-surface-200 p-4 text-sm dark:border-surface-700 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-surface-500">Email</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100">{detailOwner.email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Phone</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100">{detailOwner.phone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Status</p>
                    <p className="font-medium capitalize text-surface-900 dark:text-surface-100">{detailOwner.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Created</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100">{formatDateTime(detailOwner.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Last Activity</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100">{formatDateTime(detailOwner.lastActivity)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Last Login</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100">{formatDateTime(detailOwner.lastLogin)}</p>
                  </div>
                  {detailOwner.lockedAt && (
                    <div className="col-span-full">
                      <p className="text-xs text-danger">Locked {formatDateTime(detailOwner.lockedAt)} by {detailOwner.lockedBy || 'admin'}{detailOwner.lockReason ? ` — ${detailOwner.lockReason}` : ''}</p>
                    </div>
                  )}
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap gap-2">
                  {detailOwner.status === 'active' && !detailOwner.lockedAt && (
                    <Button variant="outline" size="sm" onClick={() => runAction('suspend', { id: detailOwner.id, name: detailOwner.name, email: detailOwner.email, phone: detailOwner.phone, status: detailOwner.status, restaurants: detailOwner.restaurants, createdAt: detailOwner.createdAt, updatedAt: detailOwner.updatedAt })}>
                      <Ban size={14} /> Suspend
                    </Button>
                  )}
                  {(detailOwner.status === 'suspended' || detailOwner.status === 'inactive') && !detailOwner.lockedAt && (
                    <Button variant="outline" size="sm" onClick={() => runAction('activate', { id: detailOwner.id, name: detailOwner.name, email: detailOwner.email, phone: detailOwner.phone, status: detailOwner.status, restaurants: detailOwner.restaurants, createdAt: detailOwner.createdAt, updatedAt: detailOwner.updatedAt })}>
                      <ShieldCheck size={14} /> Activate
                    </Button>
                  )}
                  {detailOwner.lockedAt && (
                    <Button variant="outline" size="sm" onClick={() => runAction('unlock', { id: detailOwner.id, name: detailOwner.name, email: detailOwner.email, phone: detailOwner.phone, status: detailOwner.status, restaurants: detailOwner.restaurants, createdAt: detailOwner.createdAt, updatedAt: detailOwner.updatedAt })}>
                      <Unlock size={14} /> Unlock
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => runAction('resetPwd', { id: detailOwner.id, name: detailOwner.name, email: detailOwner.email, phone: detailOwner.phone, status: detailOwner.status, restaurants: detailOwner.restaurants, createdAt: detailOwner.createdAt, updatedAt: detailOwner.updatedAt })}>
                    <KeyRound size={14} /> Reset Password
                  </Button>
                </div>
              </div>
            )}

            {detailTab === 'restaurants' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) { assignMutation.mutate(e.target.value); e.target.value = '' }
                    }}
                  >
                    <option value="">Assign a restaurant…</option>
                    {restaurantOptions
                      .filter((r) => !(ownerRestaurants || []).some((or) => or.restaurantId === r.id && or.isActive))
                      .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                {ownerRestaurants?.length === 0 ? (
                  <p className="py-8 text-center text-sm text-surface-400">No restaurants assigned</p>
                ) : (
                  <div className="space-y-2">
                    {(ownerRestaurants || []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700">
                        <div className="flex items-center gap-3">
                          <Store size={16} className="text-surface-400" />
                          <div>
                            <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{r.name}</p>
                            <p className="text-xs text-surface-500">{r.branches} branches · {r.devices} devices · {r.plan} ({r.subscriptionStatus})</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => unassignMutation.mutate(r.id)}>Unassign</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detailTab === 'sessions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-surface-500">{sessionsData?.total ?? 0} active session(s)</p>
                  <Button variant="outline" size="sm" onClick={() => revokeAllMutation.mutate()}>
                    <ShieldOff size={14} /> Revoke All
                  </Button>
                </div>
                {sessionsData?.sessions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-surface-400">No active sessions</p>
                ) : (
                  <div className="space-y-2">
                    {(sessionsData?.sessions || []).map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700">
                        <div className="flex items-center gap-3 min-w-0">
                          <MonitorSmartphone size={16} className="text-surface-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{s.deviceName || 'Unknown device'} {s.os && <span className="text-surface-400">· {s.os}</span>}</p>
                            <p className="text-xs text-surface-500 truncate">
                              Last activity {formatDateTime(s.lastActivityAt)} {s.ipAddress && `· ${s.ipAddress}`}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger shrink-0" onClick={() => revokeSessionMutation.mutate(s.id)}>Revoke</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detailTab === 'devices' && (
              <div className="space-y-2">
                {devicesData?.length === 0 ? (
                  <p className="py-8 text-center text-sm text-surface-400">No registered devices</p>
                ) : (
                  (devicesData || []).map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700">
                      <div className="flex items-center gap-3 min-w-0">
                        <MonitorSmartphone size={16} className="text-surface-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{d.deviceName} {d.os && <span className="text-surface-400">· {d.os} {d.osVersion}</span>}</p>
                          <p className="text-xs text-surface-500 truncate">{d.restaurantName} · Last login {formatDateTime(d.lastLogin)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={d.status === 'blocked' ? 'danger' : d.isActive ? 'success' : 'neutral'}>
                          {d.status === 'blocked' ? 'Blocked' : d.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        {d.status === 'blocked' ? (
                          <Button variant="ghost" size="sm" onClick={() => unblockDeviceMutation.mutate(d.id)}>Unblock</Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-warning" onClick={() => blockDeviceMutation.mutate(d.id)}>Block</Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => removeDeviceMutation.mutate(d.id)}>Remove</Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {detailTab === 'login' && (
              <div className="space-y-2">
                {loginHistoryData?.data.length === 0 ? (
                  <p className="py-8 text-center text-sm text-surface-400">No login history</p>
                ) : (
                  (loginHistoryData?.data || []).map((e, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700">
                      <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${
                        e.event === 'login' ? 'bg-success' : e.event === 'failed' ? 'bg-danger' : 'bg-warning'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize text-surface-900 dark:text-surface-100">
                          {e.event === 'login' ? 'Login' : e.event === 'failed' ? 'Failed login' : 'Password reset'}
                        </p>
                        <p className="text-xs text-surface-500">{formatDateTime(e.timestamp)}</p>
                        {(e.deviceName || e.ipAddress) && (
                          <p className="text-xs text-surface-500 truncate mt-0.5">
                            {e.deviceName}{e.os ? ` · ${e.os}` : ''}{e.ipAddress ? ` · ${e.ipAddress}` : ''}
                          </p>
                        )}
                        {e.isActive && <Badge variant="success" className="mt-1">Active</Badge>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ─── Confirmations ───────────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirm}
        title={
          confirmState?.kind === 'suspend' ? 'Suspend Owner' :
          confirmState?.kind === 'activate' ? 'Activate Owner' :
          confirmState?.kind === 'unlock' ? 'Unlock Owner' :
          confirmState?.kind === 'delete' ? 'Delete Owner' :
          confirmState?.kind === 'restore' ? 'Restore Owner' :
          confirmState?.kind === 'permanent-delete' ? 'Permanently Delete Owner' :
          'Reset Password'
        }
        message={
          confirmState?.kind === 'suspend'
            ? `Suspend ${confirmState?.owner.name}? All active sessions will be revoked and sign-in blocked until reactivated.`
            : confirmState?.kind === 'activate'
            ? `Reactivate ${confirmState?.owner.name}? They will regain access to their restaurants.`
            : confirmState?.kind === 'unlock'
            ? `Unlock ${confirmState?.owner.name}'s account?`
            : confirmState?.kind === 'delete'
            ? `Delete ${confirmState?.owner.name}? This soft-deletes the owner, deactivates their devices and revokes all sessions. You can restore them later from the Deleted view.`
            : confirmState?.kind === 'restore'
            ? `Restore ${confirmState?.owner.name}? Their account and linked employee will become active again.`
            : confirmState?.kind === 'permanent-delete'
            ? `Permanently delete ${confirmState?.owner.name}? This erases the account, linked employee, devices and sessions, and unlinks their restaurants. This CANNOT be undone.`
            : `Reset the password for ${confirmState?.owner.name}? A new secure credential is generated and kept in sync across their linked accounts. The PIN is never displayed.`
        }
        confirmLabel={
          confirmState?.kind === 'suspend' ? 'Suspend' :
          confirmState?.kind === 'activate' ? 'Activate' :
          confirmState?.kind === 'unlock' ? 'Unlock' :
          confirmState?.kind === 'delete' ? 'Delete' :
          confirmState?.kind === 'restore' ? 'Restore' :
          confirmState?.kind === 'permanent-delete' ? 'Delete Forever' :
          'Reset Password'
        }
        variant={
          confirmState?.kind === 'suspend' || confirmState?.kind === 'delete' || confirmState?.kind === 'permanent-delete'
            ? 'danger'
            : confirmState?.kind === 'resetPwd'
            ? 'warning'
            : 'primary'
        }
      />
    </div>
  )
}

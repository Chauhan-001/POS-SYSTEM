/**
 * =============================================================================
 *  Devices.tsx — Device Management Page
 * =============================================================================
 *
 * Features:
 *   - Paginated device table with search + status filter
 *   - Device info: name, OS, app version, last seen (with relative time)
 *   - Approval workflow for pending devices (Approve / Reject)
 *   - Block / Unblock actions with confirmation dialogs
 *   - Remove (soft delete) with reason
 *   - Sessions modal (active/expired/revoked) with per-session revocation
 *   - View Activity Log modal with timeline of device events
 *   - Health summary cards (online / offline / pending / blocked)
 *
 * Data Sources:
 *   - GET  /admin/devices                  → Device list
 *   - GET  /admin/devices/statistics       → Device statistics
 *   - POST /admin/devices/:id/block        → Block device
 *   - POST /admin/devices/:id/unblock      → Unblock device
 *   - POST /admin/devices/:id/approve      → Approve pending device
 *   - POST /admin/devices/:id/reject       → Reject pending device
 *   - DELETE /admin/devices/:id            → Remove device
 *   - GET  /admin/devices/:id/activity     → Device activity log
 *   - GET  /admin/devices/:id/sessions     → Device sessions
 *   - POST /admin/devices/:id/sessions/:sessionId/revoke → Revoke session
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Activity, ShieldOff, ShieldCheck, Monitor, LogIn, AlertTriangle, CheckCircle2, XCircle, Trash2, Smartphone, Laptop, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader } from '../components/ui/Card'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { ErrorPage } from '../components/ui/ErrorPage'
import { getDevices, blockDevice, unblockDevice, approveDevice, rejectDevice, removeDevice, getDeviceActivity, getDeviceSessions, revokeDeviceSession, getDeviceStatistics, type DeviceActivityEvent } from '../api/devices'
import type { Device, DeviceSession, DeviceStatistics } from '../types'
import { formatDateTime } from '../utils/format'

// ─── Relative time helper ──────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function lastSeenDisplay(dateStr: string | undefined | null): React.ReactNode {
  if (!dateStr) return <span className="text-surface-400 text-xs">Never</span>
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-surface-900 dark:text-surface-100">
        {relativeTime(dateStr)}
      </span>
      <span className="text-[10px] text-surface-400 dark:text-surface-500">
        {formatDateTime(dateStr)}
      </span>
    </div>
  )
}

// ─── Status badge helper ───────────────────────────────────────

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'active': return 'success'
    case 'blocked': case 'rejected': return 'danger'
    case 'pending': return 'warning'
    case 'inactive': return 'neutral'
    default: return 'neutral'
  }
}

function onlineBadge(d: Device): React.ReactNode {
  if (d.status === 'blocked' || d.status === 'rejected') return null
  const online = d.isOnline || d.online
  return online
    ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-green-600 dark:text-green-400"><Wifi size={9} />ONLINE</span>
    : <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-surface-400"><WifiOff size={9} />OFFLINE</span>
}

// ─── Activity event icons & colors ─────────────────────────────

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  device_registered: {
    icon: <Monitor size={14} />,
    color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20',
    label: 'Registered',
  },
  device_login: {
    icon: <LogIn size={14} />,
    color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20',
    label: 'Login',
  },
  device_blocked: {
    icon: <ShieldOff size={14} />,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
    label: 'Blocked',
  },
  device_unblocked: {
    icon: <ShieldCheck size={14} />,
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20',
    label: 'Unblocked',
  },
  device_approved: {
    icon: <CheckCircle2 size={14} />,
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20',
    label: 'Approved',
  },
  device_rejected: {
    icon: <XCircle size={14} />,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
    label: 'Rejected',
  },
  device_removed: {
    icon: <Trash2 size={14} />,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
    label: 'Removed',
  },
  device_inactive: {
    icon: <AlertTriangle size={14} />,
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20',
    label: 'Inactive',
  },
  heartbeat: {
    icon: <Activity size={14} />,
    color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/20',
    label: 'Heartbeat',
  },
}

function activityIcon(event: string): { icon: React.ReactNode; color: string; label: string } {
  return EVENT_CONFIG[event] || {
    icon: <Activity size={14} />,
    color: 'text-surface-600 bg-surface-100 dark:text-surface-400 dark:bg-surface-800',
    label: event,
  }
}

// ─── Activity Timeline Component ──────────────────────────────

function ActivityTimeline({ events }: { events: DeviceActivityEvent[] }) {
  return (
    <div className="relative space-y-0">
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-surface-400">No activity recorded yet.</p>
      ) : (
        events.map((ev, idx) => {
          const cfg = activityIcon(ev.event)
          const isLast = idx === events.length - 1
          return (
            <div key={ev.id} className="relative flex gap-3 pb-5">
              {!isLast && (
                <div className="absolute left-[15px] top-[30px] bottom-0 w-px bg-surface-200 dark:bg-surface-700" />
              )}
              <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${cfg.color}`}>
                {cfg.icon}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-surface-400 shrink-0">
                    {relativeTime(ev.timestamp)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-surface-500 dark:text-surface-400 leading-relaxed">
                  {ev.description}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-surface-400">
                  <span>{formatDateTime(ev.timestamp)}</span>
                  {ev.ipAddress && <span>· IP: {ev.ipAddress}</span>}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── Sessions Modal ────────────────────────────────────────────

function SessionsModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['device-sessions', device.id, page],
    queryFn: () => getDeviceSessions(device.id, page),
  })
  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeDeviceSession(device.id, sessionId),
    onSuccess: () => {
      toast.success('Session revoked')
      setPage(1)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to revoke session'),
  })

  return (
    <Modal open onClose={onClose} title={`Sessions — ${device.deviceName}`} size="2xl">
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (data?.data || []).length === 0 ? (
          <p className="py-8 text-center text-sm text-surface-400">No sessions found for this device.</p>
        ) : (
          <div className="space-y-2">
            {(data?.data || []).map((s: DeviceSession) => (
              <div key={s.id} className="rounded-lg border border-surface-200 p-3 dark:border-surface-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={s.isActive ? 'success' : s.isRevoked ? 'danger' : 'neutral'}>
                        {s.isRevoked ? 'Revoked' : s.isActive ? 'Active' : 'Expired'}
                      </Badge>
                      {s.ipAddress && <code className="text-[10px] text-surface-400">{s.ipAddress}</code>}
                    </div>
                    <p className="mt-1 text-[11px] text-surface-500 dark:text-surface-400">
                      {s.os ? `${s.os} · ` : ''}v{s.appVersion || '—'} · {formatDateTime(s.createdAt)}
                    </p>
                    {s.userAgent && (
                      <p className="mt-0.5 truncate text-[10px] text-surface-400">{s.userAgent}</p>
                    )}
                  </div>
                  {s.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => revokeMutation.mutate(s.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-surface-200 pt-3 dark:border-surface-700">
          <span className="text-xs text-surface-400">Page {page} of {data.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

// ─── Statistics cards ──────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-800">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent}`}>{value}</p>
    </div>
  )
}

// ─── Page Component ──────────────────────────────────────────

export default function Devices() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ device: Device; type: 'block' | 'unblock' | 'remove' } | null>(null)
  const [rejectDeviceState, setRejectDeviceState] = useState<Device | null>(null)
  const [activityDevice, setActivityDevice] = useState<Device | null>(null)
  const [sessionsDevice, setSessionsDevice] = useState<Device | null>(null)
  const [activityPage, setActivityPage] = useState(1)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['devices', page, search, statusFilter],
    queryFn: () => getDevices({ page, limit: 10, search, status: statusFilter || undefined }),
  })

  const { data: stats } = useQuery({
    queryKey: ['device-statistics'],
    queryFn: getDeviceStatistics,
    refetchInterval: 60_000,
  })

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['device-activity', activityDevice?.id, activityPage],
    queryFn: () => getDeviceActivity(activityDevice!.id, activityPage),
    enabled: !!activityDevice,
  })

  const blockMutation = useMutation({
    mutationFn: (id: string) => blockDevice(id),
    onSuccess: () => { toast.success('Device blocked successfully'); refetch() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to block device'),
  })

  const unblockMutation = useMutation({
    mutationFn: (id: string) => unblockDevice(id),
    onSuccess: () => { toast.success('Device unblocked successfully'); refetch() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to unblock device'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDevice(id),
    onSuccess: () => { toast.success('Device approved'); refetch() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to approve device'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectDevice(id, reason),
    onSuccess: () => { toast.success('Device rejected'); setRejectDeviceState(null); refetch() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to reject device'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeDevice(id),
    onSuccess: () => { toast.success('Device removed'); refetch() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to remove device'),
  })

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return
    if (confirmAction.type === 'block') blockMutation.mutate(confirmAction.device.id)
    else if (confirmAction.type === 'unblock') unblockMutation.mutate(confirmAction.device.id)
    else removeMutation.mutate(confirmAction.device.id)
    setConfirmAction(null)
  }, [confirmAction, blockMutation, unblockMutation, removeMutation])

  const openActivity = useCallback((device: Device) => {
    setActivityDevice(device)
    setActivityPage(1)
  }, [])

  const columns: Column<Device>[] = [
    { key: 'deviceName', header: 'Device', render: (d) => (
      <div className="flex flex-col">
        <div className="flex items-center">
          <span className="font-medium text-primary-600 dark:text-primary-400">
            {d.isElectron ? <Laptop size={12} className="mr-1 inline" /> : d.isMobile ? <Smartphone size={12} className="mr-1 inline" /> : <Monitor size={12} className="mr-1 inline" />}
            {d.deviceName}
          </span>
          {onlineBadge(d)}
        </div>
        <code className="text-[10px] text-surface-400 dark:text-surface-500">
          {d.deviceId.substring(0, 14)}...{d.nickname ? ` · ${d.nickname}` : ''}
        </code>
      </div>
    )},
    { key: 'restaurantName', header: 'Restaurant', render: (d) => (
      <div className="flex flex-col">
        <span className="font-medium text-surface-900 dark:text-surface-100">{d.restaurantName}</span>
        {d.branchName && <span className="text-[10px] text-surface-400">{d.branchName}</span>}
      </div>
    )},
    { key: 'os', header: 'Platform', render: (d) => (
      <div className="flex flex-col">
        <span className="text-xs text-surface-700 dark:text-surface-300">
          {d.platform ? `${d.platform} · ` : ''}{d.os} {d.osVersion?.substring(0, 18)}
        </span>
        <span className="text-[10px] text-surface-400">v{d.appVersion}{d.electronVersion ? ` · Electron ${d.electronVersion}` : ''}</span>
      </div>
    ), hideOnMobile: true },
    { key: 'lastLogin', header: 'Last Seen', render: (d) => lastSeenDisplay(d.lastActivity || d.lastLogin) },
    { key: 'status', header: 'Status', render: (d) => (
      <div className="flex flex-col items-start gap-0.5">
        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
        {d.status === 'pending' && d.registeredAt && (
          <span className="text-[9px] text-surface-400">{relativeTime(d.registeredAt)} ago</span>
        )}
        {d.status === 'rejected' && d.rejectionReason && (
          <span className="max-w-[140px] truncate text-[9px] text-surface-400">{d.rejectionReason}</span>
        )}
      </div>
    )},
    {
      key: 'actions',
      header: '',
      render: (d) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openActivity(d) }}>
            <Activity size={13} className="mr-1" />Activity
          </Button>
          {d.status === 'pending' ? (
            <>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); approveMutation.mutate(d.id) }}>
                <CheckCircle2 size={13} className="mr-1 text-emerald-500" />Approve
              </Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setRejectDeviceState(d) }}>
                <XCircle size={13} className="mr-1 text-red-500" />Reject
              </Button>
            </>
          ) : d.status === 'active' ? (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ device: d, type: 'block' }) }}>
              Block
            </Button>
          ) : d.status === 'blocked' ? (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmAction({ device: d, type: 'unblock' }) }}>
              Unblock
            </Button>
          ) : null}
          {d.status !== 'pending' && d.status !== 'rejected' && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSessionsDevice(d) }}>
              <Smartphone size={13} className="mr-1" />Sessions
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
            onClick={(e) => { e.stopPropagation(); setConfirmAction({ device: d, type: 'remove' }) }}>
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Devices</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          All registered devices across restaurants ·{' '}
          <span className="font-medium">{data?.total || 0} device{(data?.total || 0) !== 1 ? 's' : ''}</span>
        </p>
      </div>

      {/* Statistics summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total" value={stats?.total || 0} accent="text-surface-900 dark:text-surface-100" />
        <StatCard label="Online" value={stats?.online || 0} accent="text-green-600" />
        <StatCard label="Offline" value={stats?.offline || 0} accent="text-surface-500" />
        <StatCard label="Pending" value={stats?.pending || 0} accent="text-amber-600" />
        <StatCard label="Blocked" value={stats?.blocked || 0} accent="text-red-600" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search devices..." />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending Approval</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </CardHeader>
        <Table columns={columns} data={data?.data || []} loading={isLoading} page={page}
          totalPages={data?.totalPages || 1} onPageChange={setPage} keyExtractor={(d) => d.id} emptyMessage="No devices found" />
      </Card>

      {/* ── Activity Log Modal ── */}
      <Modal
        open={!!activityDevice}
        onClose={() => setActivityDevice(null)}
        title={activityDevice ? `Activity Log — ${activityDevice.deviceName}` : ''}
        size="2xl"
      >
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {activityLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ActivityTimeline events={activityData?.data || []} />
          )}
        </div>
        {activityData && activityData.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-surface-200 pt-3 dark:border-surface-700">
            <span className="text-xs text-surface-400">Page {activityPage} of {activityData.totalPages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={activityPage <= 1} onClick={() => setActivityPage(p => Math.max(1, p - 1))}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={activityPage >= activityData.totalPages} onClick={() => setActivityPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setActivityDevice(null)}>Close</Button>
        </div>
      </Modal>

      {/* ── Sessions Modal ── */}
      {sessionsDevice && <SessionsModal device={sessionsDevice} onClose={() => setSessionsDevice(null)} />}

      {/* ── Reject Modal ── */}
      <Modal
        open={!!rejectDeviceState}
        onClose={() => setRejectDeviceState(null)}
        title={rejectDeviceState ? `Reject Device — ${rejectDeviceState.deviceName}` : ''}
        size="md"
      >
        <p className="mb-3 text-sm text-surface-500 dark:text-surface-400">
          Rejecting this device revokes its sessions immediately. Optionally provide a reason.
        </p>
        <RejectForm
          onSubmit={(reason) => rejectMutation.mutate({ id: rejectDeviceState!.id, reason })}
          onCancel={() => setRejectDeviceState(null)}
          loading={rejectMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={confirmAction?.type === 'block' ? 'Block Device' : confirmAction?.type === 'unblock' ? 'Unblock Device' : 'Remove Device'}
        message={confirmAction?.type === 'block'
          ? `Are you sure you want to block device "${confirmAction?.device.deviceName}"? It will be disconnected from the POS system and its sessions revoked.`
          : confirmAction?.type === 'unblock'
            ? `Re-enable device "${confirmAction?.device.deviceName}"?`
            : `Remove device "${confirmAction?.device.deviceName}"? This revokes its sessions and hides it from the list (soft delete).`}
        confirmLabel={confirmAction?.type === 'block' ? 'Block' : confirmAction?.type === 'unblock' ? 'Unblock' : 'Remove'}
        variant={confirmAction?.type === 'unblock' ? 'primary' : 'danger'}
      />
    </div>
  )
}

// ─── Reject form (inline so Modal stays controlled) ────────────

function RejectForm({ onSubmit, onCancel, loading }: { onSubmit: (reason?: string) => void; onCancel: () => void; loading: boolean }) {
  const [reason, setReason] = useState('')
  return (
    <div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for rejection (optional)"
        rows={3}
        className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={() => onSubmit(reason || undefined)} disabled={loading}>
          {loading ? 'Rejecting...' : 'Reject Device'}
        </Button>
      </div>
    </div>
  )
}

/**
 * =============================================================================
 *  Security.tsx — Security & IP Blocklist Page
 * =============================================================================
 *
 * Manual attack response:
 *   - Suggested attacking IPs: top failed-login sources (7d) with one-click block
 *   - Block an IP / CIDR / prefix permanently or for N hours
 *   - List every blocked entry with search + status filter + pagination
 *   - Unblock with confirmation
 *
 * Data Sources:
 *   - GET    /admin/security/blocked-ips            → getBlockedIps()
 *   - POST   /admin/security/blocked-ips            → blockIp()
 *   - DELETE /admin/security/blocked-ips/:id        → unblockIp()
 *   - GET    /admin/security/blocked-ips/suggested  → getSuggestedBlockedIps()
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, ShieldCheck, Ban, Clock, RefreshCw, Radar, ShieldOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Table, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { ErrorPage } from '../components/ui/ErrorPage'
import {
  getBlockedIps, blockIp, unblockIp, getSuggestedBlockedIps,
  type BlockedIpEntry, type SuggestedBlockedIp,
} from '../api/security'
import { formatDateTime } from '../utils/format'

// ─── Statistics cards ──────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-800">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent}`}>{value}</p>
    </div>
  )
}

function statusVariant(entry: BlockedIpEntry): 'success' | 'danger' | 'warning' | 'neutral' {
  if (!entry.isActive) return 'neutral'
  if (entry.permanent) return 'danger'
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) return 'neutral'
  return 'warning'
}

// ─── Page Component ──────────────────────────────────────────

export default function Security() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [confirmUnblock, setConfirmUnblock] = useState<BlockedIpEntry | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['blocked-ips', page, search, statusFilter],
    queryFn: () => getBlockedIps({ page, limit: 10, search, status: (statusFilter || undefined) as 'active' | 'expired' | undefined }),
  })

  const { data: suggestedData } = useQuery({
    queryKey: ['suggested-blocked-ips'],
    queryFn: getSuggestedBlockedIps,
    refetchInterval: 60_000,
  })

  const refetchAll = useCallback(() => {
    refetch()
    queryClient.invalidateQueries({ queryKey: ['suggested-blocked-ips'] })
  }, [refetch, queryClient])

  const blockMutation = useMutation({
    mutationFn: (input: { ip: string; reason?: string; hours?: number }) => blockIp(input),
    onSuccess: (res) => { toast.success(res.message); setBlockModalOpen(false); refetchAll() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to block IP'),
  })

  const unblockMutation = useMutation({
    mutationFn: (id: string) => unblockIp(id),
    onSuccess: (res) => { toast.success(res.message); setConfirmUnblock(null); refetchAll() },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to unblock IP'),
  })

  const quickBlock = useCallback((ip: string) => {
    blockMutation.mutate({ ip, reason: 'Blocked from Security page (failed-login source)' })
  }, [blockMutation])

  const columns: Column<BlockedIpEntry>[] = [
    { key: 'ip', header: 'IP / Range', render: (e) => (
      <code className="rounded bg-surface-100 px-2 py-0.5 text-xs font-semibold text-surface-800 dark:bg-surface-700 dark:text-surface-200">
        {e.ip}
      </code>
    )},
    { key: 'reason', header: 'Reason', render: (e) => (
      <span className="max-w-[260px] truncate text-xs text-surface-600 dark:text-surface-400">{e.reason || '—'}</span>
    ), hideOnMobile: true },
    { key: 'blockedBy', header: 'Blocked By', render: (e) => (
      <span className="text-xs text-surface-700 dark:text-surface-300">{e.blockedBy}</span>
    ), hideOnMobile: true },
    { key: 'expiry', header: 'Duration', render: (e) => {
      if (!e.isActive) return <Badge variant="neutral">Removed</Badge>
      if (e.permanent) return <Badge variant="danger">Permanent</Badge>
      if (e.expiresAt && new Date(e.expiresAt).getTime() <= Date.now()) return <Badge variant="neutral">Expired</Badge>
      return <span className="flex items-center gap-1 text-xs text-surface-600 dark:text-surface-400"><Clock size={11} />until {e.expiresAt ? formatDateTime(e.expiresAt) : '—'}</span>
    }},
    { key: 'createdAt', header: 'Blocked At', render: (e) => (
      <span className="text-xs text-surface-500 dark:text-surface-400">{e.createdAt ? formatDateTime(e.createdAt) : '—'}</span>
    ), hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      render: (e) => (
        <div className="flex items-center gap-1">
          {e.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmUnblock(e)}>
              <ShieldCheck size={13} className="mr-1 text-emerald-500" />Unblock
            </Button>
          ) : (
            <Badge variant="neutral">Inactive</Badge>
          )}
        </div>
      ),
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const suggestions = suggestedData?.suggestions || []
  const activeEntries = (data?.data || []).filter((e) => e.isActive)
  const permanentCount = activeEntries.filter((e) => e.permanent).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Security</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Manual IP blocker — cut off attacking IPs, CIDR ranges and prefixes instantly. Blocked sources are rejected with <span className="font-mono font-semibold text-surface-700 dark:text-surface-300">403</span> across the entire platform.
        </p>
      </div>

      {/* Statistics summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Blocked" value={data?.total || 0} accent="text-red-600" />
        <StatCard label="Permanent" value={permanentCount} accent="text-red-600" />
        <StatCard label="Temporary" value={activeEntries.length - permanentCount} accent="text-amber-600" />
        <StatCard label="Attack Sources (7d)" value={suggestions.length} accent="text-primary-600" />
        <StatCard label="Failed Logins (7d)" value={suggestions.reduce((sum, s) => sum + s.count, 0)} accent="text-surface-900 dark:text-surface-100" />
      </div>

      {/* Block IP form */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><Ban size={16} className="text-danger" />Block an IP address</CardTitle>
            <CardDescription>Exact IP, CIDR range, or prefix — e.g. <code className="rounded bg-surface-100 px-1 py-0.5 text-[11px] dark:bg-surface-700">203.0.113.7</code>, <code className="rounded bg-surface-100 px-1 py-0.5 text-[11px] dark:bg-surface-700">203.0.113.0/24</code>, <code className="rounded bg-surface-100 px-1 py-0.5 text-[11px] dark:bg-surface-700">203.0.113.</code></CardDescription>
          </div>
          <Button variant="danger" onClick={() => setBlockModalOpen(true)}>
            <Ban size={14} />Block IP
          </Button>
        </CardHeader>
      </Card>

      {/* Suggested attacking IPs */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><Radar size={16} className="text-primary-600" />Suggested blocking — failed-login sources (last 7 days)</CardTitle>
            <CardDescription>IPs with repeated failed logins that aren't blocked yet. Block them with one click.</CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['suggested-blocked-ips'] })}>
            <RefreshCw size={13} className="mr-1" />Refresh
          </Button>
        </CardHeader>
        {suggestions.length === 0 ? (
          <p className="py-6 text-center text-sm text-surface-400">No suspicious sources found in the last 7 days. All clear.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="px-4 py-3 font-medium text-surface-600 dark:text-surface-400">IP</th>
                  <th className="px-4 py-3 font-medium text-surface-600 dark:text-surface-400">Failed Logins</th>
                  <th className="px-4 py-3 font-medium text-surface-600 dark:text-surface-400">Last Attempt</th>
                  <th className="px-4 py-3 font-medium text-surface-600 dark:text-surface-400">Attempted Users</th>
                  <th className="px-4 py-3 font-medium text-surface-600 dark:text-surface-400"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.ip} className="border-b border-surface-100 last:border-0 dark:border-surface-700/50">
                    <td className="px-4 py-3"><code className="rounded bg-surface-100 px-2 py-0.5 text-xs font-semibold text-surface-800 dark:bg-surface-700 dark:text-surface-200">{s.ip}</code></td>
                    <td className="px-4 py-3">
                      <Badge variant={s.count >= 10 ? 'danger' : s.count >= 5 ? 'warning' : 'neutral'}>{s.count}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-surface-500 dark:text-surface-400">{s.lastSeen ? formatDateTime(s.lastSeen) : '—'}</td>
                    <td className="px-4 py-3 text-xs text-surface-500 dark:text-surface-400 max-w-[180px] truncate">{(s.usernames || []).slice(0, 3).join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <Button variant="danger" size="sm" onClick={() => quickBlock(s.ip)} loading={blockMutation.isPending}>
                        <ShieldOff size={13} className="mr-1" />Block
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Blocked IPs list */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldAlert size={16} className="text-danger" />Blocked IPs &amp; Ranges</CardTitle>
            <CardDescription>Every source currently blocked on the platform.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search IP..."
              className="block w-full max-w-xs rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 dark:placeholder-surface-500"
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              <option value="">All</option>
              <option value="active">Active</option>
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
          keyExtractor={(e) => e.id}
          emptyMessage="No blocked IPs. Your platform is open to all sources."
        />
      </Card>

      {/* Block modal */}
      <BlockIpModal
        open={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        onSubmit={(input) => blockMutation.mutate(input)}
        loading={blockMutation.isPending}
      />

      {/* Unblock confirm */}
      <ConfirmDialog
        open={!!confirmUnblock}
        onClose={() => setConfirmUnblock(null)}
        onConfirm={() => confirmUnblock && unblockMutation.mutate(confirmUnblock.id)}
        title="Unblock IP"
        message={`Allow traffic from "${confirmUnblock?.ip}" again? This reverses the block immediately.`}
        confirmLabel="Unblock"
        variant="primary"
      />
    </div>
  )
}

// ─── Block modal ──────────────────────────────────────────────

interface BlockFormInput { ip: string; reason?: string; hours?: number }

function BlockIpModal({ open, onClose, onSubmit, loading }: {
  open: boolean
  onClose: () => void
  onSubmit: (input: BlockFormInput) => void
  loading: boolean
}) {
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<'permanent' | '1h' | '6h' | '24h' | '7d'>('permanent')

  const hoursFor = (d: typeof duration): number | undefined => {
    switch (d) {
      case '1h': return 1
      case '6h': return 6
      case '24h': return 24
      case '7d': return 7 * 24
      default: return undefined
    }
  }

  const handleSubmit = () => {
    if (!ip.trim()) return
    onSubmit({ ip: ip.trim(), reason: reason.trim() || undefined, hours: hoursFor(duration) })
    setIp('')
    setReason('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Block IP Address" size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={loading || !ip.trim()}>
            {loading ? 'Blocking...' : 'Block IP'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="IP / CIDR / Prefix"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="203.0.113.7"
          helperText="Exact IP, CIDR range (203.0.113.0/24), or prefix (203.0.113.)"
          autoFocus
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Duration</label>
          <div className="flex flex-wrap gap-2">
            {(['permanent', '1h', '6h', '24h', '7d'] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDuration(d)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  duration === d
                    ? 'border-danger bg-danger/10 text-danger'
                    : 'border-surface-300 text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700'
                }`}>
                {d === 'permanent' ? 'Permanent' : d === '7d' ? '7 days' : d}
              </button>
            ))}
          </div>
        </div>
        <Input
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Brute-force attack, fraud, abuse"
        />
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Blocking takes effect immediately across every endpoint — auth, admin, and POS API. The block is recorded in the audit log.
        </p>
      </div>
    </Modal>
  )
}

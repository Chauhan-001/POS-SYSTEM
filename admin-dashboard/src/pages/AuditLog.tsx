/**
 * =============================================================================
 *  AuditLog.tsx — Enterprise Audit Trail (Phase 2.9)
 * =============================================================================
 *
 * Features:
 *   - Dashboard cards (total / today / failures / security / critical today)
 *   - Searchable + filterable table (action, module, category, severity, result,
 *     performer, entity, date range) with cursor-aware pagination
 *   - Row click → detail modal with JSON / old-new diff viewer
 *   - Integrity panel (hash-chain verification report)
 *   - Exports (CSV / JSON / XLSX / PDF, optional password) with job polling
 *   - Retention + archive panel
 *   - Alerts feed
 *   - Saved searches
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, ArrowDownToLine, CheckCircle2, Download,
  FileJson, FileSpreadsheet, FileText, Fingerprint, Filter, ShieldCheck,
  Save, ShieldAlert, X, Search,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ErrorPage } from '../components/ui/ErrorPage'
import {
  getAuditLogs, getAuditLogStats, getAuditLogDetail, verifyAuditIntegrity,
  createAuditExport, getAuditExportStatus, getAuditExportUrl,
  getAuditRetention, runAuditRetention,
  getSavedSearches, createSavedSearch, deleteSavedSearch,
  getAuditAlerts, getAuditAlertSummary, resolveAuditAlert,
  type AuditLogFilters,
} from '../api/auditLogs'
import type { AuditLogEntry } from '../types'
import { formatDate, formatDateTime, formatNumber } from '../utils/format'
import toast from 'react-hot-toast'
import { cn } from '../utils/cn'

// ─── Helpers ─────────────────────────────────────────────────────

const SEVERITY_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
}

function severityBadge(severity: string) {
  return <Badge variant={SEVERITY_VARIANT[severity] || 'neutral'}>{severity || 'info'}</Badge>
}

function resultBadge(result: string | null, success: boolean | null) {
  if (result === 'failure') return <Badge variant="danger">Failed</Badge>
  if (result === 'pending') return <Badge variant="warning">Pending</Badge>
  if (success === false) return <Badge variant="danger">Failed</Badge>
  return <Badge variant="success">Success</Badge>
}

function actionLabel(action: string) {
  const spaced = action.replace(/\./g, ' ').replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-surface-400">—</span>
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-surface-50 p-3 text-xs leading-relaxed text-surface-700 dark:bg-surface-900 dark:text-surface-300">
      {prettyJson(value)}
    </pre>
  )
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">{label}</span>
        <span className={cn('rounded-lg p-1.5', tone)}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-surface-100">{formatNumber(value)}</p>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────

export default function AuditLog() {
  const queryClient = useQueryClient()

  // Filters
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [module, setModule] = useState('')
  const [category, setCategory] = useState('')
  const [severity, setSeverity] = useState('')
  const [result, setResult] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [entityType, setEntityType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // UI state
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditLogEntry | null>(null)
  const [showExports, setShowExports] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showIntegrity, setShowIntegrity] = useState(false)

  const filters = useMemo<AuditLogFilters>(() => {
    const f: AuditLogFilters = { page, limit: 20 }
    if (search) f.search = search
    if (action) f.action = action
    if (module) f.module = module
    if (category) f.category = category
    if (severity) f.severity = severity
    if (result) f.result = result
    if (performedBy) f.performedBy = performedBy
    if (entityType) f.entityType = entityType
    if (from) f.from = from
    if (to) f.to = to
    return f
  }, [page, search, action, module, category, severity, result, performedBy, entityType, from, to])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => getAuditLogs(filters),
  })

  const statsQuery = useQuery({ queryKey: ['audit-logs-stats'], queryFn: getAuditLogStats })
  const alertsSummary = useQuery({ queryKey: ['audit-alert-summary'], queryFn: getAuditAlertSummary })
  const savedQuery = useQuery({ queryKey: ['audit-saved'], queryFn: getSavedSearches })
  const alertsQuery = useQuery({ queryKey: ['audit-alerts'], queryFn: () => getAuditAlerts({ limit: 10 }) })

  const stats = statsQuery.data?.data

  const clearFilters = () => {
    setSearch(''); setAction(''); setModule(''); setCategory(''); setSeverity('')
    setResult(''); setPerformedBy(''); setEntityType(''); setFrom(''); setTo(''); setPage(1)
  }

  const hasFilters = !!(search || action || module || category || severity || result || performedBy || entityType || from || to)

  // Detail modal
  const openDetail = async (entry: AuditLogEntry) => {
    setDetailId(entry.id)
    setDetail(entry)
    try {
      const res = await getAuditLogDetail(entry.id)
      setDetail(res.data)
    } catch {
      /* keep list row data */
    }
  }

  // Saved search
  const saveMutation = useMutation({
    mutationFn: () => createSavedSearch({ name: saveName, filters }),
    onSuccess: () => { toast.success('Search saved'); setShowSaved(false); setSaveName(''); queryClient.invalidateQueries({ queryKey: ['audit-saved'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to save search'),
  })

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) => deleteSavedSearch(id),
    onSuccess: () => { toast.success('Saved search deleted'); queryClient.invalidateQueries({ queryKey: ['audit-saved'] }) },
  })

  // Resolve alert
  const resolveAlertMutation = useMutation({
    mutationFn: (id: string) => resolveAuditAlert(id),
    onSuccess: () => {
      toast.success('Alert resolved')
      queryClient.invalidateQueries({ queryKey: ['audit-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit-alert-summary'] })
    },
  })

  // Integrity
  const integrityQuery = useQuery({
    queryKey: ['audit-integrity'],
    queryFn: verifyAuditIntegrity,
    enabled: showIntegrity,
  })

  // Export
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'xlsx' | 'pdf'>('csv')
  const [exportPassword, setExportPassword] = useState('')
  const [exportJobId, setExportJobId] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const exportMutation = useMutation({
    mutationFn: () => createAuditExport({
      format: exportFormat,
      search: search || undefined,
      action: action || undefined,
      module: module || undefined,
      category: category || undefined,
      severity: severity || undefined,
      result: result || undefined,
      performedBy: performedBy || undefined,
      entityType: entityType || undefined,
      from: from || undefined,
      to: to || undefined,
      password: exportPassword || undefined,
    }),
    onSuccess: async (res) => {
      toast.success('Export job queued')
      setExportJobId(res.data.id)
      setExportStatus('queued')
      pollExport(res.data.id)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to create export'),
  })

  const pollExport = async (id: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const status = await getAuditExportStatus(id)
        setExportStatus(status.data.status)
        if (status.data.status === 'completed') {
          toast.success('Export ready')
          break
        }
        if (status.data.status === 'failed') {
          toast.error(status.data.error || 'Export failed')
          break
        }
      } catch { break }
    }
  }

  const downloadExport = async () => {
    if (!exportJobId) return
    const url = await getAuditExportUrl(exportJobId)
    window.open(url, '_blank')
  }

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'action',
      header: 'Action',
      render: (l) => (
        <div>
          <span className="font-medium text-surface-900 dark:text-surface-100">{actionLabel(l.action)}</span>
          <div className="text-[10px] text-surface-400">{l.action}</div>
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (l) => severityBadge(l.severity),
      hideOnMobile: true,
    },
    {
      key: 'result',
      header: 'Result',
      render: (l) => resultBadge(l.result, l.success),
    },
    {
      key: 'entityType',
      header: 'Entity',
      render: (l) => (
        <span className="text-sm text-surface-700 dark:text-surface-300">
          {l.entityType}
          {l.entityId && <code className="ml-1 text-[10px] text-surface-400">{l.entityId.slice(-8)}</code>}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'performedBy',
      header: 'Performed By',
      render: (l) => (
        <div>
          <span className="font-medium text-surface-900 dark:text-surface-100">{l.performedBy}</span>
          {l.role && <div className="text-[10px] text-surface-400">{l.role}</div>}
        </div>
      ),
    },
    {
      key: 'module',
      header: 'Module',
      render: (l) => (l.module ? <Badge variant="info">{l.module}</Badge> : <span className="text-surface-400">—</span>),
      hideOnMobile: true,
    },
    {
      key: 'details',
      header: 'Details',
      render: (l) => {
        if (!l.details) return <span className="text-surface-400">—</span>
        const entries = Object.entries(l.details).filter(([k]) => !['restaurantId', 'notes', 'before', 'after'].includes(k))
        const str = entries.slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')
        return <span className="block max-w-[220px] truncate text-xs text-surface-500 dark:text-surface-400" title={str}>{str || '—'}</span>
      },
    },
    {
      key: 'createdAt',
      header: 'Timestamp',
      render: (l) => (
        <span className="text-sm text-surface-600 dark:text-surface-400" title={formatDateTime(l.createdAt)}>
          {formatDate(l.createdAt)}
        </span>
      ),
      hideOnMobile: true,
    },
  ]

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const activeFiltersCount = hasFilters ? Object.keys(filters).filter((k) => k !== 'page' && k !== 'limit').length : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">System Audit Log</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Immutable, hash-chained audit trail of every action across the platform
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowIntegrity((v) => !v)}>
            <Fingerprint className="h-4 w-4" /> Integrity
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSaved((v) => !v)}>
            <Save className="h-4 w-4" /> Saved Searches
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setExportFormat('csv'); setExportPassword(''); setShowExports(true) }}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total" value={stats.totals.total} icon={<Activity className="h-4 w-4 text-primary-600" />} tone="bg-primary/10" />
          <StatCard label="Today" value={stats.totals.today} icon={<Activity className="h-4 w-4 text-info" />} tone="bg-info/10" />
          <StatCard label="Failures (30d)" value={stats.health.failureCount} icon={<X className="h-4 w-4 text-danger" />} tone="bg-danger/10" />
          <StatCard label="Security (30d)" value={stats.health.securityCount} icon={<ShieldAlert className="h-4 w-4 text-warning" />} tone="bg-warning/10" />
          <StatCard label="Failed Logins" value={stats.health.failedLogins} icon={<AlertTriangle className="h-4 w-4 text-danger" />} tone="bg-danger/10" />
          <StatCard label="Critical Today" value={stats.health.criticalToday} icon={<ShieldAlert className="h-4 w-4 text-danger" />} tone="bg-danger/10" />
        </div>
      )}

      {/* Integrity panel */}
      {showIntegrity && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Hash-chain integrity</CardTitle>
              <CardDescription>Verifies the append-only chain (active + archive) for tampering.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => integrityQuery.refetch()} loading={integrityQuery.isFetching}>
              Re-verify
            </Button>
          </CardHeader>
          {integrityQuery.isLoading ? (
            <p className="text-sm text-surface-400">Verifying chain…</p>
          ) : integrityQuery.data?.data ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {integrityQuery.data.data.verified
                  ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Verified</Badge>
                  : <Badge variant="danger"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Tampered</Badge>}
                <span className="text-sm text-surface-600 dark:text-surface-400">{integrityQuery.data.data.message}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <StatCard label="Verified rows" value={integrityQuery.data.data.verifiedRows} icon={<ShieldCheck className="h-4 w-4 text-success" />} tone="bg-success/10" />
                <StatCard label="Chain seq" value={integrityQuery.data.data.metaSeq} icon={<Activity className="h-4 w-4 text-primary-600" />} tone="bg-primary/10" />
                <StatCard label="Missing" value={integrityQuery.data.data.missing.length} icon={<AlertTriangle className="h-4 w-4 text-warning" />} tone="bg-warning/10" />
                <StatCard label="Tampered" value={integrityQuery.data.data.tampered.length} icon={<AlertTriangle className="h-4 w-4 text-danger" />} tone="bg-danger/10" />
                <StatCard label="Active rows" value={integrityQuery.data.data.totalRows} icon={<Activity className="h-4 w-4 text-info" />} tone="bg-info/10" />
              </div>
              {integrityQuery.data.data.brokenAt && (
                <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                  Break at chain #{integrityQuery.data.data.brokenAt.chainIndex} ({integrityQuery.data.data.brokenAt.id})
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-surface-400">Failed to load verification report.</p>
          )}
        </Card>
      )}

      {/* Alerts strip */}
      {alertsSummary.data?.data && alertsSummary.data.data.unresolved > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-warning-700 dark:text-warning-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{alertsSummary.data.data.unresolved} unresolved audit alerts</span>
            <span className="text-xs opacity-70">({alertsSummary.data.data.openHigh} high/critical)</span>
          </div>
          {alertsQuery.data?.data && alertsQuery.data.data.length > 0 && (
            <div className="hidden md:flex items-center gap-2">
              {alertsQuery.data.data.slice(0, 3).map((a) => (
                <button key={a.id} onClick={() => resolveAlertMutation.mutate(a.id)} title="Click to resolve" className="rounded-full bg-white/60 px-3 py-1 text-xs text-surface-600 hover:bg-white dark:bg-surface-800/60 dark:text-surface-300">
                  {a.type}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Saved searches */}
      {showSaved && (
        <Card>
          <CardHeader>
            <CardTitle>Saved searches</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={saveName} onChange={setSaveName} placeholder="Name this filter set…" />
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!saveName || activeFiltersCount === 0} loading={saveMutation.isPending}>
              <Save className="h-4 w-4" /> Save current filters
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {savedQuery.data?.data?.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-2 rounded-full bg-surface-100 px-3 py-1 text-xs text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                {s.name}
                {s.isGlobal && <Badge variant="info">global</Badge>}
                <button onClick={() => deleteSavedMutation.mutate(s.id)} className="text-surface-400 hover:text-danger">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {savedQuery.data?.data?.length === 0 && <p className="text-sm text-surface-400">No saved searches yet.</p>}
          </div>
        </Card>
      )}

      {/* Filters + Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search action, actor, entity…" />
            <input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="Action (exact)" className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
            <input value={module} onChange={(e) => { setModule(e.target.value); setPage(1) }} placeholder="Module" className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
            <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1) }} className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>
            <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1) }} className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              <option value="">All Results</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="pending">Pending</option>
            </select>
            <input value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }} placeholder="Entity type" className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
            <input value={performedBy} onChange={(e) => { setPerformedBy(e.target.value); setPage(1) }} placeholder="Performed by" className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
            <div className="flex items-center gap-1">
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
              <span className="text-xs text-surface-400">to</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400">
                <Filter className="h-3 w-3" /> Clear ({activeFiltersCount})
              </button>
            )}
          </div>
        </CardHeader>
        <Table
          columns={columns}
          data={data?.data || []}
          loading={isLoading}
          page={page}
          totalPages={data?.meta.pagination.totalPages || 1}
          onPageChange={setPage}
          onRowClick={openDetail}
          keyExtractor={(l) => l.id}
          emptyMessage="No audit log entries found"
        />
      </Card>

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => { setDetail(null); setDetailId(null) }} title={detail ? `${actionLabel(detail.action)}` : ''} size="2xl">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {severityBadge(detail.severity)}
              {resultBadge(detail.result, detail.success)}
              {detail.module && <Badge variant="info">{detail.module}</Badge>}
              {detail.category && <Badge variant="neutral">{detail.category}</Badge>}
              {detail.chainIndex && <Badge variant="neutral">chain #{detail.chainIndex}</Badge>}
              <span className="text-xs text-surface-400">{formatDateTime(detail.createdAt)}</span>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {[
                ['Action', detail.action],
                ['Performed by', `${detail.performedBy}${detail.role ? ` (${detail.role})` : ''}`],
                ['Entity', `${detail.entityType}${detail.entityId ? ` · ${detail.entityId}` : ''}`],
                ['Restaurant', detail.restaurantName || detail.restaurantId || '—'],
                ['Branch', detail.branchName || detail.branchId || '—'],
                ['IP Address', detail.ipAddress || '—'],
                ['Device', detail.deviceName || detail.deviceId || '—'],
                ['Browser', detail.browser || '—'],
                ['OS', detail.os || '—'],
                ['Route', detail.method && detail.route ? `${detail.method} ${detail.route}` : (detail.route || '—')],
                ['Request ID', detail.requestId || '—'],
                ['Correlation ID', detail.correlationId || '—'],
                ['Session ID', detail.sessionId || '—'],
                ['Response Status', detail.responseStatus ?? '—'],
                ['Duration (ms)', detail.durationMs ?? '—'],
                ['Error', detail.error || '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-900/60">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-surface-400">{k}</div>
                  <div className="mt-0.5 break-all text-sm text-surface-800 dark:text-surface-200">{v || '—'}</div>
                </div>
              ))}
            </div>

            <div>
              <h4 className="mb-1 text-sm font-semibold text-surface-800 dark:text-surface-200">Details</h4>
              <JsonBlock value={detail.details} />
            </div>

            {detail.oldValues && (
              <div>
                <h4 className="mb-1 text-sm font-semibold text-surface-800 dark:text-surface-200">Before / After</h4>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-surface-500">Before</div>
                    <JsonBlock value={detail.oldValues} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-surface-500">After</div>
                    <JsonBlock value={detail.newValues} />
                  </div>
                </div>
                {detail.changedFields && detail.changedFields.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {detail.changedFields.map((f) => <Badge key={f} variant="info">{f}</Badge>)}
                  </div>
                )}
              </div>
            )}

            {detail.hash && (
              <div className="rounded-lg bg-surface-50 p-3 text-[10px] text-surface-500 dark:bg-surface-900/60 dark:text-surface-400">
                <div>hash: {detail.hash}</div>
                <div>prev: {detail.prevHash || 'genesis'}</div>
              </div>
            )}

            {detail.stackTrace && (
              <div>
                <h4 className="mb-1 text-sm font-semibold text-surface-800 dark:text-surface-200">Stack trace</h4>
                <pre className="max-h-48 overflow-auto rounded-lg bg-surface-50 p-3 text-xs text-surface-600 dark:bg-surface-900 dark:text-surface-300">{detail.stackTrace}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Export modal */}
      <Modal open={showExports} onClose={() => { setShowExports(false); setExportJobId(null); setExportStatus(null) }} title="Export audit logs" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Exports respect the current filters{hasFilters ? ` (${activeFiltersCount} active)` : ' (all entries)'} and are generated in the background.
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(['csv', 'json', 'xlsx', 'pdf'] as const).map((f) => (
              <button key={f} onClick={() => setExportFormat(f)}
                className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors',
                  exportFormat === f ? 'border-primary-500 bg-primary/10 text-primary-700 dark:text-primary-300' : 'border-surface-300 text-surface-500 hover:border-surface-400 dark:border-surface-600')}>
                {f === 'csv' ? <FileText className="h-5 w-5" /> : f === 'json' ? <FileJson className="h-5 w-5" /> : f === 'xlsx' ? <FileSpreadsheet className="h-5 w-5" /> : <ArrowDownToLine className="h-5 w-5" />}
                <span className="font-medium uppercase">{f}</span>
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-500">Password (optional, encrypts the file)</label>
            <input type="password" value={exportPassword} onChange={(e) => setExportPassword(e.target.value)} placeholder="Leave empty for no encryption" className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300" />
          </div>
          <div className="flex items-center justify-between">
            <Button onClick={() => exportMutation.mutate()} loading={exportMutation.isPending} disabled={!!exportJobId && (exportStatus === 'queued' || exportStatus === 'processing')}>
              <Download className="h-4 w-4" /> Start export
            </Button>
            {exportJobId && exportStatus === 'completed' && (
              <Button variant="primary" onClick={downloadExport}>
                <Download className="h-4 w-4" /> Download file
              </Button>
            )}
            {exportJobId && (exportStatus === 'queued' || exportStatus === 'processing') && (
              <span className="inline-flex items-center gap-2 text-sm text-surface-500">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                Generating…
              </span>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
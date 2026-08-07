/**
 * =============================================================================
 *  Support.tsx — Support / Help-Desk Console
 * =============================================================================
 *
 * Two sections sharing the page:
 *   1. Ticket Management (Phase 2.8)
 *   2. Unified Search (existing) across restaurants/owners/subscriptions/devices
 *
 * Ticket features:
 *   - Server-side list with search, status/priority filters, sort, pagination
 *   - Stat cards (per-status / per-priority counts)
 *   - Create ticket (restaurant picker)
 *   - Detail modal: overview, replies (public + internal), timeline, activity,
 *     assignment, status transitions, attachments, soft delete/restore
 *
 * Data Sources (RBAC-protected, backend-driven):
 *   - GET  /admin/support/tickets, /stats
 *   - POST /admin/support/tickets
 *   - GET/PUT/POST /admin/support/tickets/:id, :id/status, :id/assign
 *   - GET/POST .../:id/replies
 *   - POST/DELETE .../:id/attachments, POST .../:id/satisfaction
 *   - GET .../:id/activity, DELETE .../:id, POST .../:id/restore
 *   - GET /admin/support/search (existing)
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, Ticket as TicketIcon, MessageSquare, Clock, User as UserIcon,
  Paperclip, Trash2, RotateCcw, Mail, Tag, Send, History, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Table, SearchInput, type Column } from '../components/ui/Table'
import { ErrorPage } from '../components/ui/ErrorPage'
import { EmptyState } from '../components/ui/EmptyState'
import {
  listTickets, getTicketStats, createTicket, updateTicket, setTicketStatus,
  assignTicket, getReplies, addReply, deleteTicket, restoreTicket,
  setSatisfaction, getTicketActivity,
  type SupportTicket, type TicketReply, type TicketStatus, type TicketPriority,
  type TicketCategory, type ListTicketsParams,
} from '../api/support'
import { getRestaurants } from '../api/restaurants'
import { formatDateTime } from '../utils/format'

// ─── Lookups ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<TicketStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  new: 'info',
  open: 'info',
  in_progress: 'warning',
  pending: 'warning',
  resolved: 'success',
  closed: 'success',
  reopened: 'warning',
  cancelled: 'neutral',
}

const PRIORITY_BADGE: Record<TicketPriority, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
}

const STATUSES: TicketStatus[] = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'reopened', 'cancelled']
const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent']
const CATEGORIES: TicketCategory[] = ['billing', 'technical', 'account', 'feature_request', 'bug', 'other']

const fmtBytes = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

export default function Support() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<ListTicketsParams>({ page: 1, limit: 10 })
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SupportTicket | null>(null)

  // Existing unified search state
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<'query' | 'restaurantId' | 'phone' | 'name'>('query')

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
    queryClient.invalidateQueries({ queryKey: ['support-stats'] })
    queryClient.invalidateQueries({ queryKey: ['support-detail'] })
  }

  // ── Queries ────────────────────────────────────────────────────
  const ticketsQuery = useQuery({
    queryKey: ['support-tickets', filters],
    queryFn: () => listTickets(filters),
    placeholderData: (prev) => prev,
  })

  const statsQuery = useQuery({
    queryKey: ['support-stats'],
    queryFn: () => getTicketStats(),
  })

  const lookupQuery = useQuery({
    queryKey: ['support-search', query, searchType],
    queryFn: () => import('../api/support').then((m) => m.searchSupport({ [searchType]: query })),
    enabled: query.length > 2,
  })

  // ── Mutations ──────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (t: SupportTicket) => deleteTicket(t._id, 'Removed by admin'),
    onSuccess: () => { toast.success('Ticket deleted'); setDeleteTarget(null); setDetailId(null); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to delete ticket'),
  })

  // ── Stat cards ─────────────────────────────────────────────────
  const statCards = useMemo(() => {
    const s = statsQuery.data
    const totals: [string, number][] = []
    if (s) {
      totals.push(['Total', s.total])
      totals.push(['New', s.byStatus.new ?? 0])
      totals.push(['In progress', s.byStatus.in_progress ?? 0])
      totals.push(['Open', s.byStatus.open ?? 0])
    }
    return totals
  }, [statsQuery.data])

  // Search results (existing) — requires the restaurant object shape
  const searchResults = lookupQuery.data ?? []

  // ── Columns ────────────────────────────────────────────────────
  const columns: Column<SupportTicket>[] = [
    { key: 'ticketNumber', header: 'Ticket', render: (t) => <span className="font-medium text-primary-600 dark:text-primary-400">{t.ticketNumber}</span> },
    { key: 'restaurantName', header: 'Restaurant', render: (t) => (
        <button onClick={(e) => { e.stopPropagation(); setDetailId(t._id) }} className="text-left text-surface-700 hover:text-primary-600 dark:text-surface-300">
          {t.restaurantName}
        </button>
      ) },
    { key: 'subject', header: 'Subject', hideOnMobile: true, render: (t) => <span className="text-surface-600 dark:text-surface-400">{t.subject}</span> },
    { key: 'priority', header: 'Priority', render: (t) => <Badge variant={PRIORITY_BADGE[t.priority]}>{t.priority}</Badge> },
    { key: 'status', header: 'Status', render: (t) => <Badge variant={STATUS_BADGE[t.status]}>{t.status.replace('_', ' ')}</Badge> },
    { key: 'assigneeName', header: 'Assignee', hideOnMobile: true, render: (t) => <span className="text-surface-500 dark:text-surface-400">{t.assigneeName || '—'}</span> },
    { key: 'createdAt', header: 'Created', hideOnMobile: true, render: (t) => <span className="text-xs text-surface-500 dark:text-surface-400">{formatDateTime(t.createdAt)}</span> },
  ]

  function applyFilters(patch: Partial<ListTicketsParams>) {
    setFilters((f) => ({ ...f, ...patch, page: 1 }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Support</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Tickets console & unified account search</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New Ticket
        </Button>
      </div>

      {/* ── Stat cards ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-surface-500 dark:text-surface-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
          </Card>
        ))}
      </div>

      {/* ── Tickets ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Open &amp; closed tickets</CardTitle>
        </CardHeader>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="lg:w-64">
            <SearchInput value={search} onChange={(v) => { setSearch(v); applyFilters({ search: v || undefined }) }} placeholder="Search tickets..." />
          </div>
          <select
            value={filters.status ?? ''}
            onChange={(e) => applyFilters({ status: (e.target.value || undefined) as any })}
            className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select
            value={filters.priority ?? ''}
            onChange={(e) => applyFilters({ priority: (e.target.value || undefined) as any })}
            className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => { setFilters({ page: 1, limit: 10 }); setSearch('') }}>Clear filters</Button>
          </div>
        </div>

        {ticketsQuery.isError ? (
          <ErrorPage message={(ticketsQuery.error as any)?.message} onRetry={() => ticketsQuery.refetch()} />
        ) : (
          <Table
            columns={columns}
            data={ticketsQuery.data?.data ?? []}
            loading={ticketsQuery.isLoading}
            page={ticketsQuery.data?.meta.page ?? 1}
            totalPages={ticketsQuery.data?.meta.totalPages ?? 1}
            onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            onRowClick={(t) => setDetailId(t._id)}
            emptyMessage="No tickets match your filters"
            keyExtractor={(t) => t._id}
          />
        )}
      </Card>

      {/* ── Detail modal ───────────────────────────── */}
      {detailId && (
        <TicketDetailModal
          id={detailId}
          onClose={() => { setDetailId(null); invalidate() }}
          onRequestDelete={(t) => setDeleteTarget(t)}
        />
      )}

      {/* ── Create modal ───────────────────────────── */}
      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); invalidate() }}
      />

      {/* ── Delete confirm ─────────────────────────── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        title="Delete ticket"
        message={deleteTarget ? `Soft-delete ${deleteTarget.ticketNumber}? It stays recoverable in the audit trail.` : ''}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      {/* ── Unified Search (existing) ──────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Account lookup</CardTitle>
          <CardDescription>Search restaurants, owners, subscriptions, devices</CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Input
              placeholder={`Search by ${searchType === 'query' ? 'keyword' : searchType}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as any)}
            className="rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
          >
            <option value="query">All Fields</option>
            <option value="restaurantId">Restaurant ID</option>
            <option value="phone">Phone</option>
            <option value="name">Restaurant Name</option>
          </select>
        </div>
      </Card>

      {query.length > 0 && query.length <= 2 && <p className="text-sm text-surface-400">Type at least 3 characters to search</p>}
      {query.length > 0 && lookupQuery.isLoading && <div className="h-24 animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" />}
      {searchResults.length > 0 ? (
        <div className="space-y-4">
          {searchResults.map((r: any, idx: number) => (
            <Card key={idx} hover>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                    <TicketIcon size={16} className="text-primary-500" />
                    {r.restaurant?.name}
                  </div>
                  <p className="text-xs text-surface-400">ID: {r.restaurant?.id}</p>
                  <Badge variant={r.restaurant?.status === 'active' ? 'success' : 'neutral'}>{r.restaurant?.status}</Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                    <UserIcon size={16} className="text-info" />
                    {r.owner?.name}
                  </div>
                  <p className="text-xs text-surface-400">{r.owner?.email}</p>
                  <p className="text-xs text-surface-400">{r.owner?.phone}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                    <Tag size={16} className="text-warning" />
                    {r.subscription?.plan} - {r.subscription?.status}
                  </div>
                  <p className="text-xs text-surface-400">Expires: {r.subscription?.expiryDate}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                    <Mail size={16} className="text-success" />
                    {r.devices} device(s)
                  </div>
                  <div className="flex items-center gap-2 text-xs text-surface-400">
                    <Clock size={12} />
                    Last login: {r.lastLogin}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : query.length > 2 && !lookupQuery.isLoading && !lookupQuery.isError ? (
        <EmptyState title="No results found" description={`No results for "${query}". Try a different search term.`} />
      ) : null}
    </div>
  )
}

// ─── Detailed ticket modal ─────────────────────────────────────────

function TicketDetailModal({ id, onClose, onRequestDelete }: {
  id: string
  onClose: () => void
  onRequestDelete: (t: SupportTicket) => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'overview' | 'replies' | 'activity'>('overview')
  const [replyText, setReplyText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState<number | null>(null)

  const detail = useQuery({ queryKey: ['support-detail', id], queryFn: () => import('../api/support').then((m) => m.getTicket(id)) })
  const replies = useQuery({ queryKey: ['support-detail', id, 'replies'], queryFn: () => getReplies(id) })
  const activity = useQuery({ queryKey: ['support-detail', id, 'activity'], queryFn: () => getTicketActivity(id) })

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ['support-detail'] })
    queryClient.invalidateQueries({ queryKey: ['support-stats'] })
    queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
  }

  const statusMutation = useMutation({
    mutationFn: ({ status, note }: { status: TicketStatus; note?: string }) => setTicketStatus(id, status, note),
    onSuccess: () => { toast.success('Status updated'); invalidateDetail() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update status'),
  })

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string | null) => assignTicket(id, assigneeId),
    onSuccess: () => toast.success('Assignment updated'),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to assign'),
  })

  const replyMutation = useMutation({
    mutationFn: () => addReply(id, replyText, isInternal),
    onSuccess: () => { toast.success('Reply added'); setReplyText(''); invalidateDetail() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to add reply'),
  })

  const satisfactionMutation = useMutation({
    mutationFn: () => setSatisfaction(id, rating ?? 5, comment),
    onSuccess: () => { toast.success('Satisfaction recorded'); setComment(''); setRating(null); invalidateDetail() },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to record'),
  })

  const t = detail.data
  const nextStatus: TicketStatus | null = t ? nextAllowed(t.status) : null

  return (
    <Modal open onClose={onClose} title={t ? `${t.ticketNumber} — ${t.subject}` : 'Ticket'} size="2xl"
      footer={
        <div className="flex items-center gap-2">
          {t && !t.isDeleted && (
            <>
              <Button variant="outline" onClick={() => onRequestDelete(t)}><Trash2 size={16} /> Delete</Button>
              {nextStatus && (
                <Button onClick={() => statusMutation.mutate({ status: nextStatus })} loading={statusMutation.isPending}>
                  Move to {nextStatus.replace('_', ' ')}
                </Button>
              )}
            </>
          )}
          {t && t.isDeleted && (
            <Button onClick={() => restoreTicket(id).then(() => { toast.success('Ticket restored'); invalidateDetail() })}>
              <RotateCcw size={16} /> Restore
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {detail.isLoading || !t ? (
        <div className="flex items-center justify-center py-16 text-surface-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          {/* header badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[t.status]}>{t.status.replace('_', ' ')}</Badge>
            <Badge variant={PRIORITY_BADGE[t.priority]}>{t.priority}</Badge>
            <Badge variant="neutral">{t.category.replace('_', ' ')}</Badge>
            <Badge variant="neutral">{t.source}</Badge>
            <span className="text-xs text-surface-400">Restaurant: {t.restaurantName}</span>
            {t.reporterName && <span className="text-xs text-surface-400">Reporter: {t.reporterName}{t.reporterEmail ? ` (${t.reporterEmail})` : ''}</span>}
          </div>

          {/* tabs */}
          <div className="flex gap-2 border-b border-surface-200 pb-2 dark:border-surface-700">
            {(['overview', 'replies', 'activity'] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={tab === tb ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-400' : 'rounded-lg px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'}
              >
                {tb}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <p className="whitespace-pre-wrap text-sm text-surface-700 dark:text-surface-300">{t.description}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-surface-600 dark:text-surface-400">
                  Assignee
                  <select
                    value={t.assigneeId ?? ''}
                    onChange={(e) => assignMutation.mutate(e.target.value || null)}
                    className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
                  >
                    <option value="">Unassigned</option>
                    <option value="__current__">Assign to me</option>
                  </select>
                </label>
                <label className="text-sm text-surface-600 dark:text-surface-400">
                  Priority
                  <select
                    value={t.priority}
                    onChange={(e) => updateTicket(id, { priority: e.target.value as TicketPriority }).then(() => { toast.success('Priority updated'); invalidateDetail() })}
                    className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              </div>
              {t.resolutionNote && (
                <div className="rounded-lg bg-success/10 p-3 text-sm text-success"><strong>Resolution:</strong> {t.resolutionNote}</div>
              )}
              {t.assigneeName && <p className="text-xs text-surface-400">Assigned to {t.assigneeName}</p>}

              {/* attachments */}
              {t.attachments.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-surface-400">Attachments</p>
                  <ul className="space-y-2">
                    {t.attachments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-700">
                        <a className="flex items-center gap-2 text-primary-600 hover:underline dark:text-primary-400" href={a.key.startsWith('http') ? a.key : a.key} target="_blank" rel="noreferrer">
                          <Paperclip size={14} /> {a.originalName} <span className="text-xs text-surface-400">({fmtBytes(a.size)})</span>
                        </a>
                        <button
                          onClick={() => import('../api/support').then((m) => m.deleteAttachment(id, a.id)).then(() => { toast.success('Attachment removed'); invalidateDetail() })}
                          className="text-surface-400 hover:text-danger"
                          title="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* satisfaction */}
              {t.status === 'closed' || t.status === 'resolved' ? (
                <div className="rounded-lg border border-surface-200 p-3 dark:border-surface-700">
                  <p className="mb-2 text-sm font-medium text-surface-700 dark:text-surface-300">Customer satisfaction</p>
                  {t.satisfactionRating ? (
                    <p className="text-sm text-surface-600 dark:text-surface-400">Rated {t.satisfactionRating}/5{t.satisfactionComment ? ` — ${t.satisfactionComment}` : ''}</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select value={rating ?? 5} onChange={(e) => setRating(Number(e.target.value))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:border-surface-600 dark:bg-surface-800">
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <Input placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} className="flex-1" />
                      <Button size="sm" onClick={() => satisfactionMutation.mutate()} loading={satisfactionMutation.isPending}><Send size={14} /></Button>
                    </div>
                  )}
                </div>
              ) : null}

              {/* timeline */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-surface-400">Timeline</p>
                <ol className="space-y-2">
                  {t.timeline.slice().reverse().map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-400">
                      <History size={13} className="mt-0.5 text-surface-300" />
                      <span><strong>{e.performedBy}</strong> {e.description} · {formatDateTime(e.timestamp)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {tab === 'replies' && (
            <div className="space-y-3">
              {(replies.data ?? []).length === 0 && <EmptyState title="No replies yet" description="Add the first reply to this ticket." />}
              {(replies.data ?? []).map((r: TicketReply) => (
                <div key={r._id} className={`rounded-lg border p-3 text-sm ${r.isInternal ? 'border-warning/40 bg-warning/5' : 'border-surface-200 dark:border-surface-700'}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-surface-700 dark:text-surface-300">
                      <UserIcon size={13} /> {r.authorName}
                      {r.isInternal && <Badge variant="warning">internal</Badge>}
                    </span>
                    <span className="text-xs text-surface-400">{formatDateTime(r.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-surface-600 dark:text-surface-400">{r.body}</p>
                </div>
              ))}
              <div className="mt-3 space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  placeholder="Write a reply..."
                  className="block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                    <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                    Internal note
                  </label>
                  <Button onClick={() => replyMutation.mutate()} disabled={!replyText.trim()} loading={replyMutation.isPending}><MessageSquare size={15} /> {isInternal ? 'Add note' : 'Reply'}</Button>
                </div>
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div>
              {(activity.data ?? []).length === 0 && <EmptyState title="No activity logged" description="Audit entries will appear here." />}
              <ul className="space-y-2">
                {(activity.data ?? []).map((a: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-400">
                    <History size={13} className="mt-0.5 text-surface-300" />
                    <span><strong>{a.action}</strong> by {a.performedBy}@<code className="text-surface-400">{a.ipAddress}</code> · {formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function nextAllowed(current: TicketStatus): TicketStatus | null {
  const map: Partial<Record<TicketStatus, TicketStatus>> = {
    new: 'open',
    open: 'in_progress',
    in_progress: 'resolved',
    pending: 'open',
    resolved: 'closed',
    reopened: 'open',
    closed: 'reopened',
  }
  return map[current] ?? null
}

// ─── Create ticket modal ───────────────────────────────────────────

function CreateTicketModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [restaurantId, setRestaurantId] = useState('')
  const [category, setCategory] = useState<TicketCategory>('technical')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [report, setReport] = useState(false)
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')

  const restaurants = useQuery({
    queryKey: ['restaurants', 'support-picker'],
    queryFn: () => getRestaurants({ limit: 100 }),
  })

  const mutation = useMutation({
    mutationFn: () => createTicket({ restaurantId, category, priority, subject, description, reporterName: report ? reporterName || undefined : undefined, reporterEmail: report ? reporterEmail || undefined : undefined }),
    onSuccess: () => {
      toast.success('Ticket created')
      setRestaurantId(''); setSubject(''); setDescription(''); setReporterName(''); setReporterEmail('')
      onCreated()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to create ticket'),
  })

  const valid = restaurantId && subject.trim() && description.trim()

  return (
    <Modal open={open} onClose={onClose} title="Create support ticket" size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid} loading={mutation.isPending}>Create ticket</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
          Restaurant
          <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
            <option value="">Select a restaurant…</option>
            {(restaurants.data?.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" />
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe the issue in detail…" className="mt-1 block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100" />
        </label>
        <label className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
          <input type="checkbox" checked={report} onChange={(e) => setReport(e.target.checked)} />
          Add reporter details
        </label>
        {report && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Reporter name" value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
            <Input label="Reporter email" type="email" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} />
          </div>
        )}
      </div>
    </Modal>
  )
}
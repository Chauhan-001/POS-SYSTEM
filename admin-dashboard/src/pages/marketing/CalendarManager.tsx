/**
 * =============================================================================
 *  CalendarManager.tsx — ChitKuber Context Calendar (Phase 1)
 * =============================================================================
 *
 * Simple two-part layout (spec §8/§9):
 *   1. Month grid  — < prev / today / next >, events as colored chips by type
 *   2. Upcoming    — next 8 active events with type color + scope label
 *
 * Interactions: click day chip → detail modal → edit / archive / restore.
 * [+ Add Event] opens the short form with conditional scope fields.
 * Filters: search + type + scope + status (server-side via query params).
 *
 * No Gemini/AI here (Phase 2+) — this is pure CRUD over /api/calendar.
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ChevronLeft, ChevronRight, Search, CalendarDays, Archive,
  RotateCcw, Pencil, MapPin, Sparkles, TriangleAlert, CheckCircle2,
} from 'lucide-react'
import reactHotToast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorPage } from '../../components/ui/ErrorPage'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent,
  archiveCalendarEvent, restoreCalendarEvent, approveCalendarEvent,
  generateCalendarEvents, approveCalendarCandidates,
  CALENDAR_EVENT_TYPES, CALENDAR_EVENT_SCOPES,
  type CalendarEvent, type CalendarEventType, type CalendarEventScope,
  type CalendarEventInput, type CalendarEventCandidate,
} from '../../api/calendar'
import { getRestaurants } from '../../api/restaurants'

// ─── Type colors (theme tokens, no hardcoded palette) ───────────

const TYPE_META: Record<CalendarEventType, { label: string; chip: string; dot: string }> = {
  festival: { label: 'Festival', chip: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300', dot: 'bg-primary-500' },
  national_event: { label: 'National Event', chip: 'bg-success/15 text-success dark:text-success', dot: 'bg-success' },
  seasonal: { label: 'Seasonal', chip: 'bg-warning/15 text-warning dark:text-warning', dot: 'bg-warning' },
  sports: { label: 'Sports', chip: 'bg-info/15 text-info dark:text-info', dot: 'bg-info' },
  local_event: { label: 'Local Event', chip: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', dot: 'bg-purple-500' },
  restaurant_event: { label: 'Restaurant Event', chip: 'bg-danger/15 text-danger dark:text-danger', dot: 'bg-danger' },
  custom: { label: 'Custom', chip: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300', dot: 'bg-surface-400' },
}

const RELEVANCE_BADGE: Record<string, 'success' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
}

function scopeLabel(ev: Pick<CalendarEvent, 'scope' | 'city' | 'state' | 'region' | 'country'>): string {
  if (ev.scope === 'india') return 'India'
  if (ev.scope === 'restaurant') return 'Restaurant'
  if (ev.scope === 'city') return ev.city || 'City'
  if (ev.scope === 'state') return ev.state || 'State'
  return ev.region || 'Region'
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtShort(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Month grid helper ──────────────────────────────────────────

function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7)) // Monday-first grid
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

// ─── Event form state ───────────────────────────────────────────

interface FormState {
  name: string
  type: CalendarEventType
  startDate: string
  endDate: string
  scope: CalendarEventScope
  country: string
  state: string
  region: string
  city: string
  restaurantId: string
  description: string
  tags: string
  marketingRelevance: 'low' | 'medium' | 'high'
  preparationWindowDays: number
}

function emptyForm(): FormState {
  const today = toDateInput(new Date())
  return {
    name: '', type: 'festival', startDate: today, endDate: today, scope: 'india',
    country: 'India', state: '', region: '', city: '', restaurantId: '',
    description: '', tags: '', marketingRelevance: 'medium', preparationWindowDays: 0,
  }
}

function formFromEvent(ev: CalendarEvent): FormState {
  return {
    name: ev.name,
    type: ev.type,
    startDate: toDateInput(new Date(ev.startDate)),
    endDate: toDateInput(new Date(ev.endDate)),
    scope: ev.scope,
    country: ev.country || '',
    state: ev.state || '',
    region: ev.region || '',
    city: ev.city || '',
    restaurantId: ev.restaurantId || '',
    description: ev.description || '',
    tags: ev.tags.filter((t) => t !== 'demo').join(', '),
    marketingRelevance: ev.marketingRelevance,
    preparationWindowDays: ev.preparationWindowDays,
  }
}

function validateForm(f: FormState): string | null {
  if (!f.name.trim()) return 'Event name is required.'
  if (!f.startDate) return 'Start date is required.'
  if (!f.endDate) return 'End date is required.'
  if (new Date(f.endDate) < new Date(f.startDate)) return 'End date must be on or after start date.'
  if (f.scope === 'state' && !f.state.trim()) return 'State is required for state scope.'
  if (f.scope === 'city' && !f.city.trim()) return 'City is required for city scope.'
  if (f.scope === 'city' && !f.state.trim()) return 'State is required for city scope.'
  if (f.scope === 'restaurant' && !f.restaurantId) return 'Select a restaurant for restaurant scope.'
  return null
}

function toInput(f: FormState): CalendarEventInput {
  return {
    name: f.name.trim(),
    type: f.type,
    startDate: new Date(`${f.startDate}T00:00:00`).toISOString(),
    endDate: new Date(`${f.endDate}T23:59:59`).toISOString(),
    scope: f.scope,
    country: f.country.trim() || undefined,
    state: f.state.trim() || undefined,
    region: f.region.trim() || undefined,
    city: f.city.trim() || undefined,
    restaurantId: f.scope === 'restaurant' ? f.restaurantId : undefined,
    description: f.description.trim() || undefined,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    marketingRelevance: f.marketingRelevance,
    preparationWindowDays: f.preparationWindowDays,
  }
}

// ─── Page ───────────────────────────────────────────────────────

export default function CalendarManager() {
  const queryClient = useQueryClient()
  const [cursor, setCursor] = useState(() => new Date())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'draft' | 'active' | 'archived'>('active')
  const [detail, setDetail] = useState<CalendarEvent | null>(null)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)

  // ── AI Assistant state (Phase 2) ──
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [aiRequest, setAiRequest] = useState('')
  const [aiStartDate, setAiStartDate] = useState('')
  const [aiEndDate, setAiEndDate] = useState('')
  const [aiCandidates, setAiCandidates] = useState<CalendarEventCandidate[]>([])
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set())
  const [aiBusy, setAiBusy] = useState(false)

  const { data: restaurants } = useQuery({
    queryKey: ['calendar-restaurants'],
    queryFn: () => getRestaurants({ page: 1, limit: 200 }),
    staleTime: 5 * 60_000,
  })

  // Fetch a wide window covering the visible month ± 1 month.
  const monthFrom = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1).toISOString(), [cursor])
  const monthTo = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0).toISOString(), [cursor])

  const eventsQuery = useQuery({
    queryKey: ['calendar-events', monthFrom, monthTo, search, typeFilter, scopeFilter, statusFilter],
    queryFn: () =>
      getCalendarEvents({
        startDate: monthFrom,
        endDate: monthTo,
        status: statusFilter,
        search: search || undefined,
        type: typeFilter === 'all' ? undefined : (typeFilter as CalendarEventType),
        scope: scopeFilter === 'all' ? undefined : (scopeFilter as CalendarEventScope),
      }),
  })

  const upcomingQuery = useQuery({
    queryKey: ['calendar-upcoming'],
    queryFn: () => getCalendarEvents({ status: 'active', withinDays: 60, limit: 8 }),
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    queryClient.invalidateQueries({ queryKey: ['calendar-upcoming'] })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = toInput(form)
      return editing ? updateCalendarEvent(editing._id, payload) : createCalendarEvent(payload)
    },
    onSuccess: () => {
      reactHotToast.success(editing ? 'Event updated' : 'Event created')
      setFormOpen(false)
      setEditing(null)
      setFormError(null)
      invalidate()
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.response?.data?.details?.[0]?.message ?? 'Save failed')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveCalendarEvent(id),
    onSuccess: () => {
      reactHotToast.success('Event archived')
      setDetail(null)
      invalidate()
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreCalendarEvent(id),
    onSuccess: () => {
      reactHotToast.success('Event restored')
      setDetail(null)
      invalidate()
    },
  })

  const approveDraftMutation = useMutation({
    mutationFn: (id: string) => approveCalendarEvent(id),
    onSuccess: () => {
      reactHotToast.success('Event approved and activated')
      setDetail(null)
      invalidate()
    },
  })

  async function runAssistant() {
    setAiBusy(true)
    setAiCandidates([])
    setAiWarnings([])
    setAiSelected(new Set())
    try {
      const result = await generateCalendarEvents({
        request: aiRequest,
        startDate: aiStartDate || undefined,
        endDate: aiEndDate || undefined,
      })
      setAiCandidates(result.candidates)
      setAiWarnings(result.warnings)
      if (result.candidates.length === 0 && result.warnings.length === 0) {
        setAiWarnings(['No candidates were generated. Try a broader request.'])
      }
    } catch (err: any) {
      setAiWarnings([err?.response?.data?.error ?? 'AI generation failed — the calendar still works manually.'])
    } finally {
      setAiBusy(false)
    }
  }

  async function approveSelected(force = false) {
    if (aiSelected.size === 0) return
    setAiBusy(true)
    try {
      const payload = [...aiSelected].map((i) => aiCandidates[i])
      const result = await approveCalendarCandidates(payload, force)
      reactHotToast.success(
        `${result.created.length} event(s) added${result.rejected.length ? `, ${result.rejected.length} skipped` : ''}`,
      )
      setAiCandidates((prev) => prev.filter((_, i) => !aiSelected.has(i)))
      setAiSelected(new Set())
      invalidate()
    } catch (err: any) {
      reactHotToast.error(err?.response?.data?.error ?? 'Approval failed')
    } finally {
      setAiBusy(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormError(null)
    setFormOpen(true)
  }

  function candidateToEdit(c: CalendarEventCandidate) {
    return {
      _id: '',
      name: c.name,
      type: c.type,
      startDate: c.startDate,
      endDate: c.endDate ?? c.startDate,
      scope: c.scope,
      state: c.state,
      city: c.city,
      description: c.description,
      tags: c.tags ?? [],
      marketingRelevance: c.marketingRelevance,
      preparationWindowDays: c.preparationWindowDays,
      status: 'active',
      source: 'gemini',
      createdAt: '',
      updatedAt: '',
    } as unknown as CalendarEvent
  }

  function openEdit(ev: CalendarEvent) {
    setEditing(ev)
    setForm(formFromEvent(ev))
    setFormError(null)
    setDetail(null)
    setFormOpen(true)
  }

  function submit() {
    const problem = validateForm(form)
    if (problem) {
      setFormError(problem)
      return
    }
    saveMutation.mutate()
  }

  const events = eventsQuery.data ?? []
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of events) {
      const start = new Date(ev.startDate)
      const end = new Date(ev.endDate)
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toDateInput(d)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(ev)
      }
    }
    return map
  }, [events])

  const cells = monthCells(cursor.getFullYear(), cursor.getMonth())
  const upcoming = upcomingQuery.data ?? []

  const selectCls =
    'h-10 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-surface-100 px-3 focus:outline-none focus:ring-2 focus:ring-primary-500'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Calendar</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            The ChitKuber Context Calendar — festivals, events and seasons that power future marketing intelligence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAssistantOpen(true)}>
            <Sparkles size={16} className="mr-1 text-primary-500" /> AI Assistant
          </Button>
          <Button onClick={openCreate}>
            <Plus size={16} className="mr-1" /> Add Event
          </Button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="h-10 pl-9 pr-4 text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 w-56"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls} aria-label="Filter by type">
          <option value="all">All types</option>
          {CALENDAR_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className={selectCls} aria-label="Filter by scope">
          <option value="all">All scopes</option>
          {CALENDAR_EVENT_SCOPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'draft' | 'active' | 'archived')} className={selectCls} aria-label="Filter by status">
          <option value="active">Active</option>
          <option value="draft">Drafts (pending approval)</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {eventsQuery.error ? (
        <ErrorPage message={(eventsQuery.error as any).message} onRetry={() => eventsQuery.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Month grid */}
          <Card className="lg:col-span-2 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </Button>
                <span className="font-semibold text-surface-900 dark:text-surface-100 min-w-40 text-center">
                  {cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">
                  <ChevronRight size={16} />
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-surface-400 mb-1">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>

            {eventsQuery.isLoading ? (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d) => {
                  const inMonth = d.getMonth() === cursor.getMonth()
                  const isToday = sameDay(d, new Date())
                  const dayEvents = eventsByDay.get(toDateInput(d)) ?? []
                  return (
                    <div
                      key={d.toISOString()}
                      className={`min-h-16 rounded-lg border p-1 text-xs ${
                        inMonth
                          ? 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
                          : 'border-transparent bg-surface-50 dark:bg-surface-900/40 text-surface-300'
                      } ${isToday ? 'ring-2 ring-primary-400' : ''}`}
                    >
                      <div className={`text-right px-1 ${isToday ? 'font-bold text-primary-600' : 'text-surface-500'}`}>
                        {d.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <button
                            key={ev._id}
                            onClick={() => setDetail(ev)}
                            className={`w-full truncate text-left text-[10px] px-1 py-0.5 rounded ${TYPE_META[ev.type].chip}`}
                            title={ev.name}
                          >
                            {ev.name}
                          </button>
                        ))}
                        {dayEvents.length > 2 && (
                          <div className="text-[10px] text-surface-400 px-1">+{dayEvents.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-surface-500">
              {(Object.keys(TYPE_META) as CalendarEventType[]).map((t) => (
                <span key={t} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${TYPE_META[t].dot}`} /> {TYPE_META[t].label}
                </span>
              ))}
            </div>
          </Card>

          {/* Upcoming events */}
          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-semibold text-surface-900 dark:text-surface-100 mb-3">
              <CalendarDays size={16} className="text-primary-500" /> Upcoming Events
            </h2>
            {upcomingQuery.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={40} />}
                title="No events yet"
                description="Add your first event to start building the ChitKuber Context Calendar."
              />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((ev) => (
                  <li key={ev._id}>
                    <button
                      onClick={() => setDetail(ev)}
                      className="w-full flex items-center gap-3 rounded-lg border border-surface-200 dark:border-surface-700 p-2 text-left hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TYPE_META[ev.type].dot}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{ev.name}</span>
                        <span className="block text-[11px] text-surface-400 flex items-center gap-1">
                          <MapPin size={9} /> {scopeLabel(ev)}
                        </span>
                      </span>
                      <span className="text-xs text-surface-500 shrink-0">{fmtShort(ev.startDate)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} size="md">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className={`px-2 py-0.5 rounded text-xs ${TYPE_META[detail.type].chip}`}>{TYPE_META[detail.type].label}</span>
              <Badge variant={RELEVANCE_BADGE[detail.marketingRelevance]} className="text-[10px] capitalize">
                {detail.marketingRelevance} relevance
              </Badge>
              {detail.source !== 'admin' && (
                <Badge variant="neutral" className="text-[10px]">source: {detail.source}</Badge>
              )}
              {detail.status === 'archived' && (
                <Badge variant="danger" className="text-[10px]">archived</Badge>
              )}
            </div>
            <div className="text-sm text-surface-700 dark:text-surface-300 space-y-1">
              <p>
                <span className="text-surface-400">When:</span> {fmtDate(detail.startDate)}
                {detail.endDate !== detail.startDate && ` → ${fmtDate(detail.endDate)}`}
              </p>
              <p><span className="text-surface-400">Scope:</span> {scopeLabel(detail)}</p>
              {detail.description && <p className="text-surface-500">{detail.description}</p>}
              {detail.tags.length > 0 && (
                <p><span className="text-surface-400">Tags:</span> {detail.tags.join(' · ')}</p>
              )}
              {detail.preparationWindowDays > 0 && (
                <p><span className="text-surface-400">Prep window:</span> {detail.preparationWindowDays} days</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
              {detail.status === 'draft' && (
                <Button variant="outline" onClick={() => approveDraftMutation.mutate(detail._id)} loading={approveDraftMutation.isPending}>
                  <CheckCircle2 size={14} className="mr-1" /> Approve
                </Button>
              )}
              {detail.status === 'archived' ? (
                <Button variant="outline" onClick={() => restoreMutation.mutate(detail._id)} loading={restoreMutation.isPending}>
                  <RotateCcw size={14} className="mr-1" /> Restore
                </Button>
              ) : detail.status !== 'draft' && (
                <Button variant="outline" onClick={() => archiveMutation.mutate(detail._id)} loading={archiveMutation.isPending}>
                  <Archive size={14} className="mr-1" /> Archive
                </Button>
              )}
              <Button onClick={() => openEdit(detail)}>
                <Pencil size={14} className="mr-1" /> Edit
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        title={editing ? `Edit: ${editing.name}` : 'Add Event'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={submit} loading={saveMutation.isPending}>{editing ? 'Save Changes' : 'Create Event'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{formError}</div>
          )}
          <Input label="Event Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Janmashtami" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Event Type *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CalendarEventType })} className={`${selectCls} w-full`}>
                {CALENDAR_EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Scope *</label>
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as CalendarEventScope })} className={`${selectCls} w-full`}>
                {CALENDAR_EVENT_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date *" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            <Input label="End Date *" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>

          {/* Conditional scope fields */}
          {(form.scope === 'state' || form.scope === 'city' || form.scope === 'region') && (
            <Input label="State *" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Uttarakhand" />
          )}
          {form.scope === 'region' && (
            <Input label="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. North India" />
          )}
          {form.scope === 'city' && (
            <Input label="City *" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Dehradun" />
          )}
          {form.scope === 'restaurant' && (
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Restaurant *</label>
              <select value={form.restaurantId} onChange={(e) => setForm({ ...form, restaurantId: e.target.value })} className={`${selectCls} w-full`}>
                <option value="">Select a restaurant...</option>
                {(restaurants?.data ?? []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short context for future marketing use" />
          <Input label="Tags (comma separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="sweets, family, gifting" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Marketing Relevance</label>
              <select value={form.marketingRelevance} onChange={(e) => setForm({ ...form, marketingRelevance: e.target.value as FormState['marketingRelevance'] })} className={`${selectCls} w-full`}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <Input label="Preparation Window (days)" type="number" min={0} value={form.preparationWindowDays} onChange={(e) => setForm({ ...form, preparationWindowDays: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
          </div>
        </div>
      </Modal>

      {/* ─── AI Assistant modal (Phase 2) ─── */}
      <Modal
        open={assistantOpen}
        onClose={() => { setAssistantOpen(false); setAiCandidates([]); setAiWarnings([]) }}
        title="Calendar Assistant"
        size="xl"
        footer={
          aiCandidates.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-surface-400">{aiSelected.size} selected · candidates are inserted only after approval</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => approveSelected(true)} loading={aiBusy}>Approve incl. duplicates</Button>
                <Button onClick={() => approveSelected(false)} loading={aiBusy}>Approve Selected</Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-end">
            <Input
              label="Generate"
              value={aiRequest}
              onChange={(e) => setAiRequest(e.target.value)}
              placeholder="e.g. Major festivals for Uttarakhand in 2027"
            />
            <div className="flex gap-2">
              <Input label="From" type="date" value={aiStartDate} onChange={(e) => setAiStartDate(e.target.value)} />
              <Input label="To" type="date" value={aiEndDate} onChange={(e) => setAiEndDate(e.target.value)} />
              <Button onClick={runAssistant} loading={aiBusy} disabled={aiRequest.trim().length < 3} className="shrink-0">
                <Sparkles size={14} className="mr-1" /> Generate
              </Button>
            </div>
          </div>

          {aiWarnings.length > 0 && (
            <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-sm text-warning space-y-1">
              {aiWarnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          {aiCandidates.length > 0 && (
            <ul className="space-y-2">
              {aiCandidates.map((c, i) => (
                <li key={i} className="rounded-lg border border-surface-200 dark:border-surface-700 p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={aiSelected.has(i)}
                      onChange={(e) => {
                        const next = new Set(aiSelected)
                        if (e.target.checked) next.add(i); else next.delete(i)
                        setAiSelected(next)
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                        {c.name}
                        <span className="ml-2 text-xs text-surface-400">{fmtDate(c.startDate)} · {c.scope}{c.state ? ` (${c.state})` : ''}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant={RELEVANCE_BADGE[c.marketingRelevance]} className="text-[10px] capitalize">{c.marketingRelevance}</Badge>
                        {c.dateVerification !== 'exact' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                            <TriangleAlert size={11} /> Date requires verification
                          </span>
                        )}
                        {c.dateVerification === 'exact' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-success">
                            <CheckCircle2 size={11} /> Date verified
                          </span>
                        )}
                        {c.duplicate.isDuplicate && (
                          <Badge variant="danger" className="text-[10px]">possible duplicate</Badge>
                        )}
                      </div>
                      {c.warnings.length > 0 && (
                        <p className="mt-1 text-[11px] text-surface-400">{c.warnings.join(' ')}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setForm(formFromEvent(candidateToEdit(c))); setAssistantOpen(false); setFormOpen(true) }}>
                      <Pencil size={13} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  )
}

/**
 * =============================================================================
 *  calendar.ts — Context Calendar API (Phase 1)
 * =============================================================================
 *
 * Endpoints (backend/src/modules/calendar/routes/calendar.ts):
 *   GET    /api/calendar/events             → list (filters)
 *   GET    /api/calendar/events/:id         → single
 *   POST   /api/calendar/events             → create
 *   PUT    /api/calendar/events/:id         → update
 *   PATCH  /api/calendar/events/:id/archive → archive
 *   PATCH  /api/calendar/events/:id/restore → restore
 */

import apiClient from './client'

// ─── Types ───────────────────────────────────────────────────────

export const CALENDAR_EVENT_TYPES = [
  'festival',
  'national_event',
  'seasonal',
  'sports',
  'local_event',
  'restaurant_event',
  'custom',
] as const

export const CALENDAR_EVENT_SCOPES = ['india', 'state', 'region', 'city', 'restaurant'] as const

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]
export type CalendarEventScope = (typeof CALENDAR_EVENT_SCOPES)[number]

export interface CalendarEvent {
  _id: string
  name: string
  type: CalendarEventType
  startDate: string
  endDate: string
  scope: CalendarEventScope
  country?: string
  state?: string
  region?: string
  city?: string
  restaurantId?: string | null
  description?: string
  tags: string[]
  marketingRelevance: 'low' | 'medium' | 'high'
  preparationWindowDays: number
  status: 'draft' | 'active' | 'archived'
  source: 'admin' | 'gemini' | 'external'
  createdAt: string
  updatedAt: string
}

export interface CalendarEventFilters {
  startDate?: string
  endDate?: string
  type?: CalendarEventType
  scope?: CalendarEventScope
  status?: 'draft' | 'active' | 'archived'
  search?: string
  restaurantId?: string
  withinDays?: number
  limit?: number
}

export interface CalendarEventInput {
  name: string
  type: CalendarEventType
  startDate: string
  endDate: string
  scope: CalendarEventScope
  country?: string
  state?: string
  region?: string
  city?: string
  restaurantId?: string
  description?: string
  tags?: string[]
  marketingRelevance?: 'low' | 'medium' | 'high'
  preparationWindowDays?: number
}

// ─── API ─────────────────────────────────────────────────────────

export async function getCalendarEvents(filters: CalendarEventFilters = {}): Promise<CalendarEvent[]> {
  const { data } = await apiClient.get('/api/calendar/events', { params: filters })
  return data.events
}

export async function getCalendarEvent(id: string): Promise<CalendarEvent> {
  const { data } = await apiClient.get(`/api/calendar/events/${id}`)
  return data.event
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const { data } = await apiClient.post('/api/calendar/events', input)
  return data.event
}

export async function updateCalendarEvent(id: string, input: Partial<CalendarEventInput>): Promise<CalendarEvent> {
  const { data } = await apiClient.put(`/api/calendar/events/${id}`, input)
  return data.event
}

export async function archiveCalendarEvent(id: string): Promise<CalendarEvent> {
  const { data } = await apiClient.patch(`/api/calendar/events/${id}/archive`)
  return data.event
}

export async function restoreCalendarEvent(id: string): Promise<CalendarEvent> {
  const { data } = await apiClient.patch(`/api/calendar/events/${id}/restore`)
  return data.event
}

export async function approveCalendarEvent(id: string): Promise<CalendarEvent> {
  const { data } = await apiClient.patch(`/api/calendar/events/${id}/approve`)
  return data.event
}

// ─── AI Assistant (Phase 2) ──────────────────────────────────────

export interface CalendarEventCandidate {
  name: string
  type: CalendarEventType
  startDate: string
  endDate?: string
  scope: CalendarEventScope
  state?: string
  region?: string
  city?: string
  description?: string
  tags?: string[]
  marketingRelevance: 'low' | 'medium' | 'high'
  preparationWindowDays: number
  sourceReason?: string
  dateVerification: 'exact' | 'approximate' | 'unknown'
  requiresDateVerification: boolean
  duplicate: { isDuplicate: boolean; matchedEventId?: string; reason?: string }
  warnings: string[]
}

export interface GenerateResult {
  candidates: CalendarEventCandidate[]
  warnings: string[]
  requiresApproval: true
  llmUsed: boolean
}

export interface ApproveResult {
  created: string[]
  rejected: Array<{ name: string; reason: string }>
}

export async function generateCalendarEvents(input: {
  request: string
  startDate?: string
  endDate?: string
}): Promise<GenerateResult> {
  const { data } = await apiClient.post('/api/calendar/assistant/generate', input)
  return data
}

export async function approveCalendarCandidates(candidates: unknown[], force = false): Promise<ApproveResult> {
  const { data } = await apiClient.post('/api/calendar/assistant/approve', { candidates, force })
  return data
}

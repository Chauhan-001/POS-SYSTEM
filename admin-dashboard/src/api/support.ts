/**
 * API — Support / Help Desk
 *
 * Endpoints:
 *   GET  /admin/support/search            → searchSupport()    (unified lookup)
 *   GET  /admin/support/tickets           → list tickets       (paginated)
 *   GET  /admin/support/tickets/stats     → status/priority counts
 *   POST /admin/support/tickets           → create ticket
 *   GET  /admin/support/tickets/:id       → ticket detail
 *   PUT  /admin/support/tickets/:id       → update fields
 *   POST /admin/support/tickets/:id/status→ transition status
 *   POST /admin/support/tickets/:id/assign→ assign/unassign
 *   GET/POST  /admin/support/tickets/:id/replies
 *   POST/DELETE /admin/support/tickets/:id/attachments[...]
 *   POST /admin/support/tickets/:id/satisfaction
 *   GET  /admin/support/tickets/:id/activity
 *   DELETE/POST .../:id , /:id/restore    → soft delete / restore
 *
 * List endpoints return the `{ data, meta }` envelope from the backend.
 */

import apiClient from './client'
import type { Restaurant } from '../types'

// ─── Types ────────────────────────────────────────────────────────

export type TicketStatus = 'new' | 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed' | 'reopened' | 'cancelled'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketCategory = 'billing' | 'technical' | 'account' | 'feature_request' | 'bug' | 'other'
export type TicketSource = 'restaurant' | 'owner' | 'internal'

export interface TicketAttachment {
  id: string
  key: string
  size: number
  mimetype: string
  originalName: string
  uploadedBy: string
  uploadedAt: string
}

export interface TicketTimelineEntry {
  id: string
  action: string
  description: string
  performedBy: string
  performedById?: string
  timestamp: string
}

export interface SupportTicket {
  _id: string
  ticketNumber: string
  restaurantId: string
  restaurantName: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  subject: string
  description: string
  source: TicketSource
  reporterName?: string
  reporterEmail?: string
  assigneeId?: string
  assigneeName?: string
  attachments: TicketAttachment[]
  timeline: TicketTimelineEntry[]
  resolutionNote?: string
  closedAt?: string
  closedByName?: string
  satisfactionRating?: number
  satisfactionComment?: string
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface TicketReply {
  _id: string
  ticketId: string
  authorId?: string
  authorName: string
  body: string
  isInternal: boolean
  attachments: TicketAttachment[]
  createdAt: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  sortApplied?: string
}

export interface ListTicketsParams {
  page?: number
  limit?: number
  search?: string
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  restaurantId?: string
  assigneeId?: string
  source?: TicketSource
  deleted?: 'true' | 'false'
  from?: string
  to?: string
  sortBy?: 'createdAt' | 'updatedAt' | 'ticketNumber' | 'priority' | 'status' | 'restaurantName'
  sortOrder?: 'asc' | 'desc'
}

// ─── Search (existing) ────────────────────────────────────────────

export interface SupportSearchParams {
  query?: string
  restaurantId?: string
  phone?: string
  name?: string
}

export interface SupportSearchResult {
  restaurant: Restaurant
  owner: { id: string; name: string; email: string; phone: string }
  subscription: { plan: string; status: string; expiryDate: string }
  devices: number
  lastLogin: string
}

export async function searchSupport(params: SupportSearchParams): Promise<SupportSearchResult[]> {
  const { data } = await apiClient.get('/api/admin/support/search', { params })
  return data
}

// ─── Tickets ──────────────────────────────────────────────────────

export async function listTickets(params: ListTicketsParams = {}): Promise<{ data: SupportTicket[]; meta: PaginationMeta }> {
  const res = await apiClient.get('/api/admin/support/tickets', { params })
  return { data: res.data.data, meta: res.data.meta?.pagination }
}

export async function getTicketStats(params: { restaurantId?: string; assigneeId?: string } = {}): Promise<
  { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> }
> {
  const res = await apiClient.get('/api/admin/support/tickets/stats', { params })
  return res.data.data
}

export async function createTicket(input: {
  restaurantId: string
  category: TicketCategory
  priority?: TicketPriority
  subject: string
  description: string
  source?: TicketSource
  reporterName?: string
  reporterEmail?: string
}): Promise<SupportTicket> {
  const res = await apiClient.post('/api/admin/support/tickets', input)
  return res.data.data
}

export async function getTicket(id: string): Promise<SupportTicket> {
  const res = await apiClient.get(`/api/admin/support/tickets/${id}`)
  return res.data.data
}

export async function updateTicket(id: string, patch: Partial<Pick<SupportTicket, 'subject' | 'category' | 'priority' | 'description'>>): Promise<SupportTicket> {
  const res = await apiClient.put(`/api/admin/support/tickets/${id}`, patch)
  return res.data.data
}

export async function setTicketStatus(id: string, status: TicketStatus, note?: string): Promise<SupportTicket> {
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/status`, { status, note })
  return res.data.data
}

export async function assignTicket(id: string, assigneeId: string | null): Promise<SupportTicket> {
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/assign`, { assigneeId })
  return res.data.data
}

export async function getReplies(id: string): Promise<TicketReply[]> {
  const res = await apiClient.get(`/api/admin/support/tickets/${id}/replies`)
  return res.data.data
}

export async function addReply(id: string, body: string, isInternal = false): Promise<TicketReply> {
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/replies`, { body, isInternal })
  return res.data.data
}

export async function uploadAttachment(id: string, file: File): Promise<{ key: string; meta: TicketAttachment }> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.data
}

export async function deleteAttachment(id: string, attachmentId: string): Promise<{ removed: string }> {
  const res = await apiClient.delete(`/api/admin/support/tickets/${id}/attachments/${attachmentId}`)
  return res.data.data
}

export async function setSatisfaction(id: string, rating: number, comment?: string): Promise<SupportTicket> {
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/satisfaction`, { rating, comment })
  return res.data.data
}

export async function getTicketActivity(id: string): Promise<Array<Record<string, any>>> {
  const res = await apiClient.get(`/api/admin/support/tickets/${id}/activity`)
  return res.data.data
}

export async function deleteTicket(id: string, reason?: string): Promise<SupportTicket> {
  const res = await apiClient.delete(`/api/admin/support/tickets/${id}`, { data: { reason } })
  return res.data.data
}

export async function restoreTicket(id: string): Promise<SupportTicket> {
  const res = await apiClient.post(`/api/admin/support/tickets/${id}/restore`)
  return res.data.data
}
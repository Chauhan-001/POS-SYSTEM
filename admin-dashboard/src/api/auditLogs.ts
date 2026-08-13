/**
 * =============================================================================
 *  auditLogs.ts — Enterprise Audit Log API (Phase 2.9)
 * =============================================================================
 *
 * Endpoints:
 *   GET    /admin/audit-logs                  → searchable list (cursor/page)
 *   GET    /admin/audit-logs/stats            → dashboard statistics
 *   GET    /admin/audit-logs/registry         → action/module/category reference
 *   GET    /admin/audit-logs/:id              → single entry detail
 *   POST   /admin/audit-logs/exports          → create background export
 *   GET    /admin/audit-logs/exports/:id      → export job status
 *   GET    /admin/audit-logs/exports/:id/download → download artifact
 *   GET    /admin/audit-logs/integrity/verify → hash-chain report
 *   GET    /admin/audit-logs/retention        → retention rules
 *   POST   /admin/audit-logs/retention/run    → run cleanup
 *   GET    /admin/audit-logs/archive          → archived rows
 *   POST   /admin/audit-logs/archive/restore  → restore archived rows
 *   GET/POST/DELETE /admin/audit-logs/legal-holds
 *   GET/POST/DELETE /admin/audit-logs/saved-searches
 *   GET/POST/DELETE /admin/audit-logs/alerts
 */

import apiClient from './client'
import type {
  AuditLogEntry,
  AuditLogStats,
  AuditIntegrityReport,
  AuditExportJob,
  AuditAlert,
  AuditSavedSearch,
  AuditLegalHold,
  AuditRetentionRules,
  PaginatedResponse,
} from '../types'

export interface AuditLogFilters {
  page?: number
  limit?: number
  cursor?: string
  search?: string
  action?: string
  actionContains?: string
  module?: string
  category?: string
  severity?: string
  result?: string
  performedBy?: string
  role?: string
  restaurantId?: string
  branchId?: string
  entityType?: string
  entityId?: string
  ipAddress?: string
  from?: string
  to?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface AuditListResponse {
  data: AuditLogEntry[]
  meta: {
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
      nextCursor: string | null
      hasMore: boolean
    }
  }
}

export async function getAuditLogs(filters: AuditLogFilters = {}): Promise<AuditListResponse> {
  const { data } = await apiClient.get('/api/admin/audit-logs', { params: filters })
  return data
}

export async function getAuditLogStats(): Promise<{ data: AuditLogStats }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/stats')
  return data
}

export async function getAuditLogDetail(id: string, includeStack = false): Promise<{ data: AuditLogEntry }> {
  const { data } = await apiClient.get(`/api/admin/audit-logs/${id}`, { params: { includeStack } })
  return data
}

export async function getAuditRegistry(): Promise<{
  data: { actions: { action: string; meta: Record<string, any> | null }[]; modules: string[]; categories: string[] }
}> {
  const { data } = await apiClient.get('/api/admin/audit-logs/registry')
  return data
}

// ─── Integrity ────────────────────────────────────────────────────

export async function verifyAuditIntegrity(): Promise<{ data: AuditIntegrityReport }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/integrity/verify')
  return data
}

// ─── Exports ──────────────────────────────────────────────────────

export interface CreateExportInput {
  format: 'csv' | 'json' | 'xlsx' | 'pdf'
  search?: string
  action?: string
  module?: string
  category?: string
  severity?: string
  result?: string
  performedBy?: string
  restaurantId?: string
  entityType?: string
  from?: string
  to?: string
  password?: string
}

export async function createAuditExport(input: CreateExportInput): Promise<{ data: { id: string; status: string } }> {
  const { data } = await apiClient.post('/api/admin/audit-logs/exports', input)
  return data
}

export async function getAuditExportStatus(id: string): Promise<{ data: AuditExportJob }> {
  const { data } = await apiClient.get(`/api/admin/audit-logs/exports/${id}`)
  return data
}

/**
 * Download a completed export as a file.
 *
 * The file is fetched as a blob through `apiClient` so the JWT travels in the
 * `Authorization` header only — never in the URL (query-string tokens leak into
 * browser history and server logs). A temporary object URL is used to trigger
 * the browser download and is revoked immediately after.
 */
export async function downloadAuditExport(id: string, format: string = 'csv'): Promise<void> {
  const res = await apiClient.get(`/api/admin/audit-logs/exports/${id}/download`, {
    responseType: 'blob',
  })
  const blob = res.data as Blob

  // Prefer the server-provided filename; fall back to a stable default.
  const disposition = res.headers?.['content-disposition'] as string | undefined
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  // Only percent-decode the RFC 5987 `filename*=UTF-8''...` form — a plain
  // `filename="..."` value is a literal name and could contain a stray `%`
  // that would make decodeURIComponent throw and kill a valid download.
  const filename = match
    ? /filename\*=/.test(match[0])
      ? decodeURIComponent(match[1])
      : match[1]
    : `audit-export-${id}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : format === 'json' ? 'json' : 'csv'}`

  const url = window.URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.URL.revokeObjectURL(url)
  }
}

// ─── Retention / archive ──────────────────────────────────────────

export async function getAuditRetention(): Promise<{ data: AuditRetentionRules }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/retention')
  return data
}

export async function runAuditRetention(force = false): Promise<{
  data: { scanned: number; archived: number; held: number; deleted: number }
}> {
  const { data } = await apiClient.post('/api/admin/audit-logs/retention/run', { force })
  return data
}

export async function getAuditArchive(params: { page?: number; limit?: number; module?: string; from?: string; to?: string } = {}): Promise<PaginatedResponse<any>> {
  const { data } = await apiClient.get('/api/admin/audit-logs/archive', { params })
  return data
}

export async function restoreAuditArchive(ids: string[]): Promise<{ data: { restored: number; notFound: number } }> {
  const { data } = await apiClient.post('/api/admin/audit-logs/archive/restore', { ids })
  return data
}

// ─── Legal holds ──────────────────────────────────────────────────

export async function getLegalHolds(active?: boolean): Promise<{ data: AuditLegalHold[] }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/legal-holds', { params: active === undefined ? {} : { active: String(active) } })
  return data
}

export async function createLegalHold(input: {
  module?: string
  entityType?: string
  entityId?: string
  caseRef: string
  reason: string
  expiresAt?: string
}): Promise<{ data: { id: string } }> {
  const { data } = await apiClient.post('/api/admin/audit-logs/legal-holds', input)
  return data
}

export async function releaseLegalHold(id: string): Promise<{ data: { released: boolean } }> {
  const { data } = await apiClient.delete(`/api/admin/audit-logs/legal-holds/${id}`)
  return data
}

// ─── Saved searches ───────────────────────────────────────────────

export async function getSavedSearches(): Promise<{ data: AuditSavedSearch[] }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/saved-searches')
  return data
}

export async function createSavedSearch(input: { name: string; filters?: Record<string, any>; isGlobal?: boolean }): Promise<{ data: { id: string } }> {
  const { data } = await apiClient.post('/api/admin/audit-logs/saved-searches', input)
  return data
}

export async function deleteSavedSearch(id: string): Promise<{ data: { deleted: boolean } }> {
  const { data } = await apiClient.delete(`/api/admin/audit-logs/saved-searches/${id}`)
  return data
}

// ─── Alerts ───────────────────────────────────────────────────────

export async function getAuditAlerts(params: { page?: number; limit?: number; severity?: string; resolved?: boolean } = {}): Promise<PaginatedResponse<AuditAlert>> {
  const { data } = await apiClient.get('/api/admin/audit-logs/alerts', { params })
  return data
}

export async function getAuditAlertSummary(): Promise<{ data: { unresolved: number; openHigh: number; total: number } }> {
  const { data } = await apiClient.get('/api/admin/audit-logs/alerts/summary')
  return data
}

export async function resolveAuditAlert(id: string): Promise<{ data: { resolved: boolean } }> {
  const { data } = await apiClient.post(`/api/admin/audit-logs/alerts/${id}/resolve`)
  return data
}
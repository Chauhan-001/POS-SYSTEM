/**
 * =============================================================================
 *  adminReports.ts — Admin Reports API Client (Phase 2.10)
 * =============================================================================
 *
 * Platform-wide reporting hub. Every endpoint is mounted on `/api/admin/reports/*`
 * and returns the standard `{ data, meta }` envelope. The client below unwraps
 * the envelope so callers receive the report payload directly.
 */

import apiClient from './client'

export interface ReportQuery {
  period?: string
  from?: string
  to?: string
  forecastSteps?: number
  markup?: number
  thresholdDays?: number
  limit?: number
  useSnapshot?: boolean
}

export type ReportKey =
  | 'growth'
  | 'revenue'
  | 'subscriptions'
  | 'ai-revenue'
  | 'support'
  | 'devices'
  | 'usage'
  | 'owners'
  | 'inactive'
  | 'features'

interface Envelope<T> {
  data: T
  meta?: Record<string, unknown>
}

async function get<T>(path: string, params?: ReportQuery): Promise<T> {
  const res = await apiClient.get<Envelope<T>>(`/api/admin/reports${path}`, { params: params as Record<string, unknown> | undefined })
  return res.data.data
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<Envelope<T>>(`/api/admin/reports${path}`, body)
  return res.data.data
}

// ─── Summary ────────────────────────────────────────────────────────────────

export interface ReportSummary {
  generatedAt: string
  period: string
  growth: Record<string, number>
  revenue: Record<string, number>
  subscriptions: Record<string, number>
  aiRevenue: Record<string, number>
  support: Record<string, number>
  devices: Record<string, number>
  usage: Record<string, number>
}

export const getReportSummary = (query?: ReportQuery) => get<ReportSummary>('/summary', query)

// ─── Individual reports ─────────────────────────────────────────────────────

export const getGrowthReport = (query?: ReportQuery) => get<any>('/growth', query)
export const getRevenueReport = (query?: ReportQuery) => get<any>('/revenue', query)
export const getSubscriptionReport = (query?: ReportQuery) => get<any>('/subscriptions', query)
export const getAiRevenueReport = (query?: ReportQuery) => get<any>('/ai-revenue', query)
export const getSupportReport = (query?: ReportQuery) => get<any>('/support', query)
export const getDeviceReport = (query?: ReportQuery) => get<any>('/devices', query)
export const getUsageReport = (query?: ReportQuery) => get<any>('/usage', query)
export const getOwnerReport = (query?: ReportQuery) => get<any>('/owners', query)
export const getInactiveReport = (query?: ReportQuery) => get<any>('/inactive', query)
export const getFeatureReport = (query?: ReportQuery) => get<any>('/features', query)

// ─── Exports & snapshots ────────────────────────────────────────────────────

export interface ExportJob {
  id: string
  reportKey: ReportKey
  format: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  fileName?: string
  fileSize?: number
  rowCount?: number
  error?: string
  createdAt: string
  completedAt?: string
}

export interface CreateExportInput {
  reportKey: ReportKey
  format: 'csv' | 'json' | 'xlsx' | 'pdf'
  query?: ReportQuery
  password?: string
}

export const createReportExport = (input: CreateExportInput) => post<ExportJob>('/exports', input)
export const getExportStatus = (id: string) => get<ExportJob>(`/exports/${id}`)
export const downloadExportUrl = (id: string) => `/api/admin/reports/exports/${id}/download`

export interface SnapshotRow {
  id: string
  kind: string
  period: string
  snapshotDate: string
}

export const listSnapshots = () => get<SnapshotRow[]>('/snapshots')
export const runSnapshots = () => post<{ nightly: boolean; inactive: boolean; at: string }>('/snapshots/run')
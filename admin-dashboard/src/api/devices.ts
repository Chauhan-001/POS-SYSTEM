/**
 * API — Devices
 *
 * Endpoints:
 *   GET   /admin/devices                         → getDevices()
 *   GET   /admin/devices/statistics              → getDeviceStatistics()
 *   POST  /admin/devices/bulk-approve            → bulkApproveDevices()
 *   POST  /admin/devices/bulk-reject             → bulkRejectDevices()
 *   POST  /admin/devices/remove-inactive         → removeInactiveDevices()
 *   POST  /admin/devices/force-logout            → forceLogoutDevices()
 *   GET   /admin/devices/:id                     → getDevice()
 *   POST  /admin/devices/:id/approve             → approveDevice()
 *   POST  /admin/devices/:id/reject              → rejectDevice()
 *   POST  /admin/devices/:id/block               → blockDevice()
 *   POST  /admin/devices/:id/unblock             → unblockDevice()
 *   DELETE /admin/devices/:id                    → removeDevice()
 *   POST  /admin/devices/:id/permanent-delete    → permanentDeleteDevice()
 *   GET   /admin/devices/:id/activity            → getDeviceActivity()
 *   GET   /admin/devices/:id/sessions            → getDeviceSessions()
 *   POST  /admin/devices/:id/sessions/:sessionId/revoke → revokeDeviceSession()
 *   GET   /admin/devices/:id/health              → getDeviceHealth()
 *
 * Used by the Devices management page for paginated listing, approval
 * workflow, block/unblock, removal, sessions, health and statistics.
 */

import apiClient from './client'
import type { Device, DeviceSession, DeviceSessionsResponse, DeviceHealth, DeviceStatistics, PaginatedResponse } from '../types'

// ─── Types ────────────────────────────────────────────────

export interface DeviceFilters {
  page?: number
  limit?: number
  search?: string
  status?: string
  restaurantId?: string
  branchId?: string
  userId?: string
  platform?: string
  os?: string
  pending?: string
  approved?: string
  online?: string
  offline?: string
  deleted?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  createdFrom?: string
  createdTo?: string
  lastActiveFrom?: string
  lastActiveTo?: string
}

export interface DeviceActivityEvent {
  id: string
  event: 'device_registered' | 'device_login' | 'device_blocked' | 'device_unblocked' | 'device_inactive' | 'heartbeat' | 'device_approved' | 'device_rejected' | 'device_removed' | 'device_logout' | 'device_limit_violation' | 'device_offline' | 'device_online' | 'device_session_revoked' | 'device_status_change' | 'device_rename'
  description: string
  metadata?: Record<string, any>
  ipAddress?: string
  timestamp: string
}

export interface DeviceActivityResponse {
  data: DeviceActivityEvent[]
  total: number
  page: number
  limit: number
  totalPages: number
  device: {
    id: string
    deviceName: string
    deviceId: string
  }
}

export interface BulkResult {
  approved?: number
  rejected?: number
  removed?: number
  results: Array<{ id: string; status: string; message: string }>
}

export interface ForceLogoutInput {
  scope: 'current' | 'selected' | 'all' | 'restaurant'
  deviceId?: string
  ids?: string[]
  restaurantId?: string
  reason?: string
}

export async function getDevices(filters: DeviceFilters = {}): Promise<PaginatedResponse<Device>> {
  const { data } = await apiClient.get('/api/admin/devices', { params: filters })
  return data
}

export async function getDevice(id: string): Promise<Device> {
  const { data } = await apiClient.get(`/api/admin/devices/${id}`)
  return data
}

export async function getDeviceStatistics(): Promise<DeviceStatistics> {
  const { data } = await apiClient.get('/api/admin/devices/statistics')
  return data
}

export async function blockDevice(id: string): Promise<void> {
  await apiClient.post(`/api/admin/devices/${id}/block`)
}

export async function unblockDevice(id: string): Promise<void> {
  await apiClient.post(`/api/admin/devices/${id}/unblock`)
}

export async function approveDevice(id: string, note?: string): Promise<Device> {
  const { data } = await apiClient.post(`/api/admin/devices/${id}/approve`, { note })
  return data
}

export async function rejectDevice(id: string, reason?: string): Promise<Device> {
  const { data } = await apiClient.post(`/api/admin/devices/${id}/reject`, { reason })
  return data
}

export async function bulkApproveDevices(ids: string[], note?: string): Promise<BulkResult> {
  const { data } = await apiClient.post('/api/admin/devices/bulk-approve', { ids, note })
  return data
}

export async function bulkRejectDevices(ids: string[], reason?: string): Promise<BulkResult> {
  const { data } = await apiClient.post('/api/admin/devices/bulk-reject', { ids, reason })
  return data
}

export async function removeDevice(id: string, reason?: string): Promise<void> {
  await apiClient.delete(`/api/admin/devices/${id}`, { data: { reason } })
}

export async function permanentDeleteDevice(id: string): Promise<void> {
  await apiClient.post(`/api/admin/devices/${id}/permanent-delete`)
}

export async function removeInactiveDevices(restaurantId?: string): Promise<{ removed: number }> {
  const { data } = await apiClient.post('/api/admin/devices/remove-inactive', { restaurantId })
  return data
}

export async function forceLogoutDevices(input: ForceLogoutInput): Promise<{ message: string; scope: string; revoked: number }> {
  const { data } = await apiClient.post('/api/admin/devices/force-logout', input)
  return data
}

export async function getDeviceActivity(deviceId: string, page: number = 1): Promise<DeviceActivityResponse> {
  const { data } = await apiClient.get(`/api/admin/devices/${deviceId}/activity`, { params: { page, limit: 20 } })
  return data
}

export async function getDeviceSessions(deviceId: string, page: number = 1): Promise<DeviceSessionsResponse> {
  const { data } = await apiClient.get(`/api/admin/devices/${deviceId}/sessions`, { params: { page, limit: 20 } })
  return data
}

export async function revokeDeviceSession(deviceId: string, sessionId: string): Promise<void> {
  await apiClient.post(`/api/admin/devices/${deviceId}/sessions/${sessionId}/revoke`)
}

export async function getDeviceHealth(deviceId: string): Promise<DeviceHealth> {
  const { data } = await apiClient.get(`/api/admin/devices/${deviceId}/health`)
  return data
}

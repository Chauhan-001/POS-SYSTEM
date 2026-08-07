/**
 * API — Restaurant Owners (Phase 2.3)
 *
 * Full owner lifecycle:
 *   GET    /admin/owners                          → list (search/filter/sort/page)
 *   POST   /admin/owners                          → create owner (atomic onboarding)
 *   GET    /admin/owners/:id                      → owner detail
 *   PUT    /admin/owners/:id                      → update profile
 *   DELETE /admin/owners/:id                      → soft delete
 *   POST   /admin/owners/:id/restore              → restore
 *   POST   /admin/owners/:id/permanent-delete     → permanent delete
 *   POST   /admin/owners/:id/suspend|activate     → status
 *   POST   /admin/owners/:id/lock|unlock          → lock / unlock
 *   POST   /admin/owners/:id/reset-password       → secure reset (no plaintext)
 *   GET    /admin/owners/:id/restaurants          → owner restaurants
 *   POST/DELETE /admin/owners/:id/restaurants/:rid → assign / unassign
 *   GET    /admin/owners/:id/sessions             → active sessions
 *   POST   /admin/owners/:id/sessions/:sid/revoke → revoke one
 *   POST   /admin/owners/:id/sessions/revoke-all  → revoke all
 *   GET    /admin/owners/:id/devices              → devices
 *   POST/DELETE /admin/owners/:id/devices/:did[/block|/unblock] → device ops
 *   GET    /admin/owners/:id/login-history        → login history
 *   GET    /admin/owners/:id/profile              → profile
 *   GET    /admin/owners/:id/statistics           → backend stats
 */

import apiClient from './client'
import type {
  Owner, OwnerDetail, OwnerSession, OwnerDevice, OwnerStatistics,
  OwnerLoginHistoryEntry, PaginatedResponse,
} from '../types'

// ─── Types ────────────────────────────────────────────────

export interface OwnerFilters {
  page?: number
  limit?: number
  search?: string
  status?: string
  restaurant?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  createdFrom?: string
  createdTo?: string
  lastLoginFrom?: string
  lastLoginTo?: string
  deleted?: 'true' | 'false'
}

export interface CreateOwnerPayload {
  name: string
  email?: string
  phone?: string
  password?: string
  restaurantIds?: string[]
}

export interface OwnerSessionsResponse {
  sessions: OwnerSession[]
  total: number
}

export async function getOwners(filters: OwnerFilters = {}): Promise<PaginatedResponse<Owner>> {
  const { data } = await apiClient.get('/api/admin/owners', { params: filters })
  return data
}

export async function getOwner(id: string): Promise<OwnerDetail> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}`)
  return data
}

export async function createOwner(payload: CreateOwnerPayload): Promise<OwnerDetail & { tempPassword?: string; userId?: string }> {
  const { data } = await apiClient.post('/api/admin/owners', payload)
  return data
}

export async function updateOwner(id: string, payload: { name?: string; phone?: string; email?: string }): Promise<{ message: string }> {
  const { data } = await apiClient.put(`/api/admin/owners/${id}`, payload)
  return data
}

export async function deleteOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.delete(`/api/admin/owners/${id}`)
  return data
}

export async function restoreOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/restore`)
  return data
}

export async function permanentDeleteOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/permanent-delete`)
  return data
}

export async function suspendOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/suspend`)
  return data
}

export async function activateOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/activate`)
  return data
}

export async function deactivateOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/deactivate`)
  return data
}

export async function lockOwner(id: string, reason?: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/lock`, { reason })
  return data
}

export async function unlockOwner(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/unlock`)
  return data
}

/** Secure reset — the API never returns the plaintext PIN. */
export async function resetOwnerPassword(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/reset-password`)
  return data
}

export async function getOwnerRestaurants(id: string): Promise<Array<{
  id: string
  restaurantId: string
  name: string
  isActive: boolean
  isDeleted: boolean
  branches: number
  devices: number
  plan: string
  subscriptionStatus: string
  createdAt: string | null
}>> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}/restaurants`)
  return data.data
}

export async function assignRestaurant(id: string, restaurantId: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/restaurants/${restaurantId}`)
  return data
}

export async function unassignRestaurant(id: string, restaurantId: string): Promise<{ message: string }> {
  const { data } = await apiClient.delete(`/api/admin/owners/${id}/restaurants/${restaurantId}`)
  return data
}

export async function getOwnerSessions(id: string): Promise<OwnerSessionsResponse> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}/sessions`)
  return data
}

export async function revokeOwnerSession(id: string, sessionId: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/sessions/${sessionId}/revoke`)
  return data
}

export async function revokeAllOwnerSessions(id: string): Promise<{ message: string; revoked: number }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/sessions/revoke-all`)
  return data
}

export async function getOwnerDevices(id: string): Promise<OwnerDevice[]> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}/devices`)
  return data.data
}

export async function blockOwnerDevice(id: string, deviceId: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/devices/${deviceId}/block`)
  return data
}

export async function unblockOwnerDevice(id: string, deviceId: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/owners/${id}/devices/${deviceId}/unblock`)
  return data
}

export async function removeOwnerDevice(id: string, deviceId: string): Promise<{ message: string }> {
  const { data } = await apiClient.delete(`/api/admin/owners/${id}/devices/${deviceId}`)
  return data
}

export async function getOwnerLoginHistory(id: string, params: { page?: number; limit?: number; event?: string } = {}): Promise<PaginatedResponse<OwnerLoginHistoryEntry>> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}/login-history`, { params })
  return data
}

export async function getOwnerStatistics(id: string): Promise<OwnerStatistics> {
  const { data } = await apiClient.get(`/api/admin/owners/${id}/statistics`)
  return data
}

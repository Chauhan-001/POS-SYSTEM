/**
 * =============================================================================
 *  restaurants.ts — Restaurant Management API
 * =============================================================================
 *
 * Endpoints:
 *   GET    /admin/restaurants              → List restaurants (paginated)
 *   GET    /admin/restaurants/:id          → Get restaurant details
 *   POST   /admin/restaurants              → Create restaurant
 *   PUT    /admin/restaurants/:id          → Update restaurant
 *   DELETE /admin/restaurants/:id          → Delete restaurant
 *   POST   /admin/restaurants/:id/suspend  → Suspend restaurant
 *   POST   /admin/restaurants/:id/activate → Activate restaurant
 *   POST   /admin/restaurants/:id/branches → Create branch for restaurant
 */

import apiClient from './client'
import type { Restaurant, PaginatedResponse } from '../types'

// ─── Admin Notes ─────────────────────────────────────────────────

export async function addAdminNote(restaurantId: string, note: string): Promise<{ message: string; adminNotes: any[] }> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${restaurantId}/notes`, { note })
  return data
}

// ─── Types ───────────────────────────────────────────────────────

export interface RestaurantFilters {
  page?: number
  limit?: number
  search?: string
  owner?: string
  status?: string
  plan?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  createdFrom?: string
  createdTo?: string
  lastActiveFrom?: string
  deleted?: 'true' | 'false'
}

export async function getRestaurants(filters: RestaurantFilters = {}): Promise<PaginatedResponse<Restaurant>> {
  const { data } = await apiClient.get('/api/admin/restaurants', { params: filters })
  return data
}

export async function getRestaurant(id: string): Promise<Restaurant> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${id}`)
  return data
}

export async function createRestaurant(payload: Partial<Restaurant>): Promise<Restaurant> {
  const { data } = await apiClient.post('/api/admin/restaurants', payload)
  return data
}

export async function updateRestaurant(id: string, payload: Partial<Restaurant>): Promise<Restaurant> {
  const { data } = await apiClient.put(`/api/admin/restaurants/${id}`, payload)
  return data
}

export async function deleteRestaurant(id: string): Promise<void> {
  await apiClient.delete(`/api/admin/restaurants/${id}`)
}

export async function restoreRestaurant(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/restore`)
  return data
}

export async function permanentDeleteRestaurant(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/permanent-delete`)
  return data
}

export async function suspendRestaurant(id: string): Promise<void> {
  await apiClient.post(`/api/admin/restaurants/${id}/suspend`)
}

export async function activateRestaurant(id: string): Promise<void> {
  await apiClient.post(`/api/admin/restaurants/${id}/activate`)
}

export async function resetRestaurantPassword(id: string): Promise<{ message: string; ownerUserId?: string }> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/reset-password`)
  return data
}

export async function regenerateRestaurantCredentials(id: string): Promise<{ message: string; secretKey: string; apiKey: string }> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/regenerate-credentials`)
  return data
}

export interface StorageMetrics {
  usedBytes: number
  usedMB: number
  logoSizeBytes: number
  coverSizeBytes: number
  imageCount: number
  documentCount: number
  totalFiles: number
  quotaBytes: number | null
  quotaMB: number
  isUnlimited: boolean
  remainingBytes: number | null
  remainingMB: number | null
  usagePercent: number
}

export interface RestaurantStatistics {
  id: string
  restaurantId: string
  name: string
  logoUrl?: string | null
  coverImageUrl?: string | null
  storage: StorageMetrics
  plan: string
  subscriptionStatus: string
  subscription: { plan: string; status: string; expiryDate: string | null; graceEnd: string | null } | null
  branches: number
  branchStats: { total: number; active: number; headBranches: number; inactive: number }
  devices: { total: number; active: number; offline: number; blocked: number; limit: number }
  usage: {
    employees: number
    products: number
    customers: number
    loyaltyMembers: number
    bills: number
    revenue: number
    aiRequests: number
    voiceRequests: number
  }
  activity: {
    totalEvents: number
    logins: number
    lastActive: string | null
    recent: { id: string; event: string; description: string; metadata?: any; ipAddress?: string; createdAt: string | null }[]
  }
}

export async function getRestaurantStatistics(id: string): Promise<RestaurantStatistics> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${id}/statistics`)
  return data
}

// ─── Media (logo / cover) & storage metrics ──────────────────────

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3002').replace(/\/$/, '')

/**
 * Resolve a media URL returned by the backend into a directly loadable URL.
 * Backend responses already carry absolute URLs when a public base is
 * configured or the origin is derivable; this is a safety net for relative
 * paths (dev setups without PUBLIC_BASE_URL).
 */
export function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//.test(url)) return url
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`
  return url
}

export type RestaurantMediaKind = 'logo' | 'cover'

export interface MediaUploadResponse {
  message: string
  kind: RestaurantMediaKind
  url: string
  media: {
    key: string
    size: number
    mimetype: string
    originalName: string
    uploadedBy: string
    uploadedAt: string
  }
}

export async function uploadRestaurantImage(id: string, kind: RestaurantMediaKind, file: File): Promise<MediaUploadResponse> {
  const form = new FormData()
  form.append('file', file)
  // NOTE: do NOT set Content-Type manually — the browser must attach the
  // multipart boundary itself, otherwise multer fails to parse the upload.
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/media/${kind}`, form)
  return data
}

export async function deleteRestaurantImage(id: string, kind: RestaurantMediaKind): Promise<{ message: string; removed: string }> {
  const { data } = await apiClient.delete(`/api/admin/restaurants/${id}/media/${kind}`)
  return data
}

export async function getRestaurantStorage(id: string): Promise<StorageMetrics> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${id}/media/storage`)
  return data
}

export async function createRestaurantBranch(id: string, payload: { name: string; address?: string; phone?: string; isHeadBranch?: boolean }): Promise<any> {
  const { data } = await apiClient.post(`/api/admin/restaurants/${id}/branches`, payload)
  return data
}

export interface DeviceActivitySummary {
  totalEvents: number
  last24h: number
  last7d: number
  uniqueDevices: number
  eventBreakdown: { event: string; count: number }[]
}

export async function getRestaurantDeviceActivitySummary(id: string): Promise<DeviceActivitySummary> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${id}/device-activity-summary`)
  return data
}

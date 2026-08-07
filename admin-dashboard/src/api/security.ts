/**
 * API — Security (IP Blocklist)
 *
 * Endpoints:
 *   GET    /admin/security/blocked-ips            → getBlockedIps()
 *   POST   /admin/security/blocked-ips            → blockIp()
 *   DELETE /admin/security/blocked-ips/:id        → unblockIp()
 *   GET    /admin/security/blocked-ips/suggested  → getSuggestedBlockedIps()
 *
 * Used by the Security page for manual attack response: list every blocked
 * IP/range, block an attacker (permanent or for N hours), unblock, and one-click
 * block of top failed-login sources.
 */

import apiClient from './client'

export interface BlockedIpEntry {
  id: string
  ip: string
  reason: string
  blockedBy: string
  blockedById?: string | null
  permanent: boolean
  expiresAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface BlockedIpListResponse {
  data: BlockedIpEntry[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface SuggestedBlockedIp {
  ip: string
  count: number
  lastSeen: string | null
  usernames: string[]
}

export interface BlockIpInput {
  ip: string
  reason?: string
  /** Duration in hours; 0 or omitted = permanent. */
  hours?: number
}

export async function getBlockedIps(params: {
  page?: number
  limit?: number
  search?: string
  status?: 'active' | 'expired'
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
} = {}): Promise<BlockedIpListResponse> {
  const { data } = await apiClient.get('/api/admin/security/blocked-ips', { params })
  return data
}

export async function blockIp(input: BlockIpInput): Promise<{ message: string; blockedIp: BlockedIpEntry }> {
  const { data } = await apiClient.post('/api/admin/security/blocked-ips', input)
  return data
}

export async function unblockIp(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.delete(`/api/admin/security/blocked-ips/${id}`)
  return data
}

export async function getSuggestedBlockedIps(): Promise<{ suggestions: SuggestedBlockedIp[] }> {
  const { data } = await apiClient.get('/api/admin/security/blocked-ips/suggested')
  return data
}

/**
 * =============================================================================
 *  auth.ts — Admin Dashboard Authentication API
 * =============================================================================
 *
 * Endpoints:
 *   POST /auth/admin/login          → Login with userId + password
 *   GET  /auth/admin/profile        → Get current admin profile
 *   PUT  /auth/admin/change-password → Change admin password
 *   PUT  /auth/admin/profile        → Update admin name/avatar
 *
 * All calls go through the Axios client (client.ts) which handles
 * JWT token attachment and 401 redirects automatically.
 */

import apiClient from './client'
import type { LoginCredentials, AuthResponse, User } from '../types'

// ─── Login ───────────────────────────────────────────────────────

export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const { data } = await apiClient.post('/api/auth/admin/login', credentials)
  return data
}

// ─── Profile ─────────────────────────────────────────────────────

export async function getProfile(): Promise<User> {
  const { data } = await apiClient.get('/api/auth/admin/profile')
  return data
}

// ─── Password ────────────────────────────────────────────────────

export async function changePassword(payload: { currentPassword: string; newPassword: string }): Promise<void> {
  await apiClient.put('/api/auth/admin/change-password', payload)
}

// ─── Update Profile ──────────────────────────────────────────────

export async function updateProfile(payload: { name?: string; avatar?: string }): Promise<User> {
  const { data } = await apiClient.put('/api/auth/admin/profile', payload)
  return data
}

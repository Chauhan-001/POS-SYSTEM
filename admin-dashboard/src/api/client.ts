/**
 * =============================================================================
 *  client.ts — Axios HTTP Client
 * =============================================================================
 *
 * Purpose:
 *   Configured Axios instance for all Admin Dashboard API calls.
 *   Base URL is set via VITE_API_URL env var (default: localhost:3002).
 *
 * Interceptors:
 *   Request:  Attaches Bearer JWT token from localStorage/sessionStorage
 *   Response: On 401 → clears auth data + redirects to /login
 *
 * Usage:
 *   import apiClient from './client'
 *   const { data } = await apiClient.get('/admin/restaurants')
 */

import axios from 'axios'

// ─── Axios Instance ─────────────────────────────────────────────

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3002',
  headers: {
    'Content-Type': 'application/json',
  },
})

// ─── Request Interceptor: Attach JWT Token ──────────────────────

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── Response Interceptor: Handle 401 ───────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      sessionStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export default apiClient

/**
 * API — Analytics & Dashboard
 *
 * Endpoints:
 *   GET  /admin/analytics/dashboard         → getDashboardStats()
 *   GET  /admin/analytics                    → getAnalytics()
 *   GET  /admin/analytics/recent-activity    → getRecentActivity()
 *   GET  /admin/analytics/latest-restaurants → getLatestRestaurants()
 */

import apiClient from './client'
import type { DashboardStats, AnalyticsData } from '../types'

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data } = await apiClient.get('/api/admin/analytics/dashboard')
  return data
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const { data } = await apiClient.get('/api/admin/analytics')
  return data
}

export async function getRecentActivity(): Promise<{ id: string; action: string; timestamp: string; details: string }[]> {
  const { data } = await apiClient.get('/api/admin/analytics/recent-activity')
  return data
}

export async function getLatestRestaurants(): Promise<{ id: string; name: string; createdAt: string; status: string }[]> {
  const { data } = await apiClient.get('/api/admin/analytics/latest-restaurants')
  return data
}

export interface SubscriptionRevenue {
  total: { revenue: number; count: number }
  cash: { revenue: number; count: number; percentage: number }
  razorpay: { revenue: number; count: number; percentage: number }
  monthly: Array<{ month: string; cash: number; razorpay: number; cashCount: number; razorpayCount: number; total: number }>
  recent: Array<{ id: string; invoiceNumber: string; amount: number; gateway: string; paymentMethod: string; createdAt: string }>
}

export async function getSubscriptionRevenue(filters?: { startDate?: string; endDate?: string }): Promise<SubscriptionRevenue> {
  const { data } = await apiClient.get('/api/admin/analytics/subscription-revenue', { params: filters })
  return data
}

// ─── Phase 2.6 New Analytics Endpoints ───────────────────────

export async function getAIAnalytics(days?: number): Promise<any> {
  const params = days ? { days } : {}
  const { data } = await apiClient.get('/api/admin/analytics/ai', { params })
  return data
}

export async function getDeviceAnalytics(): Promise<any> {
  const { data } = await apiClient.get('/api/admin/analytics/devices')
  return data
}

export async function getGrowthMetrics(): Promise<any> {
  const { data } = await apiClient.get('/api/admin/analytics/growth')
  return data
}

export async function getChurnMetrics(): Promise<any> {
  const { data } = await apiClient.get('/api/admin/analytics/churn')
  return data
}

export async function getActivityMetrics(): Promise<any> {
  const { data } = await apiClient.get('/api/admin/analytics/activity')
  return data
}

export async function getApiRequestAnalytics(days?: number): Promise<any> {
  const params = days ? { days } : {}
  const { data } = await apiClient.get('/api/admin/analytics/api-requests', { params })
  return data
}

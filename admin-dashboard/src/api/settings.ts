/**
 * API — System Settings
 *
 * Endpoints organized by settings category:
 *   Company:
 *     GET|PUT  /admin/settings/company
 *   Default Subscription:
 *     GET|PUT  /admin/settings/default-subscription
 *   AI:
 *     GET|PUT  /admin/settings/ai
 *   General:
 *     GET|PUT  /admin/settings/general
 */

import apiClient from './client'

// ─── Types ────────────────────────────────────────────────

export interface CompanySettings {
  name: string
  email: string
  phone: string
  address: string
  logo?: string
}

export interface DefaultSubscriptionSettings {
  plan: string
  maxDevices: number
  aiEnabled: boolean
  trialDays: number
}

export interface AISettings {
  enabled: boolean
  maxRequestsPerDay: number
  model: string
  apiKey?: string
}

export interface GeneralSettings {
  allowRegistration: boolean
  maintenanceMode: boolean
  timezone: string
  language: string
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const { data } = await apiClient.get('/api/admin/settings/company')
  return data
}

export async function updateCompanySettings(payload: Partial<CompanySettings>): Promise<CompanySettings> {
  const { data } = await apiClient.put('/api/admin/settings/company', payload)
  return data
}

export async function getDefaultSubscriptionSettings(): Promise<DefaultSubscriptionSettings> {
  const { data } = await apiClient.get('/api/admin/settings/default-subscription')
  return data
}

export async function updateDefaultSubscriptionSettings(payload: Partial<DefaultSubscriptionSettings>): Promise<DefaultSubscriptionSettings> {
  const { data } = await apiClient.put('/api/admin/settings/default-subscription', payload)
  return data
}

export async function getAISettings(): Promise<AISettings> {
  const { data } = await apiClient.get('/api/admin/settings/ai')
  return data
}

export async function updateAISettings(payload: Partial<AISettings>): Promise<AISettings> {
  const { data } = await apiClient.put('/api/admin/settings/ai', payload)
  return data
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const { data } = await apiClient.get('/api/admin/settings/general')
  return data
}

export async function updateGeneralSettings(payload: Partial<GeneralSettings>): Promise<GeneralSettings> {
  const { data } = await apiClient.put('/api/admin/settings/general', payload)
  return data
}

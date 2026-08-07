/**
 * =============================================================================
 *  voiceInventory.ts — Admin API client for Voice Inventory features
 * =============================================================================
 *
 * Provides typed functions for all Voice Inventory admin endpoints.
 * Uses the shared apiClient (Axios with JWT auth interceptor).
 */

import apiClient from './client'
import type { AxiosResponse } from 'axios'

// ─── Type Definitions ────────────────────────────────────────────

export interface ProductAliasSummary {
  _id: string
  name: string
  code: string
  category: string
  unit: string
  voiceAliases: string[]
  searchAliases: string[]
  learnedAliases: LearnedAliasEntry[]
  aliasUsageCount: number
  lastUsedAlias: string | null
}

export interface LearnedAliasEntry {
  alias: string
  source: 'transcript' | 'correction' | 'ai_generated'
  usageCount: number
  lastUsed: string
  approved?: boolean
}

export interface VoiceAuditLogEntry {
  _id: string
  restaurantId: string
  employeeName: string
  intent: string
  transcript: string
  confidence: number
  confirmationStatus: string
  items: Array<{ name: string; quantity: number; unit: string }>
  matchingMethod?: string
  pipelineCandidates?: Array<{
    productId: string
    productName: string
    stage: string
    confidence: number
  }>
  latencyMs: number
  createdAt: string
}

export interface AliasGenerationResult {
  productId: string
  allAliases: string[]
  voiceAliases: string[]
  searchAliases: string[]
}

export interface ProductSuggestion {
  suggestedName: string
  suggestedCategory: string
  confidence: number
  voiceAliases: string[]
  searchAliases: string[]
  enrichment: 'llm' | 'heuristic' | 'none'
}

export interface ProductResolutionResult {
  product: {
    _id: string
    name: string
    code: string
    category: string
    unit: string
  } | null
  confidence: number
  stage: string
  method: string
  candidates: Array<{
    product: { _id: string; name: string }
    confidence: number
    stage: string
  }>
  newProductSuggestion?: ProductSuggestion
}

// ─── API Functions ───────────────────────────────────────────────

/**
 * GET /api/voice-inventory/product-aliases
 * List all products with their voice/search aliases.
 */
export async function listProductAliases(params?: {
  search?: string
  page?: number
  limit?: number
}): Promise<{ data: ProductAliasSummary[]; total: number; page: number; limit: number }> {
  const { data } = await apiClient.get('/api/voice-inventory/product-aliases', { params })
  return data
}

/**
 * PUT /api/voice-inventory/product-aliases/:id
 * Update a product's voice/search aliases.
 */
export async function updateProductAliases(
  id: string,
  payload: {
    voiceAliases?: string[]
    searchAliases?: string[]
    learnedAliases?: LearnedAliasEntry[]
  },
): Promise<ProductAliasSummary> {
  const { data } = await apiClient.put(`/api/voice-inventory/product-aliases/${id}`, payload)
  return data.data
}

/**
 * POST /api/voice-inventory/resolve
 * Resolve a spoken item through the Product Resolution Engine.
 */
export async function resolveProduct(
  transcript: string,
  restaurantId?: string,
): Promise<ProductResolutionResult> {
  const { data } = await apiClient.post('/api/voice-inventory/resolve', { transcript, restaurantId })
  return data.data
}

/**
 * POST /api/voice-inventory/learn
 * Record a manual correction for self-learning.
 */
export async function learnCorrection(
  spokenName: string,
  productId: string,
  source: 'confirmation_override' | 'product_picker' | 'admin_edit' = 'confirmation_override',
): Promise<boolean> {
  const { data } = await apiClient.post('/api/voice-inventory/learn', { spokenName, productId, source })
  return data.success
}

/**
 * POST /api/voice-inventory/generate-aliases
 * On-demand AI alias generation for a product.
 */
export async function generateProductAliases(
  productId: string,
  productName: string,
  category?: string,
  brand?: string,
  existingAliases?: string[],
): Promise<AliasGenerationResult | null> {
  const { data } = await apiClient.post('/api/voice-inventory/generate-aliases', {
    productId,
    productName,
    category,
    brand,
    existingAliases,
  })
  return data.data
}

/**
 * POST /api/voice-inventory/suggest-product
 * AI-powered new product suggestion.
 */
export async function suggestProduct(
  spokenName: string,
  transcript: string,
  existingCategories: string[] = [],
): Promise<ProductSuggestion> {
  const { data } = await apiClient.post('/api/voice-inventory/suggest-product', {
    spokenName,
    transcript,
    existingCategories,
  })
  return data.data
}

/**
 * GET /api/voice-inventory/history
 * Query voice action history.
 */
export async function getVoiceHistory(params?: {
  limit?: number
  offset?: number
  intent?: string
  status?: string
  from?: string
  to?: string
}): Promise<{ data: VoiceAuditLogEntry[]; total: number }> {
  const { data } = await apiClient.get('/api/voice-inventory/history', { params })
  return data
}

/**
 * GET /api/voice-inventory/aliases
 * List all ItemAlias entries for the current restaurant.
 */
export async function listItemAliases(): Promise<any[]> {
  const { data } = await apiClient.get('/api/voice-inventory/aliases')
  return data.data
}

/**
 * POST /api/voice-inventory/aliases
 * Create or update an ItemAlias entry.
 */
export async function createItemAlias(
  canonicalName: string,
  aliases: string[],
  unit?: string,
): Promise<any> {
  const { data } = await apiClient.post('/api/voice-inventory/aliases', { canonicalName, aliases, unit })
  return data.data
}

/**
 * DELETE /api/voice-inventory/aliases/:id
 * Soft-delete an ItemAlias entry.
 */
export async function deleteItemAlias(id: string): Promise<void> {
  await apiClient.delete(`/api/voice-inventory/aliases/${id}`)
}


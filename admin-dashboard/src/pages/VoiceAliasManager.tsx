/**
 * =============================================================================
 *  VoiceAliasManager.tsx — Admin UI for Voice/Search Alias Management
 * =============================================================================
 *
 * Features:
 *   - View all product aliases (voiceAliases + searchAliases + learnedAliases)
 *   - Edit aliases inline
 *   - Delete individual aliases
 *   - Approve AI-generated aliases (promote learned → voiceAliases)
 *   - Regenerate aliases via AI on demand
 *   - Search/filter products
 *   - Merge duplicate aliases
 *
 * Designed for restaurant owners who speak Hindi/Hinglish/English.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  listProductAliases,
  updateProductAliases,
  generateProductAliases,
  type ProductAliasSummary,
  type LearnedAliasEntry,
} from '../api/voiceInventory'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'

// =============================================================================
// Types
// =============================================================================

interface AliasEditState {
  productId: string
  field: 'voiceAliases' | 'searchAliases'
  index: number
  value: string
}

// =============================================================================
// Constants
// =============================================================================

const ALIAS_SOURCE_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  ai_generated: 'info',
  transcript: 'success',
  correction: 'warning',
  manual: 'neutral',
}

// =============================================================================
// Component
// =============================================================================

export default function VoiceAliasManager() {
  const [products, setProducts] = useState<ProductAliasSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<AliasEditState | null>(null)
  const [approveModal, setApproveModal] = useState<{
    product: ProductAliasSummary
    alias: LearnedAliasEntry
  } | null>(null)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const LIMIT = 20

  // ─── Data Fetching ─────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listProductAliases({ search: search || undefined, page, limit: LIMIT })
      setProducts(result.data)
      setTotal(result.total)
    } catch (err: any) {
      showNotification('error', 'Failed to load products: ' + (err.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [search, page])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  // ─── Notifications ─────────────────────────────────────────────

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }

  // ─── Save Aliases ──────────────────────────────────────────────

  const handleSaveAliases = async (product: ProductAliasSummary) => {
    setSavingId(product._id)
    try {
      await updateProductAliases(product._id, {
        voiceAliases: product.voiceAliases,
        searchAliases: product.searchAliases,
      })
      showNotification('success', `Aliases saved for "${product.name}"`)
    } catch (err: any) {
      showNotification('error', 'Failed to save aliases: ' + (err.message || 'Unknown error'))
    } finally {
      setSavingId(null)
    }
  }

  // ─── Approve Learned Alias ─────────────────────────────────────

  const handleApproveAlias = async () => {
    if (!approveModal) return
    const { product, alias } = approveModal
    setSavingId(product._id)

    try {
      const updatedLearned = product.learnedAliases.map((l) =>
        l.alias === alias.alias ? { ...l, approved: true } : l,
      )
      const result = await updateProductAliases(product._id, {
        learnedAliases: updatedLearned,
      })
      setProducts((prev) =>
        prev.map((p) => (p._id === product._id ? { ...p, ...result } : p)),
      )
      showNotification('success', `Approved "${alias.alias}" for "${product.name}"`)
      setApproveModal(null)
    } catch (err: any) {
      showNotification('error', 'Failed to approve alias: ' + (err.message || 'Unknown error'))
    } finally {
      setSavingId(null)
    }
  }

  // ─── Regenerate Aliases via AI ─────────────────────────────────

  const handleRegenerateAliases = async (product: ProductAliasSummary) => {
    setGeneratingId(product._id)
    try {
      const result = await generateProductAliases(
        product._id,
        product.name,
        product.category,
        undefined,
        product.voiceAliases,
      )
      if (result) {
        setProducts((prev) =>
          prev.map((p) =>
            p._id === product._id
              ? {
                  ...p,
                  voiceAliases: result.voiceAliases,
                  searchAliases: result.searchAliases,
                }
              : p,
          ),
        )
        showNotification('success', `Generated ${result.allAliases.length} new aliases for "${product.name}"`)
      }
    } catch (err: any) {
      showNotification('error', 'Failed to generate aliases: ' + (err.message || 'Unknown error'))
    } finally {
      setGeneratingId(null)
    }
  }

  // ─── Delete Alias ──────────────────────────────────────────────

  const handleDeleteAlias = async (product: ProductAliasSummary, field: 'voiceAliases' | 'searchAliases', index: number) => {
    setSavingId(product._id)
    try {
      const updated = [...product[field]]
      updated.splice(index, 1)
      const result = await updateProductAliases(product._id, {
        [field]: updated,
      })
      setProducts((prev) =>
        prev.map((p) => (p._id === product._id ? { ...p, ...result } : p)),
      )
      showNotification('success', 'Alias deleted')
    } catch (err: any) {
      showNotification('error', 'Failed to delete alias: ' + (err.message || 'Unknown error'))
    } finally {
      setSavingId(null)
    }
  }

  // ─── Update Alias Inline ───────────────────────────────────────

  const handleInlineUpdate = async () => {
    if (!editState) return
    setSavingId(editState.productId)
    try {
      const product = products.find((p) => p._id === editState.productId)
      if (!product) return
      const updated = [...product[editState.field]]
      updated[editState.index] = editState.value
      const result = await updateProductAliases(editState.productId, {
        [editState.field]: updated,
      })
      setProducts((prev) =>
        prev.map((p) => (p._id === editState.productId ? { ...p, ...result } : p)),
      )
      setEditState(null)
      showNotification('success', 'Alias updated')
    } catch (err: any) {
      showNotification('error', 'Failed to update alias: ' + (err.message || 'Unknown error'))
    } finally {
      setSavingId(null)
    }
  }

  // ─── Toggle Details ────────────────────────────────────────────

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // ─── Badge helper ──────────────────────────────────────────────

  const getBadgeVariant = (source: string): 'info' | 'success' | 'warning' | 'neutral' => {
    return ALIAS_SOURCE_VARIANT[source] || 'neutral'
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Voice Alias Manager</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage multilingual voice and search aliases for all products. Aliases let staff use natural
            speech in Hindi, Hinglish, or English.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">{total} products</Badge>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={cn(
            'rounded-md px-4 py-3 text-sm font-medium',
            notification.type === 'success'
              ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300',
          )}
        >
          {notification.message}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            placeholder="Search by product name, alias, or category..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          title="No products found"
          description={search ? 'Try a different search term.' : 'No products with aliases configured yet.'}
        />
      ) : (
        <div className="space-y-4">
          {products.map((product) => (
            <div
              key={product._id}
              className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              {/* Product Header */}
              <div
                className="flex cursor-pointer items-center justify-between px-4 py-3"
                onClick={() => toggleExpand(product._id)}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{product.name}</span>
                    <span className="ml-2 text-sm text-gray-500">({product.code})</span>
                  </div>
                  <Badge variant="neutral">{product.category}</Badge>
                  <Badge variant="info">{product.unit}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {product.aliasUsageCount || 0} uses
                  </span>
                  <svg
                    className={cn(
                      'h-5 w-5 text-gray-400 transition-transform',
                      expandedId === product._id && 'rotate-180',
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedId === product._id && (
                <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-700">
                  {/* Voice Aliases */}
                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Voice Aliases{' '}
                        <span className="text-xs font-normal text-gray-400">(spoken names)</span>
                      </h3>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRegenerateAliases(product)}
                          disabled={generatingId === product._id}
                        >
                          {generatingId === product._id ? 'Generating...' : 'Regenerate AI'}
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleSaveAliases(product)}
                          disabled={savingId === product._id}
                        >
                          {savingId === product._id ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {product.voiceAliases.length > 0 ? (
                        product.voiceAliases.map((alias, i) => (
                          <div key={i} className="group relative">
                            <Badge
                              variant="success"
                              className={cn(
                                'cursor-pointer transition-all hover:ring-2 hover:ring-green-300',
                                editState?.productId === product._id &&
                                  editState?.field === 'voiceAliases' &&
                                  editState?.index === i &&
                                  'ring-2 ring-blue-400',
                              )}
                            >
                              {editState?.productId === product._id &&
                              editState?.field === 'voiceAliases' &&
                              editState?.index === i ? (
                                <input
                                  className="w-24 bg-transparent text-sm outline-none"
                                  value={editState.value}
                                  onChange={(e) =>
                                    setEditState({ ...editState, value: e.target.value })
                                  }
                                  onBlur={handleInlineUpdate}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleInlineUpdate()
                                    if (e.key === 'Escape') setEditState(null)
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <span
                                  onClick={() =>
                                    setEditState({
                                      productId: product._id,
                                      field: 'voiceAliases',
                                      index: i,
                                      value: alias,
                                    })
                                  }
                                >
                                  {alias}
                                </span>
                              )}
                            </Badge>
                            <button
                              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white group-hover:flex"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteAlias(product, 'voiceAliases', i)
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="text-sm text-gray-400 italic">No voice aliases</span>
                      )}
                    </div>
                  </div>

                  {/* Search Aliases */}
                  <div className="mb-4">
                    <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Search Aliases{' '}
                      <span className="text-xs font-normal text-gray-400">(text search)</span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {product.searchAliases.length > 0 ? (
                        product.searchAliases.map((alias, i) => (
                          <div key={i} className="group relative">
                            <Badge
                              variant="info"
                              className={cn(
                                'cursor-pointer transition-all hover:ring-2 hover:ring-blue-300',
                                editState?.productId === product._id &&
                                  editState?.field === 'searchAliases' &&
                                  editState?.index === i &&
                                  'ring-2 ring-blue-400',
                              )}
                            >
                              {editState?.productId === product._id &&
                              editState?.field === 'searchAliases' &&
                              editState?.index === i ? (
                                <input
                                  className="w-24 bg-transparent text-sm outline-none"
                                  value={editState.value}
                                  onChange={(e) =>
                                    setEditState({ ...editState, value: e.target.value })
                                  }
                                  onBlur={handleInlineUpdate}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleInlineUpdate()
                                    if (e.key === 'Escape') setEditState(null)
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <span
                                  onClick={() =>
                                    setEditState({
                                      productId: product._id,
                                      field: 'searchAliases',
                                      index: i,
                                      value: alias,
                                    })
                                  }
                                >
                                  {alias}
                                </span>
                              )}
                            </Badge>
                            <button
                              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white group-hover:flex"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteAlias(product, 'searchAliases', i)
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="text-sm text-gray-400 italic">No search aliases</span>
                      )}
                    </div>
                  </div>

                  {/* Learned Aliases */}
                  {product.learnedAliases && product.learnedAliases.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Learned Aliases{' '}
                        <span className="text-xs font-normal text-gray-400">
                          (from staff corrections — approve to promote)
                        </span>
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {product.learnedAliases.map((entry, i) => (
                          <div key={i} className="group relative">
                            <Badge variant={getBadgeVariant(entry.source)} className="cursor-pointer">
                              {entry.alias}
                              <span className="ml-1 text-xs opacity-60">
                                ({entry.source === 'ai_generated' ? 'AI' : entry.source === 'transcript' ? 'voice' : 'correction'})
                              </span>
                              {!entry.approved && (
                                <button
                                  className="ml-1 text-xs underline hover:text-green-600"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setApproveModal({ product, alias: entry })
                                  }}
                                >
                                  approve
                                </button>
                              )}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page * LIMIT >= total} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      <Modal
        open={!!approveModal}
        onClose={() => setApproveModal(null)}
        title="Approve Learned Alias"
      >
        {approveModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Promote <strong className="text-gray-900 dark:text-white">"{approveModal.alias.alias}"</strong>{' '}
              to become a voice alias for{' '}
              <strong className="text-gray-900 dark:text-white">{approveModal.product.name}</strong>?
            </p>
            <p className="text-xs text-gray-400">
              Source: {approveModal.alias.source} | Used {approveModal.alias.usageCount} times
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleApproveAlias}
                disabled={savingId === approveModal.product._id}
              >
                {savingId === approveModal.product._id ? 'Approving...' : 'Approve'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}


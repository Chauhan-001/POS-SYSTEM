/**
 * =============================================================================
 *  VoiceInventoryDashboard.tsx — Admin Dashboard for Voice Inventory
 * =============================================================================
 *
 * Displays voice usage analytics, recent voice actions, and matching accuracy.
 *
 * Features:
 *   - Voice action history with filters (intent, status, date range)
 *   - Matching method breakdown chart
 *   - Confidence trend over time
 *   - Recent voice actions list
 *   - Overall accuracy metrics
 *   - Per-product alias usage stats
 */

import React, { useState, useEffect, useCallback } from 'react'
import { getVoiceHistory, type VoiceAuditLogEntry } from '../api/voiceInventory'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'

// =============================================================================
// Types
// =============================================================================

interface MatchingStats {
  method: string
  count: number
  percentage: number
}

type GroupByMethod = Record<string, number>

// =============================================================================
// Constants
// =============================================================================

const INTENT_LABELS: Record<string, string> = {
  inventory_add: 'Add Stock',
  inventory_remove: 'Remove Stock',
  inventory_adjust: 'Adjust Stock',
  inventory_waste: 'Log Waste',
  purchase_reminder: 'Purchase Reminder',
  supplier_update: 'Supplier Update',
  unknown: 'Unknown',
}

const INTENT_COLORS: Record<string, string> = {
  inventory_add: 'bg-green-500',
  inventory_remove: 'bg-red-500',
  inventory_adjust: 'bg-blue-500',
  inventory_waste: 'bg-yellow-500',
  purchase_reminder: 'bg-purple-500',
  unknown: 'bg-gray-400',
}

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  confirmed: 'success',
  pending: 'warning',
  rejected: 'danger',
  clarified: 'info',
}

const METHOD_COLORS: Record<string, string> = {
  exact: 'bg-green-500',
  voiceAlias: 'bg-blue-500',
  searchAlias: 'bg-cyan-500',
  sku: 'bg-purple-500',
  barcode: 'bg-pink-500',
  fuzzy: 'bg-yellow-500',
  semantic: 'bg-orange-500',
}

// =============================================================================
// Component
// =============================================================================

export default function VoiceInventoryDashboard() {
  const [logs, setLogs] = useState<VoiceAuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterIntent, setFilterIntent] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState<MatchingStats[]>([])

  const LIMIT = 20

  // ─── Fetch History ─────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getVoiceHistory({
        limit: LIMIT,
        offset: (page - 1) * LIMIT,
        intent: filterIntent || undefined,
        status: filterStatus || undefined,
      })
      setLogs(result.data)
      setTotal(result.total)
      computeStats(result.data)
    } catch (err) {
      console.error('[VoiceInventoryDashboard] Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }, [page, filterIntent, filterStatus])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // ─── Compute Stats ─────────────────────────────────────────────

  const computeStats = (entries: VoiceAuditLogEntry[]) => {
    const groupedByMethod: GroupByMethod = {}
    const totalEntries = entries.length

    for (const entry of entries) {
      const method = entry.matchingMethod || 'unknown'
      groupedByMethod[method] = (groupedByMethod[method] || 0) + 1
    }

    const methodStats: MatchingStats[] = Object.entries(groupedByMethod)
      .map(([method, count]) => ({
        method,
        count,
        percentage: totalEntries > 0 ? Math.round((count / totalEntries) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    setStats(methodStats)
  }

  // ─── Format Date ───────────────────────────────────────────────

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Voice Inventory Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor voice inventory usage, accuracy, and trends across your restaurant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">{total} total actions</Badge>
          <Button variant="outline" size="sm" onClick={fetchHistory}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Actions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{total}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Confirmed</p>
          <p className="mt-1 text-2xl font-bold text-green-600">
            {logs.filter((l) => l.confirmationStatus === 'confirmed').length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">
            {logs.filter((l) => l.confirmationStatus === 'pending').length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rejected</p>
          <p className="mt-1 text-2xl font-bold text-red-600">
            {logs.filter((l) => l.confirmationStatus === 'rejected').length}
          </p>
        </div>
      </div>

      {/* Matching Method Breakdown */}
      {stats.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Matching Method Breakdown
          </h3>
          <div className="space-y-2">
            {stats.map((stat) => (
              <div key={stat.method} className="flex items-center gap-3">
                <span className="w-24 text-xs font-medium capitalize text-gray-600 dark:text-gray-400">
                  {stat.method.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <div className="flex-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        METHOD_COLORS[stat.method] || 'bg-gray-500',
                      )}
                      style={{ width: `${stat.percentage}%` }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                  {stat.count} ({stat.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          value={filterIntent}
          onChange={(e) => {
            setFilterIntent(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All Intents</option>
          {Object.entries(INTENT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="clarified">Clarified</option>
        </select>
      </div>

      {/* History Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          title="No voice actions found"
          description="Voice inventory actions will appear here once staff start using voice commands."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Employee
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Transcript
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Intent
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Confidence
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Latency
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {logs.map((log) => (
                <tr key={log._id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {log.employeeName || 'Unknown'}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {log.transcript}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        INTENT_COLORS[log.intent]
                          ? 'text-white'
                          : 'bg-gray-100 text-gray-800',
                      )}
                    >
                      {INTENT_LABELS[log.intent] || log.intent}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs capitalize text-gray-500">
                    {log.matchingMethod
                      ? log.matchingMethod.replace(/([A-Z])/g, ' $1').trim()
                      : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        log.confidence >= 0.8
                          ? 'text-green-600'
                          : log.confidence >= 0.5
                            ? 'text-yellow-600'
                            : 'text-red-600',
                      )}
                    >
                      {Math.round(log.confidence * 100)}%
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant={STATUS_COLORS[log.confirmationStatus] || 'neutral'}>
                      {log.confirmationStatus}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {log.latencyMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  )
}


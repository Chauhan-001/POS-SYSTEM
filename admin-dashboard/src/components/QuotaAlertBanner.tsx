/**
 * =============================================================================
 *  QuotaAlertBanner.tsx — Global LLM API Key Quota Alert
 * =============================================================================
 *
 * Shown on EVERY admin page (mounted in DashboardLayout) when the backend's
 * AI quota tracker reports a critical condition:
 *   - A key is parked in 429 cooldown (quota exhausted), OR
 *   - Any reported rate-limit window is at/above 90% consumed.
 *
 * Dismissible per session (persisted in sessionStorage so it stays dismissed
 * while navigating between pages); refetches every 60s so a recovering quota
 * clears the banner automatically.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, X, RefreshCw } from 'lucide-react'
import { getAiQuota } from '../api/aiUsageAnalytics'

const WARNING_PCT = 90
const DISMISS_KEY = 'ai-quota-alert-dismissed'

function pctUsed(remaining: number | null, limit: number): number | null {
  if (remaining === null || limit <= 0) return null
  return Math.min(100, Math.round(((limit - remaining) / limit) * 100))
}

export function QuotaAlertBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')

  const { data, isFetching } = useQuery({
    queryKey: ['ai-quota-alert'],
    queryFn: getAiQuota,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  })

  if (dismissed) return null

  const report = data?.data as any
  if (!report?.enabled || !Array.isArray(report.keys) || report.keys.length === 0) return null

  // ─── Evaluate critical conditions ──────────────────────────────────
  const parked = report.keys.filter((k: any) => k.parked)
  const exhausted = report.keys
    .flatMap((k: any) => (k.windows || []).map((w: any) => ({ key: k, window: w, pct: pctUsed(w.remaining, w.limit) })))
    .filter((x: any) => x.pct !== null && x.pct >= WARNING_PCT)
    .sort((a: any, b: any) => b.pct - a.pct)

  const top = exhausted[0]
  if (parked.length === 0 && !top) return null

  const parkedNames = parked.map((k: any) => k.label)
  const allParked = parked.length > 0 && parked.length === report.keys.length
  const message = parked.length > 0
    ? allParked
      ? `AI is currently unavailable — all API keys (${parkedNames.join(', ')}) are rate-limited (429).`
      : `AI quota exhausted — key${parkedNames.length > 1 ? 's' : ''} ${parkedNames.join(', ')} rate-limited (429). Traffic is falling back to the next key.`
    : top
      ? `AI quota ${top.pct}% used on ${top.key.label} (${top.window.window.replace('per-', '')}) — consider adding another API key.`
      : null

  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/40"
    >
      <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 text-xs font-medium text-amber-800 dark:text-amber-200">
        {message}
      </p>
      {isFetching && <RefreshCw size={12} className="shrink-0 animate-spin text-amber-400" />}
      <button
        onClick={() => { setDismissed(true); sessionStorage.setItem(DISMISS_KEY, '1') }}
        aria-label="Dismiss quota alert"
        className="shrink-0 rounded p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 cursor-pointer dark:hover:bg-amber-900/40 dark:hover:text-amber-300"
      >
        <X size={14} />
      </button>
    </div>
  )
}

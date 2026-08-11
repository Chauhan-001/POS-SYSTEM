/**
 * =============================================================================
 *  AIUsage.tsx — AI Usage Dashboard Page (Phase 2.7)
 * =============================================================================
 *
 * Every metric is fetched from the backend AI analytics endpoints — no local
 * calculations, no mocked values. Rendered with the admin dashboard's native
 * UI kit (Tailwind + lucide-react) instead of MUI, which is not a dependency
 * of this project.
 *
 * Features:
 *   - Summary cards (requests, tokens, cost, latency, error rate)
 *   - Feature usage breakdown table
 *   - Model comparison table
 *   - Voice AI analytics panel
 *   - Token & cost time-series tables
 *   - Search, filters, date range selector
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RefreshCw, DollarSign, Zap, BarChart3, Mic,
  Activity, Clock, Server, CheckCircle, XCircle, HelpCircle, KeyRound, ShieldAlert,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { Badge } from '../components/ui/Badge'
import {
  getDashboardSummary,
  getFeatureAnalytics,
  getModelAnalytics,
  getVoiceAnalytics,
  getTokenTimeSeries,
  getCostTimeSeries,
  getErrorSummary,
  getLatencySummary,
  getAiQuota,
} from '../api/aiUsageAnalytics'
import { formatNumber, formatCurrency } from '../utils/format'

const DATE_PRESETS: Record<string, [Date, Date]> = {
  'today': [new Date(new Date().setHours(0, 0, 0, 0)), new Date()],
  '7d': [new Date(Date.now() - 7 * 86400000), new Date()],
  '30d': [new Date(Date.now() - 30 * 86400000), new Date()],
  '90d': [new Date(Date.now() - 90 * 86400000), new Date()],
}

function StatCard({ label, value, sub, icon: Icon, tone }: {
  label: string
  value: string | number
  sub?: string
  icon: any
  tone: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <p className="truncate text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">{label}</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
          {sub && <p className="text-xs text-surface-400 truncate">{sub}</p>}
        </div>
        <div className={`rounded-lg p-2.5 shrink-0 ${tone}`}>
          <Icon size={18} />
        </div>
      </div>
    </Card>
  )
}

function TableShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  )
}

function QuotaBar({ label, used, limit, unit }: { label: string; used: number | null; limit: number; unit: string }) {
  // Only render a meaningful bar when the provider reported a remaining value;
  // otherwise (e.g. Groq omits the per-day header when it isn't the binding
  // constraint) show the window as unconstrained instead of a fake 100%.
  if (used === null || limit <= 0) {
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-surface-600 dark:text-surface-300">{label}</span>
        <span className="font-mono text-surface-400">not reported / unconstrained</span>
      </div>
    )
  }
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-amber-500' : 'bg-success'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-surface-600 dark:text-surface-300">{label}</span>
        <span className="font-mono text-surface-500 dark:text-surface-400">
          {formatNumber(used)} / {formatNumber(limit)} {unit} · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  )
}

function QuotaSection({ quota }: { quota: any }) {
  const keys: any[] = quota?.keys || []
  const hasData = keys.length > 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2"><KeyRound size={18} /> API Key Quota</span>
        </CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {!quota?.enabled ? (
          <p className="py-6 text-center text-sm text-surface-400">AI is not configured — no API keys to monitor.</p>
        ) : !hasData ? (
          <div className="flex items-start gap-3 py-4 text-sm text-surface-500 dark:text-surface-400">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <p>
              No quota snapshots yet. The dashboard captures the provider's rate-limit headers on the first
              live AI call — make an AI request (e.g. open the POS inventory dashboard) and refresh.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {keys.map((k: any) => {
              const dayWindow = (k.windows || []).find((w: any) => w.window === 'per-day')
              const minWindow = (k.windows || []).find((w: any) => w.window === 'per-minute')
              return (
                <div key={k.label} className="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-surface-900 dark:text-surface-100">{k.label}</span>
                      {k.isPrimary
                        ? <Badge variant="info" className="text-[9px]">Primary</Badge>
                        : <Badge variant="neutral" className="text-[9px]">Fallback</Badge>}
                      {k.parked && <Badge variant="danger" className="text-[9px]">429 cooldown</Badge>}
                      {!k.parked && (k.rateLimitHits ?? 0) > 0 && <Badge variant="warning" className="text-[9px]">{k.rateLimitHits}× 429</Badge>}
                    </div>
                    <span className="text-[10px] text-surface-400">{k.model}</span>
                  </div>
                  {dayWindow ? (
                    <QuotaBar label="Daily tokens" used={dayWindow.remaining != null ? dayWindow.limit - dayWindow.remaining : null} limit={dayWindow.limit} unit="tokens" />
                  ) : (
                    <p className="text-[11px] text-surface-400">Runtime tokens: {formatNumber(k.tokensUsedRuntime ?? 0)}</p>
                  )}
                  {minWindow && minWindow.limit > 0 && (
                    <QuotaBar label="Per-minute tokens" used={minWindow.remaining != null ? minWindow.limit - minWindow.remaining : null} limit={minWindow.limit} unit="tokens" />
                  )}
                  <div className="flex items-center justify-between text-[10px] text-surface-400 pt-1">
                    <span>{k.rateLimitHits ?? 0} rate-limit hits{k.lastRateLimitAt ? ` · last ${new Date(k.lastRateLimitAt).toLocaleTimeString()}` : ''}</span>
                    <span>{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleTimeString()}` : 'not used yet'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-[10px] text-surface-400">
          Live snapshots from the provider's rate-limit headers; keys are masked server-side. Refreshes every 30s.
        </p>
      </div>
    </Card>
  )
}

function useAnalytics<T>(key: string, fn: () => Promise<T>, filter: any) {
  return useQuery({
    queryKey: [key, filter],
    queryFn: fn,
    staleTime: 30_000,
  })
}

export default function AIUsage() {
  const [period, setPeriod] = useState('30d')
  const [featureFilter, setFeatureFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')

  const filter = () => {
    const preset = DATE_PRESETS[period]
    const out: Record<string, string> = {}
    if (preset) {
      out.startDate = preset[0].toISOString()
      out.endDate = preset[1].toISOString()
    }
    if (featureFilter) out.feature = featureFilter
    if (modelFilter) out.model = modelFilter
    return out
  }
  const f = filter()

  const dash = useAnalytics('ai-dash', () => getDashboardSummary(f), f)
  const features = useAnalytics('ai-features', () => getFeatureAnalytics({ ...f, page: 1, limit: 20 }), f)
  const models = useAnalytics('ai-models', () => getModelAnalytics(f), f)
  const voice = useAnalytics('ai-voice', () => getVoiceAnalytics(f), f)
  const tokens = useAnalytics('ai-tokens', () => getTokenTimeSeries({ ...f, groupBy: 'day' }), f)
  const costs = useAnalytics('ai-costs', () => getCostTimeSeries({ ...f, groupBy: 'day' }), f)
  const errors = useAnalytics('ai-errors', () => getErrorSummary(f), f)
  const latency = useAnalytics('ai-latency', () => getLatencySummary(f), f)
  const quota = useAnalytics('ai-quota', () => getAiQuota(), {})

  const error = dash.error || features.error || models.error
  const loading = dash.isLoading || features.isLoading || models.isLoading

  if (error && !dash.data) {
    return <ErrorPage message={(error as any).message} onRetry={() => dash.refetch()} />
  }

  const d = dash.data?.data as any
  const envelope = (q: any) => q?.data
  const featureRows = envelope(features.data)?.data || []
  const modelRows = envelope(models.data)?.data || []
  const voiceData = envelope(voice.data) || {}
  const tokenRows = envelope(tokens.data) || []
  const costRows = envelope(costs.data) || []
  const errorSum = envelope(errors.data) || {}
  const latencySum = envelope(latency.data) || {}

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">AI Usage</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Real-time AI usage analytics across all restaurants, models and features.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-10 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {Object.keys(DATE_PRESETS).map((k) => (
              <option key={k} value={k}>{k === 'today' ? 'Today' : `Last ${k}`}</option>
            ))}
          </select>
          <input
            value={featureFilter}
            onChange={(e) => setFeatureFilter(e.target.value)}
            placeholder="Feature"
            className="h-10 w-32 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            placeholder="Model"
            className="h-10 w-32 px-3 text-sm rounded-lg border border-surface-300 bg-white dark:border-surface-600 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <Button variant="outline" size="sm" onClick={() => { dash.refetch(); features.refetch(); models.refetch(); tokens.refetch(); costs.refetch(); quota.refetch(); }}>
            <RefreshCw size={15} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Requests" value={loading ? '…' : formatNumber(d?.totalRequests ?? 0)} sub={`${(d?.errorRate ?? 0).toFixed(1)}% error rate`} icon={BarChart3} tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20" />
        <StatCard label="Total Tokens" value={loading ? '…' : formatNumber(d?.totalTokens ?? 0)} sub="All models" icon={Server} tone="text-success bg-success/10" />
        <StatCard label="Total Cost" value={loading ? '…' : formatCurrency(d?.totalCost ?? 0)} sub={`${(d?.cachedRate ?? 0).toFixed(1)}% cached`} icon={DollarSign} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
        <StatCard label="Avg Latency" value={loading ? '…' : `${Math.round(d?.averageLatency ?? 0)}ms`} sub={`${d?.activeModels ?? 0} models`} icon={Zap} tone="text-violet-600 bg-violet-50 dark:bg-violet-900/20" />
      </div>

      <QuotaSection quota={envelope(quota.data)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TableShell title="Feature usage">
          {loading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Feature</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Requests</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Tokens</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Cost</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Success</th>
                </tr>
              </thead>
              <tbody>
                {featureRows.map((r: any) => (
                  <tr key={r.feature} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="py-3 px-4 font-medium text-surface-900 dark:text-surface-100">{r.feature}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{formatNumber(r.totalRequests ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{formatNumber(r.totalTokens ?? 0)}</td>
                    <td className="py-3 px-4 text-right font-mono text-surface-700 dark:text-surface-300">{formatCurrency(r.totalCost ?? 0)}</td>
                    <td className="py-3 px-4 text-right">
                      <Badge variant={(r.successRate ?? 0) >= 90 ? 'success' : (r.successRate ?? 0) >= 70 ? 'warning' : 'danger'}>
                        {(r.successRate ?? 0).toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && featureRows.length === 0 && <p className="py-10 text-center text-sm text-surface-400">No feature data available.</p>}
        </TableShell>

        <TableShell title="Model comparison">
          {loading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Model</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Requests</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Tokens</th>
                  <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Cost</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map((m: any) => (
                  <tr key={m.model} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="py-3 px-4 font-medium text-surface-900 dark:text-surface-100">{m.model}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{formatNumber(m.requests ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-surface-600 dark:text-surface-400">{formatNumber(m.totalTokens ?? 0)}</td>
                    <td className="py-3 px-4 text-right font-mono text-surface-700 dark:text-surface-300">{formatCurrency(m.totalCost ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && modelRows.length === 0 && <p className="py-10 text-center text-sm text-surface-400">No model data available.</p>}
        </TableShell>
      </div>

      <Card>
        <CardHeader><CardTitle><span className="inline-flex items-center gap-2"><Mic size={18} /> Voice AI Analytics</span></CardTitle></CardHeader>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Voice Requests" value={formatNumber(voiceData.totalVoiceRequests ?? 0)} icon={Mic} tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20" />
          <StatCard label="Successful" value={formatNumber(voiceData.successfulRecognition ?? 0)} icon={CheckCircle} tone="text-success bg-success/10" />
          <StatCard label="Failed" value={formatNumber(voiceData.failedRecognition ?? 0)} icon={XCircle} tone="text-danger bg-danger/10" />
          <StatCard label="Token Usage" value={formatNumber(voiceData.totalTokenUsage ?? 0)} icon={Activity} tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20" />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TableShell title="Token trends (daily)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700">
                <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Date</th>
                <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {(tokenRows || []).map((p: any) => (
                <tr key={p.date} className="border-b border-surface-100 dark:border-surface-800">
                  <td className="py-3 px-4 text-surface-600 dark:text-surface-400">{p.date}</td>
                  <td className="py-3 px-4 text-right font-mono text-surface-700 dark:text-surface-300">{formatNumber(p.totalTokens ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tokenRows?.length === 0 && <p className="py-10 text-center text-sm text-surface-400">No token trends available.</p>}
        </TableShell>

        <TableShell title="Cost trends (daily)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700">
                <th className="text-left py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Date</th>
                <th className="text-right py-3 px-4 font-semibold text-surface-500 dark:text-surface-400">Cost</th>
              </tr>
            </thead>
            <tbody>
              {(costRows || []).map((p: any) => (
                <tr key={p.date} className="border-b border-surface-100 dark:border-surface-800">
                  <td className="py-3 px-4 text-surface-600 dark:text-surface-400">{p.date}</td>
                  <td className="py-3 px-4 text-right font-mono text-surface-700 dark:text-surface-300">{formatCurrency(p.cost ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {costRows?.length === 0 && <p className="py-10 text-center text-sm text-surface-400">No cost trends available.</p>}
        </TableShell>
      </div>

      {(errorSum?.totalFailures > 0 || latencySum?.medianLatency) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {errorSum?.totalFailures > 0 && (
            <Card>
              <CardHeader><CardTitle><span className="inline-flex items-center gap-2"><XCircle size={16} /> Error Summary</span></CardTitle></CardHeader>
              <p className="px-4 pb-4 text-sm text-surface-600 dark:text-surface-400">
                {formatNumber(errorSum.totalFailures)} failures · {errorSum.providerFailures ?? 0} provider ·
                {errorSum.timeoutFailures ?? 0} timeout · {errorSum.rateLimitFailures ?? 0} rate-limit
              </p>
            </Card>
          )}
          {latencySum?.medianLatency && (
            <Card>
              <CardHeader><CardTitle><span className="inline-flex items-center gap-2"><Clock size={16} /> Latency</span></CardTitle></CardHeader>
              <p className="px-4 pb-4 text-sm text-surface-600 dark:text-surface-400">
                Median <span className="font-semibold">{Math.round(latencySum.medianLatency)}ms</span> · P95{' '}
                <span className="font-semibold">{Math.round(latencySum.p95Latency ?? 0)}ms</span> · P99{' '}
                <span className="font-semibold">{Math.round(latencySum.p99Latency ?? 0)}ms</span>
              </p>
            </Card>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-surface-400">
        <HelpCircle size={14} />
        Data is aggregated server-side from the AI analytics module and cached for 30s.
      </div>
    </div>
  )
}
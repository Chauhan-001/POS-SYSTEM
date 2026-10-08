/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailySummaryIntelligence — the "Generate Daily Summary" AI experience.
 *
 * WHAT IT IS: a presentation layer over the EXISTING backend pipeline
 * (POST /ai/z-report/generate). The owner clicks once; the server gathers
 * deterministic evidence (the same numbers the Z-report shows), derives
 * signals, optionally adds predictive/context evidence, and returns a
 * grounded, critic-validated summary.
 *
 * HARD RULES IMPLEMENTED HERE
 *   - The deterministic Z-report stays authoritative: this screen computes no
 *     sales, cash or margin numbers of its own. It renders only server text
 *     and counts of rows the server returned.
 *   - Nothing runs automatically — the owner clicks "Generate Daily Summary".
 *   - Gaps are never hidden: unavailable sources, failed reads, cross-source
 *     disagreements and a deterministic fallback are all shown plainly.
 *   - No internal identifiers reach the owner: raw tool names, normalizer
 *     names and signal codes are counted or mapped to plain language, never
 *     printed.
 *   - A null result shows the specific cause (offline / timeout / rate limit /
 *     session) via aiFailureCopy — not one generic line.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, X, CalendarClock,
  CircleAlert, Check, ShieldCheck, TrendingUp,
} from 'lucide-react';
import {
  generateZReportIntelligence,
  getLastAiFailureReason,
  type DailySummaryIntelligenceResult,
} from '../../api/client';
import { aiFailureCopy } from '../marketing/agentCopy';

/** Analysis sources → owner-facing names. Unknown ids are skipped (never leaked). */
const SOURCE_LABELS: Record<string, string> = {
  sales_context: 'Sales',
  menu_engineering: 'Menu performance',
  cost_intelligence: 'Item margins',
  inventory_context: 'Inventory & wastage',
  customer_segments: 'Customer groups',
  retention_signals: 'Returning customers',
  offer_performance: 'Offers',
  campaign_performance: 'Campaigns',
  demand_forecast: 'Demand prediction',
  market_basket: 'Items bought together',
  festival_context: 'Festivals',
  sports_context: 'Local matches',
  competition_context: 'Nearby competition',
  weather_context: 'Weather',
  cash_ledger: 'Cash drawer & closing',
  demand_anomaly: 'Unusual-pattern check',
  ml_evidence: 'AI predictions',
};

/** ML evidence kinds → owner language (honest about predictions vs experiments). */
const ML_KIND_LABELS: Record<string, string> = {
  segment: 'Customer groups (predicted)',
  forecast: 'Demand prediction',
  basket: 'Items bought together (predicted)',
  response_model: 'Offer response (predicted)',
  causal_uplift: 'Proven extra sales (from a real experiment)',
  descriptive: 'Data summary',
};

/**
 * Batch-3 decision → owner sentence. The server's reason strings are audit
 * text (rule ids and thresholds); only a plain restatement is shown here, and
 * an unrecognised reason degrades to a neutral line rather than a raw token.
 */
function friendlyExtraContext(reason: string | undefined): string {
  if (!reason) return 'No extra context was needed.';
  if (reason.startsWith('triggered:')) return 'Extra context was gathered because the day moved more than usual.';
  if (reason.startsWith('not triggered')) return 'Nothing moved enough to need extra context.';
  if (reason === 'forced by caller') return 'Extra context was gathered on request.';
  if (reason === 'skipped by caller') return 'Extra context was skipped on request.';
  return 'Extra context was handled automatically.';
}

interface DailySummaryIntelligenceProps {
  isOpen: boolean;
  onClose: () => void;
  /** Business date to summarize ('YYYY-MM-DD'); server defaults to yesterday. */
  businessDate?: string;
}

/** Friendly names for the sources a run could not use (never the raw ref). */
function friendlySources(refs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    const key = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
    const label = SOURCE_LABELS[key];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: 'neutral' | 'warn' | 'good' }) {
  if (items.length === 0) return null;
  const toneCls =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50/60'
      : tone === 'good'
        ? 'border-emerald-200 bg-emerald-50/60'
        : 'border-[var(--color-border-default)] bg-gray-50';
  return (
    <div className={`rounded-xl border p-3.5 ${toneCls}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((line, i) => (
          <li key={`${title}-${i}`} className="text-xs sm:text-sm text-gray-700 font-medium flex gap-2">
            <span className="text-gray-300 leading-5">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DailySummaryIntelligence({ isOpen, onClose, businessDate }: DailySummaryIntelligenceProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DailySummaryIntelligenceResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedReason, setFailedReason] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setFailedReason('');
    try {
      const res = await generateZReportIntelligence(businessDate ? { date: businessDate } : {});
      if (!res?.result) {
        // The request layer recorded WHY (offline / client abort / rate limit /
        // expired session) — show that cause instead of one generic line.
        setFailed(true);
        setFailedReason(aiFailureCopy(getLastAiFailureReason('/ai/z-report/generate')));
        return;
      }
      setResult(res.result);
    } catch {
      // Client functions never reject (the request layer swallows network
      // errors); this catch keeps an unexpected rejection in the retry state.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [businessDate]);

  // A fresh, explicit click per open: nothing is fetched until the owner asks.
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setFailed(false);
      setFailedReason('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const report = result?.report;
  const unavailableLabels = result ? friendlySources(result.evidence.unavailable) : [];
  const currentCount = result
    ? (result.evidence.freshness?.fresh ?? 0) + (result.evidence.freshness?.aging ?? 0)
    : 0;
  const staleCount = result ? (result.evidence.freshness?.stale ?? 0) + (result.evidence.freshness?.expired ?? 0) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-3xl w-full mx-4 border border-[var(--color-border-default)] max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[var(--color-border-default)] flex justify-between items-start gap-3">
          <div>
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-600" /> Daily Summary
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">
              A plain-language read of the same closing numbers, with what needs attention tomorrow.
              The detailed Z-report stays the authoritative record.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
              <CalendarClock className="w-3.5 h-3.5" />
              {businessDate ? `Business day ${businessDate}` : 'Business day: yesterday (latest closed day)'}
            </span>
            <button
              type="button"
              onClick={run}
              disabled={loading}
              className="flex items-center gap-2 bg-[var(--brand-color)] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {loading ? 'Generating…' : result ? 'Generate again' : 'Generate Daily Summary'}
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border-default)] bg-gray-50 px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--brand-color)]" />
              <span className="text-sm font-semibold text-gray-600">
                Collecting today’s evidence and writing the summary…
              </span>
            </div>
          )}

          {failed && !loading && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-amber-800">
                  The daily summary couldn’t be generated.
                  {failedReason && <span className="block font-medium"> {failedReason}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={run}
                className="shrink-0 flex items-center gap-1.5 border border-amber-300 bg-white text-amber-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try Again
              </button>
            </div>
          )}

          {result && report && !loading && (
            <>
              <div className="rounded-2xl border border-[var(--color-border-default)] bg-white p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-black text-purple-700 uppercase tracking-wider">
                    <TrendingUp className="w-3.5 h-3.5" /> {result.businessDate}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    {Math.round(Math.max(0, Math.min(1, result.confidence)) * 100)}% confidence
                  </span>
                  {result.reportSource === 'deterministic' && (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 uppercase tracking-wider">
                      <CircleAlert className="w-3.5 h-3.5" /> Evidence-only summary
                    </span>
                  )}
                </div>
                <h4 className="text-base sm:text-lg font-extrabold text-gray-900 mt-2.5">{report.headline}</h4>
                <p className="text-[11px] text-gray-400 mt-1">
                  Built from {result.evidence.signals} evidence reading{result.evidence.signals === 1 ? '' : 's'}
                  {currentCount > 0 ? ` (${currentCount} current)` : ''}
                  {staleCount > 0 ? `, ${staleCount} older and excluded` : ''}.
                </p>
              </div>

              <Section title="What happened" items={report.whatHappened} tone="neutral" />
              <Section title="What mattered" items={report.whatMattered} tone="good" />
              <Section title="Needs attention" items={report.needsAttention} tone="warn" />
              <Section title="Focus next" items={report.focusNext} tone="neutral" />

              {(result.degraded || result.evidence.conflicts.length > 0 || staleCount > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> What to keep in mind
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-amber-900 font-medium">
                    {result.evidence.conflicts.length > 0 && (
                      <li>
                        {result.evidence.conflicts.length} figure{result.evidence.conflicts.length === 1 ? '' : 's'} were reported
                        differently by different sources — both readings are shown, none was picked silently.
                      </li>
                    )}
                    {unavailableLabels.length > 0 && (
                      <li>Not available for this run: {unavailableLabels.join(', ')}.</li>
                    )}
                    {result.evidence.toolErrors.length > 0 && (
                      <li>
                        {result.evidence.toolErrors.length} data read{result.evidence.toolErrors.length === 1 ? '' : 's'} failed and
                        are excluded from this summary.
                      </li>
                    )}
                    {staleCount > 0 && <li>{staleCount} older reading(s) were excluded because they are no longer current.</li>}
                    {result.reportSource === 'deterministic' && (
                      <li>
                        The AI wording was not used for this run — the summary is built directly from the evidence instead.
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {report.caveats.length > 0 && <Section title="Notes about this summary" items={report.caveats} tone="neutral" />}

              {result.evidence.ml && (
                <div className="rounded-xl border border-[var(--color-border-default)] bg-gray-50 p-3.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Predictions used</p>
                  {result.evidence.ml.availableKinds.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {result.evidence.ml.availableKinds.map((k) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                        >
                          <Check className="w-3.5 h-3.5" /> {ML_KIND_LABELS[k] ?? 'Prediction'}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-gray-600 font-medium">
                      No prediction was available for this run — the summary uses measured data only
                      {result.evidence.ml.missingKinds.length > 0 ? ` (${result.evidence.ml.missingKinds.length} source(s) missing)` : ''}.
                    </p>
                  )}
                </div>
              )}

              <details className="rounded-xl border border-[var(--color-border-default)] bg-white p-3.5">
                <summary className="text-[11px] font-bold text-gray-500 cursor-pointer">How this was produced</summary>
                <ul className="mt-2 space-y-1 text-[11px] text-gray-500 font-medium">
                  <li>Core facts gathered in {Math.round(result.generation.batch1Ms)} ms from {result.generation.toolCalls} data read(s).</li>
                  <li>Derived checks completed in {Math.round(result.generation.batch2Ms)} ms.</li>
                  <li>{friendlyExtraContext(result.evidence.batch3Reason)}</li>
                  {result.evidence.followUpReason && (
                    <li>A targeted follow-up check ran to resolve a movement or a disagreement in the evidence.</li>
                  )}
                  <li>Total time {Math.round(result.generation.durationMs)} ms; AI response time {Math.round(result.generation.llmMs)} ms.</li>
                  <li>{result.persisted ? 'This run was saved for audit.' : 'This run was not saved.'}</li>
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

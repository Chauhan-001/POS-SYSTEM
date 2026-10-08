/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeepAnalysisPanel — the owner-facing surface for the canonical `/analyze`
 * path (Marketing Agent Phase 16).
 *
 * What this is: one sequential investigation that looks at the restaurant
 * domain by domain (sales, menu, stock, customers, past campaigns,
 * festivals/sports/weather, predictions), reports what it found WITH evidence,
 * then proposes ranked actions that a deterministic validation gate has
 * already checked. An LLM only chooses which domain to look at next and
 * reviews the result — it is never the source of truth, and it can never
 * override a validation verdict.
 *
 * Rendering rules (the same discipline as the rest of the Marketing page):
 *   - nothing is invented: a missing number renders as "Not available";
 *   - an area with no data says "No data" — it never reads as healthy;
 *   - a check that was SKIPPED says "Not checked" — never a pass;
 *   - declared-only areas (guest feedback, nearby competition) are disclosed
 *     as "not available yet" instead of silently omitted;
 *   - NO chain-of-thought exists in the API contract at all, so there is
 *     nothing hidden to reveal: only findings, evidence references, verdicts
 *     and the engine's own numbers.
 *
 * Actions: Review (expand the reasoning already provided) · Approve (creates a
 * PENDING draft via the existing `/proposal` route — nothing is sent) ·
 * Ignore (recorded through the existing owner-feedback endpoint, so the
 * decision is audited and feeds the next run's learning).
 *
 * The panel is owner-invoked, not auto-run: a deep analysis spends several LLM
 * calls, so the page never starts one behind the owner's back.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  XCircle,
  FileText,
  ShieldCheck,
  TrendingUp,
  Info,
} from 'lucide-react';
import {
  runMarketingAnalyze,
  createProposalFromRecommendation,
  recordRecommendationFeedback,
  getLastAiFailureReason,
  type MarketingAnalyzeResult,
  type AnalyzeRecommendation,
  type AnalyzedRecommendation,
} from '../../api/client';
import {
  friendlySignals,
  friendlyMlKinds,
  friendlyMoney,
  friendlyEconomics,
  friendlyBreakEven,
  friendlyCategory,
  friendlyDomain,
  friendlyConfidence,
  friendlySignalValue,
  friendlyEvidenceRefs,
  friendlyRejectionCodes,
  friendlyCriticVerdict,
  friendlyAnalyzeStatus,
  DOMAIN_DESCRIPTIONS,
  DOMAIN_STATUS_LABELS,
  VALIDATION_CHECK_LABELS,
  VALIDATION_STATUS_LABELS,
  RISK_LABELS,
  aiFailureCopy,
} from './agentCopy';

const NOT_AVAILABLE = 'Not available';

/** How far back the investigation should look. Owner-visible, always sent. */
const LOOKBACK_OPTIONS = [
  { days: 30, label: 'Last 30 days' },
  { days: 60, label: 'Last 60 days' },
  { days: 90, label: 'Last 90 days' },
];

const STATUS_TONE: Record<string, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-rose-200 bg-rose-50 text-rose-700',
};

/** Small labelled heading used by every block in the report. */
function Block({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="min-w-0">
      <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** A situation fact — statement + where it came from + confidence. */
function FactRow({ statement, domain, confidence, evidenceRefs }: { statement: string; domain: string; confidence: number; evidenceRefs: string[] }) {
  const refs = friendlyEvidenceRefs(evidenceRefs);
  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-xs leading-relaxed text-slate-700">{statement}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
        <span className="font-bold text-slate-500">{friendlyDomain(domain)}</span>
        {friendlyConfidence(confidence) && <span>· {friendlyConfidence(confidence)}</span>}
        {refs.length > 0 && <span>· from {refs.join(', ')}</span>}
      </div>
    </li>
  );
}

export interface DeepAnalysisPanelProps {
  currencySymbol: string;
}

export default function DeepAnalysisPanel({ currencySymbol }: DeepAnalysisPanelProps) {
  const [result, setResult] = useState<MarketingAnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [goal, setGoal] = useState('');
  const [lookbackDays, setLookbackDays] = useState(30);

  /** Which explanation block the owner opened (one at a time keeps it calm). */
  const [openId, setOpenId] = useState('');
  /** id → proposalId: a draft already exists, so it can never be created twice. */
  const [approved, setApproved] = useState<Record<string, string>>({});
  /** id → true: the ignore decision is recorded and the card is marked. */
  const [ignored, setIgnored] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError(false);
    setErrorText('');
    setActionError('');
    setApproved({});
    setIgnored({});
    setOpenId('');
    try {
      const trimmed = goal.trim();
      const res = await runMarketingAnalyze({
        ...(trimmed ? { goal: trimmed.slice(0, 300) } : {}),
        lookbackDays,
      });
      const incoming = res?.result;
      if (!incoming) {
        setResult(null);
        setError(true);
        // The request layer records WHY the run produced nothing (offline /
        // client abort / rate limit / session) — state that cause too instead
        // of one generic line for four different problems.
        setErrorText(
          'The deep analysis could not be completed right now.' +
          aiFailureCopy(getLastAiFailureReason('/ai/marketing-agent/analyze')),
        );
        return;
      }
      setResult(incoming);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setResult(null);
      setError(true);
      if (/429|rate|too many|in progress/i.test(message)) {
        setErrorText('An analysis is already running or you have run too many recently. Please wait a moment and try again.');
      } else if (/401|403|unauthor|session/i.test(message)) {
        setErrorText('Your session has expired. Please sign in again to run the analysis.');
      } else {
        setErrorText('The deep analysis could not be completed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [goal, lookbackDays]);

  /** APPROVE — the existing proposal route; a pending, editable draft only. */
  const approve = useCallback(async (rec: AnalyzeRecommendation) => {
    if (approved[rec.id] || busyId) return;
    setBusyId(rec.id);
    setActionError('');
    try {
      const res = await createProposalFromRecommendation({
        id: rec.id,
        type: rec.type,
        title: rec.title,
        description: rec.description,
        recommendedAction: rec.recommendedAction,
        strategyLabel: rec.strategyLabel,
        engineScore: rec.engineScore,
        confidence: rec.confidence,
        priority: rec.priority,
        economics: rec.economics as unknown as Record<string, unknown> | undefined,
        provenance: rec.provenance as unknown as Record<string, unknown> | undefined,
        why: rec.why,
        target: rec.target as unknown as Record<string, unknown> | undefined,
      });
      const outcome = res?.proposal;
      if (!outcome?.created) {
        setActionError(outcome?.skipReason ?? 'The draft could not be created. Please try again.');
        return;
      }
      setApproved((prev) => ({ ...prev, [rec.id]: outcome.proposalId ?? '' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setActionError(/401|403|session/i.test(message)
        ? 'Your session has expired. Please sign in again.'
        : 'The draft could not be created. Please try again.');
    } finally {
      setBusyId('');
    }
  }, [approved, busyId]);

  /**
   * IGNORE — recorded through the existing owner-decision endpoint so the
   * choice survives reloads and feeds learning. `neutral`, not `negative`:
   * the owner is saying "not now", which is not the same judgement as
   * "this idea is wrong" (that is what Reject means on Recommended Actions).
   */
  const ignore = useCallback(async (rec: AnalyzeRecommendation) => {
    if (ignored[rec.id] || busyId) return;
    setBusyId(rec.id);
    setActionError('');
    try {
      const res = await recordRecommendationFeedback(rec.id, {
        rating: 'neutral',
        comment: 'Ignored by the owner from Deep Analysis.',
        would_accept_again: true,
      });
      if (res && res.success === false) {
        setActionError('The decision could not be saved. Please try again.');
        return;
      }
      setIgnored((prev) => ({ ...prev, [rec.id]: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setActionError(/401|403|session/i.test(message)
        ? 'Your session has expired. Please sign in again.'
        : 'The decision could not be saved. Please try again.');
    } finally {
      setBusyId('');
    }
  }, [ignored, busyId]);

  const status = useMemo(() => friendlyAnalyzeStatus(result?.status), [result?.status]);
  const situation = result?.situation;
  const recommendations: AnalyzedRecommendation[] = result?.recommendations ?? [];
  const declined = recommendations.filter((r) => r.validation && !r.validation.passed).length;

  const targetOf = (rec: AnalyzeRecommendation): string => {
    const names = rec.target?.productNames ?? [];
    if (names.length > 0) return names.join(', ');
    if ((rec.target?.segmentIds ?? []).length > 0) return 'Saved customer segments';
    return NOT_AVAILABLE;
  };

  return (
    <section
      data-testid="deep-analysis-section"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900">Deep Analysis</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Looks at your restaurant one area at a time, checks each idea against your rules, then ranks what is worth doing.
          </p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            Read-only — nothing is created or sent from here without your approval.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="deep-analysis-goal">What do you want to improve?</label>
          <input
            id="deep-analysis-goal"
            data-testid="deep-analysis-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={300}
            placeholder="What do you want to improve? (optional)"
            className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          />
          <label className="sr-only" htmlFor="deep-analysis-lookback">How far back</label>
          <select
            id="deep-analysis-lookback"
            data-testid="deep-analysis-lookback"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            data-testid="run-deep-analysis"
            onClick={() => void run()}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Run deep analysis</>
            )}
          </button>
        </div>
      </div>

      {loading && (
        <div
          data-testid="deep-analysis-loading"
          className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-500"
        >
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          Going through your sales, menu, stock, customers and past campaigns…
        </div>
      )}

      {error && !loading && (
        <div
          data-testid="deep-analysis-error"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3"
        >
          <span className="flex items-center gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorText}
          </span>
          <button
            type="button"
            data-testid="deep-analysis-retry"
            onClick={() => void run()}
            className="text-xs font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900 cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {!result && !loading && !error && (
        <p className="mt-4 text-xs text-slate-400" data-testid="deep-analysis-empty">
          No deep analysis yet — run one to see what each area of your restaurant shows and what is worth acting on.
        </p>
      )}

      {result && !loading && (
        <div className="mt-5 space-y-5">
          {/* ── 1. Restaurant analysis: the run itself ── */}
          <div data-testid="deep-analysis-status" className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
                {status.label}
              </span>
              {result.risk && (
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${result.risk === 'high' ? STATUS_TONE.bad : result.risk === 'medium' ? STATUS_TONE.warn : STATUS_TONE.good}`}>
                  {RISK_LABELS[result.risk] ?? result.risk}
                </span>
              )}
              {friendlyConfidence(result.confidence) && (
                <span className="text-[10px] font-bold text-slate-400">{friendlyConfidence(result.confidence)}</span>
              )}
              {result.investigation?.domainOrder?.length > 0 && (
                <span className="text-[10px] text-slate-400">
                  {result.investigation.domainOrder.length} area(s), {result.investigation.stepsUsed} step(s)
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              <span className="font-bold text-slate-700">You asked: </span>
              {result.objective || NOT_AVAILABLE}
            </p>
            {status.description && (
              <p className="mt-1 text-[11px] text-slate-500">{status.description}</p>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              Your approval is always required before anything is sent.
            </p>
          </div>

          {/* ── 2. What we found ── */}
          <Block
            testId="deep-analysis-facts"
            title="What we found"
            hint="Each line is something the data showed — with where it came from."
          >
            {!situation || (situation.confirmedFacts.length === 0 && situation.opportunities.length === 0 && situation.risks.length === 0) ? (
              <p className="text-xs text-slate-400">
                Nothing could be confirmed from your data in this window. That is a data gap, not a clean bill of health.
              </p>
            ) : (
              <div className="space-y-3">
                {situation.confirmedFacts.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Confirmed</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {situation.confirmedFacts.map((f, i) => (
                        <FactRow key={`cf-${i}`} statement={f.statement} domain={f.domain} confidence={f.confidence} evidenceRefs={f.evidenceRefs} />
                      ))}
                    </ul>
                  </div>
                )}
                {situation.opportunities.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Possible openings</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {situation.opportunities.map((f, i) => (
                        <FactRow key={`op-${i}`} statement={f.statement} domain={f.domain} confidence={f.confidence} evidenceRefs={f.evidenceRefs} />
                      ))}
                    </ul>
                  </div>
                )}
                {situation.risks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Watch-outs</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {situation.risks.map((f, i) => (
                        <FactRow key={`rk-${i}`} statement={f.statement} domain={f.domain} confidence={f.confidence} evidenceRefs={f.evidenceRefs} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Block>

          {/* ── 3. Important signals ── */}
          <Block testId="deep-analysis-signals" title="Important signals" hint="The strongest measured changes behind the findings above.">
            {!situation || situation.topSignals.length === 0 ? (
              <p className="text-xs text-slate-400">No standout signals were measured in this window.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {situation.topSignals.map((s) => {
                  const measured = friendlySignalValue(s, currencySymbol);
                  return (
                    <li key={s.signalId ?? s.code} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">
                        {friendlySignals([s.code]) || 'Signal'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-700">{s.statement}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {measured || 'No measured value'}
                        {s.freshness ? ` · ${s.freshness}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>

          {/* ── 4. What we investigated ── */}
          <Block
            testId="deep-analysis-investigated"
            title="What we investigated"
            hint="An area with no data is reported as no data — nothing was assumed from it."
          >
            <ul className="flex flex-wrap gap-1.5">
              {(situation?.investigatedDomains ?? []).map((d) => (
                <li
                  key={d.domain}
                  data-testid={`investigated-${d.domain}`}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                    d.status === 'ok' ? STATUS_TONE.good : d.status === 'partial' ? STATUS_TONE.warn : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                  title={DOMAIN_DESCRIPTIONS[d.domain]}
                >
                  {friendlyDomain(d.domain)}: {DOMAIN_STATUS_LABELS[d.status] ?? d.status}
                  {d.findingCount > 0 && <span className="text-slate-400">({d.findingCount})</span>}
                  {!d.implemented && <span className="text-slate-400">· not available yet</span>}
                </li>
              ))}
              {(situation?.unavailableDomains ?? []).length > 0 && (
                <li className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  Skipped for lack of data: {(situation?.unavailableDomains ?? []).map(friendlyDomain).join(', ')}
                </li>
              )}
            </ul>
            {(situation?.missingEvidence ?? []).length > 0 && (
              <ul className="mt-2 space-y-1">
                {(situation?.missingEvidence ?? []).map((m, i) => (
                  <li key={`me-${i}`} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                    <Info className="mt-0.5 w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                    {m}
                  </li>
                ))}
              </ul>
            )}
            {(situation?.uncertainties ?? []).length > 0 && (
              <ul className="mt-2 space-y-1">
                {(situation?.uncertainties ?? []).map((u, i) => (
                  <li key={`un-${i}`} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                    <Info className="mt-0.5 w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                    {u}
                  </li>
                ))}
              </ul>
            )}
            {(situation?.contradictions ?? []).length > 0 && (
              <div data-testid="deep-analysis-conflicts" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Two areas disagree</p>
                <ul className="mt-1 space-y-1">
                  {(situation?.contradictions ?? []).map((c, i) => (
                    <li key={`ct-${i}`} className="text-[11px] text-amber-800">{c}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-amber-700">
                  This is shown rather than hidden — treat the affected ideas with extra care.
                </p>
              </div>
            )}
          </Block>

          {/* ── 5. Top opportunities (the actionable cards) ── */}
          <Block
            testId="deep-analysis-opportunities"
            title="Top opportunities"
            hint="Ranked by the engine, checked by your rules. Approving creates a draft — it never sends."
          >
            {recommendations.length === 0 ? (
              <p className="text-xs text-slate-400" data-testid="deep-analysis-no-opportunities">
                No action was recommended this time. That usually means there was not enough usable data — not that nothing is wrong.
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.map((entry) => {
                  const rec = entry.recommendation;
                  const isOpen = openId === rec.id;
                  const isApproved = !!approved[rec.id];
                  const isIgnored = !!ignored[rec.id];
                  const critic = friendlyCriticVerdict(entry.critic?.verdict);
                  const e = rec.economics;
                  const economicsAvailable = !!e && e.available !== false && Number.isFinite(e.discountPercent);
                  const why = rec.why ?? [];
                  const criticReasons = entry.critic?.reasons ?? [];
                  const evidenceLabels = friendlyEvidenceRefs([
                    ...(rec.provenance?.signalCodes ?? []).map((c) => `signal:${c}`),
                    ...(rec.provenance?.mlKinds ?? []).map((k) => `ml:${k}`),
                  ]);
                  return (
                    <article
                      key={rec.id}
                      data-testid="deep-analysis-card"
                      data-recommendation-id={rec.id}
                      className={`rounded-xl border bg-white p-4 ${isIgnored ? 'border-slate-200 opacity-70' : 'border-slate-200'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-indigo-600">
                          {friendlyCategory(rec)}
                        </span>
                        {entry.validation?.passed ? (
                          <span data-testid={`validation-ok-${rec.id}`} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_TONE.good}`}>
                            <ShieldCheck className="w-3 h-3" aria-hidden="true" /> Checked
                          </span>
                        ) : (
                          <span data-testid={`validation-failed-${rec.id}`} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_TONE.bad}`}>
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Blocked
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_TONE[critic.tone]}`}>
                          {critic.label}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">#{rec.rank}</span>
                      </div>

                      <h4 className="mt-2.5 text-sm font-black leading-snug text-slate-900">{rec.title}</h4>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        {rec.description || rec.recommendedAction || NOT_AVAILABLE}
                      </p>
                      {rec.recommendedAction && rec.description && (
                        <p className="mt-1 text-xs font-semibold text-slate-600">{rec.recommendedAction}</p>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Target</p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-700">{targetOf(rec)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Priority</p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-700">{rec.priority || NOT_AVAILABLE}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Engine score</p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-700">
                            {Number.isFinite(rec.engineScore) ? rec.engineScore.toFixed(2) : NOT_AVAILABLE}
                          </p>
                        </div>
                      </div>

                      {(rec.risks ?? []).length > 0 && (
                        <p className="mt-2 text-[10px] font-semibold text-amber-600">
                          Watch out: {(rec.risks ?? []).join('; ')}
                        </p>
                      )}
                      {(rec.prerequisites ?? []).length > 0 && (
                        <p className="mt-1 text-[10px] text-slate-400">
                          Before running: {(rec.prerequisites ?? []).join('; ')}
                        </p>
                      )}

                      <button
                        type="button"
                        data-testid={`review-${rec.id}`}
                        onClick={() => setOpenId(isOpen ? '' : rec.id)}
                        aria-expanded={isOpen}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isOpen ? 'Hide details' : 'Review details'}
                      </button>

                      {isOpen && (
                        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                          {/* Why each matters */}
                          <div data-testid={`deep-analysis-why-${rec.id}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Why this matters</p>
                            {why.length === 0 && criticReasons.length === 0 ? (
                              <p className="mt-1 text-[11px] text-slate-400">No explanation was produced for this one.</p>
                            ) : (
                              <ul className="mt-1 space-y-1">
                                {why.map((w, i) => (
                                  <li key={`w-${i}`} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                                    <TrendingUp className="mt-0.5 w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                                    {w}
                                  </li>
                                ))}
                                {criticReasons.map((w, i) => (
                                  <li key={`c-${i}`} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                                    <Info className="mt-0.5 w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                                    {w}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {entry.critic?.source === 'deterministic_fallback' && (
                              <p className="mt-1 text-[10px] text-slate-400">
                                Reviewed by the built-in rules only — the AI reviewer was unavailable.
                              </p>
                            )}
                            {(entry.critic?.strippedClaims ?? []).length > 0 && (
                              <p className="mt-1 text-[10px] text-amber-600">
                                Unsupported claims were removed from this review.
                              </p>
                            )}
                          </div>

                          {/* Evidence */}
                          <div data-testid={`deep-analysis-evidence-${rec.id}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Evidence used</p>
                            {evidenceLabels.length === 0 ? (
                              <p className="mt-1 text-[11px] text-slate-400">{NOT_AVAILABLE}</p>
                            ) : (
                              <ul className="mt-1 flex flex-wrap gap-1.5">
                                {evidenceLabels.map((label) => (
                                  <li key={label} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                                    {label}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/* Expected economics */}
                          <div data-testid={`deep-analysis-economics-${rec.id}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Expected economics</p>
                            {!economicsAvailable ? (
                              <p className="mt-1 text-[11px] text-slate-400">
                                {friendlyEconomics(0, 0, false, false)}
                              </p>
                            ) : (
                              <div className="mt-1 space-y-1">
                                <p className="text-[11px] text-slate-600">
                                  {friendlyEconomics(e.discountPercent, e.projectedContributionMargin, e.economicallySafe, true)}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {e.incrementalRevenue > 0 ? `Expected extra revenue ${friendlyMoney(e.incrementalRevenue, currencySymbol)}. ` : ''}
                                  {friendlyBreakEven(e.breakEvenIncrementalUnits, true)}.
                                </p>
                                {e.paybackPeriodDays > 0 && (
                                  <p className="text-[11px] text-slate-500">Payback: {e.paybackPeriodDays} days.</p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* ML signals */}
                          <div data-testid={`deep-analysis-ml-${rec.id}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Predictions used</p>
                            <p className="mt-1 text-[11px] text-slate-600">
                              {(rec.provenance?.mlKinds ?? []).length > 0
                                ? friendlyMlKinds(rec.provenance?.mlKinds)
                                : 'No prediction was used for this one — it rests on measured data.'}
                            </p>
                          </div>

                          {/* Validation checks (authoritative) */}
                          <div data-testid={`deep-analysis-validation-${rec.id}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Checks against your rules</p>
                            <ul className="mt-1 space-y-1">
                              {(entry.validation?.checks ?? []).map((c) => (
                                <li key={c.name} className="flex items-start gap-1.5 text-[11px]">
                                  {c.status === 'pass' ? (
                                    <CheckCircle2 className="mt-0.5 w-3 h-3 shrink-0 text-emerald-500" aria-hidden="true" />
                                  ) : c.status === 'fail' ? (
                                    <XCircle className="mt-0.5 w-3 h-3 shrink-0 text-rose-500" aria-hidden="true" />
                                  ) : (
                                    <Info className="mt-0.5 w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                                  )}
                                  <span className="text-slate-600">
                                    <span className="font-bold">{VALIDATION_CHECK_LABELS[c.name] ?? c.name.replace(/_/g, ' ')}</span>
                                    {' — '}
                                    {VALIDATION_STATUS_LABELS[c.status] ?? c.status}
                                    {c.detail ? `: ${c.detail}` : ''}
                                  </span>
                                </li>
                              ))}
                              {(entry.validation?.checks ?? []).length === 0 && (
                                <li className="text-[11px] text-slate-400">No checks were recorded.</li>
                              )}
                            </ul>
                            {(entry.validation?.rejectionCodes ?? []).length > 0 && (
                              <p className="mt-1 text-[11px] font-bold text-rose-600">
                                Blocked because {friendlyRejectionCodes(entry.validation.rejectionCodes).join('; ')}.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-3">
                        {isApproved ? (
                          <p data-testid={`deep-analysis-approved-${rec.id}`} className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] font-bold text-emerald-800">
                            <CheckCircle2 className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Draft saved{approved[rec.id] ? ` (${approved[rec.id]})` : ''} — editable, nothing has been sent yet.
                            </span>
                          </p>
                        ) : isIgnored ? (
                          <p data-testid={`deep-analysis-ignored-${rec.id}`} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-500">
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Not now — your decision was recorded
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {/*
                              A candidate that FAILED the deterministic gate is
                              never draftable from here: the gate is
                              authoritative and the UI cannot be a way around
                              it.
                            */}
                            <button
                              type="button"
                              data-testid={`approve-${rec.id}`}
                              onClick={() => void approve(rec)}
                              disabled={busyId === rec.id || !entry.validation?.passed}
                              title={entry.validation?.passed ? 'Create a pending, editable draft' : 'This idea did not pass the checks, so it cannot be drafted.'}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              {busyId === rec.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                              Approve → Draft
                            </button>
                            <button
                              type="button"
                              data-testid={`ignore-${rec.id}`}
                              onClick={() => void ignore(rec)}
                              disabled={busyId === rec.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Ignore
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {actionError && (
              <div data-testid="deep-analysis-action-error" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{actionError}</span>
              </div>
            )}
          </Block>

          {/* ── 6. Risk, confidence and what was set aside ── */}
          <Block testId="deep-analysis-risk" title="Risk and limitations">
            <div className="space-y-2">
              {declined > 0 && (
                <p className="text-[11px] text-slate-600">
                  {declined} idea(s) failed your rules and were NOT recommended.
                </p>
              )}
              {result.rejected.length > 0 && (
                <div data-testid="deep-analysis-rejected" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Set aside</p>
                  <ul className="mt-1 space-y-1">
                    {result.rejected.map((r) => (
                      <li key={r.candidateId} className="text-[11px] text-slate-600">
                        <span className="font-bold">{r.title || r.candidateId}</span>
                        {r.codes.length > 0 && ` — ${friendlyRejectionCodes(r.codes).join('; ')}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div data-testid="deep-analysis-validation-sources" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Feasibility actually checked</p>
                <ul className="mt-1 space-y-1">
                  <li className="text-[11px] text-slate-600">
                    <span className="font-bold">Stock risk: </span>
                    {result.validationSources.stockout.status === 'ok' ? result.validationSources.stockout.detail : 'Could not be checked — no usable stock data.'}
                  </li>
                  <li className="text-[11px] text-slate-600">
                    <span className="font-bold">Live offer overlap: </span>
                    {result.validationSources.activeOffers.status === 'ok' ? result.validationSources.activeOffers.detail : 'Could not be checked — no offer data.'}
                  </li>
                </ul>
              </div>
              {result.directionPolicy?.applied && (
                <p className="text-[11px] text-slate-500">
                  The engine only generated the kinds of action the investigation pointed at
                  {result.directionPolicy.types.length > 0 ? ` (${result.directionPolicy.types.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(', ')})` : ''}.
                  {(result.directionPolicy.unrealisedDirections ?? []).length > 0 &&
                    ` ${result.directionPolicy.unrealisedDirections.length} direction(s) produced no suggestion and were not forced into one.`}
                </p>
              )}
              {result.degradations.length > 0 && (
                <div data-testid="deep-analysis-degradations" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Limitations disclosed by this run</p>
                  <ul className="mt-1 space-y-0.5">
                    {result.degradations.map((d, i) => (
                      <li key={`dg-${i}`} className="text-[11px] text-amber-800">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Block>

          {/* ── 7. What the run learned ── */}
          <div data-testid="deep-analysis-learned" className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Learning from this run</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              {result.outcomeLearning.outcomesLinked > 0
                ? `Learned from ${result.outcomeLearning.outcomesLinked} measured outcome(s) of earlier campaigns (${result.outcomeLearning.causalOutcomes} measured against a control group).`
                : 'No measured campaign outcome was waiting to be learned from.'}
              {result.outcomeLearning.outcomesUnusable > 0 &&
                ` ${result.outcomeLearning.outcomesUnusable} measured row(s) had no usable variance and were not learned from.`}
              {' '}
              {result.memoryWrite.episodeWritten
                ? 'This analysis was saved so the next one can build on it.'
                : 'This analysis could not be saved to memory.'}
            </p>
            {result.outcomeLearning.notes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {result.outcomeLearning.notes.map((n, i) => (
                  <li key={`on-${i}`} className="text-[10px] text-slate-400">{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

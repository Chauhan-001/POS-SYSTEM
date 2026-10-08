/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationsPage — the central content area of the Marketing page.
 *
 * Two clearly separated sections, never merged, never renamed:
 *
 *   AI INSIGHTS        — System #2: the agentic LLM investigation.
 *                        "What did the AI discover?" Advisory only: an
 *                        insight can NEVER become a campaign.
 *
 *   RECOMMENDED ACTIONS— System #3: the deterministic Intelligence Pipeline.
 *                        "What should I do?" Ranked, economics-backed cards.
 *                        Only these can become a Draft → approval.
 *
 *   DEEP ANALYSIS      — System #4 (Phase 16): the canonical `/analyze` path.
 *                        One sequential investigation, area by area, whose
 *                        findings carry evidence and whose candidates have
 *                        already passed deterministic validation. Owner-
 *                        invoked (it spends several LLM calls), and its
 *                        Approve action reuses the SAME /proposal draft flow.
 *
 * Everything rendered here comes from the existing API responses
 * (`/ai/marketing-agent/recommend` and `/ai/marketing-agent/intelligence`).
 * No value is invented: a metric with no authoritative source renders as
 * "Not available" instead of a plausible-looking number.
 *
 * The offer-engine "Opportunities for you" cards below stay exactly as they
 * were: a separate, pre-existing surface with its own create-offer flow.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  ChevronDown,
  FileText,
  XCircle,
  Plus,
} from 'lucide-react';
import { OpportunityCard } from './MarketingHome';
import { EmptyState, Spinner } from './shared';
import DeepAnalysisPanel from './DeepAnalysisPanel';
import {
  friendlySignals,
  friendlyMoney,
  friendlyEconomics,
  friendlyMlKinds,
  friendlyToolLabels,
  friendlyCategory,
  aiFailureCopy,
} from './agentCopy';
import {
  runMarketingIntelligence,
  runMarketingInsights,
  createProposalFromRecommendation,
  recordRecommendationFeedback,
  getLastAiFailureReason,
  type MarketingIntelligenceResult,
  type IntelligenceRecommendation,
  type MarketingInsight,
} from '../../api/client';

interface RecommendationsPageProps {
  recommendations: any[];
  loading: boolean;
  currencySymbol: string;
  onCreate: (suggestion: any) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-rose-50 border-rose-200 text-rose-700',
  medium: 'bg-amber-50 border-amber-200 text-amber-700',
  low: 'bg-slate-50 border-slate-200 text-slate-600',
  normal: 'bg-slate-50 border-slate-200 text-slate-600',
};

/** Show a compact first page; the owner opts into the rest. */
const PAGE_SIZE = 3;

const NOT_AVAILABLE = 'Not available';

/** Compact label/value pair on a recommendation card. */
function MetaField({ label, value }: { label: string; value: string }) {
  const missing = value === NOT_AVAILABLE;
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-0.5 text-[11px] font-bold leading-snug ${missing ? 'text-slate-400' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  );
}

export default function RecommendationsPage({ recommendations, loading, currencySymbol, onCreate }: RecommendationsPageProps) {
  // LIFECYCLE: Filter out converted/cooldown recommendations from active view
  const activeRecommendations = recommendations.filter((r: any) =>
    !['converted', 'cooldown', 'reevaluate'].includes(r.status)
  );

  // ── System #2 — agentic AI insights ──
  const [insight, setInsight] = useState<MarketingInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(false);

  // ── System #3 — deterministic intelligence pipeline ──
  const [intelResult, setIntelResult] = useState<MarketingIntelligenceResult | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Card lifecycle ──
  const [proposal, setProposal] = useState<{ recommendationId: string; proposalId?: string; error?: string } | null>(null);
  const [draftLoadingId, setDraftLoadingId] = useState('');
  const [rejectLoadingId, setRejectLoadingId] = useState('');
  /** id → proposalId — a draft already exists (never create a second one). */
  const [drafted, setDrafted] = useState<Record<string, string>>({});
  /** id → true — owner rejected this recommendation (persisted server-side). */
  const [rejected, setRejected] = useState<Record<string, boolean>>({});

  const friendlyError = (err: unknown): string => {
    const message = err instanceof Error ? err.message : '';
    if (/429|rate|too many|in progress/i.test(message)) return 'An analysis is already running or you have run too many recently. Please wait a moment and try again.';
    if (/401|403|unauthor|session/i.test(message)) return 'Your session has expired. Please sign in again to run the analysis.';
    return 'The analysis could not be completed. Please try again.';
  };
  const [insightErrorText, setInsightErrorText] = useState('');
  const [intelErrorText, setIntelErrorText] = useState('');
  const [proposalErrorText, setProposalErrorText] = useState('');

  const runInsights = useCallback(async () => {
    setInsightLoading(true);
    setInsightError(false);
    setInsightErrorText('');
    try {
      const res = await runMarketingInsights({ task: 'What marketing issue should I pay attention to this week?' });
      const incoming = res?.result?.insights ?? [];
      // ONE primary card at a time: the latest run's first insight replaces the
      // previous one. No history pile-up, no fabricated content.
      if (!res?.result || incoming.length === 0) {
        setInsight(null);
        setInsightError(true);
        // A null result is deliberately generic; the request layer recorded WHY
        // (offline / timeout / rate limit / session) — surface that cause too.
        setInsightErrorText(
          'AI insights couldn\u2019t be generated right now.' +
          aiFailureCopy(getLastAiFailureReason('/ai/marketing-agent/recommend')),
        );
        return;
      }
      setInsight(incoming[0]);
    } catch (err) {
      setInsight(null);
      setInsightError(true);
      setInsightErrorText('AI insights couldn\u2019t be generated right now.');
      // Rate-limit/session causes are still surfaced, but never raw payloads.
      if (/429|rate|401|403|session/i.test(err instanceof Error ? err.message : '')) {
        setInsightErrorText(friendlyError(err));
      }
    } finally {
      setInsightLoading(false);
    }
  }, []);

  const runIntelligence = useCallback(async () => {
    setIntelLoading(true);
    setIntelError(false);
    setIntelErrorText('');
    try {
      const res = await runMarketingIntelligence({ limit: 12 });
      if (!res?.result) {
        setIntelResult(null);
        setIntelError(true);
        // See runInsights: the recorded failure reason adds the specific cause
        // (offline / client abort / rate limit / session) to the generic line.
        setIntelErrorText(
          'Recommendations couldn\u2019t be loaded right now.' +
          aiFailureCopy(getLastAiFailureReason('/ai/marketing-agent/intelligence')),
        );
        return;
      }
      setIntelResult(res.result);
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setIntelResult(null);
      setIntelError(true);
      setIntelErrorText(/429|rate|401|403|session/i.test(err instanceof Error ? err.message : '') ? friendlyError(err) : 'Recommendations couldn\u2019t be loaded right now.');
    } finally {
      setIntelLoading(false);
    }
  }, []);

  /**
   * Both sections fill themselves on first paint so the page is never blank.
   * A ref guard keeps React StrictMode's double effect from running the calls
   * twice.
   */
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void runInsights();
    void runIntelligence();
  }, [runInsights, runIntelligence]);

  /**
   * DRAFT — the existing proposal flow. `createProposalFromRecommendation`
   * persists the EXACT selected recommendation (sourceRecommendationId) as a
   * pending, editable, never-sent draft.
   */
  const draftRecommendation = async (rec: IntelligenceRecommendation) => {
    if (drafted[rec.id] || draftLoadingId) return;
    setDraftLoadingId(rec.id);
    setProposal(null);
    setProposalErrorText('');
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
        economics: rec.economics as unknown as Record<string, unknown>,
        provenance: rec.provenance,
        why: rec.why,
        target: rec.target as unknown as Record<string, unknown> | undefined,
      });
      const outcome = res?.proposal;
      if (!outcome?.created) {
        setProposalErrorText(outcome?.skipReason ?? 'The draft could not be created. Please try again.');
        return;
      }
      const proposalId = outcome.proposalId ?? '';
      setDrafted((prev) => ({ ...prev, [rec.id]: proposalId }));
      setProposal({ recommendationId: rec.id, proposalId });
    } catch (err) {
      setProposalErrorText(friendlyError(err));
    } finally {
      setDraftLoadingId('');
    }
  };

  /**
   * REJECT — the existing persistent owner-feedback mechanism
   * (`/api/intelligence/recommendations/:id/feedback`, upserted server-side),
   * so the decision survives reloads and feeds the learning loop. The card is
   * marked rejected rather than deleted, and the action cannot repeat.
   */
  const rejectRecommendation = async (rec: IntelligenceRecommendation) => {
    if (rejected[rec.id] || rejectLoadingId) return;
    setRejectLoadingId(rec.id);
    setProposalErrorText('');
    try {
      const res = await recordRecommendationFeedback(rec.id, {
        rating: 'negative',
        categories: ['not_useful'],
        comment: 'Rejected by the owner from Recommended Actions.',
        would_accept_again: false,
      });
      if (res && res.success === false) {
        setProposalErrorText('The rejection could not be saved. Please try again.');
        return;
      }
      setRejected((prev) => ({ ...prev, [rec.id]: true }));
    } catch (err) {
      setProposalErrorText(friendlyError(err));
    } finally {
      setRejectLoadingId('');
    }
  };

  /**
   * CREATE OFFER — hands the selected recommendation to the EXISTING offer
   * creation flow (prefilled), which previews before anything is created. The
   * recommendation id travels with the suggestion so provenance is preserved;
   * nothing is published from here.
   */
  const createOffer = (rec: IntelligenceRecommendation) => {
    const discount = rec.economics?.discountPercent ?? 0;
    if (!(discount > 0)) return; // guarded by the disabled button
    onCreate({
      recommendationSource: 'rule',
      recommendationType: rec.type,
      recommendationSourceId: rec.id,
      action: 'create_offer',
      title: rec.title,
      description: rec.description || rec.recommendedAction,
      recommendationReason: rec.recommendedAction || rec.description,
      priority: ['high', 'medium', 'low'].includes(rec.priority) ? rec.priority : 'medium',
      type: 'percentage',
      value: discount,
      applicableProducts: rec.target?.productIds ?? [],
      applicableCategories: [],
      estimatedReach: 0,
      offerSuggestion: {
        type: 'percentage',
        value: discount,
        title: rec.title,
        description: rec.recommendedAction || rec.description,
        applicableProducts: rec.target?.productIds ?? [],
      },
    });
  };

  const rankedRecommendations: IntelligenceRecommendation[] = intelResult?.ranking.recommendations ?? [];

  // ── Derived card values (real data only) ──
  const targetOf = (rec: IntelligenceRecommendation): string => {
    const names = rec.target?.productNames ?? [];
    if (names.length > 0) return names.join(', ');
    const segments = rec.target?.segmentIds ?? [];
    if (segments.length > 0) return 'Saved customer segments';
    const signals = friendlySignals(rec.provenance?.signalCodes);
    return signals || NOT_AVAILABLE;
  };
  const durationOf = (rec: IntelligenceRecommendation): string => {
    const days = (rec as unknown as { durationDays?: number }).durationDays;
    if (typeof days === 'number' && Number.isFinite(days) && days > 0) return `${days} days`;
    return NOT_AVAILABLE;
  };
  const impactOf = (rec: IntelligenceRecommendation): string => {
    const e = rec.economics;
    if (!e || e.available === false) return NOT_AVAILABLE;
    if (!Number.isFinite(e.incrementalRevenue) || e.incrementalRevenue <= 0) return NOT_AVAILABLE;
    return `+${friendlyMoney(e.incrementalRevenue)} revenue`;
  };
  const hasOfferTerms = (rec: IntelligenceRecommendation): boolean =>
    Number.isFinite(rec.economics?.discountPercent) && (rec.economics?.discountPercent ?? 0) > 0;

  /**
   * SHOW / HIDE RULE — a card is only rendered when it carries at least ONE
   * authoritative decision value (who to target, how long for, what it is
   * expected to earn).
   *
   * A candidate with all three missing is not an action: it is a demand
   * anomaly the engine could not price (the demand-anomaly builder ships an
   * empty target and `economicsUnavailable: true`). Rendering it produced a
   * template card reading "Not available" three times with a disabled Create
   * Offer button, which reads like a broken page rather than an honest gap.
   * Such a candidate is therefore NOT shown; the section explains the low-data
   * reason instead (see `lowDataReason`).
   */
  const hasDecisionData = (rec: IntelligenceRecommendation): boolean =>
    targetOf(rec) !== NOT_AVAILABLE ||
    durationOf(rec) !== NOT_AVAILABLE ||
    impactOf(rec) !== NOT_AVAILABLE;

  const actionableRanked = rankedRecommendations.filter(hasDecisionData);
  /** Candidates the engine produced but that carry nothing actionable. */
  const suppressedCount = rankedRecommendations.length - actionableRanked.length;

  /**
   * Rejected cards STAY on screen, marked "Recommendation rejected": the
   * decision is audited (persisted server-side), never silently deleted, and
   * the marker doubles as the owner's confirmation.
   */
  const visibleRanked = actionableRanked.slice(0, visibleCount);
  const hiddenCount = actionableRanked.length - visibleRanked.length;

  /**
   * Why nothing is shown — read off the suppressed recommendations' OWN missing
   * fields (never invented), phrased for the owner. "Low data" is a valid
   * reason: it is not an error and not an empty pipeline.
   */
  const lowDataReason = (recs: IntelligenceRecommendation[]): string => {
    const missing: string[] = [];
    if (recs.every((r) => targetOf(r) === NOT_AVAILABLE)) missing.push('an audience it could name');
    if (recs.every((r) => durationOf(r) === NOT_AVAILABLE)) missing.push('a duration');
    if (recs.every((r) => !r.economics || r.economics.available === false)) {
      missing.push('verified price and cost data, so it cannot estimate the profit impact');
    }
    const idea = recs.length === 1 ? 'one idea' : `${recs.length} ideas`;
    if (missing.length === 0) {
      return `ChitKuber found ${idea} for you but could not stand behind a single number on it, so it is not recommending an action yet. Add more sales, menu and customer history and try again.`;
    }
    return `ChitKuber found ${idea} for you, but every one was missing ${missing.join(', ')} — so it is not recommending an action yet. Add more sales, menu and customer history, then refresh.`;
  };

  const insightChips = friendlyToolLabels(insight?.toolsUsed?.length ? insight.toolsUsed : insight?.steps?.map((s) => s.tool));

  return (
    <div className="space-y-6">
      {/* ── Page header (central content area only) ── */}
      <div data-testid="marketing-page-header" className="pt-1">
        <h1 className="text-lg font-black tracking-tight text-slate-900">Marketing</h1>
        <p className="text-[13px] font-bold text-slate-600">Smarter Marketing. Better Results.</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Get AI-powered insights and actionable recommendations to grow your restaurant.
        </p>
      </div>

      {/* ══ AI INSIGHTS ══ */}
      <section
        data-testid="ai-insights-section"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900">AI Insights</h2>
            <p className="text-xs text-slate-500 mt-0.5">What the AI found from your restaurant data</p>
            <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              Advisory only — nothing here can be sent.
            </p>
          </div>
          <button
            type="button"
            data-testid="run-ai-insights"
            onClick={() => void runInsights()}
            disabled={insightLoading}
            className="shrink-0 flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {insightLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Run AI Insight</>
            )}
          </button>
        </div>

        {/* Loading — one compact, human-readable state (no internal tool names). */}
        {insightLoading && (
          <div
            data-testid="ai-insight-loading"
            className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-500"
          >
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            Analyzing your restaurant data…
          </div>
        )}

        {/* Error — friendly copy + retry, never a raw backend error. */}
        {insightError && !insightLoading && (
          <div
            data-testid="ai-insight-error"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3"
          >
            <span className="flex items-center gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {insightErrorText || 'AI insights couldn’t be generated right now.'}
            </span>
            <button
              type="button"
              data-testid="ai-insight-retry"
              onClick={() => void runInsights()}
              className="text-xs font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900 cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty — the section explains itself instead of showing a blank box. */}
        {!insight && !insightLoading && !insightError && (
          <p className="mt-4 text-xs text-slate-400" data-testid="ai-insight-empty">
            No insight yet — run an analysis to see what the AI found in your restaurant data.
          </p>
        )}

        {/* ── ONE primary insight card ── */}
        {insight && !insightLoading && (
          <article
            key={insight.id}
            data-testid="ai-insight-card"
            data-insight-id={insight.id}
            className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 border border-violet-100">
                <Lightbulb className="w-4 h-4 text-violet-600" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${PRIORITY_STYLES[insight.priority] ?? PRIORITY_STYLES.normal}`}
                  >
                    {insight.priority} priority
                  </span>
                  {insight.degraded && (
                    <span
                      data-testid="ai-insight-degraded"
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700"
                    >
                      <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Limited
                    </span>
                  )}
                  {typeof insight.confidence === 'number' && insight.confidence >= 0.5 && (
                    <span className="text-[10px] text-slate-400">
                      {Math.round(insight.confidence * 100)}% confidence
                    </span>
                  )}
                </div>

                <h3 className="mt-2 text-sm font-black text-slate-900">{insight.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{insight.summary}</p>

                {insight.recommendation && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      Suggested next step
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-700">{insight.recommendation}</p>
                  </div>
                )}
              </div>
            </div>

            {/* What the AI checked — real sources, deduped, never internal ids. */}
            {insightChips.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3" data-testid="ai-insight-checked">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  What the AI checked
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {insightChips.map((label) => (
                    <li
                      key={label}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}
      </section>

      {/* ══ RECOMMENDED ACTIONS ══ */}
      <section
        data-testid="recommended-actions-section"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900">Recommended Actions</h2>
            <p className="text-xs text-slate-500 mt-0.5">What ChitKuber recommends you do</p>
          </div>
          <button
            type="button"
            data-testid="run-intelligence"
            onClick={() => void runIntelligence()}
            disabled={intelLoading}
            className="shrink-0 flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {intelLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…</>
            ) : (
              'Refresh'
            )}
          </button>
        </div>

        {intelLoading && (
          <div
            data-testid="recommendations-loading"
            className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-500"
          >
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            Reviewing your sales, menu, stock and customer activity…
          </div>
        )}

        {intelError && !intelLoading && (
          <div
            data-testid="recommendations-error"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3"
          >
            <span className="flex items-center gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {intelErrorText || 'Recommendations couldn’t be loaded right now.'}
            </span>
            <button
              type="button"
              data-testid="recommendations-retry"
              onClick={() => void runIntelligence()}
              className="text-xs font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900 cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Draft / reject feedback (kept in this section, never a toast storm). */}
        {proposal && (
          <div
            data-testid="proposal-result"
            className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong>✓ Saved to Drafts</strong> — proposal{' '}
              <strong data-testid="proposal-id">{proposal.proposalId}</strong> created from recommendation{' '}
              <strong data-testid="proposal-source-id">{proposal.recommendationId}</strong>. It stays editable and
              needs your approval before anything can send.
            </span>
          </div>
        )}
        {proposalErrorText && (
          <div
            data-testid="proposal-error"
            className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{proposalErrorText}</span>
          </div>
        )}

        {!intelResult && !intelLoading && !intelError && (
          <p className="mt-4 text-xs text-slate-400" data-testid="recommendations-empty">
            No recommendations yet — refresh to see what ChitKuber recommends.
          </p>
        )}

        {intelResult && rankedRecommendations.length === 0 && !intelLoading && (
          <div className="mt-4" data-testid="recommendations-empty">
            <EmptyState
              icon="🎯"
              title="No recommendations yet"
              subtitle="ChitKuber needs more restaurant activity before it can suggest useful marketing actions."
            />
          </div>
        )}

        {/*
          LOW DATA — the engine produced candidate(s), but none carried a
          target, a duration or an expected impact. No card is rendered (a
          template of three "Not available" cells is not an action) and the
          reason is stated instead. Not an error: nothing failed.
        */}
        {intelResult && rankedRecommendations.length > 0 && actionableRanked.length === 0 && !intelLoading && !intelError && (
          <div className="mt-4" data-testid="recommendations-low-data">
            <EmptyState icon="📊" title="Not enough data for an action yet" subtitle={lowDataReason(rankedRecommendations)} />
          </div>
        )}

        {visibleRanked.length > 0 && (
          <div className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleRanked.map((rec) => {
                const isDrafted = !!drafted[rec.id];
                const isRejected = !!rejected[rec.id];
                const offerEnabled = hasOfferTerms(rec) && !isRejected;
                return (
                  <article
                    key={rec.id}
                    data-testid="recommended-action-card"
                    data-recommendation-id={rec.id}
                    className={`flex flex-col rounded-xl border bg-white p-4 transition-shadow hover:shadow-sm ${
                      isRejected ? 'border-slate-200 opacity-70' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-indigo-600">
                        {friendlyCategory(rec)}
                      </span>
                      {rec.economics?.economicallySafe ? (
                        <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">
                          Within limits
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700">
                          Check limits
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2.5 text-sm font-black leading-snug text-slate-900">{rec.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500 line-clamp-3">
                      {rec.description || rec.recommendedAction || NOT_AVAILABLE}
                    </p>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                      <MetaField label="Target" value={targetOf(rec)} />
                      <MetaField label="Duration" value={durationOf(rec)} />
                      <MetaField label="Expected impact" value={impactOf(rec)} />
                    </div>

                    {rec.economics && rec.economics.available !== false && (
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                        {friendlyEconomics(
                          rec.economics.discountPercent,
                          rec.economics.projectedContributionMargin,
                          rec.economics.economicallySafe,
                          true,
                        )}
                        {rec.economics.paybackPeriodDays > 0 && ` Payback: ${rec.economics.paybackPeriodDays} days.`}
                      </p>
                    )}

                    {/* Real provenance only — shown when the engine produced it. */}
                    {(rec.provenance?.mlKinds?.length ?? 0) > 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">
                        Predictions used: {friendlyMlKinds(rec.provenance.mlKinds)}
                      </p>
                    )}
                    {rec.risks.length > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-600">
                        Watch out: {rec.risks.join('; ')}
                      </p>
                    )}

                    <div className="mt-auto pt-3">
                      {isRejected ? (
                        <p
                          data-testid={`rejected-${rec.id}`}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-500"
                        >
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Recommendation rejected
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid={`create-proposal-${rec.id}`}
                            onClick={() => void draftRecommendation(rec)}
                            disabled={isDrafted || draftLoadingId === rec.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer transition-colors disabled:cursor-default disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            {draftLoadingId === rec.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isDrafted ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            {isDrafted ? 'Saved to Drafts' : 'Draft'}
                          </button>

                          <button
                            type="button"
                            data-testid={`reject-${rec.id}`}
                            onClick={() => void rejectRecommendation(rec)}
                            disabled={rejectLoadingId === rec.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          >
                            {rejectLoadingId === rec.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            Reject
                          </button>

                          {/*
                            Create Offer — same treatment as the Create Offer
                            button on the "Opportunities for you" cards below
                            (brand colour, rounded-xl, Plus icon, press
                            feedback), so the two offer entry points are one
                            visual language. It stays disabled until the
                            recommendation actually carries offer terms.
                          */}
                          <button
                            type="button"
                            data-testid={`create-offer-${rec.id}`}
                            onClick={() => createOffer(rec)}
                            disabled={!offerEnabled}
                            title={
                              offerEnabled
                                ? 'Open the offer builder prefilled with this recommendation'
                                : 'No offer terms are available for this recommendation yet.'
                            }
                            className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-color)]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Create Offer
                          </button>
                        </div>
                      )}

                      <p className="mt-2 text-[10px] text-slate-400">
                        {isDrafted
                          ? 'Draft saved — editable, nothing has been sent.'
                          : 'Drafts stay editable. Nothing sends without your approval.'}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>

            {hiddenCount > 0 && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  data-testid="view-more-recommendations"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  View more recommendations
                  <span className="text-[10px] text-slate-400">({hiddenCount} more)</span>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Transparency: actionable cards are shown, the ones without a
                single usable value are not — say how many, never silently. */}
            {suppressedCount > 0 && (
              <p className="mt-4 text-[10px] text-slate-400" data-testid="recommendations-suppressed-note">
                {suppressedCount === 1 ? '1 idea was' : `${suppressedCount} ideas were`} not shown — no target, duration or
                estimated impact was available for {suppressedCount === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>
        )}
      </section>

      {/*
        ══ DEEP ANALYSIS ══
        The canonical /analyze path. A SEPARATE section with its own endpoint
        and its own owner-invoked run: it never touches the two intelligence
        sections above or the opportunity cards below.
      */}
      <DeepAnalysisPanel currencySymbol={currencySymbol} />

      {/* ── Rule/ML opportunity cards (pre-existing offer-engine surface) ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">AI + rule based</p>
          <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" /> Opportunities for you
          </h3>
          <p className="text-[11px] text-gray-400 mt-1">
            Ideas detected from your weather, festivals, inventory, sales and customers. Pick one to start.
          </p>
        </div>
      </div>

      {loading ? (
        <Spinner label="Scanning for opportunities…" />
      ) : activeRecommendations.length === 0 ? (
        <EmptyState
          icon="🪄"
          title="Nothing to recommend right now"
          subtitle="Opportunities appear based on weather, festivals, inventory levels and customer activity. Create a promotion manually any time."
          cta={
            <button
              onClick={() => onCreate({ title: 'New promotion', type: 'percentage', value: 10, description: '', recommendationSource: 'manual', recommendationReason: '', estimatedReach: 0, expectedImpact: '', priority: 'medium', applicableCategories: [] })}
              className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Create a promotion
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeRecommendations.map((rec, i) => (
            <OpportunityCard key={i} suggestion={rec} currencySymbol={currencySymbol} onCreate={() => onCreate(rec)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationsPage — all detected opportunities in one place. Each card is
 * driven by the existing recommendation engine (/offers/recommendations); the
 * UI only shows friendly labels and a "Create Offer" action.
 *
 * On top of that, the deterministic marketing agent is surfaced to the owner:
 * "Run agent" calls POST /ai/marketing-agent/recommend (read-only targeting),
 * and "Save as proposal" persists it as a pending CampaignProposal draft via
 * POST /ai/marketing-agent/proposal. The agent never creates offers itself.
 */

import React, { useState } from 'react';
import { Sparkles, Bot, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Target, Users, TrendingUp, Brain, ShieldCheck } from 'lucide-react';
import { OpportunityCard } from './MarketingHome';
import { EmptyState, Spinner } from './shared';
import {
  friendlyTargetingReason,
  friendlyScope,
  customerGroupPhrase,
  customerScoreHint,
  friendlySignals,
  friendlyMlKinds,
  friendlyMoney,
  friendlyBreakEven,
  friendlyEconomics,
} from './agentCopy';
import {
  runMarketingAgent,
  createMarketingAgentProposal,
  runMarketingIntelligence,
  type MarketingAgentResult,
  type AgentProposalOutcome,
  type MarketingIntelligenceResult,
  type IntelligenceRecommendation,
} from '../../api/client';

interface RecommendationsPageProps {
  recommendations: any[];
  loading: boolean;
  currencySymbol: string;
  onCreate: (suggestion: any) => void;
  /** Called after a proposal is successfully saved so the workspace refetches the inbox. */
  onProposalSaved?: () => void;
  /** Jump to the Approvals tab after saving. */
  onOpenApprovals?: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  CAUSAL_UPLIFT: 'Causal uplift',
  RESPONSE_MODEL: 'Response model',
  ML_SEGMENTS: 'ML segments',
  NONE: 'No signal yet',
};

export default function RecommendationsPage({ recommendations, loading, currencySymbol, onCreate, onProposalSaved, onOpenApprovals }: RecommendationsPageProps) {
  // LIFECYCLE: Filter out converted/cooldown recommendations from active view
  const activeRecommendations = recommendations.filter((r: any) =>
    !['converted', 'cooldown', 'reevaluate'].includes(r.status)
  );

  // ── Marketing agent (owner-facing targeting plan) ──
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState<MarketingAgentResult | null>(null);
  const [agentError, setAgentError] = useState('');
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalOutcome, setProposalOutcome] = useState<AgentProposalOutcome | null>(null);

  // ── Phase 3–7 intelligence panel (read-only decision evidence) ──
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelResult, setIntelResult] = useState<MarketingIntelligenceResult | null>(null);
  const [intelError, setIntelError] = useState('');

  const runIntelligence = async () => {
    setIntelLoading(true);
    setIntelError('');
    try {
      const res = await runMarketingIntelligence({ limit: 8 });
      if (!res?.result) {
        setIntelResult(null);
        setIntelError('The detailed intelligence run is unavailable right now. Please try again when you are online.');
        return;
      }
      setIntelResult(res.result);
    } finally {
      setIntelLoading(false);
    }
  };

  const runAgent = async () => {
    setAgentLoading(true);
    setAgentError('');
    setProposalOutcome(null);
    try {
      const res = await runMarketingAgent();
      if (!res?.result) {
        setAgentResult(null);
        setAgentError('The marketing agent is unavailable right now. Check that the backend is reachable and try again.');
        return;
      }
      setAgentResult(res.result);
    } finally {
      setAgentLoading(false);
    }
  };

  const saveProposal = async () => {
    setProposalLoading(true);
    try {
      const res = await createMarketingAgentProposal();
      const outcome = res?.proposal ?? { created: false, skipReason: 'Could not reach the agent — no proposal was created. Try again when you are online.' };
      setProposalOutcome(outcome);
      if (outcome.created) onProposalSaved?.();
    } finally {
      setProposalLoading(false);
    }
  };

  const evidenceLines = agentResult
    ? [agentResult.festivalContext, agentResult.sportsContext, agentResult.competitionContext, agentResult.basketContext, agentResult.demandContext].filter(Boolean) as string[]
    : [];

  // Segment-first audience: real segment chips as-is; customer-level scores
  // grouped into ONE chip (never a promotion per single customer).
  const segmentTargets = agentResult ? agentResult.targets.filter((t) => t.refType === 'segment') : [];
  const customerTargets = agentResult ? agentResult.targets.filter((t) => t.refType === 'customer') : [];
  const bestCustomerScore = customerTargets.reduce<number | null>(
    (best, t) => (typeof t.score === 'number' && (best === null || t.score > best) ? t.score : best),
    null,
  );

  return (
    <div className="space-y-5">
      {/* ── Marketing agent panel ── */}
      <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1">Marketing agent</p>
            <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-500" /> AI targeting plan
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              Runs the deterministic agent over your sales, customers and context. Nothing is created until you approve it.
            </p>
          </div>
          <button
            type="button"
            onClick={runAgent}
            disabled={agentLoading}
            className="shrink-0 flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {agentLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5" /> {agentResult ? 'Refresh plan' : 'Run agent'}</>
            )}
          </button>
        </div>

        {agentError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{agentError}</span>
          </div>
        )}

        {agentResult && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-lg bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {SOURCE_LABELS[agentResult.targetingSource] || agentResult.targetingSource}
              </span>
              <span className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {agentResult.targets.length} target{agentResult.targets.length === 1 ? '' : 's'}
              </span>
            </div>

            <p className="text-[11px] text-gray-600"><strong>Why:</strong> {friendlyTargetingReason(agentResult.targetingReason)}</p>
            <p className="text-[10px] text-gray-400">{friendlyScope(agentResult.targetingScope)}</p>

            {agentResult.targets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Audience</p>
                <div className="flex flex-wrap gap-2">
                  {segmentTargets.slice(0, 8).map((t, i) => (
                    <span
                      key={`${t.refId}-${i}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700"
                    >
                      <Target className="w-3 h-3 text-gray-400" />
                      {t.label || t.refId}
                    </span>
                  ))}
                  {customerTargets.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50/50 px-2 py-1 text-[11px] font-semibold text-gray-700"
                      title="Grouped audience — one promotion reaches everyone in it, not one per customer."
                    >
                      <Users className="w-3 h-3 text-purple-400" />
                      {customerTargets.length} customers
                      <span className="text-gray-400 font-normal">· {customerGroupPhrase(agentResult.targetingSource)}</span>
                      {customerScoreHint(agentResult.targetingSource, bestCustomerScore)}
                    </span>
                  )}
                  {segmentTargets.length > 8 && (
                    <span className="inline-flex items-center text-[10px] text-gray-400">+{segmentTargets.length - 8} more groups</span>
                  )}
                </div>
              </div>
            )}

            {agentResult.offerDraft && (
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Offer draft</p>
                <p className="text-xs font-bold text-gray-900">{agentResult.offerDraft.title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{agentResult.offerDraft.rationale}</p>
              </div>
            )}

            {evidenceLines.length > 0 && (
              <ul className="space-y-1">
                {evidenceLines.map((line, i) => (
                  <li key={i} className="text-[11px] text-gray-500">• {line}</li>
                ))}
              </ul>
            )}

            {agentResult.nextActions.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Recommended next steps</p>
                <ul className="space-y-1">
                  {agentResult.nextActions.map((a, i) => (
                    <li key={i} className="text-[11px] text-gray-600">• {a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={saveProposal}
                disabled={proposalLoading || agentResult.targetingSource === 'NONE'}
                title={agentResult.targetingSource === 'NONE' ? 'No signal yet — the agent needs customer history or ML data first.' : undefined}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--brand-color)] px-3.5 py-2 text-xs font-bold text-[var(--brand-color)] cursor-pointer hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {proposalLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Save as proposal</>
                )}
              </button>
              {proposalOutcome && (
                proposalOutcome.created ? (
                  <span className="flex items-center gap-2 text-[11px] font-semibold text-emerald-600">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Proposal sent to your approvals.
                    </span>
                    {onOpenApprovals && (
                      <button
                        type="button"
                        onClick={onOpenApprovals}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 cursor-pointer hover:bg-emerald-100"
                      >
                        Review it →
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> {proposalOutcome.skipReason || 'Not enough signal to create a proposal yet.'}
                  </span>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Intelligence pipeline panel (Phases 3–7) ── */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Detailed intelligence</p>
            <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
              <Brain className="w-4 h-4 text-indigo-500" /> What to do next, and why
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              Checks sales, menu, stock, customers and past offers, then ranks the best options with their numbers. Nothing is created or sent — you approve everything.
            </p>
          </div>
          <button
            type="button"
            onClick={runIntelligence}
            disabled={intelLoading}
            className="shrink-0 flex items-center gap-1.5 bg-indigo-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {intelLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
            ) : (
              <><TrendingUp className="w-3.5 h-3.5" /> {intelResult ? 'Refresh analysis' : 'Analyse my restaurant'}</>
            )}
          </button>
        </div>

        {intelError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{intelError}</span>
          </div>
        )}

        {intelResult && (
          <div className="mt-4 space-y-3">
            {/* Top recommendation + owner-language explanation */}
            {intelResult.explanation && intelResult.ranking.recommendations.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-1">Top suggestion</p>
                <p className="text-xs font-bold text-gray-900">{intelResult.explanation.explanation.recommendation}</p>
                <p className="text-[11px] text-gray-600 mt-1">{intelResult.explanation.explanation.whyItFits}</p>
                {intelResult.explanation.explanation.evidenceSummary.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {intelResult.explanation.explanation.evidenceSummary.map((line, i) => (
                      <li key={i} className="text-[11px] text-gray-500">• {line}</li>
                    ))}
                  </ul>
                )}
                {intelResult.explanation.explanation.offerDescription && (
                  <p className="text-[11px] text-gray-600 mt-1.5">
                    <strong>Offer idea:</strong> {intelResult.explanation.explanation.offerDescription}
                  </p>
                )}
                {intelResult.explanation.explanation.campaignCopy && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    <strong>Message you could send:</strong> “{intelResult.explanation.explanation.campaignCopy}”
                  </p>
                )}
                {intelResult.explanation.source === 'deterministic' && (
                  <p className="text-[10px] text-gray-400 mt-1">Generated without AI wording — the numbers are unchanged.</p>
                )}
              </div>
            )}

            {/* Ranked options */}
            {intelResult.ranking.recommendations.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ranked options ({intelResult.ranking.recommendations.length})</p>
                {intelResult.ranking.recommendations.map((rec: IntelligenceRecommendation) => (
                  <div key={rec.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-gray-900">
                          #{rec.rank} {rec.title}
                        </p>
                        <p className="text-[10px] text-gray-400">{rec.strategyLabel} · confidence {Math.round(rec.confidence * 100)}%</p>
                      </div>
                      {rec.economics.economicallySafe ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          <ShieldCheck className="w-3 h-3" /> Within limits
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          <AlertTriangle className="w-3 h-3" /> Check limits
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-600 mt-1">{rec.description}</p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {friendlyEconomics(rec.economics.discountPercent, rec.economics.projectedContributionMargin, rec.economics.economicallySafe)}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Expected extra sales: {friendlyMoney(rec.economics.incrementalRevenue)} · {friendlyBreakEven(rec.economics.breakEvenIncrementalUnits)}
                    </p>
                    {rec.provenance.signalCodes.length > 0 && (
                      <p className="text-[10px] text-gray-400 mt-1">Based on: {friendlySignals(rec.provenance.signalCodes)}</p>
                    )}
                    {rec.provenance.mlKinds.length > 0 && (
                      <p className="text-[10px] text-gray-400">Predictions used: {friendlyMlKinds(rec.provenance.mlKinds)}</p>
                    )}
                    {rec.risks.length > 0 && (
                      <p className="text-[10px] text-amber-600 mt-1">Watch out: {rec.risks.join('; ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Evidence + memory + limits, in plain language */}
            {intelResult.investigation && intelResult.investigation.topSignalLines.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">What we found</p>
                <ul className="space-y-0.5">
                  {intelResult.investigation.topSignalLines.slice(0, 5).map((line, i) => (
                    <li key={i} className="text-[11px] text-gray-500">• {line}</li>
                  ))}
                </ul>
              </div>
            )}

            {intelResult.memory.statements.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">What we learned before</p>
                <ul className="space-y-0.5">
                  {intelResult.memory.statements.slice(0, 3).map((m) => (
                    <li key={m.ref} className="text-[11px] text-gray-500">• {m.statement}</li>
                  ))}
                </ul>
              </div>
            )}

            {intelResult.degradations.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">What is not available right now</p>
                <ul className="space-y-0.5">
                  {intelResult.degradations.slice(0, 4).map((line, i) => (
                    <li key={i} className="text-[10px] text-gray-500">• {line}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-gray-400">
              You stay in control: pick an option above and use “Save as proposal” — nothing is sent automatically.
            </p>
          </div>
        )}
      </div>

      {/* ── Rule/ML opportunity cards ── */}
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

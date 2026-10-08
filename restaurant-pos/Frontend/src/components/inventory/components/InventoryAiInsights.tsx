/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryAiInsights — the "AI INVENTORY INSIGHTS" section on the Inventory
 * Overview. Presentation layer only; the intelligence lives in the EXISTING
 * backend agent (POST /ai/inventory-agent/recommend with `agentic: true`),
 * which investigates with its own read-only tools and returns a server-
 * validated, evidence-grounded assessment.
 *
 * Hard rules implemented here:
 *   - READ-ONLY: this section never writes to inventory — it only explains.
 *   - The deterministic inventory system stays authoritative: every number the
 *     owner reads is server text that the backend already grounded against its
 *     tool evidence. This UI computes no quantities, dates or costs of its own
 *     (only counts of rows the server actually returned).
 *   - "What the AI checked" chips come from `toolsUsed` (server truth), are
 *     deduplicated and use owner-friendly labels — raw tool names never show.
 *   - An unavailable source is shown as DATA UNAVAILABLE, never as "no risk".
 *   - A degraded run shows a PARTIAL ANALYSIS warning; findings supported by
 *     the available evidence still render.
 *   - Severity comes from the server (already floored at the deterministic
 *     severity there) — the UI never upgrades or downgrades it.
 *   - Nothing runs automatically; the owner clicks "Run AI Analysis".
 *   - Owner-facing language only: no agents, tools, models or endpoints.
 */

import { useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, Check, CircleAlert,
  ArrowRight, ShieldCheck,
} from 'lucide-react';
import {
  runInventoryAgentInsight,
  getLastAiFailureReason,
  type InventoryAgentInsightResult,
  type InventoryAiIssue,
  type InventoryAiSeverity,
} from '../../../api/client';
import { aiFailureCopy } from '../../marketing/agentCopy';
import type { InventoryPage } from '../types';

/** The owner's investigation task — deliberately open; the agent chooses tools. */
const ANALYSIS_TASK =
  "Analyze the restaurant's current inventory and identify the most important stock, expiry, wastage, or demand-related issue. Investigate the relevant data sources and explain the finding with evidence.";

/**
 * Tool → owner-facing chip. The chip is honest about an empty source: core
 * tools derive it from the result's evidenceSources; extended tools from the
 * server's per-tool availability map (a tool can run and still report that it
 * had no data).
 */
const CHECK_LABELS: Record<string, { label: string; source?: keyof InventoryAgentInsightResult['evidenceSources'] }> = {
  // Authoritative inventory sources
  getInventoryStatus: { label: 'Current stock', source: 'inventory' },
  getStockoutRisk: { label: 'Stockout risk', source: 'demandForecast' },
  getExpiryRisk: { label: 'Expiry risk', source: 'expiry' },
  getWastage: { label: 'Wastage history', source: 'wastage' },
  // Extended investigation surface (ML prediction + demand context)
  getDemandForecast: { label: 'AI demand prediction' },
  getSalesTrends: { label: 'Sales trends' },
  getMenuPerformance: { label: 'Menu performance' },
  getProductMargins: { label: 'Item margins' },
  getProductCombinations: { label: 'Bought-together items' },
  getFestivalContext: { label: 'Festival calendar' },
  getSportsContext: { label: 'Sports events' },
};

const SEVERITY_BADGE: Record<InventoryAiSeverity, { label: string; cls: string } | null> = {
  critical: { label: 'CRITICAL', cls: 'bg-red-50 text-red-600 border-red-200' },
  high: { label: 'HIGH PRIORITY', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  medium: { label: 'MEDIUM PRIORITY', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'LOW PRIORITY', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  normal: null,
};

/** Issue types → secondary card categories. Nothing is invented beyond these. */
const STOCKOUT_TYPES = new Set(['low_stock', 'out_of_stock', 'stockout_risk']);
const EXPIRY_TYPES = new Set(['expiry_risk']);
const WASTAGE_TYPES = new Set(['wastage_risk']);
const INFORMATIONAL_TYPES = new Set(['no_immediate_risk', 'data_unavailable']);

interface CheckedChip {
  tool: string;
  label: string;
  unavailable: boolean;
  /** A risk tool that RAN and found nothing — a clean check, not a failure.
   *  Only meaningful when `unavailable` is false. */
  noneFound?: boolean;
}

/** Risk tools → the issue types that count as a finding for their chip. */
const RISK_CHIP_ISSUES: Record<string, string[]> = {
  getStockoutRisk: ['low_stock', 'out_of_stock', 'stockout_risk'],
  getExpiryRisk: ['expiry_risk'],
  getWastage: ['wastage_risk'],
};

interface SecondaryCard {
  key: string;
  label: string;
  headline: string;
  body: string;
  tone: 'red' | 'amber' | 'orange' | 'slate';
  navigateTo?: InventoryPage;
  navigateLabel?: string;
}

const CARD_TONE: Record<SecondaryCard['tone'], string> = {
  red: 'border-red-200 bg-red-50/60',
  amber: 'border-amber-200 bg-amber-50/60',
  orange: 'border-orange-200 bg-orange-50/60',
  slate: 'border-slate-200 bg-slate-50',
};

/** Distinct item names across issues — a count of returned rows, nothing else. */
function distinctItems(issues: InventoryAiIssue[]): string[] {
  const names = new Set<string>();
  for (const i of issues) {
    const n = (i.itemName || i.itemId || '').trim();
    if (n) names.add(n);
  }
  return [...names];
}

function joinExplanations(issues: InventoryAiIssue[], max: number): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const i of issues) {
    const text = (i.explanation || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
    if (parts.length >= max) break;
  }
  const remaining = distinctItems(issues).length - distinctItems(issues.slice(0, max)).length;
  const body = parts.join(' ');
  return remaining > 0 ? `${body} ${remaining} more item${remaining === 1 ? '' : 's'} need review.` : body;
}

/** Group the server's issues into the compact secondary cards (if any). */
function secondaryCards(issues: InventoryAiIssue[]): SecondaryCard[] {
  const cards: SecondaryCard[] = [];
  const actionable = issues.filter((i) => !INFORMATIONAL_TYPES.has(i.type));

  const stockout = actionable.filter((i) => STOCKOUT_TYPES.has(i.type));
  if (stockout.length > 0) {
    const n = distinctItems(stockout).length || stockout.length;
    cards.push({
      key: 'stockout',
      label: 'STOCKOUT RISK',
      headline: `${n} ingredient${n === 1 ? '' : 's'} at risk of running out`,
      body: joinExplanations(stockout, 2),
      tone: stockout.some((i) => i.severity === 'critical') ? 'red' : 'amber',
      navigateTo: 'items',
      navigateLabel: 'View inventory',
    });
  }

  const expiry = actionable.filter((i) => EXPIRY_TYPES.has(i.type));
  if (expiry.length > 0) {
    const n = distinctItems(expiry).length || expiry.length;
    cards.push({
      key: 'expiry',
      label: 'EXPIRY RISK',
      headline: `${n} ingredient${n === 1 ? '' : 's'} may expire soon`,
      body: joinExplanations(expiry, 2),
      tone: expiry.some((i) => i.severity === 'critical') ? 'red' : 'amber',
      navigateTo: 'expiry',
      navigateLabel: 'View inventory',
    });
  }

  const wastage = actionable.filter((i) => WASTAGE_TYPES.has(i.type));
  if (wastage.length > 0) {
    const n = distinctItems(wastage).length || wastage.length;
    cards.push({
      key: 'wastage',
      label: 'WASTAGE',
      headline: n > 1 ? `Wastage recorded across ${n} ingredients` : 'Food wastage needs attention',
      body: joinExplanations(wastage, 2),
      tone: 'orange',
      navigateTo: 'waste',
      navigateLabel: 'View details',
    });
  }

  const unavailable = issues.filter((i) => i.type === 'data_unavailable');
  if (unavailable.length > 0) {
    cards.push({
      key: 'unavailable',
      label: 'DATA UNAVAILABLE',
      headline: 'Some inventory data could not be assessed',
      body: joinExplanations(unavailable, 2) ||
        'Part of this analysis could not be completed because the required data was unavailable.',
      tone: 'slate',
    });
  }

  return cards;
}

/** Chips for exactly the sources the investigation actually used (deduped). */
function checkedChips(result: InventoryAgentInsightResult): CheckedChip[] {
  const chips: CheckedChip[] = [];
  const seen = new Set<string>();
  const issues = result.issues ?? [];
  for (const tool of result.toolsUsed ?? []) {
    if (seen.has(tool)) continue;
    seen.add(tool);
    const meta = CHECK_LABELS[tool];
    if (!meta) continue; // never expose an unmapped/raw tool name
    const unavailable = meta.source
      ? result.evidenceSources?.[meta.source] === false
      : result.toolAvailability?.[tool] === false;
    // Only a risk tool that actually ran can be "checked, none found" — an
    // empty source must never be dressed up as a clean result.
    const riskTypes = RISK_CHIP_ISSUES[tool];
    const noneFound = !unavailable && !!riskTypes
      ? !issues.some((i) => !INFORMATIONAL_TYPES.has(i.type) && riskTypes.includes(i.type))
      : undefined;
    chips.push({ tool, label: meta.label, unavailable, noneFound });
  }
  return chips;
}

export default function InventoryAiInsights({ onNavigate }: { onNavigate?: (page: InventoryPage) => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InventoryAgentInsightResult | null>(null);
  const [failed, setFailed] = useState(false);
  /** Specific cause of the last failed run (timeout / rate limit / offline…). */
  const [failedReason, setFailedReason] = useState<string>('');

  const run = async () => {
    setLoading(true);
    setFailed(false);
    setFailedReason('');
    try {
      const res = await runInventoryAgentInsight({ task: ANALYSIS_TASK });
      if (!res?.result) {
        // The request layer recorded WHY the run produced nothing (offline /
        // client abort / rate limit / session) — show that cause, not one
        // generic line for four different problems.
        setResult(null);
        setFailed(true);
        setFailedReason(aiFailureCopy(getLastAiFailureReason('/ai/inventory-agent/recommend')));
        return;
      }
      setResult(res.result);
    } catch {
      // Client functions never reject (request() swallows network errors);
      // this catch exists so an unexpected rejection still lands in the
      // retry state instead of crashing the section.
      setResult(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const chips = result ? checkedChips(result) : [];
  const issues = result?.issues ?? [];
  const actionable = issues.filter((i) => !INFORMATIONAL_TYPES.has(i.type));
  const hasUnavailableSource = chips.some((c) => c.unavailable);
  const incomplete = !!result && (result.degraded || result.status === 'insufficient_data' || hasUnavailableSource);
  const healthy = !!result && actionable.length === 0 && !incomplete;
  const cards = secondaryCards(issues);

  const severity = result?.assessment?.priority;
  const badge = severity ? SEVERITY_BADGE[severity] : null;
  const nextStep =
    result?.nextActions?.[0] ||
    result?.recommendations?.[0]?.rationale ||
    'Review the highlighted ingredients in Inventory.';

  return (
    <div className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-5 sm:p-6 shadow-sm">
      {/* ── Section header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-black text-[var(--brand-color)] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI Inventory Insights
          </p>
          <h2 className="text-base sm:text-lg font-extrabold text-gray-900">What the AI found in your inventory</h2>
          <p className="text-[11px] text-gray-400 mt-1">
            AI analysis is advisory. Your inventory data and stock rules remain authoritative.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="shrink-0 flex items-center gap-2 bg-[var(--brand-color)] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Analyzing…' : result ? 'Run AI Analysis again' : 'Run AI Analysis'}
        </button>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-[var(--color-border-default)] bg-gray-50 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--brand-color)]" />
          <span className="text-sm font-semibold text-gray-600">Analyzing your inventory…</span>
        </div>
      )}

      {/* ── Request failure ── */}
      {failed && !loading && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-amber-800">
              AI inventory analysis couldn't be completed.
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

      {/* ── Result ── */}
      {result && !loading && (
        <div className="mt-5 space-y-4">
          {incomplete && actionable.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Partial analysis</p>
                <p className="text-xs text-amber-800 font-medium">
                  Some inventory data was unavailable, so this analysis may be incomplete.
                </p>
              </div>
            </div>
          )}

          {healthy ? (
            /* ── Healthy: only when the evidence actually supports it ── */
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-black text-emerald-600 uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5" /> Inventory looks healthy
              </span>
              <p className="text-sm text-gray-700 mt-2.5 font-medium">
                No significant stockout, expiry, or wastage issue was detected in the available inventory data.
              </p>
            </div>
          ) : actionable.length === 0 && incomplete ? (
            /* ── Incomplete, NOT "no problems" ── */
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
              <span className="inline-flex rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-black text-amber-700 uppercase tracking-wider">
                Partial analysis
              </span>
              <p className="text-sm text-gray-700 mt-2.5 font-medium">
                Inventory analysis is incomplete because some data was unavailable.
              </p>
              {result?.summary && <p className="text-xs text-gray-500 mt-1.5">{result.summary}</p>}
            </div>
          ) : (
            /* ── Primary insight card ── */
            <div className="rounded-2xl border border-[var(--color-border-default)] bg-white p-4 sm:p-5">
              {badge && (
                <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
              <h3 className="text-base sm:text-lg font-extrabold text-gray-900 mt-2">
                {result?.assessment?.title || 'Inventory situation'}
              </h3>
              <p className="text-sm text-gray-600 mt-1.5">
                {result?.assessment?.summary || result?.summary}
              </p>
              <div className="mt-3 rounded-xl bg-gray-50 border border-[var(--color-border-default)] px-3.5 py-2.5">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Suggested next step</p>
                <p className="text-xs sm:text-sm text-gray-700 font-medium mt-0.5">{nextStep}</p>
              </div>
            </div>
          )}

          {/* ── What the AI checked (from the actual investigation) ── */}
          {chips.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">What the AI checked</p>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) =>
                  c.unavailable ? (
                    <span
                      key={c.tool}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"
                    >
                      <CircleAlert className="w-3.5 h-3.5" /> {c.label} unavailable
                    </span>
                  ) : (
                    <span
                      key={c.tool}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                    >
                      <Check className="w-3.5 h-3.5" /> {c.label}
                      {c.noneFound && <span className="font-normal text-emerald-600/80">— none found</span>}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}

          {/* ── Secondary findings — only what the server actually reported ── */}
          {cards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cards.map((card) => (
                <div key={card.key} className={`rounded-2xl border p-4 ${CARD_TONE[card.tone]}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{card.label}</p>
                  <p className="text-sm font-extrabold text-gray-900 mt-1">{card.headline}</p>
                  {card.body && <p className="text-xs text-gray-600 mt-1.5">{card.body}</p>}
                  {card.navigateTo && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate(card.navigateTo as InventoryPage)}
                      className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer"
                    >
                      {card.navigateLabel} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

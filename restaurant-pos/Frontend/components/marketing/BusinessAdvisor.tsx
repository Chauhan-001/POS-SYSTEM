/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BusinessAdvisor — the AI Business Advisor frontend.
 *
 * Flow: owner picks a business goal → the backend analyzes the restaurant's
 * real data (sales, inventory, margins, customers, offers, calendar) and
 * returns 3–5 ranked recommendations → each card shows evidence, economics,
 * confidence, risk and an action button that opens the EXISTING offer/campaign
 * builders (never a second offer engine).
 *
 * Icons are lucide-react (no food emojis). The LLM is only an enhancement —
 * the deterministic copy always shows, so the feature works offline too.
 */

import React, { useCallback, useState } from 'react';
import {
  ArrowUpRight, Boxes, Users, Wallet, ShoppingCart, Target, UtensilsCrossed,
  Sparkles, CheckCircle2, AlertTriangle, Info, TrendingUp, Tag, Megaphone,
  PackageSearch, BadgeIndianRupee, Loader2, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';

export type AdvisorGoal =
  | 'increase_sales'
  | 'move_inventory'
  | 'bring_customers_back'
  | 'increase_profit'
  | 'increase_aov'
  | 'create_offer'
  | 'create_combo';

export interface AdvisorCandidate {
  id?: string;
  recommendationType: string;
  title: string;
  why: string;
  evidence: string[];
  economics?: {
    price?: number;
    marginPercent?: number;
    discount?: number;
    currentAov?: number;
    projectedAov?: number;
    minOrderValue?: number;
  };
  expectedImpact: string;
  risk?: string;
  confidence: 'Low' | 'Medium' | 'High';
  score: number;
  supportingSignals: string[];
  offerSuggestion?: any;
  action: 'create_offer' | 'create_combo' | 'create_campaign' | 'review_inventory' | 'review_pricing';
}

export interface AdvisorResult {
  goal: AdvisorGoal;
  recommendations: AdvisorCandidate[];
  insufficientData: boolean;
  note?: string;
  analyzed: { sales: boolean; inventory: boolean; customers: boolean; margins: boolean; offers: boolean; calendar: boolean };
}

interface BusinessAdvisorProps {
  currencySymbol: string;
  branches?: { id: string; name: string; isActive?: boolean }[];
  /** Create an offer/combo through the existing builder with a prefill. */
  onCreateSuggestion?: (suggestion: any) => void;
  /** Jump to the Inventory module (review_inventory action). */
  onReviewInventory?: () => void;
  /** Jump to the Offers page. */
  onViewOffers?: () => void;
  notify?: (msg: string) => void;
}

const GOALS: { id: AdvisorGoal; label: string; description: string; icon: React.ElementType; tone: string }[] = [
  { id: 'increase_sales', label: 'Increase Sales', description: 'Grow revenue with combos, upsells and targeted offers', icon: TrendingUp, tone: 'from-blue-500 to-indigo-500' },
  { id: 'move_inventory', label: 'Move Inventory', description: 'Clear overstock and slow-moving stock before it ages', icon: Boxes, tone: 'from-amber-500 to-orange-500' },
  { id: 'bring_customers_back', label: 'Bring Customers Back', description: 'Win back lapsed customers with a targeted campaign', icon: Users, tone: 'from-emerald-500 to-teal-500' },
  { id: 'increase_profit', label: 'Increase Profit', description: 'Push high-margin items and protect thin margins', icon: Wallet, tone: 'from-violet-500 to-purple-500' },
  { id: 'increase_aov', label: 'Increase Average Order Value', description: 'Add-ons and pairings that raise the basket size', icon: ShoppingCart, tone: 'from-pink-500 to-rose-500' },
  { id: 'create_offer', label: 'Create an Offer', description: 'A data-backed offer built from your real performance', icon: Target, tone: 'from-cyan-500 to-sky-500' },
  { id: 'create_combo', label: 'Create a Combo', description: 'Bundle your top sellers with proven purchase affinity', icon: UtensilsCrossed, tone: 'from-fuchsia-500 to-pink-500' },
];

const GOAL_TITLES: Record<AdvisorGoal, string> = {
  increase_sales: 'Increase Sales',
  move_inventory: 'Move Inventory',
  bring_customers_back: 'Bring Customers Back',
  increase_profit: 'Increase Profit',
  increase_aov: 'Increase Average Order Value',
  create_offer: 'Create an Offer',
  create_combo: 'Create a Combo',
};

const ACTION_META: Record<AdvisorCandidate['action'], { label: string; icon: React.ElementType; tone: string }> = {
  create_offer: { label: 'Create this offer', icon: Tag, tone: 'bg-[var(--brand-color)] text-white hover:opacity-90' },
  create_combo: { label: 'Create this combo', icon: UtensilsCrossed, tone: 'bg-[var(--brand-color)] text-white hover:opacity-90' },
  create_campaign: { label: 'Create campaign', icon: Megaphone, tone: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  review_inventory: { label: 'Review inventory', icon: PackageSearch, tone: 'bg-amber-600 text-white hover:bg-amber-700' },
  review_pricing: { label: 'Review pricing', icon: BadgeIndianRupee, tone: 'bg-slate-700 text-white hover:bg-slate-800' },
};

const TYPE_LABEL: Record<string, string> = {
  combo: 'Combo',
  upsell: 'Upsell',
  promotion: 'Promotion',
  clearance: 'Inventory clearance',
  win_back: 'Win-back',
  retention: 'Retention',
  margin_promotion: 'Margin promotion',
  margin_protection: 'Margin protection',
  cost_riser: 'Cost alert',
  add_on: 'Add-on',
  offer: 'Offer',
  inventory_review: 'Inventory review',
};

function fmtMoney(n: number | undefined, symbol: string): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  return `${symbol}${Math.round(n).toLocaleString('en-IN')}`;
}

function ConfidencePill({ level }: { level: 'Low' | 'Medium' | 'High' }) {
  const cfg = {
    High: 'bg-emerald-100 text-emerald-700',
    Medium: 'bg-amber-100 text-amber-700',
    Low: 'bg-slate-100 text-slate-500',
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg}`}>
      <CheckCircle2 className="w-3 h-3" />
      {level} confidence
    </span>
  );
}

function AnalyzingState() {
  const checks = [
    { label: 'Sales', icon: TrendingUp },
    { label: 'Inventory', icon: Boxes },
    { label: 'Customer behaviour', icon: Users },
    { label: 'Product margins', icon: Wallet },
    { label: 'Existing offers', icon: Tag },
    { label: 'Calendar & festivals', icon: Sparkles },
  ];
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--brand-color)] to-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
      </div>
      <h3 className="mt-5 text-sm font-bold text-slate-800">Analyzing your restaurant…</h3>
      <p className="mt-1 text-xs text-slate-500">Reading your real sales, stock, margins and customers</p>
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-md">
        {checks.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-600">
              <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3" />
              </span>
              <Icon className="w-3.5 h-3.5 text-slate-400" />
              {c.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ rec, currencySymbol, onAct, expanded, onToggle }: {
  rec: AdvisorCandidate;
  currencySymbol: string;
  onAct: (rec: AdvisorCandidate) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = ACTION_META[rec.action] || ACTION_META.create_offer;
  const ActionIcon = meta.icon;
  const econ = rec.economics;
  const econChips: string[] = [];
  if (econ?.price !== undefined) econChips.push(`${fmtMoney(econ.price, currencySymbol)} price`);
  if (econ?.marginPercent !== undefined) econChips.push(`${Math.round(econ.marginPercent)}% margin`);
  if (econ?.discount !== undefined && econ.discount > 0) econChips.push(`${fmtMoney(econ.discount, currencySymbol)} discount`);
  if (econ?.minOrderValue !== undefined) econChips.push(`Min order ${fmtMoney(econ.minOrderValue, currencySymbol)}`);
  if (econ?.currentAov !== undefined && econ?.projectedAov !== undefined) {
    econChips.push(`AOV ${fmtMoney(econ.currentAov, currencySymbol)} → ${fmtMoney(econ.projectedAov, currencySymbol)}`);
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--brand-color)] bg-blue-50 px-2 py-0.5 rounded-md">
                {TYPE_LABEL[rec.recommendationType] || rec.recommendationType.replace(/_/g, ' ')}
              </span>
              <ConfidencePill level={rec.confidence} />
            </div>
            <h4 className="mt-2 text-[15px] font-bold text-slate-900 leading-snug">{rec.title}</h4>
          </div>
          <button
            onClick={onToggle}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-[var(--brand-color)] hover:bg-blue-50 cursor-pointer"
            title={expanded ? 'Hide details' : 'Why?'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-600">{rec.why}</p>

        {econChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {econChips.map((c) => (
              <span key={c} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-600">{c}</span>
            ))}
          </div>
        )}

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {rec.evidence.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Evidence</p>
                <ul className="space-y-1">
                  {rec.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                      <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-500 shrink-0" />
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Expected impact</p>
              <p className="flex items-start gap-1.5 text-[11px] text-slate-600">
                <TrendingUp className="w-3 h-3 mt-0.5 text-[var(--brand-color)] shrink-0" />
                {rec.expectedImpact}
              </p>
            </div>
            {rec.risk && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Risk / trade-off</p>
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {rec.risk}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => onAct(rec)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${meta.tone}`}
          >
            <ActionIcon className="w-3.5 h-3.5" />
            {meta.label}
          </button>
          <button
            onClick={onToggle}
            className="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-[var(--brand-color)] hover:bg-blue-50 transition-colors cursor-pointer"
          >
            {expanded ? 'Hide details' : 'Why?'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BusinessAdvisor({
  currencySymbol, branches = [], onCreateSuggestion, onReviewInventory, onViewOffers, notify,
}: BusinessAdvisorProps) {
  const [goal, setGoal] = useState<AdvisorGoal | null>(null);
  const [result, setResult] = useState<AdvisorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const run = useCallback(async (g: AdvisorGoal) => {
    setGoal(g);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.advisorRecommend({ goal: g });
      if (!res) {
        setError('Could not reach the advisor right now. Check your connection and try again.');
        return;
      }
      setResult(res);
    } catch (err) {
      debugWarn('Advisor', 'recommend failed:', err);
      setError('Something went wrong while analyzing your restaurant. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback((i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const act = useCallback((rec: AdvisorCandidate) => {
    // Outcome tracking: record the decision, then hand off to the EXISTING flow.
    if (rec.id) void api.advisorAction(rec.id, { status: 'accepted', actionTaken: rec.action }).catch(() => {});
    if (rec.action === 'create_offer' || rec.action === 'create_combo') {
      if (rec.offerSuggestion) {
        onCreateSuggestion?.({ ...rec.offerSuggestion, recommendationSource: rec.offerSuggestion.recommendationSource || 'advisor' });
      } else if (onViewOffers) {
        onViewOffers();
        notify?.('No offer payload was attached to this recommendation — create it manually from Offers.');
      }
    } else if (rec.action === 'create_campaign') {
      notify?.('Open the Promote tab to build this win-back campaign.');
      onCreateSuggestion?.({ ...rec.offerSuggestion, recommendationSource: 'win_back' });
    } else if (rec.action === 'review_inventory' || rec.action === 'review_pricing') {
      onReviewInventory?.();
    }
  }, [onCreateSuggestion, onReviewInventory, onViewOffers, notify]);

  if (goal === null) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-color)] to-blue-500 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Business Advisor</h2>
            <p className="text-xs text-slate-500">What do you want to improve? We analyze your actual data and tell you the best next move.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GOALS.map((g) => {
            const Icon = g.icon;
            return (
              <button
                key={g.id}
                onClick={() => run(g.id)}
                className="group text-left rounded-2xl bg-white border border-slate-200 p-4 hover:border-[var(--brand-color)] hover:shadow-md transition-all cursor-pointer"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${g.tone} flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  {g.label}
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[var(--brand-color)] transition-colors" />
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{g.description}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Info className="w-3.5 h-3.5" />
          Every recommendation is built from your own sales, inventory, margins and customers — AI only explains, never invents numbers.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setGoal(null)} className="text-xs font-bold text-slate-500 hover:text-[var(--brand-color)] cursor-pointer">
            ← Choose another goal
          </button>
        </div>
        <AnalyzingState />
      </div>
    );
  }

  const recs = result?.recommendations || [];
  const analyzed = result?.analyzed;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGoal(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-[var(--brand-color)] hover:bg-blue-50 border border-slate-200 cursor-pointer"
          >
            ← Goals
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900">{GOAL_TITLES[goal]}</h2>
            <p className="text-xs text-slate-500">
              {recs.length > 0 ? `${recs.length} opportunit${recs.length === 1 ? 'y' : 'ies'} found for your restaurant` : 'Analysis complete'}
            </p>
          </div>
        </div>
        <button
          onClick={() => run(goal)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--brand-color)] bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-analyze
        </button>
      </div>

      {analyzed && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {Object.entries(analyzed).map(([key, ok]) => (
            <span
              key={key}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}
            >
              {ok ? '✓' : '·'} {key.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-5 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <p className="mt-2 text-sm font-bold text-rose-700">{error}</p>
          <button onClick={() => run(goal)} className="mt-3 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">
            Try again
          </button>
        </div>
      )}

      {!error && result?.insufficientData && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-center">
          <PackageSearch className="w-8 h-8 text-amber-400 mx-auto" />
          <p className="mt-2 text-sm font-semibold text-amber-800">{result.note || 'Not enough data yet — add a few days of sales and stock, then try again.'}</p>
          <button onClick={() => setGoal(null)} className="mt-3 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold cursor-pointer">
            Choose another goal
          </button>
        </div>
      )}

      {!error && !result?.insufficientData && recs.length === 0 && (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 text-center">
          <Info className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="mt-2 text-sm font-semibold text-slate-600">No strong opportunities found for this goal right now — try another goal or check back after more sales.</p>
        </div>
      )}

      {!error && recs.length > 0 && (
        <div className="space-y-3">
          {recs.map((rec, i) => (
            <Card
              key={`${rec.title}-${i}`}
              rec={rec}
              currencySymbol={currencySymbol}
              onAct={act}
              expanded={expanded.has(i)}
              onToggle={() => toggle(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostIntelligencePanel — deterministic cost intelligence dashboard.
 *
 * Everything shown here is computed server-side from real restaurant data:
 *   - Summary (revenue, contribution, food cost %, wastage cost)
 *   - Product profitability (recipe cost vs selling price vs contribution)
 *   - Ingredient cost changes (dependency-aware)
 *   - Wastage + consumption variance
 *   - Offer economics (normal vs discounted contribution)
 *
 * AI insights are ADVISORY ONLY and generated ON DEMAND via the "Generate
 * insights" button — never auto-called, so no repeated LLM tokens are burned
 * just by opening the tab.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, TrendingUp, IndianRupee, Percent, Package, AlertTriangle,
  RefreshCw, Loader2, Sparkles, Scale, Tag, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { fetchCostIntelligence, fetchCostInsights } from '../../../src/api/client';

const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

export default function CostIntelligencePanel() {
  const [data, setData] = useState<any | null>(null);
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(false);

  // AI insights are on-demand only — no auto-call on mount.
  const [insights, setInsights] = useState<string[] | null>(null);
  const [insightFocus, setInsightFocus] = useState<string | undefined>(undefined);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchCostIntelligence({ days: 60 });
    setLoading(false);
    if (!d) { setSynced(false); return; }
    setData(d);
    setSynced(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generateInsights = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError('');
    setInsights(null);
    try {
      const res = await fetchCostInsights({ days: 60 });
      setInsights(res?.insights || []);
      setInsightFocus(res?.focus);
    } catch {
      setAiError('AI insights unavailable right now — the deterministic report above is still accurate.');
    } finally {
      setAiLoading(false);
    }
  };

  if (!synced && data === null) {
    return (
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-10 flex flex-col items-center text-sm text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-color)] mb-2" />
        Loading cost intelligence…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-10 text-center text-sm text-gray-400">
        Cost intelligence unavailable. Check your connection and try again.
      </div>
    );
  }

  const s = data.summary || {};
  const products = data.productProfitability || [];
  const costChanges = data.ingredientCostChanges || [];
  const wastage = data.wastage || { topItems: [], totalCost: 0 };
  const variance = data.variance || { rows: [] };
  const offers = data.offerEconomics || [];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Revenue (60d)', value: fmt(s.totalRevenue || 0), icon: IndianRupee, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Est. Contribution', value: fmt(s.totalContribution || 0), icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
          { label: 'Food Cost %', value: pct(s.overallFoodCostPercent || 0), icon: Percent, color: 'text-amber-600 bg-amber-50' },
          { label: 'Wastage Cost', value: fmt(s.wastageCost || 0), icon: Package, color: 'text-rose-600 bg-rose-50' },
        ].map((c) => (
          <div key={c.label} className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${c.color} mb-2`}>
              <c.icon className="w-4 h-4" />
            </div>
            <p className="text-lg font-black text-gray-900">{c.value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* AI insights — on demand only */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-bold text-gray-800">AI Business Insights</p>
            <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-100 px-2 py-0.5 rounded-full">advisory · on demand</span>
          </div>
          <button
            onClick={generateInsights}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-indigo-600-solid)] text-white rounded-xl text-xs font-bold hover:bg-[var(--color-indigo-700-solid)] transition-all cursor-pointer disabled:opacity-50"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {insights ? 'Regenerate insights' : 'Generate insights'}
          </button>
        </div>
        {aiLoading && (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 bg-indigo-100/70 rounded-lg animate-pulse" style={{ width: `${90 - i * 15}%` }} />
            ))}
          </div>
        )}
        {aiError && <p className="mt-3 text-xs font-semibold text-rose-600">{aiError}</p>}
        {!aiLoading && insights && insights.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {insights.map((ins, i) => (
              <li key={i} className="text-xs text-gray-700 bg-white/70 border border-indigo-100 rounded-xl px-3 py-2 flex items-start gap-2">
                <Sparkles className="w-3 h-3 text-indigo-500 mt-0.5 shrink-0" />
                {ins}
              </li>
            ))}
          </ul>
        )}
        {!aiLoading && insights !== null && insights.length === 0 && (
          <p className="mt-3 text-xs text-gray-500">No insights found for this period yet — add recipes to unlock deeper analysis.</p>
        )}
      </div>

      {/* Product profitability */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[var(--brand-color)]" />
          <p className="text-sm font-bold text-gray-800">Product Profitability</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Est. Var. Cost</th>
                <th className="px-4 py-2">Food Cost %</th>
                <th className="px-4 py-2">Contribution</th>
                <th className="px-4 py-2">Margin</th>
                <th className="px-4 py-2">Units</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-gray-400">No recipe-linked products yet — create recipes to see profitability.</td></tr>
              )}
              {products.map((p: any) => (
                <tr key={p.productId} className="border-t border-[var(--color-surface-muted)] text-xs">
                  <td className="px-4 py-2 font-semibold text-gray-800">{p.productName}</td>
                  <td className="px-4 py-2">{fmt(p.sellingPrice)}</td>
                  <td className="px-4 py-2">{p.hasRecipe ? fmt(p.recipeCost) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2">{p.foodCostPercent != null ? pct(p.foodCostPercent) : '—'}</td>
                  <td className="px-4 py-2 font-bold text-emerald-600">{fmt(p.contribution)}</td>
                  <td className="px-4 py-2">{p.contributionMarginPercent != null ? pct(p.contributionMarginPercent) : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{p.unitsSold ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ingredient cost changes */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-bold text-gray-800">Ingredient Cost Changes</p>
          </div>
          <div className="divide-y divide-[var(--color-surface-muted)]">
            {(costChanges.length === 0) && (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No ingredient cost history yet.</p>
            )}
            {costChanges.map((c: any) => {
              const changed = c.hasData && c.previousCost != null && c.currentCost != null && c.previousCost !== c.currentCost;
              const up = changed && c.currentCost > c.previousCost;
              return (
                <div key={c.itemId || c.name} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700">{c.name}</span>
                  <span className="flex items-center gap-2">
                    {changed ? (
                      <>
                        <span className="text-gray-400 line-through">{fmt(c.previousCost)}</span>
                        <span className={`font-bold ${up ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(c.currentCost)}</span>
                        {up
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />
                          : <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" />}
                      </>
                    ) : (
                      <span className="text-gray-500">{c.currentCost != null ? fmt(c.currentCost) : 'no cost data'}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wastage */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
            <Package className="w-4 h-4 text-rose-600" />
            <p className="text-sm font-bold text-gray-800">Recorded Wastage</p>
            <span className="ml-auto text-xs font-bold text-rose-600">{fmt(wastage.totalCost || 0)}</span>
          </div>
          <div className="divide-y divide-[var(--color-surface-muted)]">
            {(!wastage.topItems || wastage.topItems.length === 0) && (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No recorded wastage this period.</p>
            )}
            {(wastage.topItems || []).map((w: any, i: number) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-700">{w.name}</span>
                <span className="text-gray-500">{w.qty} {w.unit} · <span className="font-bold text-rose-600">{fmt(w.cost)}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Consumption variance */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
          <Scale className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-bold text-gray-800">Theoretical vs Actual Consumption</p>
          <span className="ml-auto text-xs font-bold text-gray-400">variance cost {fmt(variance.totalVarianceCost || 0)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Theoretical</th>
                <th className="px-4 py-2">Actual</th>
                <th className="px-4 py-2">Variance</th>
              </tr>
            </thead>
            <tbody>
              {(variance.rows || []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">No consumption data yet — recipe consumption appears once bills are created.</td></tr>
              )}
              {(variance.rows || []).map((r: any, i: number) => {
                const over = (r.varianceQty || 0) > 0;
                return (
                  <tr key={i} className="border-t border-[var(--color-surface-muted)] text-xs">
                    <td className="px-4 py-2 font-semibold text-gray-800">{r.name}</td>
                    <td className="px-4 py-2 text-gray-500">{r.theoreticalQty ?? 0} {r.unit || ''}</td>
                    <td className="px-4 py-2 text-gray-500">{r.actualQty ?? 0} {r.unit || ''}</td>
                    <td className={`px-4 py-2 font-bold ${over ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {over ? '+' : ''}{r.varianceQty ?? 0} {r.unit || ''} ({r.variancePercent ?? 0}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Offer economics */}
      {offers.length > 0 && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-600" />
            <p className="text-sm font-bold text-gray-800">Offer Economics</p>
          </div>
          <div className="divide-y divide-[var(--color-surface-muted)]">
            {offers.map((o: any) => (
              <div key={o.offerId} className="px-4 py-2.5 text-xs flex items-center justify-between">
                <span className="font-semibold text-gray-700">{o.title}</span>
                <span className="text-gray-500">{o.type} {o.value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400 px-1">
        All figures are estimates based on current weighted-average ingredient costs and configured allowances. Historical cost snapshots are never rewritten.
      </p>
    </div>
  );
}

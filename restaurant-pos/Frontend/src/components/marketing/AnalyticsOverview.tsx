/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AnalyticsOverview — answers "did my promotion work?" using REAL OfferAnalytics
 * data from /api/offers/analytics. The backend aggregates snapshots into a
 * per-offer `performance` array (redemptions, revenue, discount, AOV, unique
 * customers, trend). No fabricated values: when there isn't enough data the
 * page says so explicitly, and estimated-contribution fields are labelled
 * "Data unavailable" instead of showing fake numbers.
 */

import React, { useMemo } from 'react';
import { DollarSign, Award, Target, TrendingUp, ShoppingBag, BadgePercent, Users, Lightbulb, AlertCircle } from 'lucide-react';
import { fmtNumber, EmptyState, Spinner } from './shared';

/** Weekday labels for combo peak/weak-day periods (0 = Sunday, JS getDay()). */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface AnalyticsOverviewProps {
  analytics: any;
  offers: any[];
  loading: boolean;
  currencySymbol: string;
}

export default function AnalyticsOverview({ analytics, offers, loading, currencySymbol }: AnalyticsOverviewProps) {
  // Backend-derived per-offer performance (authoritative aggregation server-side).
  const performance = useMemo(() => (Array.isArray(analytics?.performance) ? analytics.performance : []), [analytics]);
  const summary = useMemo(() => analytics?.summary || null, [analytics]);
  // P2 — deterministic combo analytics (empty array when no combo redemptions).
  const combos = useMemo(() => (Array.isArray(analytics?.combos) ? analytics.combos : []), [analytics]);
  const comboRankings = useMemo(() => analytics?.comboRankings || null, [analytics]);

  const totals = useMemo(() => performance.reduce(
    (acc, p) => {
      acc.redeemed += p.redemptions || 0;
      acc.revenue += p.revenueGenerated || 0;
      acc.discount += p.discountGiven || 0;
      acc.customers += p.uniqueCustomers || 0;
      return acc;
    },
    { redeemed: 0, revenue: 0, discount: 0, customers: 0 },
  ), [performance]);

  const aov = totals.redeemed > 0 ? Math.round(totals.revenue / totals.redeemed) : 0;
  const topOffers = useMemo(() => [...performance].sort((a, b) => b.revenueGenerated - a.revenueGenerated).slice(0, 5), [performance]);

  // Honest rule-based insights — only from data that actually exists.
  const insights = useMemo(() => {
    const out: string[] = [];
    if (performance.length < 2) {
      return ['Not enough data yet — once offers start redeeming, insights will appear here automatically.'];
    }
    if (topOffers.length > 0 && topOffers[0].revenueGenerated > 0) {
      out.push(`"${topOffers[0].title || 'Your top offer'}" drove the most revenue (${currencySymbol}${fmtNumber(Math.round(topOffers[0].revenueGenerated))}) with ${fmtNumber(topOffers[0].redemptions)} redemptions.`);
    }
    const heavyDiscount = topOffers.find((p) => p.discountGiven > 0 && p.revenueGenerated > 0 && p.discountGiven / p.revenueGenerated > 0.3);
    if (heavyDiscount) {
      out.push(`"${heavyDiscount.title || 'One offer'}" gives away ${Math.round((heavyDiscount.discountGiven / heavyDiscount.revenueGenerated) * 100)}% of its revenue as discount — check whether it still makes sense.`);
    }
    if (out.length === 0) out.push('Not enough data yet — keep promoting and check back soon.');
    return out;
  }, [performance, topOffers, currencySymbol]);

  const hasData = performance.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Analytics</p>
          <h3 className="text-sm font-extrabold text-gray-900">Did your promotions work?</h3>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading analytics…" />
      ) : !hasData ? (
        <EmptyState
          icon="📊"
          title="No performance data yet"
          subtitle="Analytics build up from real redemptions. Create an offer, get customers to apply it, and the numbers will appear here automatically."
        />
      ) : (
        <>
          {/* Top metrics — all derived server-side from real redemptions */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Metric icon={<DollarSign className="w-4 h-4" />} label="Revenue influenced" value={`${currencySymbol}${fmtNumber(Math.round(totals.revenue))}`} tone="bg-emerald-100 text-emerald-700" />
            <Metric icon={<Award className="w-4 h-4" />} label="Redemptions" value={fmtNumber(totals.redeemed)} tone="bg-green-100 text-green-700" />
            <Metric icon={<BadgePercent className="w-4 h-4" />} label="Total discount" value={`${currencySymbol}${fmtNumber(Math.round(totals.discount))}`} tone="bg-rose-100 text-rose-700" />
            <Metric icon={<TrendingUp className="w-4 h-4" />} label="Average order" value={aov ? `${currencySymbol}${fmtNumber(aov)}` : '—'} tone="bg-purple-100 text-purple-700" />
            <Metric icon={<Users className="w-4 h-4" />} label="Unique customers" value={fmtNumber(totals.customers)} tone="bg-blue-100 text-blue-700" />
            <Metric icon={<Target className="w-4 h-4" />} label="Offers tracked" value={fmtNumber(summary?.offersTracked ?? performance.length)} tone="bg-amber-100 text-amber-700" />
          </div>

          {/* Per-offer performance comparison — real historical data */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="font-bold text-gray-900 text-xs">Offer performance</h4>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Compare which promotion actually worked</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[9px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="py-3 px-5 font-bold">Offer</th>
                    <th className="py-3 font-bold">Redemptions</th>
                    <th className="py-3 font-bold">Revenue influenced</th>
                    <th className="py-3 font-bold">Discount given</th>
                    <th className="py-3 font-bold">Avg order</th>
                    <th className="py-3 font-bold">Unique customers</th>
                    <th className="py-3 font-bold pr-5">Est. contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topOffers.map((p) => (
                    <tr key={p.offerId} className="hover:bg-gray-50">
                      <td className="py-3.5 px-5 font-bold text-gray-800">{p.title || 'Offer'}</td>
                      <td className="py-3.5">{fmtNumber(p.redemptions)}</td>
                      <td className="py-3.5 font-bold text-emerald-600">{currencySymbol}{fmtNumber(Math.round(p.revenueGenerated))}</td>
                      <td className="py-3.5 text-rose-600">−{currencySymbol}{fmtNumber(Math.round(p.discountGiven))}</td>
                      <td className="py-3.5">{p.averageOrderValue ? `${currencySymbol}${fmtNumber(Math.round(p.averageOrderValue))}` : '—'}</td>
                      <td className="py-3.5">{fmtNumber(p.uniqueCustomers)}</td>
                      <td className="py-3.5 pr-5 text-gray-400">
                        {p.contribution != null
                          ? `${currencySymbol}${fmtNumber(Math.round(p.contribution))}`
                          : <span title="Requires the deterministic cost engine to compute contribution.">Data unavailable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* P2 — Combo performance (deterministic combo-attributed economics) */}
          {combos.length > 0 && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h4 className="font-bold text-gray-900 text-xs">Combo performance</h4>
                <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Bundle economics — actual combo price, never component double-count</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[9px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="py-3 px-5 font-bold">Combo</th>
                      <th className="py-3 font-bold">Orders</th>
                      <th className="py-3 font-bold">Units</th>
                      <th className="py-3 font-bold">Combo revenue</th>
                      <th className="py-3 font-bold">List value</th>
                      <th className="py-3 font-bold">Savings</th>
                      <th className="py-3 font-bold">Est. cost</th>
                      <th className="py-3 font-bold">Contribution</th>
                      <th className="py-3 font-bold">Margin</th>
                      <th className="py-3 font-bold">Repeat</th>
                      <th className="py-3 font-bold">Peak · weak day</th>
                      <th className="py-3 font-bold pr-5">Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {combos.map((c) => (
                      <tr key={c.offerId} className="hover:bg-gray-50">
                        <td className="py-3.5 px-5 font-bold text-gray-800">{c.name}</td>
                        <td className="py-3.5">{fmtNumber(c.orders)}</td>
                        <td className="py-3.5">{fmtNumber(c.units)}</td>
                        <td className="py-3.5 font-bold text-emerald-600">{currencySymbol}{fmtNumber(Math.round(c.comboRevenue))}</td>
                        <td className="py-3.5 text-gray-500">{currencySymbol}{fmtNumber(Math.round(c.listValueAtSale))}</td>
                        <td className="py-3.5 text-rose-600">−{currencySymbol}{fmtNumber(Math.round(c.structuralSavings))}</td>
                        <td className="py-3.5 text-gray-500">{currencySymbol}{fmtNumber(Math.round(c.variableCost))}</td>
                        <td className="py-3.5 font-bold text-gray-800">{currencySymbol}{fmtNumber(Math.round(c.contribution))}</td>
                        <td className={`py-3.5 font-bold ${c.contributionMargin != null && c.contributionMargin >= 35 ? 'text-emerald-600' : c.contributionMargin != null && c.contributionMargin < 25 ? 'text-rose-600' : 'text-gray-700'}`}>
                          {c.contributionMargin != null ? `${c.contributionMargin}%` : '—'}
                        </td>
                        <td className="py-3.5">{c.repeatRate != null ? `${c.repeatRate}%` : '—'}</td>
                        <td className="py-3.5 text-gray-600">
                          {c.bestPeriod || c.weakPeriod ? (
                            <span className="whitespace-nowrap">
                              <span className="text-emerald-600 font-bold">{c.bestPeriod ? `${DAY_NAMES[c.bestPeriod.weekday]} ${c.bestPeriod.units}u` : '—'}</span>
                              <span className="text-gray-300 mx-1">·</span>
                              <span className="text-rose-500">{c.weakPeriod ? `${DAY_NAMES[c.weakPeriod.weekday]} ${c.weakPeriod.units}u` : '—'}</span>
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-3.5 pr-5">
                          <div className="flex flex-wrap gap-1">
                            {c.classification.length > 0 ? c.classification.slice(0, 2).map((badge) => (
                              <span key={badge} className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide ${badge.includes('LOW') || badge.includes('WEAK') ? 'bg-rose-50 text-rose-600' : badge.includes('HIGH') ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                {badge.replace(/_/g, ' ')}
                              </span>
                            )) : <span className="text-gray-300">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {comboRankings?.topByContribution?.[0] && comboRankings.weakestByMargin?.[0] && (
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 text-[10px] text-gray-500 font-semibold">
                  Best by contribution: <span className="text-emerald-700">{comboRankings.topByContribution[0].name}</span>
                  {' · '}Weakest by margin: <span className="text-rose-700">{comboRankings.weakestByMargin[0].name}</span>
                  {' · '}Individual-value counterfactual and economic delta are available per combo in the API.
                </div>
              )}
            </div>
          )}

          {/* Honest insights */}
          <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-200 p-5">
            <p className="text-[10px] font-black text-purple-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> Insights
            </p>
            <div className="space-y-2.5">
              {insights.map((ins, i) => (
                <p key={i} className={`flex items-start gap-2 text-xs leading-relaxed ${ins.startsWith('Not enough') ? 'text-gray-400' : 'text-purple-900'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  {ins}
                </p>
              ))}
            </div>
            {insights.some((i) => i.startsWith('Not enough')) && (
              <p className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-3">
                <AlertCircle className="w-3 h-3" /> Insights are computed only from real data — nothing is fabricated.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4 shadow-xs">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <p className="text-xl font-black text-gray-900 mt-2 leading-none">{value}</p>
      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-1.5">{label}</p>
    </div>
  );
}

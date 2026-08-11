/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AnalyticsOverview — answers "did my promotion work?" using REAL OfferAnalytics
 * data from /api/offers/analytics. No fabricated values: when there isn't
 * enough data the page says so explicitly.
 */

import React, { useMemo } from 'react';
import { BarChart3, RefreshCw, DollarSign, Award, Target, TrendingUp, ShoppingBag, Lightbulb, AlertCircle } from 'lucide-react';
import { fmtNumber, EmptyState, Spinner } from './shared';

interface AnalyticsOverviewProps {
  analytics: any;
  offers: any[];
  loading: boolean;
  currencySymbol: string;
  onRefresh: () => void;
}

export default function AnalyticsOverview({ analytics, offers, loading, currencySymbol, onRefresh }: AnalyticsOverviewProps) {
  const rows = useMemo(() => (Array.isArray(analytics?.analytics) ? analytics.analytics : []), [analytics]);
  const summary = useMemo(() => analytics?.summary || null, [analytics]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.redeemed += r.redeemed || 0;
      acc.revenue += r.revenueGenerated || 0;
      acc.targeted += r.customersTargeted || 0;
      acc.reached += r.customersReached || 0;
      acc.orders += r.customersReached || 0; // reached ≈ deliveries that could convert
      return acc;
    },
    { redeemed: 0, revenue: 0, targeted: 0, reached: 0, orders: 0 },
  ), [rows]);

  const conversion = totals.targeted > 0 ? Math.round((totals.redeemed / totals.targeted) * 100) : 0;
  const aov = totals.redeemed > 0 ? Math.round(totals.revenue / totals.redeemed) : 0;

  // Top performing offers — group real snapshot rows by offerId.
  const topOffers = useMemo(() => {
    const byOffer = new Map<string, { redeemed: number; revenue: number; targeted: number }>();
    for (const r of rows) {
      const id = r.offerId?.toString?.() || '';
      if (!id) continue;
      const agg = byOffer.get(id) || { redeemed: 0, revenue: 0, targeted: 0 };
      agg.redeemed += r.redeemed || 0;
      agg.revenue += r.revenueGenerated || 0;
      agg.targeted += r.customersTargeted || 0;
      byOffer.set(id, agg);
    }
    return Array.from(byOffer.entries())
      .map(([id, agg]) => ({
        id,
        offer: offers.find((o) => o._id === id) || { title: 'Offer' },
        ...agg,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [rows, offers]);

  // Honest rule-based insights — only from data that actually exists.
  const insights = useMemo(() => {
    const out: string[] = [];
    const dateCount = rows.length;
    if (dateCount < 2) {
      return ['Not enough data yet — once offers start redeeming and campaigns deliver, insights will appear here automatically.'];
    }
    // Weekend vs weekday comparison from snapshotDate (real rows only).
    const weekend = rows.filter((r) => { const d = new Date(r.snapshotDate); const day = d.getDay(); return day === 0 || day === 6; });
    const weekday = rows.filter((r) => { const d = new Date(r.snapshotDate); const day = d.getDay(); return day >= 1 && day <= 5; });
    const avg = (arr: any[]) => arr.length ? arr.reduce((s, r) => s + (r.revenueGenerated || 0), 0) / arr.length : 0;
    const wkAvg = avg(weekend); const wdAvg = avg(weekday);
    if (weekend.length >= 2 && weekday.length >= 2) {
      if (wkAvg > wdAvg * 1.15) out.push(`Weekend offers generate about ${Math.round((wkAvg / wdAvg - 1) * 100)}% more revenue per day than weekday offers. Try a recurring Saturday promotion.`);
      else if (wdAvg > wkAvg * 1.15) out.push('Weekday offers are outperforming weekend ones. Consider a mid-week promotion to keep momentum.');
      else out.push('Revenue is consistent across the week — a steady promotion cadence is working for you.');
    }
    if (topOffers.length > 0 && topOffers[0].revenue > 0) {
      out.push(`"${topOffers[0].offer?.title || 'Your top offer'}" drove the most revenue (${currencySymbol}${fmtNumber(Math.round(topOffers[0].revenue))}) with ${fmtNumber(topOffers[0].redeemed)} redemptions.`);
    }
    if (conversion > 0) {
      out.push(conversion >= 10
        ? `${conversion}% of targeted customers converted — solid performance. Double down on similar offers.`
        : `Conversion is at ${conversion}% — try tightening your audience or raising the discount to improve it.`);
    }
    if (out.length === 0) out.push('Not enough data yet — keep promoting and check back soon.');
    return out;
  }, [rows, topOffers, conversion, currencySymbol]);

  const hasData = rows.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Analytics</p>
          <h3 className="text-sm font-extrabold text-gray-900">Did your promotions work?</h3>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-bold transition-all cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading analytics…" />
      ) : !hasData ? (
        <EmptyState
          icon="📊"
          title="No performance data yet"
          subtitle="Analytics build up from real redemptions and campaign deliveries. Create an offer and start promoting to see results."
        />
      ) : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Metric icon={<DollarSign className="w-4 h-4" />} label="Revenue generated" value={`${currencySymbol}${fmtNumber(Math.round(totals.revenue))}`} tone="bg-emerald-100 text-emerald-700" />
            <Metric icon={<Award className="w-4 h-4" />} label="Redemptions" value={fmtNumber(totals.redeemed)} tone="bg-green-100 text-green-700" />
            <Metric icon={<Target className="w-4 h-4" />} label="Conversion" value={`${conversion}%`} tone="bg-blue-100 text-blue-700" />
            <Metric icon={<TrendingUp className="w-4 h-4" />} label="Average order" value={aov ? `${currencySymbol}${fmtNumber(aov)}` : '—'} tone="bg-purple-100 text-purple-700" />
            <Metric icon={<ShoppingBag className="w-4 h-4" />} label="Customers reached" value={fmtNumber(totals.reached)} tone="bg-amber-100 text-amber-700" />
          </div>

          {/* Top performing offers */}
          {topOffers.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#e1e2ed] overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h4 className="font-bold text-gray-900 text-xs">Top performing offers</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[9px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="py-3 px-5 font-bold">Offer</th>
                      <th className="py-3 font-bold">Orders</th>
                      <th className="py-3 font-bold">Revenue</th>
                      <th className="py-3 font-bold pr-5">Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {topOffers.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="py-3.5 px-5 font-bold text-gray-800">{t.offer?.title || 'Offer'}</td>
                        <td className="py-3.5">{fmtNumber(t.redeemed)}</td>
                        <td className="py-3.5 font-bold text-emerald-600">{currencySymbol}{fmtNumber(Math.round(t.revenue))}</td>
                        <td className="py-3.5 pr-5 font-bold">{t.targeted > 0 ? `${Math.round((t.redeemed / t.targeted) * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI insights */}
          <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-200 p-5">
            <p className="text-[10px] font-black text-purple-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> AI Insight
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
    <div className="bg-white rounded-2xl border border-[#e1e2ed] p-4 shadow-xs">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <p className="text-xl font-black text-gray-900 mt-2 leading-none">{value}</p>
      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-1.5">{label}</p>
    </div>
  );
}

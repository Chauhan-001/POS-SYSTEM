/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BranchComparison — multi-branch decision cockpit for the Owner.
 *
 * Consumes GET /api/reports/branch-compare:
 *   - Branch leaderboard (revenue, orders, AOV, growth vs previous period,
 *     share of network) with rank medals
 *   - Per-branch best sellers
 *   - Cross-branch product comparison (which branch sells what best)
 *   - Deterministic insights banner (leader, gaps, growing, declining)
 *
 * Shown when the restaurant has 2+ branches; hidden for single-branch tenants.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, TrendingUp, TrendingDown, Lightbulb, Loader2, X, Building2, Crown,
} from 'lucide-react';
import Modal from '../inventory/components/Modal';
import { fetchBranchCompare } from '../../api/client';

interface BestSeller { name: string; qty: number; revenue: number; share: number }
interface BranchRow {
  branchId: string; branchName: string; rank: number;
  orders: number; revenue: number; netRevenue: number; avgOrderValue: number;
  ordersGrowthPct: number | null; revenueGrowthPct: number | null;
  shareOfNetworkPct: number; bestSellers: BestSeller[];
}
interface ProductRow { name: string; totalQty: number; bestBranch: { branchName: string; qty: number } | null; rows: Array<{ branchName: string; qty: number; shareOfProductPct: number }> }
interface CompareData {
  period: { start: string; end: string; previous: { start: string; end: string } };
  branches: BranchRow[];
  network: { totalRevenue: number; totalOrders: number; branchCount: number };
  productComparison: ProductRow[];
  insights: Array<{ type: string; severity: 'info' | 'positive' | 'warning'; text: string }>;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const growthBadge = (pct: number | null) => {
  if (pct === null) return <span className="text-[10px] text-gray-400">—</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct}%
    </span>
  );
};

export default function BranchComparison({ onClose, currencySymbol = '₹' }: { onClose: () => void; currencySymbol?: string }) {
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'today' | '7d' | '30d' | '90d'>('30d');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rangeDates = useCallback((r: typeof range) => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const days = r === 'today' ? 0 : r === '7d' ? 6 : r === '30d' ? 29 : 89;
    const start = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    return { start: r === 'today' ? end : start, end };
  }, []);

  const load = useCallback(async (r: typeof range) => {
    setLoading(true);
    setError('');
    const { start, end } = rangeDates(r);
    const res = await fetchBranchCompare(start, end);
    if (res.data) setData(res.data as CompareData);
    else setError('Could not load the comparison. Try again.');
    setLoading(false);
  }, [rangeDates]);

  useEffect(() => { void load(range); }, [range, load]);

  const sev = (s: string) =>
    s === 'positive' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : s === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-blue-200 bg-blue-50 text-blue-800';
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

  return (
    <Modal isOpen onClose={onClose} title="Branch Comparison" size="xl">
      {/* Range selector */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex gap-1">
          {(['today', '7d', '30d', '90d'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${range === r ? 'bg-[var(--color-brand,emerald-600)] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {r === 'today' ? 'Today' : r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
        {data && (
          <p className="text-xs text-gray-500">
            vs {data.period.previous.start} → {data.period.previous.end}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-brand,emerald-600)]" />
          <p className="text-sm text-gray-500">Comparing branches…</p>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 py-8 text-center">{error}</p>
      ) : !data || data.branches.length < 2 ? (
        <div className="py-10 text-center text-sm text-gray-500 space-y-1">
          <Building2 className="w-8 h-8 mx-auto text-gray-300" />
          <p>Branch comparison needs at least two branches with sales in this window.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Network totals */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Network revenue', value: `${currencySymbol}${fmt(data.network.totalRevenue)}` },
              { label: 'Network orders', value: fmt(data.network.totalOrders) },
              { label: 'Active branches', value: String(data.network.branchCount) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-[var(--color-border-default)] p-3 text-center">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-lg font-black">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Insights */}
          {data.insights.length > 0 && (
            <div className="space-y-1.5">
              {data.insights.map((i, k) => (
                <div key={k} className={`rounded-xl border px-3 py-2 text-xs font-semibold flex items-start gap-2 ${sev(i.severity)}`}>
                  {i.severity === 'positive' ? <Crown className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                  <span>{i.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Leaderboard */}
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-2">Branch leaderboard</p>
            <div className="space-y-2">
              {data.branches.map((b) => (
                <div key={b.branchId || 'unassigned'} className="rounded-xl border border-[var(--color-border-default)] overflow-hidden">
                  <button
                    onClick={() => setExpanded(expanded === (b.branchId || 'unassigned') ? null : (b.branchId || 'unassigned'))}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer text-left"
                  >
                    <span className="text-lg w-8 text-center">{medal(b.rank)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{b.branchName}</p>
                      <p className="text-[11px] text-gray-500">
                        {fmt(b.orders)} orders · AOV {currencySymbol}{fmt(b.avgOrderValue)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black">{currencySymbol}{fmt(b.revenue)}</p>
                      <p className="text-[10px] text-gray-500">{b.shareOfNetworkPct}% of network</p>
                    </div>
                    <div className="w-16 text-right">{growthBadge(b.revenueGrowthPct)}</div>
                  </button>
                  {expanded === (b.branchId || 'unassigned') && (
                    <div className="px-4 pb-3 pt-1 bg-gray-50 border-t border-[var(--color-border-default)]">
                      <p className="text-[10px] font-black uppercase tracking-wide text-gray-500 mb-1.5">Best sellers</p>
                      {b.bestSellers.length === 0 ? (
                        <p className="text-xs text-gray-400">No item-level sales in this window.</p>
                      ) : (
                        <div className="space-y-1">
                          {b.bestSellers.map((s, k) => (
                            <div key={s.name} className="flex items-center gap-2 text-xs">
                              <span className="w-4 text-gray-400 font-bold">{k + 1}.</span>
                              <span className="flex-1 truncate font-semibold">{s.name}</span>
                              <span className="text-gray-500">{s.qty} sold</span>
                              <span className="w-16 text-right font-bold">{currencySymbol}{fmt(s.revenue)}</span>
                              <span className="w-10 text-right text-gray-400">{s.share}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Cross-branch product comparison */}
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
              Which branch sells what best <span className="font-semibold normal-case">(top items)</span>
            </p>
            <div className="rounded-xl border border-[var(--color-border-default)] overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-left px-3 py-2 font-bold">Item</th>
                    {data.branches.map((b) => (
                      <th key={b.branchId || 'u'} className="px-2 py-2 font-bold text-center max-w-20 truncate" title={b.branchName}>{b.branchName}</th>
                    ))}
                    <th className="px-3 py-2 font-bold text-right">Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {data.productComparison.map((p) => (
                    <tr key={p.name} className="border-t border-[var(--color-border-default)]">
                      <td className="px-3 py-2 font-semibold truncate max-w-36" title={p.name}>{p.name}</td>
                      {p.rows.map((r) => (
                        <td key={r.branchName} className="px-2 py-2 text-center">
                          <span className={p.bestBranch?.branchName === r.branchName && r.qty > 0 ? 'font-black text-emerald-700' : 'text-gray-600'}>
                            {r.qty}
                          </span>
                          <span className="block text-[9px] text-gray-400">{r.shareOfProductPct}%</span>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        {p.bestBranch ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap">
                            {p.bestBranch.branchName} ({p.bestBranch.qty})
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                  {data.productComparison.length === 0 && (
                    <tr><td colSpan={data.branches.length + 2} className="px-3 py-4 text-center text-gray-400">No item sales in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[10px] text-gray-400 flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Growth compares to the immediately previous period of equal length. Voided & refunded bills excluded.
          </p>
        </div>
      )}
    </Modal>
  );
}

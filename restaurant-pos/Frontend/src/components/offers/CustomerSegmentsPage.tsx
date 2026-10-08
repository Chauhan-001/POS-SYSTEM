/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Segments — Displays dynamic customer groups with counts,
 * average spend, and visit frequency. Segments update automatically.
 *
 * Two segment sources are shown together, clearly labelled:
 *   · Rule-based segments  — the deterministic engine (visit recency,
 *     spend tier, loyalty, birthdays); refreshable from here.
 *   · ML segments          — model-detected customer groups synced by the
 *     ML pipeline. Read-only: no training/sync controls are exposed to
 *     end users (those run through the LLM tool-calling path instead).
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  RefreshCw,
  Search,
  UserCheck,
  Target,
  DollarSign,
  Clock,
  Calendar,
  TrendingUp,
  Gift,
  Star,
  Award,
  Heart,
  Coffee,
  Pizza,
  ShoppingBag,
  CreditCard,
  Smartphone,
  AlertCircle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { OfferSegment } from '../../types';
import { fetchOfferSegments, refreshOfferSegments, fetchStoredSegments, type StoredSegmentRow } from '../../api/client';

/** Model-detected segment tiers (mirrors the stored ml-pipeline labels). */
const ML_SEGMENT_COLORS: Record<string, string> = {
  Champions: 'bg-emerald-100 text-emerald-700',
  Loyal: 'bg-blue-100 text-blue-700',
  Regular: 'bg-sky-100 text-sky-700',
  Potential: 'bg-amber-100 text-amber-700',
  'At-risk': 'bg-orange-100 text-orange-700',
  Dormant: 'bg-gray-200 text-gray-600',
  New: 'bg-violet-100 text-violet-700',
};

interface MlSegmentSummary {
  segment: string;
  customers: number;
  totalSpend: number;
  spendCount: number;
  totalRecency: number;
  recencyCount: number;
  trained: number;
}

const SEGMENT_ICONS: Record<string, React.ElementType> = {
  visit_today: Calendar,
  visit_this_week: Calendar,
  visit_this_month: Calendar,
  new_customer: Star,
  returning_customer: UserCheck,
  frequent_customer: Award,
  vip_customer: Award,
  high_spending: DollarSign,
  low_spending: DollarSign,
  dormant_7d: Clock,
  dormant_15d: Clock,
  dormant_30d: Clock,
  dormant_45d: Clock,
  dormant_60d: Clock,
  dormant_90d: Clock,
  birthday_today: Gift,
  birthday_tomorrow: Gift,
  birthday_this_week: Gift,
  loyalty_member: Heart,
  reward_redeemer: Gift,
};

export default function CustomerSegmentsPage() {
  const [segments, setSegments] = useState<OfferSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSegment, setSelectedSegment] = useState<OfferSegment | null>(null);

  // ML (model-detected) segments — display only, no train/sync controls.
  const [mlSegments, setMlSegments] = useState<StoredSegmentRow[]>([]);
  const [mlLoading, setMlLoading] = useState(true);
  const [mlUnavailable, setMlUnavailable] = useState<string | null>(null);

  const fetchMlSegments = async () => {
    setMlLoading(true);
    try {
      const data = await fetchStoredSegments(500);
      const rows: StoredSegmentRow[] = data?.segments || [];
      setMlSegments(rows);
      setMlUnavailable(rows.length === 0 ? 'No model-detected segments synced yet' : null);
    } catch {
      // Honest state — an unreachable pipeline is reported, never faked.
      setMlUnavailable('ML segmentation service unavailable');
    } finally {
      setMlLoading(false);
    }
  };

  const fetchSegments = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOfferSegments();
      if (!data) throw new Error('Failed to fetch');
      setSegments(data.segments || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshSegments = async () => {
    setLoading(true);
    try {
      const data = await refreshOfferSegments();
      if (!data) throw new Error('Failed to refresh');
      setSegments(data.segments || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSegments();
    fetchMlSegments();
  }, []);

  const filtered = segments.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Roll individual customers up into per-segment aggregates for display.
  const mlSummary = useMemo<MlSegmentSummary[]>(() => {
    const map = new Map<string, MlSegmentSummary>();
    for (const r of mlSegments) {
      const cur = map.get(r.segment) || {
        segment: r.segment, customers: 0, totalSpend: 0, spendCount: 0,
        totalRecency: 0, recencyCount: 0, trained: 0,
      };
      cur.customers += 1;
      if (typeof r.monetary === 'number') { cur.totalSpend += r.monetary; cur.spendCount += 1; }
      if (typeof r.recencyDays === 'number') { cur.totalRecency += r.recencyDays; cur.recencyCount += 1; }
      if (r.isTrained) cur.trained += 1;
      map.set(r.segment, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.customers - a.customers);
  }, [mlSegments]);

  const filteredMl = mlSummary.filter(s => s.segment.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading && segments.length === 0 && mlLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error && segments.length === 0 && mlSegments.length === 0 && !mlLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <AlertCircle className="w-8 h-8 text-gray-300" />
        <p className="text-sm text-gray-500">{error}</p>
        <button onClick={fetchSegments} className="text-xs text-indigo-600 font-bold underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-gray-900 text-sm">Customer Segments</h3>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
            {segments.length} segments
          </span>
        </div>
        <button
          onClick={refreshSegments}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search segments..."
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      {/* Segments Grid — deterministic (rule-based) */}
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest pt-1">Rule-based</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(seg => {
          const Icon = SEGMENT_ICONS[seg.type] || Users;
          return (
            <div
              key={seg._id}
              onClick={() => setSelectedSegment(selectedSegment?._id === seg._id ? null : seg)}
              className={`bg-[var(--color-bg-white)] rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                selectedSegment?._id === seg._id ? 'border-indigo-400 shadow-md' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  seg.customerCount > 50 ? 'bg-indigo-100 text-indigo-600'
                    : seg.customerCount > 10 ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-extrabold text-gray-900 text-sm">{seg.name}</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5">{seg.description}</p>
                  {seg.isAutoGenerated && (
                    <span className="text-[8px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded mt-1 inline-block uppercase tracking-wider">
                      Auto
                    </span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <Users className="w-3.5 h-3.5 text-gray-500 mx-auto mb-0.5" />
                  <span className="block text-sm font-black text-gray-800">{seg.customerCount}</span>
                  <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Customers</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <DollarSign className="w-3.5 h-3.5 text-green-500 mx-auto mb-0.5" />
                  <span className="block text-sm font-black text-gray-800">₹{Number(seg.averageSpend || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Avg Spend</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <Clock className="w-3.5 h-3.5 text-blue-500 mx-auto mb-0.5" />
                  <span className="block text-sm font-black text-gray-800">{seg.averageVisitFrequency || '-'}</span>
                  <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Frequency</span>
                </div>
              </div>

              {seg.lastCampaignDate && (
                <div className="mt-2 text-[9px] text-gray-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Last campaign: {seg.lastCampaignDate}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <Users className="w-10 h-10 mb-2 text-gray-300" />
          <p className="text-sm font-medium">{error ? error : 'No rule-based segments found'}</p>
          {error && (
            <button onClick={fetchSegments} className="mt-2 text-xs text-indigo-600 font-bold underline">Retry</button>
          )}
        </div>
      )}

      {/* ── ML segments (model-detected) ─────────────────────────────── */}
      <div className="pt-2 border-t border-gray-100 space-y-3">
        <div className="flex items-center justify-between pt-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <h3 className="font-bold text-gray-900 text-sm">Smart segments</h3>
            <span className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              ML detected
            </span>
          </div>
          <span className="text-[10px] text-gray-400 font-medium">
            {mlSegments.length} customer{mlSegments.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-[10px] text-gray-400 -mt-1">
          Groups found automatically from buying behaviour — no manual setup needed.
        </p>

        {mlLoading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : mlUnavailable ? (
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-gray-400 shrink-0" />
            <p className="text-xs font-medium text-gray-500">{mlUnavailable}</p>
            <button onClick={fetchMlSegments} className="ml-auto text-xs text-indigo-600 font-bold underline shrink-0">Retry</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredMl.map(s => {
              const avgSpend = s.spendCount > 0 ? s.totalSpend / s.spendCount : 0;
              const avgRecency = s.recencyCount > 0 ? Math.round(s.totalRecency / s.recencyCount) : null;
              const allTrained = s.trained === s.customers;
              return (
                <div key={s.segment} className="bg-[var(--color-bg-white)] rounded-2xl border-2 border-indigo-50 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-gray-900 text-sm">{s.segment}</h4>
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded mt-1 inline-block uppercase tracking-wider ${ML_SEGMENT_COLORS[s.segment] ?? 'bg-gray-100 text-gray-600'}`}>
                        {allTrained ? 'Model' : 'Model + rules'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <Users className="w-3.5 h-3.5 text-gray-500 mx-auto mb-0.5" />
                      <span className="block text-sm font-black text-gray-800">{s.customers}</span>
                      <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Customers</span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <DollarSign className="w-3.5 h-3.5 text-green-500 mx-auto mb-0.5" />
                      <span className="block text-sm font-black text-gray-800">₹{avgSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Avg Spend</span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <Clock className="w-3.5 h-3.5 text-blue-500 mx-auto mb-0.5" />
                      <span className="block text-sm font-black text-gray-800">{avgRecency === null ? '-' : `${avgRecency}d`}</span>
                      <span className="block text-[7px] text-gray-400 uppercase tracking-wider">Avg Recency</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!mlLoading && !mlUnavailable && filteredMl.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <Sparkles className="w-8 h-8 mb-2 text-gray-300" />
            <p className="text-sm font-medium">No smart segments match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}

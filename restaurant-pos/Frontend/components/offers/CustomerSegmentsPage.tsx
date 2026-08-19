/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Segments — Displays dynamic customer groups with counts,
 * average spend, and visit frequency. Segments update automatically.
 */

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import type { OfferSegment } from '../../src/types';
import { fetchOfferSegments, refreshOfferSegments } from '../../src/api/client';

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
  }, []);

  const filtered = segments.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading && segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error && segments.length === 0) {
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

      {/* Segments Grid */}
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
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Users className="w-10 h-10 mb-2 text-gray-300" />
          <p className="text-sm font-medium">No segments found</p>
        </div>
      )}
    </div>
  );
}

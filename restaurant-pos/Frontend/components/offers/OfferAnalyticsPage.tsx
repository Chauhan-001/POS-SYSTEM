/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Analytics — Simple analytics dashboard showing offer performance.
 * Uses simple cards — does NOT overwhelm with data.
 * Shows: Customers Targeted, Reached, Opened, Redeemed, Revenue, ROI.
 */

import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Eye,
  Target,
  Users,
  DollarSign,
  TrendingUp,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  Award,
  ShoppingBag,
} from 'lucide-react';
import type { OfferAnalytics, Offer } from '../../src/types';
import { fetchOfferAnalytics } from '../../src/api/client';

interface AnalyticsSummary {
  totalOffers: number;
  activeOffers: number;
  totalRedeemed: number;
  totalRevenue: number;
}

export default function OfferAnalyticsPage() {
  const [analytics, setAnalytics] = useState<OfferAnalytics[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>({ totalOffers: 0, activeOffers: 0, totalRedeemed: 0, totalRevenue: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOfferAnalytics();
      if (!data) throw new Error('Failed to fetch analytics');
      setAnalytics(data.analytics || []);
      setSummary(data.summary || { totalOffers: 0, activeOffers: 0, totalRedeemed: 0, totalRevenue: 0 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }

  const totalTargeted = analytics.reduce((s, a) => s + a.customersTargeted, 0);
  const totalRedeemed = analytics.reduce((s, a) => s + a.redeemed, 0);
  const totalRevenue = analytics.reduce((s, a) => s + a.revenueGenerated, 0);
  const avgROI = analytics.length > 0
    ? Math.round(analytics.reduce((s, a) => s + (a.roi || 0), 0) / analytics.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-gray-900 text-sm">Offer Analytics</h3>
        </div>
        <button
          onClick={fetchAnalytics}
          className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-bold transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
          <AlertCircle className="w-8 h-8" />
          <p className="text-sm">{error}</p>
          <button onClick={fetchAnalytics} className="text-xs text-emerald-600 font-bold underline">Retry</button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Award className="w-4 h-4 text-blue-600" />
                </div>
              </div>
              <span className="text-2xl font-black text-gray-900">{summary.totalOffers}</span>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Total Offers Created</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <ShoppingBag className="w-4 h-4 text-green-600" />
                </div>
              </div>
              <span className="text-2xl font-black text-gray-900">{summary.activeOffers}</span>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Active Offers</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Users className="w-4 h-4 text-purple-600" />
                </div>
              </div>
              <span className="text-2xl font-black text-gray-900">{summary.totalRedeemed || totalRedeemed}</span>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Total Redemptions</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                </div>
              </div>
              <span className="text-2xl font-black text-gray-900">₹{summary.totalRevenue || totalRevenue}</span>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Revenue Generated</p>
            </div>
          </div>

          {/* Performance Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-emerald-50 to-white rounded-2xl border border-emerald-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Conversion Rate</span>
              </div>
              <span className="text-3xl font-black text-emerald-700">
                {totalTargeted > 0 ? Math.round((totalRedeemed / totalTargeted) * 100) : 0}%
              </span>
              <p className="text-[10px] text-emerald-600 mt-1">{totalRedeemed} redemptions from {totalTargeted} targeted</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-white rounded-2xl border border-blue-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Average ROI</span>
              </div>
              <span className="text-3xl font-black text-blue-700">{avgROI}%</span>
              <p className="text-[10px] text-blue-600 mt-1">Return on campaign investment</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">Engagement</span>
              </div>
              <span className="text-3xl font-black text-purple-700">{analytics.length}</span>
              <p className="text-[10px] text-purple-600 mt-1">Offers with performance data</p>
            </div>
          </div>

          {/* Per-Offer Table */}
          {analytics.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h4 className="font-bold text-gray-900 text-xs">Per-Offer Performance</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[9px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="py-3 px-4 font-bold">Date</th>
                      <th className="py-3 font-bold">Targeted</th>
                      <th className="py-3 font-bold">Reached</th>
                      <th className="py-3 font-bold">Opened</th>
                      <th className="py-3 font-bold">Redeemed</th>
                      <th className="py-3 font-bold">Revenue</th>
                      <th className="py-3 font-bold">Repeat Visits</th>
                      <th className="py-3 font-bold pr-4">ROI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {analytics.slice(0, 10).map(a => (
                      <tr key={a._id} className="hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium text-gray-600">{a.snapshotDate}</td>
                        <td className="py-3 font-bold">{a.customersTargeted}</td>
                        <td className="py-3">{a.customersReached}</td>
                        <td className="py-3">{a.opened}</td>
                        <td className="py-3">
                          <span className="font-bold text-green-600">{a.redeemed}</span>
                        </td>
                        <td className="py-3 font-bold">₹{a.revenueGenerated}</td>
                        <td className="py-3">{a.repeatVisits}</td>
                        <td className="py-3 pr-4 font-bold text-emerald-600">{a.roi}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

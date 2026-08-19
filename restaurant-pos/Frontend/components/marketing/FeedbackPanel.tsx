/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeedbackPanel — displays customer feedback collected via the receipt QR code
 * (scanned from the thermal receipt printed after payment). Customers leave a
 * star rating (1–5) and an optional comment on the public receipt landing page.
 *
 * This panel is read-only and lives inside Marketing → More → Feedback.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Star, MessageSquare, Calendar, Filter, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import { EmptyState, fmtNumber } from './shared';

interface FeedbackItem {
  _id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  bill: { invoiceNumber: string; date: string; total: number } | null;
}

interface FeedbackStats {
  averageRating: number;
  totalReviews: number;
  distribution: number[]; // index 0 = 1-star, index 4 = 5-star
}

interface FeedbackResponse {
  success: boolean;
  feedback: FeedbackItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
  stats: FeedbackStats;
}

function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`}
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}

function RatingBar({ stars, count, total }: { stars: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-gray-500 w-4 text-right">{stars}</span>
      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-bold text-gray-400 w-8 text-right">{count}</span>
    </div>
  );
}

export default function FeedbackPanel() {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats>({ averageRating: 0, totalReviews: 0, distribution: [0, 0, 0, 0, 0] });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const loadFeedback = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const res: any = await api.fetchFeedback({
        page,
        limit: 10,
        ...(filterRating ? { rating: filterRating } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      const data = res?.data || res;
      if (data?.success) {
        setFeedback(data.feedback || []);
        setStats(data.stats || { averageRating: 0, totalReviews: 0, distribution: [0, 0, 0, 0, 0] });
        setPagination(data.pagination || { page: 1, limit: 10, total: 0, pages: 0 });
      } else {
        setError('Could not load feedback.');
      }
    } catch (err) {
      debugWarn('Feedback', 'load failed:', err);
      setError('Could not load feedback. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [filterRating, debouncedSearch]);

  useEffect(() => {
    loadFeedback(1);
  }, [loadFeedback]);

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return d; }
  };

  return (
    <div className="space-y-5">
      {/* Header + stats */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">Customer Feedback</p>
        <p className="text-[11px] text-gray-400 mb-4">Feedback from customers who scanned the QR code on their receipt.</p>

        {stats.totalReviews > 0 ? (
          <div className="flex flex-wrap gap-6 items-start">
            {/* Big average */}
            <div className="text-center min-w-[80px]">
              <p className="text-3xl font-black text-gray-900">{stats.averageRating}</p>
              <StarRating rating={Math.round(stats.averageRating)} size={14} />
              <p className="text-[10px] text-gray-400 mt-1">{fmtNumber(stats.totalReviews)} reviews</p>
            </div>
            {/* Distribution bars */}
            <div className="flex-1 min-w-[200px] space-y-1.5">
              {[5, 4, 3, 2, 1].map((s) => (
                <RatingBar key={s} stars={s} count={stats.distribution[s - 1]} total={stats.totalReviews} />
              ))}
            </div>
          </div>
        ) : (
          !loading && (
            <EmptyState icon="💬" title="No feedback yet" subtitle="Feedback will appear here once customers scan the QR on their receipt and leave a rating." />
          )
        )}
      </div>

      {/* Filters */}
      {stats.totalReviews > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Rating filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <div className="flex gap-1">
              {[null, 5, 4, 3, 2, 1].map((r) => (
                <button
                  key={r ?? 'all'}
                  onClick={() => setFilterRating(r)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border cursor-pointer transition-all ${
                    filterRating === r
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {r ? `${r}★` : 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search comments…"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-xs font-semibold">Loading feedback…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">{error}</div>
      )}

      {/* Feedback list */}
      {!loading && feedback.length > 0 && (
        <div className="space-y-3">
          {feedback.map((f) => (
            <div key={f._id} className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    <span className="text-lg font-black text-amber-600">{f.rating}</span>
                  </div>
                  <div className="min-w-0">
                    <StarRating rating={f.rating} size={12} />
                    <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(f.createdAt)}
                      {f.bill && (
                        <span className="text-gray-300">· {f.bill.invoiceNumber}</span>
                      )}
                    </p>
                  </div>
                </div>
                {f.bill?.total && (
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg shrink-0">
                    ₹{fmtNumber(f.bill.total)}
                  </span>
                )}
              </div>
              {f.comment && (
                <div className="mt-3 flex items-start gap-2 bg-gray-50 rounded-xl px-4 py-3">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-gray-700 leading-relaxed">{f.comment}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && pagination.pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => loadFeedback(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="text-[10px] font-bold text-gray-400">
            Page {pagination.page} of {pagination.pages}
          </span>
          <button
            onClick={() => loadFeedback(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Empty state after filtering */}
      {!loading && feedback.length === 0 && stats.totalReviews > 0 && (
        <EmptyState icon="🔍" title="No matching feedback" subtitle="Try adjusting your filters or search term." />
      )}
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationsPage — deterministic marketing opportunities.
 *
 * The offer engine computes these from existing business data (weather,
 * festivals, inventory, sales and customer activity) with no LLM or ML model.
 * The owner can turn an opportunity into a promotion through the normal offer
 * flow. Nothing is invented: a metric with no authoritative source renders as
 * "Not available" instead of a plausible-looking number.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { OpportunityCard } from './MarketingHome';
import { EmptyState, Spinner } from './shared';

interface RecommendationsPageProps {
  recommendations: any[];
  loading: boolean;
  currencySymbol: string;
  onCreate: (suggestion: any) => void;
}

export default function RecommendationsPage({ recommendations, loading, currencySymbol, onCreate }: RecommendationsPageProps) {
  // LIFECYCLE: Filter out converted/cooldown recommendations from active view
  const activeRecommendations = recommendations.filter((r: any) =>
    !['converted', 'cooldown', 'reevaluate'].includes(r.status)
  );

  return (
    <div className="space-y-6">
      {/* Page header (central content area only) */}
      <div data-testid="marketing-page-header" className="pt-1">
        <h1 className="text-lg font-black tracking-tight text-slate-900">Marketing</h1>
        <p className="text-[13px] font-bold text-slate-600">Smarter Marketing. Better Results.</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Opportunities computed from your sales, inventory, customer and calendar data.
        </p>
      </div>

      {/* Deterministic opportunity cards (offer-engine surface) */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Data-driven</p>
          <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" /> Opportunities for you
          </h3>
          <p className="text-[11px] text-gray-400 mt-1">
            Ideas detected from your weather, festivals, inventory, sales and customers. Pick one to start.
          </p>
        </div>
      </div>

      {loading ? (
        <Spinner label="Scanning for opportunities…" />
      ) : activeRecommendations.length === 0 ? (
        <EmptyState
          icon="💡"
          title="Nothing to recommend right now"
          subtitle="Opportunities appear based on weather, festivals, inventory levels and customer activity. Create a promotion manually any time."
          cta={
            <button
              onClick={() => onCreate({ title: 'New promotion', type: 'percentage', value: 10, description: '', recommendationSource: 'manual', recommendationReason: '', estimatedReach: 0, expectedImpact: '', priority: 'medium', applicableCategories: [] })}
              className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Create a promotion
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeRecommendations.map((rec, i) => (
            <OpportunityCard key={i} suggestion={rec} currencySymbol={currencySymbol} onCreate={() => onCreate(rec)} />
          ))}
        </div>
      )}
    </div>
  );
}

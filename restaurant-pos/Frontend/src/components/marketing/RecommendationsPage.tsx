/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationsPage — all detected opportunities in one place. Each card is
 * driven by the existing recommendation engine (/offers/recommendations); the
 * UI only shows friendly labels and a "Create Offer" action.
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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">AI + rule based</p>
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
          icon="🪄"
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

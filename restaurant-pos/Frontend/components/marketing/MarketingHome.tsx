/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketingHome — the command center. Answers "what should I promote right now?"
 * with opportunity cards from the existing recommendation engine (never the
 * internal provider names), plus a live snapshot of active promotions.
 */

import React from 'react';
import { Plus, Sparkles, Tag, Megaphone, TrendingUp, ArrowRight } from 'lucide-react';
import { opportunityMeta, OFFER_TYPE_LABELS, offerValueLabel, fmtNumber, EmptyState } from './shared';
import type { MarketingData } from './useMarketingData';

interface MarketingHomeProps {
  data: MarketingData;
  currencySymbol: string;
  onCreate: () => void;
  onViewRecommendations: () => void;
  onUseSuggestion: (suggestion: any) => void;
}

export default function MarketingHome({ data, currencySymbol, onCreate, onViewRecommendations, onUseSuggestion }: MarketingHomeProps) {
  const { offers, recommendations, loading } = data;
  const live = offers.filter((o) => o.status === 'active');
  const upcoming = offers.filter((o) => o.status === 'scheduled');
  const top = recommendations.slice(0, 4);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#0b2a5b] via-[#0d3a7a] to-[var(--brand-color)] rounded-3xl p-7 text-white shadow-lg relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute right-24 bottom-0 w-32 h-32 rounded-full bg-white/5 blur-xl" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200">Marketing</p>
        <h1 className="text-xl font-black mt-1 tracking-tight">Create promotions, bring customers back, and increase sales.</h1>
        <div className="flex flex-wrap gap-3 mt-5 relative">
          <button
            onClick={onCreate}
            className="flex items-center gap-2 bg-white text-[var(--brand-color)] px-5 py-2.5 rounded-xl text-sm font-black shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Promotion
          </button>
          <button
            onClick={onViewRecommendations}
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white border border-white/30 px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" /> View Recommendations
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Tag className="w-4 h-4" />} label="Live offers" value={String(live.length)} tone="bg-green-100 text-green-700" />
        <StatCard icon={<Megaphone className="w-4 h-4" />} label="Starting soon" value={String(upcoming.length)} tone="bg-amber-100 text-amber-700" />
        <StatCard icon={<Sparkles className="w-4 h-4" />} label="Opportunities" value={String(recommendations.length)} tone="bg-purple-100 text-purple-700" />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Total offers" value={String(offers.length)} tone="bg-blue-100 text-blue-700" />
      </div>

      {/* Opportunities for you */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">AI + rule based</p>
            <h2 className="text-sm font-extrabold text-gray-900">Opportunities for You</h2>
          </div>
          {recommendations.length > 3 && (
            <button onClick={onViewRecommendations} className="flex items-center gap-1 text-xs font-bold text-[var(--brand-color)] hover:text-[#003ea8] transition-colors cursor-pointer">
              See all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : top.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No opportunities detected yet"
            subtitle="Open Recommendations to scan for ideas, or create a promotion yourself."
            cta={<button onClick={onCreate} className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"><Plus className="w-3.5 h-3.5" /> Create Promotion</button>}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {top.map((rec, i) => (
              <OpportunityCard key={i} suggestion={rec} currencySymbol={currencySymbol} onCreate={() => onUseSuggestion(rec)} />
            ))}
          </div>
        )}
      </section>

      {/* Live now strip */}
      {live.length > 0 && (
        <section>
          <h2 className="text-sm font-extrabold text-gray-900 mb-3">Live now</h2>
          <div className="flex flex-wrap gap-2">
            {live.slice(0, 6).map((o) => (
              <div key={o._id} className="flex items-center gap-2 bg-white border border-green-200 rounded-xl px-3 py-2 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-bold text-gray-800">{o.title}</span>
                <span className="text-[10px] font-bold text-green-600">{offerValueLabel(o.type, o.value, currencySymbol)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e1e2ed] p-4 flex items-center gap-3 shadow-xs">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>{icon}</div>
      <div>
        <p className="text-xl font-black text-gray-900 leading-none">{value}</p>
        <p className="text-[10px] text-gray-400 font-semibold mt-1">{label}</p>
      </div>
    </div>
  );
}

export function OpportunityCard({ suggestion, currencySymbol, onCreate }: {
  suggestion: any; currencySymbol: string; onCreate: () => void;
}) {
  const meta = opportunityMeta(suggestion.recommendationSource);
  return (
    <div className={`bg-gradient-to-br ${meta.tone} border border-[#e1e2ed] rounded-2xl p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-xl shrink-0">{meta.icon}</div>
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{meta.eyebrow}</p>
            <p className="text-sm font-extrabold text-gray-900">{suggestion.title}</p>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-600 mt-3 leading-relaxed line-clamp-2">{suggestion.description}</p>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-[10px] font-bold">
        <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">
          {OFFER_TYPE_LABELS[suggestion.type] || suggestion.type} · {offerValueLabel(suggestion.type, suggestion.value, currencySymbol)}
        </span>
        {suggestion.minOrderValue ? (
          <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-500">Min {currencySymbol}{fmtNumber(suggestion.minOrderValue)}</span>
        ) : null}
        {suggestion.estimatedReach ? (
          <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-500">~{fmtNumber(suggestion.estimatedReach)} reach</span>
        ) : null}
      </div>
      <div className="flex items-center justify-between mt-4">
        <p className="text-[10px] text-gray-500 italic">{suggestion.recommendationReason}</p>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Create Offer
        </button>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketingWorkspace — the redesigned Marketing module.
 *
 * Mental model: Discover → Create → Promote → Sell → Measure.
 *   Home             — marketing command center (what should I promote now?)
 *   Create           — 30-60s progressive promotion builder
 *   Recommendations  — AI/rule-detected opportunities
 *   Offers           — manage live / upcoming / draft / expired offers
 *   Promote          — tell customers about an offer (campaigns)
 *   Analytics        — did my promotion work?
 *   Settings (gear)  — Automations, Segments, Loyalty & Rewards (secondary)
 *
 * All business logic stays server-side: every create/update/status change and
 * every recommendation goes through the existing /api/offers, /api/campaigns,
 * /api/ai and /api/rewards endpoints.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft, LayoutGrid, Plus, Sparkles, Tag, Megaphone, BarChart3, Settings, RefreshCw, CheckCircle,
} from 'lucide-react';
import type { LoyaltyReward, SystemSettings, Product } from '../../src/types';
import { useMarketingData } from './useMarketingData';
import MarketingHome from './MarketingHome';
import CreatePromotion from './CreatePromotion';
import RecommendationsPage from './RecommendationsPage';
import OffersPage from './OffersPage';
import PromotePage from './PromotePage';
import AnalyticsOverview from './AnalyticsOverview';
import MarketingSettingsPanel from './MarketingSettingsPanel';
import EasyOfferMaker from './EasyOfferMaker';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';

export type MarketingTab = 'home' | 'create' | 'recommendations' | 'offers' | 'promote' | 'analytics' | 'settings';

interface MarketingWorkspaceProps {
  onBack?: () => void;
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
}

export default function MarketingWorkspace({
  onBack, rewards, onUpdateRewards, currencySymbol, settings, onUpdateSettings, products = [],
}: MarketingWorkspaceProps) {
  const data = useMarketingData();
  const [tab, setTab] = useState<MarketingTab>('home');
  const [toast, setToast] = useState('');
  const [createPrefill, setCreatePrefill] = useState<any>(null);
  const [promoteOfferId, setPromoteOfferId] = useState<string | null>(null);
  const [easyOpen, setEasyOpen] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  // ─── Cross-tab navigation helpers ──────────────────────────────
  const goCreateWithSuggestion = useCallback((suggestion: any) => {
    setCreatePrefill({ mode: 'suggestion', suggestion });
    setTab('create');
  }, []);

  const goCreateWithGoal = useCallback((goal: string) => {
    setCreatePrefill({ mode: 'goal', goal });
    setTab('create');
  }, []);

  const goEditOffer = useCallback((offer: any) => {
    setCreatePrefill({ mode: 'edit', offer });
    setTab('create');
  }, []);

  const goPromoteOffer = useCallback((offerId: string) => {
    setPromoteOfferId(offerId);
    setTab('promote');
  }, []);

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    try {
      await api.updateOfferStatus(id, status);
      showToast(`Offer ${status === 'active' ? 'activated' : status === 'paused' ? 'paused' : `moved to ${status}`}`);
      data.refresh();
    } catch (err) {
      debugWarn('Marketing', 'status change failed:', err);
      showToast('Could not update the offer. Try again.');
    }
  }, [data, showToast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.deleteOffer(id);
      showToast('Offer deleted');
      data.refresh();
    } catch (err) {
      debugWarn('Marketing', 'delete failed:', err);
      showToast('Could not delete the offer. Try again.');
    }
  }, [data, showToast]);

  const handleDuplicate = useCallback(async (offer: any) => {
    try {
      const copy = {
        title: `${offer.title} (Copy)`,
        description: offer.description,
        shortDescription: offer.shortDescription,
        type: offer.type,
        value: offer.value,
        minOrderValue: offer.minOrderValue,
        maxDiscount: offer.maxDiscount,
        maxUses: offer.maxUses,
        maxPerCustomer: offer.maxPerCustomer,
        applicableCategories: offer.applicableCategories || [],
        applicableProductIds: offer.applicableProductIds || [],
        targetSegmentIds: offer.targetSegmentIds || [],
        targetSegmentNames: offer.targetSegmentNames || [],
        startDate: offer.startDate,
        endDate: offer.endDate,
        scheduledDate: offer.scheduledDate,
        daysOfWeek: offer.daysOfWeek,
        startHour: offer.startHour,
        endHour: offer.endHour,
        // Coupon codes must stay unique per restaurant — never copy the original's.
        couponCode: undefined,
        isAiGenerated: offer.isAiGenerated,
        isAutoActivate: false,
        status: 'draft',
      };
      const created = await api.createOffer(copy);
      if (created) {
        showToast('Offer duplicated as draft');
        data.refresh();
      }
    } catch (err) {
      debugWarn('Marketing', 'duplicate failed:', err);
      showToast('Could not duplicate the offer. Try again.');
    }
  }, [data, showToast]);

  const tabs: { id: MarketingTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: 'Home', icon: LayoutGrid },
    { id: 'create', label: 'Create', icon: Plus },
    { id: 'recommendations', label: 'Recommendations', icon: Sparkles },
    { id: 'offers', label: 'Offers', icon: Tag },
    { id: 'promote', label: 'Promote', icon: Megaphone },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  const activeCounts = useMemo(() => {
    const live = data.offers.filter((o) => o.status === 'active').length;
    const recs = data.recommendations.length;
    return { live, recs };
  }, [data.offers, data.recommendations]);

  return (
    <div className="flex flex-col h-full font-sans select-none bg-[#fbfbff]">
      {/* Header */}
      <div className="bg-white border-b border-[#e1e2ed] px-5 py-2.5 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
          title="Back to POS"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--brand-color)] to-blue-500 flex items-center justify-center shadow-sm shrink-0">
            <Megaphone className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight whitespace-nowrap">Marketing</span>
          <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="Marketing sections">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isActive ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'text-gray-500 hover:text-[var(--brand-color)] hover:bg-blue-50'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  {t.id === 'recommendations' && activeCounts.recs > 0 && (
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-700'}`}>
                      {activeCounts.recs}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => data.refresh()}
          className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${data.refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`p-1.5 rounded-lg transition-all cursor-pointer ${tab === 'settings' ? 'bg-[var(--brand-color)] text-white' : 'text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50'}`}
          title="Marketing settings — automations, segments, loyalty"
          aria-label="Marketing settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {tab === 'home' && (
            <MarketingHome
              data={data}
              currencySymbol={currencySymbol}
              onCreate={() => { setCreatePrefill(null); setTab('create'); }}
              onViewRecommendations={() => setTab('recommendations')}
              onUseSuggestion={goCreateWithSuggestion}
            />
          )}
          {tab === 'create' && (
            <CreatePromotion
              currencySymbol={currencySymbol}
              products={products}
              segments={data.segments}
              prefill={createPrefill}
              onDone={(status) => {
                showToast(status === 'draft' ? 'Draft saved' : status === 'scheduled' ? 'Offer scheduled' : 'Offer is now live');
                setCreatePrefill(null);
                data.refresh();
                setTab('offers');
              }}
              onCancel={() => { setCreatePrefill(null); setTab('home'); }}
            />
          )}
          {tab === 'recommendations' && (
            <RecommendationsPage
              recommendations={data.recommendations}
              loading={data.loading}
              currencySymbol={currencySymbol}
              onRefresh={data.refresh}
              onCreate={goCreateWithSuggestion}
            />
          )}
          {tab === 'offers' && (
            <OffersPage
              offers={data.offers}
              loading={data.loading}
              currencySymbol={currencySymbol}
              onRefresh={data.refresh}
              onEdit={goEditOffer}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onPromote={goPromoteOffer}
              onCreate={() => { setCreatePrefill(null); setTab('create'); }}
              onOpenEasy={() => setEasyOpen(true)}
            />
          )}
          {easyOpen && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setEasyOpen(false)}>
              <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <EasyOfferMaker
                  onClose={() => setEasyOpen(false)}
                  onSaved={() => { setEasyOpen(false); data.refresh(); }}
                  products={products}
                  currencySymbol={currencySymbol}
                />
              </div>
            </div>
          )}
          {tab === 'promote' && (
            <PromotePage
              offers={data.offers}
              segments={data.segments}
              campaigns={data.campaigns}
              currencySymbol={currencySymbol}
              initialOfferId={promoteOfferId}
              onClearOffer={() => setPromoteOfferId(null)}
              onRefreshed={data.refresh}
              notify={showToast}
            />
          )}
          {tab === 'analytics' && (
            <AnalyticsOverview
              analytics={data.analytics}
              offers={data.offers}
              loading={data.loading}
              currencySymbol={currencySymbol}
              onRefresh={data.refresh}
            />
          )}
          {tab === 'settings' && (
            <MarketingSettingsPanel
              rewards={rewards}
              onUpdateRewards={onUpdateRewards}
              currencySymbol={currencySymbol}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              products={products}
            />
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#1e293b] text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border border-slate-700/60 z-50">
          <div className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center">
            <CheckCircle className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight">{toast}</span>
        </div>
      )}
    </div>
  );
}

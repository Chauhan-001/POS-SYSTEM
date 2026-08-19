/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketingWorkspace — the redesigned Marketing module.
 *
 * Mental model: Discover → Advise → Promote → Sell → Measure.
 *   Home             — marketing command center (what should I promote now?)
 *   Advisory         — AI business advisor + create your own offer
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
  ArrowLeft, LayoutGrid, Plus, Sparkles, Tag, Megaphone, BarChart3, MoreHorizontal, RefreshCw, CheckCircle, Briefcase, Package, ChevronDown, ArrowUpRight,
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
import CampaignWizard from './CampaignWizard';
import RecommendationPreview from './RecommendationPreview';
import BusinessAdvisor from './BusinessAdvisor';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';


export type MarketingTab = 'home' | 'advisory' | 'recommendations' | 'offers' | 'promote' | 'analytics' | 'settings';

interface MarketingWorkspaceProps {
  onBack?: () => void;
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
  /** Active branches — enables per-branch offer targeting in the builder. */
  branches?: { id: string; name: string; isActive?: boolean }[];
}

// ─── Promote a Product card (Advisory tab) ──────────────────────
function PromoteProductCard({
  products, currencySymbol, branches, onCreateSuggestion, showToast,
}: {
  products: Product[];
  currencySymbol: string;
  branches: { id: string; name: string }[];
  onCreateSuggestion: (s: any) => void;
  showToast: (msg: string) => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState('');

  const filteredProducts = useMemo(() => {
    if (!products || products.length === 0) return [];
    const q = search.toLowerCase().trim();
    const list = q ? products.filter(p => p.name.toLowerCase().includes(q) || (p as any).category?.toLowerCase().includes(q)) : products;
    return list.slice(0, 50);
  }, [products, search]);

  const selectedProduct = useMemo(() => {
    return products?.find(p => p.id === selectedProductId || (p as any)._id === selectedProductId);
  }, [products, selectedProductId]);

  const handlePromote = () => {
    if (!selectedProduct) {
      showToast('Select a product first');
      return;
    }
    // Create an offer pre-filled for this product, then open the campaign wizard
    onCreateSuggestion({
      recommendationSource: 'promote_product',
      recommendationType: 'promotion',
      title: `Promote ${selectedProduct.name}`,
      offerSuggestion: {
        type: 'percentage',
        value: 10,
        title: `${selectedProduct.name} Special`,
        description: `Check out our ${selectedProduct.name} — available now!`,
        applicableProducts: [selectedProduct.id || (selectedProduct as any)._id],
        applicableCategories: selectedProduct.category ? [selectedProduct.category] : [],
        promoteProduct: true,
        productName: selectedProduct.name,
      },
      action: 'create_offer',
      confidence: 'High',
      score: 90,
      why: `Promote ${selectedProduct.name} to drive more sales of this item.`,
      evidence: [`Product: ${selectedProduct.name}`, `Price: ${currencySymbol}${selectedProduct.price}`],
      expectedImpact: 'Increased visibility and sales for this product',
      supportingSignals: [],
    });
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-sm">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Promote a Product</h3>
            <p className="text-[11px] text-slate-500">Pick any menu item and create a targeted promotion to boost its sales</p>
          </div>
        </div>
      </div>
      <div className="mt-4 relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-left cursor-pointer hover:border-[var(--brand-color)] transition-colors"
        >
          <span className={selectedProduct ? 'text-slate-900 font-semibold' : 'text-slate-400'}>
            {selectedProduct ? `${selectedProduct.name} — ${currencySymbol}${selectedProduct.price}` : 'Search for a product…'}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>
        {showDropdown && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-slate-100">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search products…"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-[var(--brand-color)]"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-400 text-center">No products found</p>
              ) : (
                filteredProducts.map((p) => (
                  <button
                    key={p.id || (p as any)._id}
                    onClick={() => {
                      setSelectedProductId(p.id || (p as any)._id);
                      setShowDropdown(false);
                      setSearch('');
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-blue-50 cursor-pointer transition-colors ${
                      (p.id || (p as any)._id) === selectedProductId ? 'bg-blue-50 text-[var(--brand-color)] font-bold' : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-slate-400 shrink-0 ml-2">{currencySymbol}{p.price}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <button
        onClick={handlePromote}
        disabled={!selectedProduct}
        className="mt-3 flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
      >
        <Megaphone className="w-3.5 h-3.5" /> Promote this Product
        <ArrowUpRight className="w-3 h-3 ml-0.5" />
      </button>
    </div>
  );
}

export default function MarketingWorkspace({
  onBack, rewards, onUpdateRewards, currencySymbol, settings, onUpdateSettings, products = [], branches = [],
}: MarketingWorkspaceProps) {
  const data = useMarketingData();
  const [tab, setTab] = useState<MarketingTab>('home');
  const [toast, setToast] = useState('');
  const [createPrefill, setCreatePrefill] = useState<any>(null);
  const [promoteOfferId, setPromoteOfferId] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [previewSuggestion, setPreviewSuggestion] = useState<any>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  // ─── Cross-tab navigation helpers ──────────────────────────────
  // Clicking a recommendation card opens a PREVIEW first — nothing is applied
  // until the owner picks a path. Real recommendations show the preview sheet;
  // manual "New promotion" placeholders go straight to the builder.
  const goCreateWithSuggestion = useCallback((suggestion: any) => {
    if (suggestion?.recommendationSource && suggestion.recommendationSource !== 'manual') {
      setPreviewSuggestion(suggestion);
    } else {
      // Pass the suggestion data directly (flat) so the wizard can prefill
      setCreatePrefill(suggestion);
      setCreateModalOpen(true);
    }
  }, []);

  const handlePreviewEdit = useCallback((suggestion: any) => {
    setPreviewSuggestion(null);
    // Pass the suggestion data directly (flat) so the wizard can prefill
    setCreatePrefill(suggestion);
    setCreateModalOpen(true);
  }, []);



  const goCreateWithGoal = useCallback((goal: string) => {
    setCreatePrefill({ mode: 'goal', goal });
    setCreateModalOpen(true);
  }, []);

  const goEditOffer = useCallback((offer: any) => {
    setCreatePrefill({ mode: 'edit', offer });
    setCreateModalOpen(true);
  }, []);

  const goPromoteOffer = useCallback((offerId: string) => {
    setPromoteOfferId(offerId);
    setPromoteOpen(true);
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
    { id: 'advisory', label: 'Advisory', icon: Briefcase },
    { id: 'recommendations', label: 'Recommendations', icon: Sparkles },
    { id: 'offers', label: 'Offers', icon: Tag },
    { id: 'promote', label: 'Promote', icon: Megaphone },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'More', icon: MoreHorizontal },
  ];

  const activeCounts = useMemo(() => {
    const live = data.offers.filter((o) => o.status === 'active').length;
    const recs = data.recommendations.length;
    return { live, recs };
  }, [data.offers, data.recommendations]);

  // One refresh control for the whole module: the header button. It refreshes
  // everything; while on the Recommendations tab it also asks the LLM for
  // fresh AI suggestions (same behaviour the old per-page button had).
  const handleRefresh = useCallback(() => {
    if (tab === 'recommendations') void data.refreshWithAi();
    else void data.refresh();
  }, [tab, data]);

  return (
    <div className="flex flex-col h-full font-sans select-none bg-[var(--color-surface-muted)]">
      {/* Header */}
      <div className="bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] px-5 py-2.5 flex items-center gap-3 shrink-0">
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
          onClick={handleRefresh}
          className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${data.refreshing || data.aiRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {tab === 'home' && (
            <MarketingHome
              data={data}
              currencySymbol={currencySymbol}
              onViewRecommendations={() => setTab('recommendations')}
              onUseSuggestion={goCreateWithSuggestion}
            />
          )}
          {tab === 'advisory' && (
            <div className="space-y-5">
              {/* Create Your Own Offer — manual entry point */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm">
                      <Plus className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Create Your Own Offer</h3>
                      <p className="text-[11px] text-slate-500">Build a promotion from scratch — set type, value, rules and publish it live</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setCreatePrefill(null); setCreateModalOpen(true); }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create Offer
                  </button>
                </div>
              </div>
              {/* Promote a Product */}
              <PromoteProductCard
                products={products}
                currencySymbol={currencySymbol}
                branches={branches}
                onCreateSuggestion={goCreateWithSuggestion}
                showToast={showToast}
              />
              {/* AI Business Advisor */}
              <BusinessAdvisor
                currencySymbol={currencySymbol}
                branches={branches}
                onCreateSuggestion={goCreateWithSuggestion}
                onReviewInventory={() => showToast('Open Inventory from the main menu to review stock')}
                onViewOffers={() => setTab('offers')}
                notify={showToast}
              />
            </div>
          )}
          {tab === 'recommendations' && (
            <RecommendationsPage
              recommendations={data.recommendations}
              loading={data.loading}
              currencySymbol={currencySymbol}
              onCreate={goCreateWithSuggestion}
            />
          )}
          {tab === 'offers' && (
            <OffersPage
              offers={data.offers}
              loading={data.loading}
              currencySymbol={currencySymbol}
              branches={branches}
              onEdit={goEditOffer}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          )}
          {quickCreateOpen && (
            <div className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--color-bg-page)]">
              <CampaignWizard
                currencySymbol={currencySymbol}
                products={products}
                branches={branches}
                segments={data.segments}
                settings={settings}
                prefill={{ mode: 'quick' }}
                onDone={(offerId, campaignId) => {
                  showToast('Campaign created!');
                  setQuickCreateOpen(false);
                  data.refresh();
                  setTab('offers');
                }}
                onClose={() => setQuickCreateOpen(false)}
              />
            </div>
          )}
          {createModalOpen && (
            <div className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--color-bg-page)]">
              <CampaignWizard
                currencySymbol={currencySymbol}
                products={products}
                branches={branches}
                segments={data.segments}
                settings={settings}
                prefill={createPrefill}
                onDone={(offerId, campaignId) => {
                  showToast('Campaign broadcast successfully!');
                  setCreatePrefill(null);
                  setCreateModalOpen(false);
                  data.refresh();
                  setTab('offers');
                }}
                onClose={() => { setCreateModalOpen(false); setCreatePrefill(null); }}
              />
            </div>
          )}
          {previewSuggestion && (
            <RecommendationPreview
              suggestion={previewSuggestion}
              currencySymbol={currencySymbol}
              onEdit={handlePreviewEdit}
              onClose={() => setPreviewSuggestion(null)}
            />
          )}
          {tab === 'promote' && (
            <PromotePage
              offers={data.offers}
              segments={data.segments}
              campaigns={data.campaigns}
              currencySymbol={currencySymbol}
              initialOfferId={null}
              onClearOffer={() => {}}
              onRefreshed={data.refresh}
              notify={showToast}
              onBack={() => setTab('home')}
            />
          )}
          {promoteOpen && (
            <div className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--color-bg-page)]">
              <div className="p-6 max-w-4xl mx-auto">
                <PromotePage
                  offers={data.offers}
                  segments={data.segments}
                  campaigns={data.campaigns}
                  currencySymbol={currencySymbol}
                  initialOfferId={promoteOfferId}
                  onClearOffer={() => setPromoteOfferId(null)}
                  onRefreshed={data.refresh}
                  notify={showToast}
                  onBack={() => { setPromoteOpen(false); setPromoteOfferId(null); }}
                />
              </div>
            </div>
          )}
          {tab === 'analytics' && (
            <AnalyticsOverview
              analytics={data.analytics}
              offers={data.offers}
              loading={data.loading}
              currencySymbol={currencySymbol}
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

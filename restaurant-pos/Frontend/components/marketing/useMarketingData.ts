/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useMarketingData — one data hook for the redesigned Marketing workspace.
 * Loads offers, recommendations, segments, analytics and campaigns through the
 * existing API client (nothing new server-side). Every fetch is offline-safe
 * (returns empty on failure) and exposes a refresh() that pages can call.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';

export interface MarketingData {
  offers: any[];
  recommendations: any[];
  segments: any[];
  analytics: any;
  campaigns: any[];
  loading: boolean;
  refreshing: boolean;
  /** Deterministic re-fetch (rule-based engine, no LLM). */
  refresh: () => Promise<void>;
  /** True while the LLM is generating recommendations. */
  aiRefreshing: boolean;
  /** Re-run the deterministic engine AND call the LLM for fresh AI suggestions. */
  refreshWithAi: () => Promise<void>;
}

export function useMarketingData(): MarketingData {
  const [offers, setOffers] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiRefreshing, setAiRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [offerRes, recRes, segRes, anRes, campRes] = await Promise.all([
        api.fetchOfferList(),
        // 30 so low-priority safety warnings (margin protection, cost
        // increase, wastage) are not truncated off the Recommendations page.
        api.fetchOfferRecommendations(30).catch(() => null),
        api.fetchOfferSegments().catch(() => null),
        api.fetchOfferAnalytics().catch(() => null),
        api.fetchCampaigns({ limit: 100 }).catch(() => null),
      ]);
      if (offerRes && Array.isArray(offerRes.offers)) setOffers(offerRes.offers);
      if (recRes && Array.isArray(recRes.suggestions)) setRecommendations(recRes.suggestions);
      if (segRes && Array.isArray(segRes.segments)) setSegments(segRes.segments);
      if (anRes) setAnalytics(anRes);
      if (campRes && Array.isArray(campRes.data)) setCampaigns(campRes.data);
    } catch (err) {
      debugWarn('Marketing', 'data refresh failed:', err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Refresh that CALLS THE LLM: gathers real tenant context (active offers,
   * customer base) into POST /api/ai/offer-recommendations and prepends the
   * AI's suggestions to the deterministic list, labelled recommendationSource
   * = 'ai' (advisory only — never financial authority). When AI is unavailable
   * (off-subscription / offline / provider error) it falls back to the
   * deterministic refresh so the button always does something useful.
   */
  const refreshWithAi = useCallback(async () => {
    setAiRefreshing(true);
    try {
      const currentOffers = offers
        .filter((o) => o.status === 'active' && (o.title || o.name))
        .map((o) => o.title || o.name)
        .slice(0, 10);
      const customerCount = estimateAudience(segments, 'everyone') ?? 0;
      // NOTE: the API client unwraps the response envelope (result.json?.data
      // ?? result.json), so fetchAiOfferRecommendations resolves to the
      // endpoint's `data` object directly: { suggestions, summaryInsight,
      // trendNote }. A failed/offline call resolves null.
      // bustCache=true — this is an explicit user refresh: call the LLM fresh
      // and replace the cached response (Phase 3). The backend builds the full
      // canonical context server-side; these two fields are legacy payload
      // kept for API compatibility.
      const aiRes = await api.fetchAiOfferRecommendations({ currentOffers, customerCount, bustCache: true });
      const suggestions = aiRes?.suggestions;
      if (aiRes && Array.isArray(suggestions) && suggestions.length > 0) {
        // Sanitize the LLM's advisory output into the same shape the engine
        // produces — whitelisted type, numeric value, bounded priority — so a
        // malformed response can never leak into the Create-Offer prefill.
        const OFFER_TYPES = new Set(['percentage', 'flat', 'bogo', 'coupon', 'combo', 'reward_points']);
        const aiRecs = suggestions.map((s: any) => {
          const type = OFFER_TYPES.has(String(s.type || '')) ? s.type : 'percentage';
          const value = Number.isFinite(Number(s.value)) && Number(s.value) >= 0 ? Number(s.value) : 0;
          const priority = ['high', 'medium', 'low'].includes(s.priority) ? s.priority : 'medium';
          return {
            title: String(s.title || '').slice(0, 120) || 'AI suggestion',
            description: String(s.description || '').slice(0, 400),
            type,
            value,
            recommendationSource: 'ai',
            recommendationReason: String(s.reason || '').slice(0, 400),
            priority,
            applicableCategories: s.targetCategory && s.targetCategory !== 'All' ? [String(s.targetCategory)] : [],
            expectedImpact: String(s.estimatedImpact || '').slice(0, 300),
            estimatedReach: null, // never fabricate reach — no impression data
            isAiGenerated: true,
            summaryInsight: aiRes.summaryInsight,
            trendNote: aiRes.trendNote,
          };
        });
        // Replace previous AI cards (no stacking on repeated refreshes) and
        // keep the deterministic engine's cards exactly as the engine sent them.
        setRecommendations([...aiRecs, ...recommendations.filter((r: any) => r.recommendationSource !== 'ai')]);
        return;
      }
      // AI unavailable — deterministic engine still gives fresh suggestions.
      await refresh();
    } catch {
      await refresh();
    } finally {
      setAiRefreshing(false);
    }
  }, [offers, segments, recommendations, refresh]);

  return { offers, recommendations, segments, analytics, campaigns, loading, refreshing, refresh, aiRefreshing, refreshWithAi };
}

/** Estimate audience size for a friendly audience choice using real segment counts. */
export function estimateAudience(segments: any[], choice: string, tier?: string, customIds: string[] = []): number | null {
  if (choice === 'everyone') {
    // new + returning ≈ the full customer base
    const newC = segments.find((s) => s.type === 'new_customer')?.customerCount || 0;
    const retC = segments.find((s) => s.type === 'returning_customer')?.customerCount || 0;
    const both = newC + retC;
    if (both > 0) return both;
    const max = Math.max(0, ...segments.map((s) => s.customerCount || 0));
    return max > 0 ? max : null;
  }
  if (choice === 'tier') return null; // tier sizes aren't exposed — keep honest
  if (choice === 'custom') {
    if (customIds.length === 0) return null;
    return customIds.reduce((sum, id) => sum + (segments.find((s) => s._id === id)?.customerCount || 0), 0) || null;
  }
  const opt: Record<string, string> = {
    new: 'new_customer', returning: 'returning_customer', vip: 'vip_customer', inactive: 'dormant_30d',
  };
  const seg = segments.find((s) => s.type === opt[choice]);
  return seg?.customerCount || null;
}

/** Resolve a friendly audience choice into backend segment ids + target tier. */
export function resolveAudience(segments: any[], choice: string, tier: string | undefined, customIds: string[]): { segmentIds: string[]; tier?: string } {
  if (choice === 'everyone') return { segmentIds: [] };
  if (choice === 'tier') return { segmentIds: [], tier };
  if (choice === 'custom') return { segmentIds: customIds };
  const opt: Record<string, string> = {
    new: 'new_customer', returning: 'returning_customer', vip: 'vip_customer', inactive: 'dormant_30d',
  };
  const seg = segments.find((s) => s.type === opt[choice]);
  return { segmentIds: seg ? [seg._id] : [] };
}

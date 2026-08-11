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
  refresh: () => Promise<void>;
}

export function useMarketingData(): MarketingData {
  const [offers, setOffers] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [offerRes, recRes, segRes, anRes, campRes] = await Promise.all([
        api.fetchOfferList(),
        api.fetchOfferRecommendations().catch(() => null),
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

  return { offers, recommendations, segments, analytics, campaigns, loading, refreshing, refresh };
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

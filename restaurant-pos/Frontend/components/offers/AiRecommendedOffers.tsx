/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Recommended Offers — Landing page for the Offer Management System.
 * Shows proactive AI-generated offer suggestions as premium cards.
 * Deterministic engine generates recommendations based on weather,
 * festivals, inventory, time, and performance data.
 * LLM is only used for generating attractive titles/descriptions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  CloudSun,
  Calendar,
  Package,
  Clock,
  TrendingUp,
  Users,
  Target,
  Eye,
  DollarSign,
  CheckCircle,
  XCircle,
  Copy,
  Edit,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import type { OfferSuggestion } from '../../src/types';
import { fetchOfferRecommendations } from '../../src/api/client';

interface AiRecommendedOffersProps {
  onCreateFromSuggestion: (suggestion: OfferSuggestion) => void;
  onPublishSuggestion: (suggestion: OfferSuggestion) => void;
}

const SOURCE_ICONS: Record<string, React.ElementType> = {
  weather: CloudSun,
  festival: Calendar,
  inventory_clearance: Package,
  inventory_low_stock_protection: Package,
  time_based: Clock,
  weekend: Clock,
  slow_day: TrendingUp,
  weak_category: TrendingUp,
  first_visit: Users,
  repeat_customer: Users,
};

const SOURCE_LABELS: Record<string, string> = {
  weather: 'Weather-Based',
  festival: 'Festival Special',
  inventory_clearance: 'Inventory Clearance',
  inventory_low_stock_protection: 'Limited Stock',
  time_based: 'Time-Based',
  weekend: 'Weekend Special',
  slow_day: 'Slow Day Recovery',
  weak_category: 'Category Boost',
  first_visit: 'New Customer',
  repeat_customer: 'Retention',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-purple-100 text-purple-800 border-purple-200',
  medium: 'bg-blue-100 text-blue-800 border-blue-200',
  low: 'bg-gray-100 text-gray-700 border-gray-200',
};

const PRIORITY_DOTS: Record<string, string> = {
  high: 'bg-purple-500',
  medium: 'bg-blue-500',
  low: 'bg-gray-400',
};

/**
 * Local deterministic fallback — generates recommendations entirely on-device
 * so the AI Recommended page ALWAYS shows content (weather/time/festival/customer
 * based), even when the backend is offline or the feature gate is closed.
 */
function generateLocalFallback(): OfferSuggestion[] {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun
  const suggestions: OfferSuggestion[] = [];

  // Weather heuristic (season-based)
  const month = now.getMonth();
  const isSummer = month >= 2 && month <= 5;
  const isMonsoon = month >= 6 && month <= 8;
  if (isSummer) {
    suggestions.push({
      title: 'Cool Down Special',
      type: 'percentage',
      value: 20,
      description: 'Hot day! Enjoy 20% off on cold beverages and refreshing desserts.',
      recommendationSource: 'weather',
      recommendationReason: 'Sunny weather drives cold-beverage and dessert demand.',
      estimatedReach: 120,
      expectedImpact: '15-25% increase in beverage sales during the weather window',
      priority: 'high',
      applicableCategories: ['Beverages', 'Desserts'],
      defaultDurationDays: 1,
    });
  } else if (isMonsoon) {
    suggestions.push({
      title: 'Rainy Day Comfort',
      type: 'percentage',
      value: 15,
      description: 'Rainy day! Get 15% off on hot soups, pakoras and tea.',
      recommendationSource: 'weather',
      recommendationReason: 'Rainy weather increases hot snack and beverage sales.',
      estimatedReach: 100,
      expectedImpact: '15-25% increase in comfort food orders',
      priority: 'high',
      applicableCategories: ['Starters', 'Beverages'],
      defaultDurationDays: 1,
    });
  }

  // Happy hour (3 PM - 6 PM weekdays)
  if (hour >= 15 && hour < 18 && day >= 1 && day <= 5) {
    suggestions.push({
      title: 'Happy Hour!',
      type: 'percentage',
      value: 20,
      description: "It's Happy Hour! Enjoy 20% off on all beverages and appetizers until 6 PM.",
      recommendationSource: 'time_based',
      recommendationReason: 'Happy Hour promotions increase footfall by 25-40% during slow hours.',
      estimatedReach: 90,
      expectedImpact: '25-40% increase in afternoon/early evening orders',
      priority: 'high',
      applicableCategories: ['Beverages', 'Appetizers', 'Starters'],
      startHour: 15,
      endHour: 18,
      daysOfWeek: [1, 2, 3, 4, 5],
      defaultDurationDays: 1,
    });
  }

  // Lunch rush
  if (hour >= 11 && hour < 14) {
    suggestions.push({
      title: 'Lunch Special Combo',
      type: 'combo',
      value: 20,
      description: 'Quick lunch combo at 20% off — includes main course + beverage.',
      recommendationSource: 'time_based',
      recommendationReason: 'Lunch combos increase average order value by 15-20% during rush.',
      estimatedReach: 110,
      expectedImpact: '15-20% increase in lunch-time average order value',
      priority: 'high',
      applicableCategories: ['Main Course', 'Beverages'],
      startHour: 11,
      endHour: 14,
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      defaultDurationDays: 1,
    });
  }

  // Weekend family feast
  if (day === 5 || day === 6 || day === 0) {
    suggestions.push({
      title: 'Weekend Family Feast',
      type: 'percentage',
      value: 15,
      description: 'Weekend special! Bring the family and enjoy 15% off on orders above ₹500.',
      recommendationSource: 'weekend',
      recommendationReason: 'Weekend family dining accounts for 40% of weekly revenue.',
      estimatedReach: 140,
      expectedImpact: '20-30% increase in weekend revenue',
      priority: 'medium',
      applicableCategories: [],
      minOrderValue: 500,
      daysOfWeek: [5, 6, 0],
      defaultDurationDays: 3,
    });
  }

  // Customer loyalty (always shown so the page is never empty)
  suggestions.push({
    title: 'Welcome Treat!',
    type: 'flat',
    value: 100,
    description: 'First time here? Welcome! Enjoy ₹100 off on your first order above ₹300.',
    recommendationSource: 'first_visit',
    recommendationReason: 'First-visit offers increase conversion by 40% and build initial loyalty.',
    estimatedReach: 80,
    expectedImpact: '40% increase in new customer conversion rate',
    priority: 'high',
    applicableCategories: [],
    minOrderValue: 300,
    defaultDurationDays: 30,
  });

  suggestions.push({
    title: 'Come Back for More!',
    type: 'reward_points',
    value: 50,
    description: 'Earn double loyalty points on your next visit!',
    recommendationSource: 'repeat_customer',
    recommendationReason: 'Repeat customer offers increase retention by 25% and lifetime value by 35%.',
    estimatedReach: 70,
    expectedImpact: '25% increase in customer retention rate',
    priority: 'medium',
    applicableCategories: [],
    defaultDurationDays: 14,
  });

  return suggestions;
}

export default function AiRecommendedOffers({
  onCreateFromSuggestion,
  onPublishSuggestion,
}: AiRecommendedOffersProps) {
  const [suggestions, setSuggestions] = useState<OfferSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishedIds, setPublishedIds] = useState<Set<number>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [sourceLabel, setSourceLabel] = useState<string>('');

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    // Clear stale per-session state on every refresh so dismissed/published
    // suggestions come back after the feed regenerates.
    setDismissedIds(new Set());
    setPublishedIds(new Set());
    try {
      const data = await fetchOfferRecommendations();
      if (data?.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
        setSourceLabel('Live AI engine');
      } else {
        // Backend unavailable/empty — use the on-device deterministic engine
        // so the page never dead-ends on a failed load.
        setSuggestions(generateLocalFallback());
        setSourceLabel('Local estimates (offline-safe)');
      }
    } catch {
      setSuggestions(generateLocalFallback());
      setSourceLabel('Local estimates (offline-safe)');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const handlePublish = (idx: number, suggestion: OfferSuggestion) => {
    setPublishedIds(prev => new Set(prev).add(idx));
    onPublishSuggestion(suggestion);
  };

  const handleDismiss = (idx: number) => {
    setDismissedIds(prev => new Set(prev).add(idx));
  };

  const visibleSuggestions = suggestions.filter((_, i) => !dismissedIds.has(i));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-400 font-medium">Generating intelligent recommendations...</p>
        </div>
      </div>
    );
  }

  if (visibleSuggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Lightbulb className="w-10 h-10 text-amber-300" />
        <p className="text-sm text-gray-500 font-medium">No recommendations right now</p>
        <p className="text-xs text-gray-400">Check back later or create a manual offer</p>
        <button
          onClick={fetchRecommendations}
          className="mt-2 flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-gray-900 text-sm">AI Recommended Offers</h3>
          <span className="text-[10px] text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
            {visibleSuggestions.length} suggestions
          </span>
          {sourceLabel && (
            <span className="text-[9px] text-purple-500 font-semibold bg-purple-50 px-2 py-0.5 rounded-full hidden sm:inline">
              {sourceLabel}
            </span>
          )}
        </div>
        <button
          onClick={fetchRecommendations}
          className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-bold transition-all active:scale-95"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Recommendations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleSuggestions.map((s, idx) => {
          const SourceIcon = SOURCE_ICONS[s.recommendationSource] || Sparkles;
          const isPublished = publishedIds.has(idx);

          return (
            <div
              key={idx}
              className={`relative bg-white rounded-2xl border-2 p-5 shadow-sm transition-all hover:shadow-md group ${
                isPublished
                  ? 'border-green-300 bg-green-50/30'
                  : s.priority === 'high'
                    ? 'border-purple-200'
                    : s.priority === 'medium'
                      ? 'border-blue-200'
                      : 'border-gray-200'
              }`}
            >
              {/* Priority Badge */}
              <div className={`absolute top-3 right-3 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${PRIORITY_COLORS[s.priority]}`}>
                {s.priority} Priority
              </div>

              {/* Icon + Source */}
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  s.priority === 'high' ? 'bg-purple-100 text-purple-600'
                    : s.priority === 'medium' ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  <SourceIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    {SOURCE_LABELS[s.recommendationSource] || s.recommendationSource}
                  </span>
                  <h4 className="font-extrabold text-gray-900 text-sm leading-tight mt-0.5">{s.title}</h4>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-gray-600 mb-3 line-clamp-2">{s.description}</p>

              {/* Reason */}
              <div className="bg-gray-50 rounded-xl p-3 mb-3">
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  <span className="font-bold text-gray-700">Why:</span> {s.recommendationReason}
                </p>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-blue-50 rounded-lg p-2 text-center">
                  <Target className="w-3.5 h-3.5 text-blue-600 mx-auto mb-0.5" />
                  <span className="block text-[9px] font-bold text-blue-700">{s.estimatedReach}</span>
                  <span className="block text-[7px] text-blue-500 uppercase tracking-wider">Reach</span>
                </div>
                <div className="bg-green-50 rounded-lg p-2 text-center">
                  <TrendingUp className="w-3.5 h-3.5 text-green-600 mx-auto mb-0.5" />
                  <span className="block text-[9px] font-bold text-green-700">{s.defaultDurationDays}d</span>
                  <span className="block text-[7px] text-green-500 uppercase tracking-wider">Duration</span>
                </div>
                <div className="bg-amber-50 rounded-lg p-2 text-center">
                  <DollarSign className="w-3.5 h-3.5 text-amber-600 mx-auto mb-0.5" />
                  <span className="block text-[9px] font-bold text-amber-700">
                    {s.type === 'percentage' ? `${s.value}%` : s.type === 'flat' ? `₹${s.value}` : s.type}
                  </span>
                  <span className="block text-[7px] text-amber-500 uppercase tracking-wider">Discount</span>
                </div>
              </div>

              {/* Audience */}
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mb-4">
                <Users className="w-3 h-3" />
                <span>{s.applicableCategories.length > 0
                  ? `Targets: ${s.applicableCategories.slice(0, 2).join(', ')}${s.applicableCategories.length > 2 ? ' + more' : ''}`
                  : 'All categories'
                }</span>
              </div>

              {/* Impact */}
              <p className="text-[9px] text-gray-400 italic mb-4">{s.expectedImpact}</p>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {isPublished ? (
                  <div className="flex items-center gap-1.5 text-green-600 text-xs font-bold">
                    <CheckCircle className="w-4 h-4" /> Published
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handlePublish(idx, s)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Publish
                    </button>
                    <button
                      onClick={() => onCreateFromSuggestion(s)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                      title="Edit before publishing"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDismiss(idx)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                      title="Dismiss"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * features.ts — Feature adoption analytics (Phase 2.10, reports/features).
 *
 * Measures which product capabilities restaurants actually use, bucketed by
 * adoption status (adopted / exploring / never-used) so growth teams can target
 * onboarding. Sources:
 *   - AI features: AIUsageLog.feature
 *   - Voice inventory: VoiceAuditLog (source: 'voice' | 'ai_suggested')
 *   - Loyalty: Restaurant.loyaltyEnabled
 *   - Offline / POS: Device + Bill presence
 *
 * The classification is conservative and deterministic — an AI feature is
 * "adopted" when ≥ 5 requests landed in the window, "explored" when 1–4.
 */

import { AIUsageLog, Restaurant, Device, Bill } from '../../../models';
import { buildWindow, DateWindow } from '../reportQueryBuilder';

export interface FeatureReport {
  summary: {
    totalFeatures: number;
    adoptedFeatures: number;
    exploringFeatures: number;
    adoptionRate: number;
    restaurantsUsingAi: number;
    totalRestaurants: number;
  };
  features: Array<{
    feature: string;
    source: string;
    restaurants: number;
    requests: number;
    adoptedRestaurants: number;
    exploringRestaurants: number;
    adoptionStatus: 'adopted' | 'exploring' | 'never';
  }>;
  adoptionSeries: Array<{ key: string; value: number }>;
}

const ADOPTION_THRESHOLD = 5;

export async function getFeatureReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<FeatureReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });

  const totalRestaurants = await Restaurant.countDocuments({ isDeleted: { $ne: true } });

  const [aiGroups, voiceGroups, aiSeries, loyaltyEnabled, posRestaurants] = await Promise.all([
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      {
        $group: {
          _id: '$feature',
          requests: { $sum: 1 },
          restaurants: { $addToSet: '$restaurantId' },
        },
      },
      { $sort: { requests: -1 } },
    ]),
    voiceGroupsQuery(window),
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Restaurant.countDocuments({ isDeleted: { $ne: true }, loyaltyEnabled: true }),
    countPosRestaurants(window),
  ]);

  const features: FeatureReport['features'] = [];

  for (const g of aiGroups as any[]) {
    const feature = String(g._id);
    const restaurantIds = (g.restaurants ?? []).filter(Boolean).map(String);
    features.push({
      feature: `ai:${feature}`,
      source: 'ai',
      restaurants: restaurantIds.length,
      requests: g.requests,
      adoptedRestaurants: g.requests >= ADOPTION_THRESHOLD ? restaurantIds.length : 0,
      exploringRestaurants: g.requests > 0 && g.requests < ADOPTION_THRESHOLD ? restaurantIds.length : 0,
      adoptionStatus: g.requests >= ADOPTION_THRESHOLD ? 'adopted' : g.requests > 0 ? 'exploring' : 'never',
    });
  }

  for (const v of voiceGroups) {
    features.push({
      feature: `voice:${v.feature}`,
      source: 'voice',
      restaurants: v.restaurants,
      requests: v.requests,
      adoptedRestaurants: v.requests >= ADOPTION_THRESHOLD ? v.restaurants : 0,
      exploringRestaurants: v.requests > 0 && v.requests < ADOPTION_THRESHOLD ? v.restaurants : 0,
      adoptionStatus: v.requests >= ADOPTION_THRESHOLD ? 'adopted' : v.requests > 0 ? 'exploring' : 'never',
    });
  }

  features.push({
    feature: 'loyalty',
    source: 'config',
    restaurants: loyaltyEnabled,
    requests: loyaltyEnabled,
    adoptedRestaurants: loyaltyEnabled,
    exploringRestaurants: 0,
    adoptionStatus: loyaltyEnabled > 0 ? 'adopted' : 'never',
  });

  features.push({
    feature: 'pos_offline',
    source: 'config',
    restaurants: posRestaurants,
    requests: posRestaurants,
    adoptedRestaurants: posRestaurants,
    exploringRestaurants: 0,
    adoptionStatus: posRestaurants > 0 ? 'adopted' : 'never',
  });

  features.sort((a, b) => b.requests - a.requests);

  const adopted = features.filter((f) => f.adoptionStatus === 'adopted').length;
  const exploring = features.filter((f) => f.adoptionStatus === 'exploring').length;

  return {
    summary: {
      totalFeatures: features.length,
      adoptedFeatures: adopted,
      exploringFeatures: exploring,
      adoptionRate: features.length ? Number(((adopted / features.length) * 100).toFixed(2)) : 0,
      restaurantsUsingAi: features.filter((f) => f.source === 'ai' && f.restaurants > 0).length,
      totalRestaurants,
    },
    features,
    adoptionSeries: aiSeries.map((r: any) => ({ key: String(r._id), value: r.value })),
  };
}

async function voiceGroupsQuery(window: DateWindow): Promise<Array<{ feature: string; requests: number; restaurants: number }>> {
  try {
    const { default: VoiceAuditLog } = await import('../../../modules/voice-inventory/models/VoiceAuditLog');
    const rows = await (VoiceAuditLog as any).aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      {
        $group: {
          _id: { $ifNull: ['$source', 'voice'] },
          requests: { $sum: 1 },
          restaurants: { $addToSet: '$restaurantId' },
        },
      },
    ]);
    return rows.map((r: any) => ({
      feature: String(r._id),
      requests: r.requests,
      restaurants: (r.restaurants ?? []).filter(Boolean).length,
    }));
  } catch {
    return [];
  }
}

async function countPosRestaurants(window: DateWindow): Promise<number> {
  const [devices, bills] = await Promise.all([
    Device.distinct('restaurantId', { restaurantId: { $ne: null }, isDeleted: { $ne: true } }),
    Bill.distinct('restaurantId', { createdAt: { $gte: window.from, $lte: window.to }, restaurantId: { $ne: null } }),
  ]);
  return new Set([...devices.map(String), ...bills.map(String)]).size;
}
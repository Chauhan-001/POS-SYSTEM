/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PublicStoreService — read-only public loyalty store resolution.
 *
 * Given a restaurant's publicToken (the value embedded in the QR codes the POS/
 * dashboard prints), this service assembles the public site payload:
 *   - Restaurant identity (name, phone, address, logo)
 *   - Loyalty earn rate + points/wallet semantics
 *   - Active reward catalog (stock-aware)
 *   - Live offers (active/scheduled, date-window aware)
 *
 * Deliberately read-only: the public store can only look at what the owner has
 * published. Redemption/verification happens inside the authenticated loyalty
 * module, not here.
 */

import { AppError } from '../../../utils/AppError';
import Restaurant from '../../../models/Restaurant';
import Reward from '../../../models/Reward';
import Offer from '../../../models/Offer';
import LoyaltyTier from '../../../models/LoyaltyTier';
import LoyaltySettings from '../../../models/LoyaltySettings';

const TOKEN_PATTERN = /^pbl_[A-Za-z0-9]{10,64}$/;

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve a live restaurant by its public token. Shared by the loyalty
 * storefront and the menu/ordering endpoints so tenant resolution is
 * identical everywhere. Throws 404 for unknown/inactive stores.
 */
export async function resolveRestaurantByToken(publicToken: string): Promise<any> {
  if (!publicToken || !TOKEN_PATTERN.test(publicToken)) {
    throw new AppError(404, 'Store not found');
  }
  const restaurant = await Restaurant.findOne({
    publicToken,
    isActive: true,
    isDeleted: { $ne: true },
  }).lean().exec();
  if (!restaurant) throw new AppError(404, 'Store not found');
  return restaurant;
}

export class PublicStoreService {
  /**
   * Resolve a restaurant by its public token and return the payload the public
   * store page renders. Throws 404 for unknown / inactive / non-loyalty stores.
   */
  async getSiteConfig(publicToken: string): Promise<any> {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const restaurantId = restaurant._id;

    const [settings, tiers, rewards, offers] = await Promise.all([
      LoyaltySettings.findOne({ restaurantId }).lean().exec(),
      LoyaltyTier.find({ restaurantId, isActive: true, isDeleted: { $ne: true } })
        .sort({ priority: 1 })
        .lean()
        .exec(),
      Reward.find({ restaurantId, isActive: true, isDeleted: { $ne: true } })
        .sort({ pointsRequired: 1 })
        .lean()
        .exec(),
      Offer.find({ restaurantId, isDeleted: { $ne: true }, status: { $in: ['active', 'scheduled'] } })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean()
        .exec(),
    ]);

    const today = todayStamp();
    const liveOffers = offers.filter((o: any) => {
      if (o.startDate && o.startDate > today) return false;
      if (o.endDate && o.endDate < today) return false;
      return true;
    });

    // Stock-aware rewards: unlimited (null/undefined) or remaining > 0.
    const liveRewards = rewards.filter((r: any) => {
      if (typeof r.stock !== 'number') return true;
      return (r.stock || 0) > (r.redeemedCount || 0);
    });

    const enableTiers = settings?.enableTiers !== false;
    const earnRate = settings
      ? {
          pointsPerCurrency: settings.pointsPerCurrency ?? 1,
          currencyUnit: settings.pointsValueInCurrency ?? 10,
        }
      : { pointsPerCurrency: 1, currencyUnit: 10 };

    return {
      store: {
        token: publicToken,
        name: restaurant.brandName || restaurant.name,
        capabilities: {
          homepageBanner: true,
          offerCard: true,
          menuHighlight: true,
          popup: true,
          floatingOffer: true,
        },
        tagline: restaurant.description || '',
        phone: restaurant.phone || restaurant.altPhone || '',
        currency: restaurant.currency || 'INR',
        currencySymbol: '₹',
        location: [restaurant.area, restaurant.city, restaurant.state]
          .filter(Boolean)
          .join(', '),
        logoUrl: restaurant.logoUrl || null,
        loyaltyEnabled: !!restaurant.loyaltyEnabled,
      },
      loyalty: {
        enabled: !!restaurant.loyaltyEnabled,
        earnRate,
        tiers: enableTiers
          ? tiers.map((t: any) => ({
              name: t.name,
              minLifetimeSpend: t.minLifetimeSpend ?? 0,
              multiplier: t.pointsMultiplier ?? 1,
              benefits: t.benefits || [],
            }))
          : [],
      },
      rewards: liveRewards.slice(0, 30).map((r: any) => ({
        id: r._id.toString(),
        title: r.title,
        type: r.type,
        value: r.value,
        pointsRequired: r.pointsRequired,
        minBillAmount: r.minBillAmount || 0,
        isLargeReward: !!r.isLargeReward,
        itemName: r.rewardItemName || null,
        stockLeft: typeof r.stock === 'number' ? Math.max(0, (r.stock || 0) - (r.redeemedCount || 0)) : null,
      })),
      offers: liveOffers.slice(0, 20).map((o: any) => ({
        id: o._id.toString(),
        title: o.title,
        description: o.description,
        shortDescription: o.shortDescription || '',
        type: o.type,
        value: o.value,
        minOrderValue: o.minOrderValue || 0,
        couponCode: o.couponCode || null,
        endDate: o.endDate || null,
        imageUrl: o.imageUrl || null,
      })),
    };
  }
}

export const publicStoreService = new PublicStoreService();
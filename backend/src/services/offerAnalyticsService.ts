/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerAnalyticsService.ts — Populates OfferAnalytics from REAL events.
 *
 * Phase 23: OfferAnalytics was previously only written by seed scripts. This
 * service upserts today's per-offer snapshot from actual redemption and
 * campaign-delivery events, so the analytics page reflects what really
 * happened. Opens/reads are only ever incremented when a provider reports them.
 */

import mongoose from 'mongoose';
import OfferAnalytics from '../models/OfferAnalytics';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// NOTE: $setOnInsert must NEVER include a field that is also $inc'd — MongoDB
// rejects that as a path conflict. Counter fields are created by $inc itself on
// insert; the remaining snapshot counters get 0 from schema defaults.

/** Record a real redemption (called by the offer redemption ledger). */
export async function recordOfferRedemption(
  restaurantId: string,
  offerId: string,
  discountAmount: number,
): Promise<void> {
  try {
    const oid = objectId(restaurantId);
    const offerOid = objectId(offerId);
    const date = todayStr();
    await OfferAnalytics.updateOne(
      { restaurantId: oid, offerId: offerOid, snapshotDate: date },
      {
        $inc: { redeemed: 1, revenueGenerated: Number(discountAmount) || 0 },
        $setOnInsert: { restaurantId: oid, offerId: offerOid, snapshotDate: date },
      },
      { upsert: true },
    ).exec();
  } catch (err: any) {
    console.warn('[OfferAnalytics] redemption record failed:', err?.message);
  }
}

/**
 * Record a campaign delivery outcome for an offer-linked campaign.
 * `opened` is only ever non-zero when a provider actually reports opens —
 * we never invent open/read data.
 */
export async function recordCampaignDelivery(
  restaurantId: string,
  offerId: string,
  opts: { reached: number; opened?: number },
): Promise<void> {
  try {
    const reached = Number(opts.reached) || 0;
    const opened = Number(opts.opened) || 0;
    const oid = objectId(restaurantId);
    const offerOid = objectId(offerId);
    const date = todayStr();
    await OfferAnalytics.updateOne(
      { restaurantId: oid, offerId: offerOid, snapshotDate: date },
      {
        $inc: { customersReached: reached, opened },
        $setOnInsert: { restaurantId: oid, offerId: offerOid, snapshotDate: date },
      },
      { upsert: true },
    ).exec();
  } catch (err: any) {
    console.warn('[OfferAnalytics] delivery record failed:', err?.message);
  }
}

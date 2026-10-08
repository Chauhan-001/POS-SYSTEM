/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingScheduler.ts — Background scheduler for the unified Marketing system.
 *
 * Phase 18. Runs on a setInterval worker (same pattern as subscriptionScheduler
 * / reportJobs). Each tick is idempotent:
 *   - Offers:   scheduled → active when startDate/scheduledDate arrives;
 *               active|paused → expired after endDate.
 *   - Campaigns: due scheduled campaigns are claimed (scheduled → sending) and
 *               queued for the delivery worker — exactly one claim wins.
 *   - Recovery: campaigns stuck in 'sending' (crashed worker) are re-queued.
 *   - Automations: enabled recipes fire at most once per day.
 */

import mongoose from 'mongoose';
import Offer from '../models/marketing/Offer';
import Campaign from '../models/marketing/Campaign';
import CampaignHistory from '../models/marketing/CampaignHistory';
import Restaurant from '../models/core/Restaurant';
import { campaignService } from './index';
import { enqueueCampaign } from './campaignQueue';
import { runDueAutomations } from './automationService';
import { updateAllSegments } from './segmentEngine';
import { consolidateRestaurantMemory } from '../ai/memory/memoryLearningService';

const TICK_MS = 60_000; // 1 minute
const STUCK_AFTER_MS = 15 * 60 * 1000; // re-queue 'sending' campaigns older than this

// ─── Segment auto-refresh (nightly) ────────────────────────────────────────
// Segments recompute from customer data. Rather than paying that cost on every
// minute tick, refresh once per day shortly after 04:00 server time. The date
// guard keeps it idempotent: even if the tick fires several times in that hour
// (or the server restarts), the work happens at most once per calendar day.
const SEGMENT_REFRESH_HOUR = 4;
let lastSegmentRefreshDate = '';
let segmentRefreshInFlight = false;

/**
 * Whether the nightly segment refresh is due for `now`. Pure + exported for
 * unit tests. Runs once per day, at/after SEGMENT_REFRESH_HOUR.
 *
 * Both the date and the hour are computed in SERVER-LOCAL time so the guard
 * and the window never disagree around midnight in non-UTC timezones.
 */
export function shouldRunSegmentRefresh(lastDate: string, now: Date): boolean {
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return lastDate !== localToday && now.getHours() >= SEGMENT_REFRESH_HOUR;
}

/**
 * Recompute segments for EVERY active restaurant, one at a time, isolating
 * failures per restaurant so one bad tenant never aborts the whole pass.
 * Returns the number of restaurants refreshed.
 */
export async function refreshAllRestaurantSegments(): Promise<number> {
  if (segmentRefreshInFlight) return 0;
  segmentRefreshInFlight = true;
  let refreshed = 0;
  try {
    const restaurants = await Restaurant.find({ isActive: { $ne: false } })
      .select('_id')
      .lean()
      .exec();
    for (const rest of restaurants) {
      try {
        await updateAllSegments(String(rest._id));
        refreshed++;
      } catch (err: any) {
        console.warn(`[MarketingScheduler] segment refresh failed for ${rest._id}:`, err?.message);
      }
    }
  } finally {
    segmentRefreshInFlight = false;
  }
  return refreshed;
}

/** Nightly segment refresh — no-op until the daily window opens. */
async function maybeRefreshSegments(): Promise<void> {
  const now = new Date();
  if (!shouldRunSegmentRefresh(lastSegmentRefreshDate, now)) return;
  const refreshed = await refreshAllRestaurantSegments();
  lastSegmentRefreshDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (refreshed > 0) console.log(`[MarketingScheduler] refreshed segments for ${refreshed} restaurant(s)`);
}

// ─── Memory consolidation (nightly) ───────────────────────────────────────
// PHASE C: `consolidateRestaurantMemory` previously had no production caller,
// so no campaign outcome ever became RestaurantMemory. It is hosted HERE, in
// the existing marketing scheduler, rather than in a new scheduler. Runs once
// per day shortly after 05:00 server-local time (an hour after segment
// refresh), tenant-by-tenant, bounded and failure-isolated per tenant.
const MEMORY_CONSOLIDATION_HOUR = 5;
/** Upper bound on tenants per pass — never an unbounded full-database scan. */
export const MEMORY_CONSOLIDATION_TENANT_BATCH = 200;
let lastMemoryConsolidationDate = '';
let memoryConsolidationInFlight = false;

/**
 * Whether nightly memory consolidation is due for `now`. Pure + exported for
 * unit tests. Same server-local date/hour contract as shouldRunSegmentRefresh.
 */
export function shouldRunMemoryConsolidation(lastDate: string, now: Date): boolean {
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return lastDate !== localToday && now.getHours() >= MEMORY_CONSOLIDATION_HOUR;
}

/**
 * Consolidate validated lifecycle evidence into long-term memory for every
 * active tenant, one at a time. Bounded by MEMORY_CONSOLIDATION_TENANT_BATCH
 * and isolated per tenant: one failing tenant never aborts the pass. Reads and
 * writes are tenant-scoped inside consolidateRestaurantMemory itself.
 */
export async function consolidateAllRestaurantMemories(now: number = Date.now()): Promise<{
  tenants: number;
  written: number;
  skipped: number;
  invalidated: number;
}> {
  const result = { tenants: 0, written: 0, skipped: 0, invalidated: 0 };
  if (memoryConsolidationInFlight) return result;
  memoryConsolidationInFlight = true;
  try {
    const restaurants = await Restaurant.find({ isActive: { $ne: false } })
      .select('_id')
      .sort({ _id: 1 })
      .limit(MEMORY_CONSOLIDATION_TENANT_BATCH)
      .lean()
      .exec();
    for (const rest of restaurants) {
      try {
        const res = await consolidateRestaurantMemory({ restaurantId: String(rest._id) }, now);
        result.tenants += 1;
        result.written += res.written;
        result.skipped += res.skipped;
        result.invalidated += res.invalidated;
      } catch (err: any) {
        // Never throw: failure isolation per tenant.
        console.warn(`[MarketingScheduler] memory consolidation failed for ${rest._id}:`, err?.message);
      }
    }
  } finally {
    memoryConsolidationInFlight = false;
  }
  return result;
}

/** Nightly memory consolidation — no-op until the daily window opens. */
async function maybeConsolidateMemory(): Promise<void> {
  const now = new Date();
  if (!shouldRunMemoryConsolidation(lastMemoryConsolidationDate, now)) return;
  const res = await consolidateAllRestaurantMemories(now.getTime());
  lastMemoryConsolidationDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (res.tenants > 0) {
    console.log(
      `[MarketingScheduler] memory consolidation: ${res.tenants} tenant(s), ${res.written} written, ${res.skipped} skipped, ${res.invalidated} invalidated`,
    );
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startMarketingScheduler(intervalMs: number = TICK_MS): void {
  void runMarketingTick();
  setInterval(() => {
    void runMarketingTick();
  }, intervalMs).unref?.();
  console.log(`[MarketingScheduler] started (tick ${intervalMs}ms)`);
}

export async function runMarketingTick(): Promise<void> {
  try {
    await activateScheduledOffers();
    await expireOffers();
    await dispatchScheduledCampaigns();
    await recoverStuckCampaigns();
    await runDueAutomations();
    await maybeRefreshSegments();
    await maybeConsolidateMemory();
  } catch (err: any) {
    console.error('[MarketingScheduler] tick error:', err?.message);
  }
}

/** Offers: scheduled → active when startDate/scheduledDate has arrived. */
async function activateScheduledOffers(): Promise<void> {
  const today = todayStr();
  const due = await Offer.find({
    status: 'scheduled',
    isDeleted: { $ne: true },
    $or: [{ scheduledDate: { $lte: today } }, { startDate: { $lte: today } }],
  })
    .select('_id')
    .lean()
    .exec();

  let activated = 0;
  for (const offer of due) {
    const res = await Offer.updateOne(
      { _id: offer._id, status: 'scheduled' },
      { $set: { status: 'active' } },
    ).exec();
    activated += res.modifiedCount || 0;
  }
  if (activated > 0) console.log(`[MarketingScheduler] auto-activated ${activated} offers`);
}

/** Offers: active|paused → expired after endDate. */
async function expireOffers(): Promise<void> {
  const today = todayStr();
  const due = await Offer.find({
    status: { $in: ['active', 'paused'] },
    endDate: { $lt: today },
    isDeleted: { $ne: true },
  })
    .select('_id status')
    .lean()
    .exec();

  let expired = 0;
  for (const offer of due) {
    const res = await Offer.updateOne(
      { _id: offer._id, status: offer.status },
      { $set: { status: 'expired' } },
    ).exec();
    expired += res.modifiedCount || 0;
  }
  if (expired > 0) console.log(`[MarketingScheduler] expired ${expired} offers`);
}

/** Campaigns: claim due scheduled campaigns and queue delivery. */
async function dispatchScheduledCampaigns(): Promise<void> {
  const now = new Date();
  const due = await Campaign.find({
    status: 'scheduled',
    'schedule.scheduledAt': { $lte: now },
    isDeleted: { $ne: true },
  })
    .select('_id restaurantId')
    .lean()
    .exec();

  for (const campaign of due) {
    try {
      // send() claims scheduled → sending atomically; duplicates are rejected.
      await campaignService.send(String(campaign.restaurantId), String(campaign._id), { operator: 'Scheduler' });
      console.log(`[MarketingScheduler] dispatched campaign ${campaign._id}`);
    } catch (err: any) {
      // 409 = already claimed by a concurrent tick — fine, skip silently.
      if (String(err?.statusCode) !== '409') {
        console.warn(`[MarketingScheduler] campaign ${campaign._id} dispatch skipped:`, err?.message);
      }
    }
  }
}

/** Recovery: campaigns stuck in 'sending' (crashed worker) are re-queued. */
async function recoverStuckCampaigns(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await Campaign.find({
    status: 'sending',
    updatedAt: { $lt: cutoff },
  })
    .select('_id restaurantId historyIds')
    .lean()
    .exec();

  for (const campaign of stuck) {
    const history = await CampaignHistory.findOne({ campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (history) {
      enqueueCampaign({
        campaignId: String(campaign._id),
        restaurantId: String(campaign.restaurantId),
        historyId: String(history._id),
      });
      console.log(`[MarketingScheduler] re-queued stuck campaign ${campaign._id}`);
    } else {
      // Crash happened between the atomic claim (scheduled → sending) and the
      // delivery-history write — no job exists to re-queue. Reset to 'scheduled'
      // so the next tick's dispatchScheduledCampaigns reclaims it (its atomic
      // claim prevents double-send).
      await Campaign.updateOne(
        { _id: campaign._id, status: 'sending' },
        { $set: { status: 'scheduled' } },
      ).exec();
      console.warn(`[MarketingScheduler] reset stuck campaign ${campaign._id} to scheduled (no delivery history found)`);
    }
  }
}

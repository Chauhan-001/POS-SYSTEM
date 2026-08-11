/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * campaignQueue.ts — In-process delivery job queue for campaigns.
 *
 * Phase 17: campaign delivery must NEVER block the HTTP request that triggered
 * it, and a 5,000-recipient campaign must not be looped synchronously inside a
 * request. `enqueueCampaign()` returns immediately; a single worker drains the
 * queue with bounded concurrency and writes per-recipient results back to
 * CampaignHistory.
 *
 * This mirrors the project's existing background-job pattern (setInterval
 * workers in subscriptionScheduler / reportJobs) — no new queue library.
 */

import mongoose from 'mongoose';
import CampaignHistory from '../models/CampaignHistory';
import Campaign from '../models/Campaign';
import Offer from '../models/Offer';
import { providerFor, channelConfigured, type DeliveryPayload } from './deliveryService';
import { recordCampaignDelivery } from './offerAnalyticsService';
import { auditLogRepo } from '../repositories';

export interface CampaignJob {
  campaignId: string;
  restaurantId: string;
  historyId: string;
}

const queue: CampaignJob[] = [];
let draining = false;

/** Add a delivery job. Safe to call from request handlers or the scheduler. */
export function enqueueCampaign(job: CampaignJob): void {
  queue.push(job);
}

/** Number of queued (not yet started) jobs — for debugging/monitoring. */
export function queueDepth(): number {
  return queue.length;
}

/**
 * Drain the queue. Runs continuously from server startup; each job is processed
 * to completion, failures are captured per recipient and never thrown.
 */
export function startCampaignWorker(intervalMs = 2000): void {
  setInterval(() => {
    void drainQueue();
  }, intervalMs).unref?.();
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await processJob(job);
      } catch (err: any) {
        console.error('[CampaignQueue] job failed:', err?.message);
      }
    }
  } finally {
    draining = false;
  }
}

async function processJob(job: CampaignJob): Promise<void> {
  const campaign = await Campaign.findOne({
    _id: job.campaignId,
    restaurantId: new mongoose.Types.ObjectId(job.restaurantId),
  }).lean().exec();
  if (!campaign) return;

  const history = await CampaignHistory.findById(job.historyId).lean().exec();
  if (!history) return;

  const channel = history.channel as any;
  const provider = providerFor(String(channel));
  const recipients: string[] = history.recipientPhones || [];
  const message = history.messageContent || '';
  const offerTitle = campaign.offerId
    ? (await Offer.findById(campaign.offerId).lean().exec())?.title
    : undefined;

  // If the channel is not configured, every recipient fails — NEVER claim sent.
  // `channelConfigured` resolves webhook config per-restaurant (settings OR env)
  // so a Settings-configured webhook is not wrongly declared unconfigured.
  if (!(await channelConfigured(channel, job.restaurantId))) {
    await finalize(job, {
      results: recipients.map((phone) => ({ phone, status: 'failed', error: `${channel} channel is not configured (Settings → Integrations)` })),
      status: recipients.length > 0 ? 'failed' : 'sent',
    });
    return;
  }

  const results: Array<{ phone: string; status: 'delivered' | 'failed'; error?: string; deliveredAt?: string }> = [];
  let sent = 0;
  let failed = 0;

  // Bounded concurrency: process recipients in small batches (never 1-at-a-time
  // for large audiences, never all-at-once for memory safety).
  const BATCH = 25;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const outcomes = await Promise.all(
      batch.map(async (phone) => {
        const payload: DeliveryPayload = {
          to: phone,
          message,
          subject: (campaign as any).template?.subject,
          offerTitle,
          campaignId: job.campaignId,
          historyId: job.historyId,
          restaurantId: job.restaurantId,
        };
        const res = await provider.send(payload);
        return { phone, res };
      }),
    );
    for (const { phone, res } of outcomes) {
      if (res.ok) {
        sent++;
        results.push({ phone, status: 'delivered', deliveredAt: res.deliveredAt });
      } else {
        failed++;
        results.push({ phone, status: 'failed', error: res.error });
      }
    }
  }

  const finalStatus =
    failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  await finalize(job, { results, status: finalStatus, sent, failed });
}

async function finalize(
  job: CampaignJob,
  opts: {
    results: Array<{ phone: string; status: string; error?: string; deliveredAt?: string }>;
    status: 'sent' | 'failed' | 'partial';
    sent?: number;
    failed?: number;
  },
): Promise<void> {
  const sent = opts.sent ?? opts.results.filter((r) => r.status === 'delivered').length;
  const failed = opts.failed ?? opts.results.length - sent;

  await CampaignHistory.updateOne(
    { _id: job.historyId },
    {
      $set: {
        status: opts.status,
        results: opts.results,
        sentDate: new Date().toISOString(),
        recipientCount: opts.results.length,
      },
    },
  ).exec();

  await Campaign.updateOne(
    { _id: job.campaignId },
    {
      $set: {
        status: opts.status,
        'stats.sentCount': sent,
        'stats.failedCount': failed,
      },
    },
  ).exec();

  // Populate OfferAnalytics from actual delivery events (Phase 23).
  const campaign = await Campaign.findById(job.campaignId).lean().exec();
  if (campaign?.offerId) {
    await recordCampaignDelivery(job.restaurantId, String(campaign.offerId), {
      reached: sent,
      opened: 0, // provider does not report opens yet — do not invent data
    });
  }

  await auditLogRepo.create({
    action: 'CAMPAIGN_SENT',
    entityType: 'campaign',
    entityId: job.campaignId,
    performedBy: 'System',
    restaurantId: job.restaurantId,
    details: { channel: 'delivery', sent, failed, status: opts.status },
  } as any);
}

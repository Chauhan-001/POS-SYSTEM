/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * hooks.ts — Best-effort recording hooks for the Admin Reports ledger.
 *
 * Called from the admin subscription controller (renew / upgrade / downgrade /
 * pause / resume) and any future payment path. Each hook is:
 *   - fire-and-forget (never awaited by the caller)
 *   - wrapped in its own try/catch so it can NEVER break the primary flow
 *   - idempotent per invocation
 *
 * Recording failures are swallowed and surfaced only via console.debug, keeping
 * the subscription lifecycle 100% unaffected.
 */

import mongoose from 'mongoose';
import { recordRevenueEvent } from './aggregations/revenue';
import { recordSubscriptionHistory } from './aggregations/subscriptions';

export interface HookSubscriptionCtx {
  restaurantId?: string | mongoose.Types.ObjectId;
  subscriptionId?: string | mongoose.Types.ObjectId;
  restaurantName?: string;
  ownerId?: string | mongoose.Types.ObjectId;
  ownerName?: string;
  plan?: string;
  planName?: string;
  amount?: number;
}

function safe(fn: () => Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .catch((err) => {
      console.debug('[reports-hook] skipped:', (err as Error)?.message);
    });
}

/** After a successful cash/manual subscription renewal. */
export function hookSubscriptionRenewed(ctx: HookSubscriptionCtx): void {
  safe(async () => {
    await recordRevenueEvent({
      type: 'subscription',
      source: 'recurring',
      amount: ctx.amount ?? 0,
      restaurantId: ctx.restaurantId,
      restaurantName: ctx.restaurantName,
      ownerId: ctx.ownerId,
      ownerName: ctx.ownerName,
      subscriptionId: ctx.subscriptionId,
      planId: ctx.plan,
      planName: ctx.planName,
      billingCycle: 'monthly',
      description: 'Manual subscription renewal',
    });
    await recordSubscriptionHistory({
      restaurantId: ctx.restaurantId!,
      subscriptionId: ctx.subscriptionId,
      action: 'renewed',
      toStatus: 'active',
      toPlanId: ctx.plan,
      toPlanName: ctx.planName,
      amount: ctx.amount,
      reason: 'admin_action',
    });
  });
}

/** After a plan change (upgrade or downgrade). */
export function hookSubscriptionPlanChanged(
  ctx: HookSubscriptionCtx & {
    mode: 'upgrade' | 'downgrade';
    fromPlan?: string;
    fromPlanName?: string;
    toPlan?: string;
    toPlanName?: string;
  },
): void {
  safe(async () => {
    await recordSubscriptionHistory({
      restaurantId: ctx.restaurantId!,
      subscriptionId: ctx.subscriptionId,
      action: ctx.mode === 'upgrade' ? 'upgraded' : 'downgraded',
      fromPlanId: ctx.fromPlan,
      fromPlanName: ctx.fromPlanName,
      toPlanId: ctx.toPlan ?? ctx.plan,
      toPlanName: ctx.toPlanName ?? ctx.planName,
      reason: 'admin_action',
    });
  });
}

/** After pause / resume lifecycle actions. */
export function hookSubscriptionPaused(ctx: HookSubscriptionCtx & { pause: boolean }): void {
  safe(async () => {
    await recordSubscriptionHistory({
      restaurantId: ctx.restaurantId!,
      subscriptionId: ctx.subscriptionId,
      action: ctx.pause ? 'paused' : 'resumed',
      toPlanId: ctx.plan,
      toPlanName: ctx.planName,
      reason: 'admin_action',
    });
  });
}
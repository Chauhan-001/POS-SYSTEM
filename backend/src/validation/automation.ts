/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automation validation — Zod schemas for automation recipe endpoints.
 */

import { z } from 'zod';

const automationChannel = z.enum(['whatsapp', 'sms', 'email', 'app_notification', 'webhook']);

export const updateAutomationSchema = z
  .object({
    enabled: z.boolean().optional(),
    channel: automationChannel.optional(),
    message: z.string().max(2000).optional(),
    offerTemplate: z
      .object({
        type: z.enum(['percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback', 'reward_points', 'coupon', 'festival', 'referral', 'loyalty_bonus']).optional(),
        value: z.number().min(0).max(1_000_000).optional(),
        title: z.string().max(120).optional(),
        minOrderValue: z.number().min(0).max(10_000_000).optional(),
      })
      .optional(),
  })
  .strict();

export const automationParamsSchema = z
  .object({
    id: z.string().min(1).max(100),
  })
  .strict();

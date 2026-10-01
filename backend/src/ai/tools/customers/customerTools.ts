/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * customerTools.ts — Customer tools (spec §6): canonical segments
 * (aggregate-only, no PII — same contract the offer engine enforces) and
 * retention signals from the existing lifecycle service.
 */

import { z } from 'zod';
import { AiError } from '../../shared/aiErrors';
import { buildRecommendationContext, resolveBranchScope } from '../../../services/recommendationContext';
import { getCustomerLifecycleSummary, type CustomerOpportunityOptions } from '../../../services/customerOpportunityService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

// ─── getCustomerSegments ────────────────────────────────────────────

export const getCustomerSegmentsInputSchema = z.object({}).strict();
export type GetCustomerSegmentsInput = z.infer<typeof getCustomerSegmentsInputSchema>;

export interface CustomerSegmentsOutput {
  available: boolean;
  reason?: 'NO_SEGMENT_DATA';
  segments?: Array<{ id: string; name: string; customerCount: number }>;
  totals?: {
    customerCount: number;
    activeCustomers: number;
    dormant30d: number;
    vipCount: number;
  };
  generatedAt: string;
}

export async function executeGetCustomerSegments(
  _input: GetCustomerSegmentsInput,
  ctx: ToolContext,
): Promise<CustomerSegmentsOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const context = await buildRecommendationContext(ctx.tenant.restaurantId);
    const hasSegments = context.segments && context.segments.length > 0;
    if (!hasSegments && context.customerCount === 0) {
      return { available: false, reason: 'NO_SEGMENT_DATA', generatedAt };
    }
    return {
      available: true,
      segments: context.segments || [],
      totals: {
        customerCount: context.customerCount,
        activeCustomers: context.activeCustomers,
        dormant30d: context.dormant30d ?? 0,
        vipCount: context.vipCount ?? 0,
      },
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_SEGMENT_DATA', generatedAt };
  }
}

export const getCustomerSegmentsToolDefinition: ToolDefinition<GetCustomerSegmentsInput, CustomerSegmentsOutput> = {
  name: 'getCustomerSegments',
  category: 'customers',
  access: 'read',
  meta: {
    description:
      'Customer segments with counts (aggregate only, never individual customers) plus tenant totals: overall, active, dormant 30+ days, and VIP counts.',
    source: 'services/recommendationContext.ts → buildRecommendationContext (canonical segment source)',
  },
  inputSchema: getCustomerSegmentsInputSchema,
  execute: executeGetCustomerSegments,
};

// ─── getRetentionSignals ────────────────────────────────────────────

export const getRetentionSignalsInputSchema = z
  .object({
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    /** Days of inactivity that mark a customer as inactive (7–180). */
    inactiveThresholdDays: z.number().int().min(7).max(180).optional(),
  })
  .strict();

export type GetRetentionSignalsInput = z.infer<typeof getRetentionSignalsInputSchema>;

export interface RetentionSignalsOutput {
  available: boolean;
  reason?: 'NO_CUSTOMER_DATA';
  summary?: {
    totalCustomers: number;
    newCustomers: number;
    activeCustomers: number;
    inactiveCustomers: number;
    highValueCustomers: number;
    atRiskCustomers: number;
    avgOrderValue: number;
    avgVisitsPerCustomer: number;
  };
  topSegments?: Array<{
    segmentId: string;
    segmentName: string;
    customerCount: number;
    opportunityType: string;
    recommendedActions: string[];
  }>;
  generatedAt: string;
}

export async function executeGetRetentionSignals(
  input: GetRetentionSignalsInput,
  ctx: ToolContext,
): Promise<RetentionSignalsOutput> {
  const generatedAt = new Date().toISOString();

  if (input.branchId) {
    const scope = await resolveBranchScope(ctx.tenant.restaurantId, input.branchId);
    if (!scope) throw new AiError('TOOL_TENANT_MISMATCH', 'branchId does not belong to this restaurant');
  }

  try {
    const opts: CustomerOpportunityOptions = {
      restaurantId: ctx.tenant.restaurantId,
      branchId: input.branchId,
      inactiveThresholdDays: input.inactiveThresholdDays,
      // Explicit thresholds — the lifecycle aggregate expects them to be set.
      highValueThresholdVisits: 20,
      highValueThresholdPoints: 500,
      atRiskThresholdDays: 60,
    };
    const summary = await getCustomerLifecycleSummary(opts);
    const hasData = summary.totalCustomers > 0;
    if (!hasData) {
      return { available: false, reason: 'NO_CUSTOMER_DATA', generatedAt };
    }
    return {
      available: true,
      summary: {
        totalCustomers: summary.totalCustomers,
        newCustomers: summary.newCustomers,
        activeCustomers: summary.activeCustomers,
        inactiveCustomers: summary.inactiveCustomers,
        highValueCustomers: summary.highValueCustomers,
        atRiskCustomers: summary.atRiskCustomers,
        avgOrderValue: Math.round(summary.avgOrderValue || 0),
        avgVisitsPerCustomer: Math.round((summary.avgVisitsPerCustomer || 0) * 10) / 10,
      },
      topSegments: (summary.topSegments || []).slice(0, 5).map((s) => ({
        segmentId: s.segmentId,
        segmentName: s.segmentName,
        customerCount: s.customerCount,
        opportunityType: s.opportunityType,
        recommendedActions: s.recommendedActions,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_CUSTOMER_DATA', generatedAt };
  }
}

export const getRetentionSignalsToolDefinition: ToolDefinition<GetRetentionSignalsInput, RetentionSignalsOutput> = {
  name: 'getRetentionSignals',
  category: 'customers',
  access: 'read',
  meta: {
    description:
      'Customer retention health: total/new/active/inactive/high-value/at-risk counts, average order value and visit frequency, plus top segment opportunities.',
    source: 'services/customerOpportunityService.ts → getCustomerLifecycleSummary',
  },
  inputSchema: getRetentionSignalsInputSchema,
  execute: executeGetRetentionSignals,
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Segmentation Extractor — tenant-scoped RFM features from the
 * Customer collection for the segmentation service (4th ML model).
 *
 * Tenant isolation: always called with the VERIFIED restaurantId.
 * RFM derivation (real fields verified against the Customer schema):
 *   recency_days — days since Customer.lastVisit (rows without it are skipped)
 *   frequency    — Customer.visits
 *   monetary     — Customer.totalSpend
 * Nothing is invented: no lastVisit → skipped and counted, never defaulted.
 */

import Customer from '../../models/customers/Customer';
import type { Types } from 'mongoose';

export interface SegmentExtractWindow {
  /** Hard cap on customers pulled in one extraction. */
  limit?: number;
}

export interface SegmentExtractionStats {
  totalCustomers: number;
  extracted: number;
  skippedNoLastVisit: number;
  skippedZeroActivity: number;
}

export interface SegmentCustomerRow {
  customer_id: string;
  recency_days: number;
  frequency: number;
  monetary: number;
  favorite_category?: string;
}

export async function extractCustomersForSegmentation(
  restaurantId: string,
  window: SegmentExtractWindow = {}
): Promise<{ rows: SegmentCustomerRow[]; stats: SegmentExtractionStats }> {
  if (!restaurantId) {
    throw new Error('restaurantId is required (must come from verified JWT)');
  }

  const limit = Math.min(Math.max(window.limit ?? 5_000, 1), 20_000);

  const customers = await Customer.find({ restaurantId })
    .select('lastVisit visits totalSpend favoriteCategories')
    .limit(limit)
    .lean<{ _id: Types.ObjectId; lastVisit?: Date | null; visits?: number; totalSpend?: number; favoriteCategories?: string[] }[]>();

  const stats: SegmentExtractionStats = {
    totalCustomers: customers.length,
    extracted: 0,
    skippedNoLastVisit: 0,
    skippedZeroActivity: 0,
  };

  const now = Date.now();
  const rows: SegmentCustomerRow[] = [];
  for (const c of customers) {
    if (!c.lastVisit) {
      stats.skippedNoLastVisit += 1;
      continue;
    }
    const frequency = typeof c.visits === 'number' ? c.visits : 0;
    const monetary = typeof c.totalSpend === 'number' ? c.totalSpend : 0;
    if (frequency <= 0 && monetary <= 0) {
      stats.skippedZeroActivity += 1;
      continue;
    }
    rows.push({
      customer_id: String(c._id),
      recency_days: Math.max(0, Math.floor((now - new Date(c.lastVisit).getTime()) / 86_400_000)),
      frequency,
      monetary,
      ...(Array.isArray(c.favoriteCategories) && c.favoriteCategories.length > 0
        ? { favorite_category: c.favoriteCategories[0] }
        : {}),
    });
    stats.extracted += 1;
  }

  return { rows, stats };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * audienceResolver.ts — WP2 of the agent→campaign bridge.
 *
 * The marketing agent emits targets as ML segment LABELS (strings like
 * 'Champions') or CUSTOMER IDS (from the uplift tool). The campaign machine
 * speaks only rule-segment ObjectIds and 10-digit phones
 * (CampaignService.resolveAudience). This module is the server-side adapter
 * between the two vocabularies. It is deterministic, tenant-scoped, and never
 * widens targeting: an unresolvable target degrades to an explicit reason,
 * never to "everyone".
 *
 * Data sources (both already tenant-isolated):
 *   - ML segment assignments: ml_predictions rows (modelName='segment',
 *     predictionType='customer_segment') → entityId (customer id) via
 *     segmentSyncService.getStoredSegments.
 *   - Customer phone numbers: models/customers/Customer, always filtered by
 *     restaurantId + not deleted/blocked + marketing opt-in preferred.
 */

import mongoose from 'mongoose';
import Customer from '../../models/customers/Customer';
import { getStoredSegments } from '../../modules/ml-pipeline/segmentSyncService';
import type { AgentTarget } from './marketingAgent';

/** Customers counted as reachable — mirrors resolveAudience's phone union. */
export interface ResolvedAudience {
  /** Resolved 10-digit phones (deduped). */
  phones: string[];
  /** Human-readable labels kept for proposal display (segment labels). */
  segmentNames: string[];
  /** Aggregate per-source breakdown — never exposes customer PII. */
  sources: Array<{
    refId: string;
    refType: 'customer' | 'segment';
    matched: number;
    reason?: string;
  }>;
  /** Fully empty audience = nothing was resolvable. */
  isEmpty: boolean;
  /** Deterministic explanation surfaced to the owner in the proposal. */
  notes: string[];
}

const MAX_CUSTOMER_TARGETS = 200; // cap per proposal (mirrors uplift tool limit)

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  // Accept bare 10-digit (repo convention) or 12-digit with 91 country code.
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

/**
 * Resolve agent targets into a concrete audience.
 * Segment targets use stored ML segment predictions; customer targets use
 * direct (tenant-scoped) Customer lookups. Missing/unresolvable entries are
 * reported per-target instead of failing the whole resolution.
 */
export async function resolveAgentTargets(
  restaurantId: string,
  targets: AgentTarget[],
): Promise<ResolvedAudience> {
  const phones = new Set<string>();
  const segmentNames: string[] = [];
  const sources: ResolvedAudience['sources'] = [];
  const notes: string[] = [];

  const segmentTargets = targets.filter((t) => t.refType === 'segment');
  const customerTargets = targets.filter((t) => t.refType === 'customer').slice(0, MAX_CUSTOMER_TARGETS);
  const droppedCustomers = targets.filter((t) => t.refType === 'customer').length - customerTargets.length;

  if (droppedCustomers > 0) {
    notes.push(`${droppedCustomers} customer targets dropped (cap ${MAX_CUSTOMER_TARGETS}).`);
  }

  // ─── Segment targets: ML label → stored predictions → customer ids → phones
  for (const t of segmentTargets) {
    try {
      const rows = await getStoredSegments(restaurantId, { segment: t.refId, limit: 2000 });
      const customerIds = rows
        .map((r) => r.entityId)
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (customerIds.length === 0) {
        sources.push({ refId: t.refId, refType: 'segment', matched: 0, reason: 'NO_STORED_ASSIGNMENTS' });
        continue;
      }
      const custs = await Customer.find({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        _id: { $in: customerIds.map((id) => new mongoose.Types.ObjectId(id)) },
        isDeleted: { $ne: true },
        isBlocked: { $ne: true },
      })
        .select('phone')
        .lean<{ phone?: string }[]>()
        .exec();
      let matched = 0;
      for (const c of custs) {
        const p = normalizePhone(c.phone);
        if (p) {
          phones.add(p);
          matched++;
        }
      }
      segmentNames.push(t.label || t.refId);
      sources.push({ refId: t.refId, refType: 'segment', matched });
      if (matched === 0) {
        notes.push(`Segment "${t.refId}" has assignments but no reachable phones.`);
      }
    } catch (err) {
      // Segment service/Mongo hiccup — degrade this one target explicitly.
      sources.push({ refId: t.refId, refType: 'segment', matched: 0, reason: 'RESOLVE_FAILED' });
      notes.push(`Segment "${t.refId}" could not be resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Customer targets: direct tenant-scoped lookup
  if (customerTargets.length > 0) {
    const ids = customerTargets
      .map((t) => t.refId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const invalidCount = customerTargets.length - ids.length;
    if (invalidCount > 0) notes.push(`${invalidCount} customer ids were not valid ObjectIds.`);
    if (ids.length > 0) {
      const custs = await Customer.find({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        isDeleted: { $ne: true },
        isBlocked: { $ne: true },
      })
        .select('phone')
        .lean<{ phone?: string }[]>()
        .exec();
      for (const c of custs) {
        const p = normalizePhone(c.phone);
        if (p) phones.add(p);
      }
      sources.push({ refId: `${ids.length} ids`, refType: 'customer', matched: custs.length });
    }
  }

  const isEmpty = phones.size === 0;
  if (isEmpty) {
    notes.push('Audience resolved to zero reachable customers — the proposal will be flagged by validation.');
  }
  return { phones: [...phones], segmentNames, sources, isEmpty, notes };
}

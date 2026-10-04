/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Experiment Tracker (audit P1 items #4/#5) — turns offer assignment and
 * redemption activity into the experiment rows Uplit's T-Learner trains on.
 *
 * Deterministic business logic, deliberately NOT ML:
 *   - assignment snapshots features BEFORE the offer exists (pre-treatment)
 *   - conversion = redeemed AND billed (real outcome, idempotent by unique index)
 *   - export shape matches Uplit's ingest contract exactly (pre-treatment
 *     features + treatment + purchase only)
 */

import mongoose from 'mongoose';

import OfferExperimentEvent, {
  IOfferExperimentEvent,
} from '../../models/intelligence/OfferExperimentEvent';
import Customer from '../../models/customers/Customer';

// ─── Pre-treatment feature snapshot ──────────────────────────────────────────

// Exported for downstream consumers (offer-response dataset builder) so the
// leakage guard has a SINGLE source of truth.
export const WHITELISTED_FEATURES = [
  'visits_7d',
  'visits_30d',
  'visits_90d',
  'orders_30d',
  'orders_90d',
  'total_spend',
  'average_order_value',
  'days_since_last_visit',
  'opted_in',
  'days_since_last_offer',
  'favorite_category',
  'favorite_item',
  'preferred_day',
  'preferred_time',
  'previous_offer_count',
] as const;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

/** Customer fields the snapshot reads — all top-level on the Customer schema. */
interface CustomerSnapshotDoc {
  _id?: unknown;
  phone?: string;
  lastVisit?: Date | string | null;
  visits?: number;
  totalSpend?: number;
  averageSpend?: number;
  totalOrders?: number;
  marketingOptIn?: boolean;
  favoriteCategories?: string[];
  favoriteItems?: string[];
}

/**
 * Field mapping for the pre-treatment snapshot — the SINGLE source of truth
 * for both the per-customer and the batch builder, so the leakage guard can
 * never drift between them. Derived counters are computed from real
 * timestamps; absent data is simply omitted (Uplit applies its own
 * defaults) — never invented.
 */
function featuresFromCustomerDoc(
  customer: CustomerSnapshotDoc,
  priorAssignments: number,
  now: Date,
): Record<string, unknown> {
  const features: Record<string, unknown> = {};

  if (customer.lastVisit) features.days_since_last_visit = daysBetween(new Date(customer.lastVisit), now);
  if (typeof customer.visits === 'number') features.visits_90d = customer.visits;
  if (typeof customer.totalSpend === 'number') features.total_spend = customer.totalSpend;
  if (typeof customer.averageSpend === 'number') features.average_order_value = customer.averageSpend;
  if (typeof customer.totalOrders === 'number') features.orders_30d = customer.totalOrders; // best available counter (30d rollup not tracked)
  if (customer.marketingOptIn !== undefined) features.opted_in = customer.marketingOptIn ? 1 : 0;

  // Pre-treatment offer history from the experiment ledger itself (counters
  // live here, NOT on Customer — audit item #8 keeps post-treatment state out
  // of feature snapshots).
  if (priorAssignments > 0) features.previous_offer_count = priorAssignments;

  if (Array.isArray(customer.favoriteCategories) && customer.favoriteCategories.length > 0) {
    features.favorite_category = customer.favoriteCategories[0];
  }
  if (Array.isArray(customer.favoriteItems) && customer.favoriteItems.length > 0) {
    features.favorite_item = customer.favoriteItems[0];
  }

  return features;
}

/**
 * Pre-treatment customer features from the Customer document. Derived counters
 * are computed from real timestamps; absent data is simply omitted (Uplit
 * applies its own defaults) — never invented.
 *
 * Exported for the controlled-experiment flow (experimentService) which
 * snapshots the same features for BOTH arms (control rows are features too).
 */
export async function snapshotPreTreatmentFeatures(restaurantId: string, customerId: string): Promise<Record<string, unknown>> {
  // _id lookup only for genuine ObjectId-shaped ids — a phone/string id in
  // the $or would make Mongo cast-fail the whole query.
  const idClauses: Record<string, unknown>[] = [{ phone: customerId }];
  if (/^[0-9a-f]{24}$/i.test(customerId)) idClauses.unshift({ _id: customerId });
  const customer = await Customer.findOne({
    restaurantId,
    $or: idClauses,
  }).lean();

  if (!customer) return {};

  // Pre-treatment offer history from the experiment ledger (counters live
  // there, never on Customer).
  const priorAssignments = await OfferExperimentEvent.countDocuments({
    restaurantId,
    customerId,
    eventType: 'assigned',
  });

  return featuresFromCustomerDoc(customer as CustomerSnapshotDoc, priorAssignments, new Date());
}

/**
 * Batch pre-treatment snapshots — ONE Customer query + ONE ledger query for N
 * customers (the per-customer builder would do 2N). Same field mapping
 * (featuresFromCustomerDoc) and the same identifier forms: entries may be
 * ObjectIds or phone strings. An id with no customer document is simply
 * ABSENT from the map — never a fabricated empty snapshot.
 *
 * Backs the marketing agent's RESPONSE_MODEL rung (batch per-customer
 * scoring): features for a whole candidate pool without per-customer query
 * cost.
 */
export async function snapshotPreTreatmentFeaturesBatch(
  restaurantId: string,
  customerIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(customerIds.filter((id) => !!id))];
  if (unique.length === 0) return map;

  const objectIds = unique.filter((id) => /^[0-9a-f]{24}$/i.test(id));
  const phones = unique.filter((id) => !/^[0-9a-f]{24}$/i.test(id));
  const idClauses: Record<string, unknown>[] = [];
  if (objectIds.length > 0) idClauses.push({ _id: { $in: objectIds } });
  if (phones.length > 0) idClauses.push({ phone: { $in: phones } });
  if (idClauses.length === 0) return map;

  const docs = await Customer.find({ restaurantId, $or: idClauses }).lean();
  const byKey = new Map<string, CustomerSnapshotDoc>();
  for (const raw of docs) {
    const doc = raw as CustomerSnapshotDoc;
    if (doc._id !== undefined && doc._id !== null) byKey.set(String(doc._id), doc);
    if (typeof doc.phone === 'string' && doc.phone) byKey.set(doc.phone, doc);
  }

  // Prior-assignment counts for ALL requested ids in one query — the batched
  // equivalent of the single builder's countDocuments (a find keeps
  // mongoose's string→ObjectId casting; a raw aggregate would not cast and
  // would silently match nothing).
  const priorRows = await OfferExperimentEvent.find({
    restaurantId,
    customerId: { $in: unique },
    eventType: 'assigned',
  })
    .select('customerId')
    .lean();
  const counts = new Map<string, number>();
  for (const row of priorRows as Array<{ customerId?: unknown }>) {
    const key = String(row.customerId ?? '');
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  for (const id of unique) {
    const doc = byKey.get(id);
    if (!doc) continue;
    map.set(id, featuresFromCustomerDoc(doc, counts.get(id) ?? 0, now));
  }
  return map;
}

// ─── Recording APIs ──────────────────────────────────────────────────────────

export interface RecordAssignmentInput {
  restaurantId: string;
  offerId?: string | null;
  customerId: string;
  branchId?: string | null;
}

/**
 * Records that an offer was ASSIGNED/SERVED to a customer (treatment arm).
 * Idempotent: re-assignment of the same (tenant, customer, offer) updates the
 * timestamp instead of duplicating. Features are snapshotted pre-treatment on
 * first assignment only.
 */
export async function recordOfferAssignment(input: RecordAssignmentInput): Promise<IOfferExperimentEvent> {
  const { restaurantId, offerId, customerId, branchId } = input;
  const now = new Date();

  const existing = await OfferExperimentEvent.findOne({
    restaurantId,
    customerId,
    offerId: offerId ? new mongoose.Types.ObjectId(offerId) : null,
    eventType: 'assigned',
  });

  if (existing) {
    existing.assignedAt = existing.assignedAt ?? now;
    await existing.save();
    return existing;
  }

  const features = await snapshotPreTreatmentFeatures(restaurantId, customerId);
  return OfferExperimentEvent.create({
    restaurantId,
    branchId: branchId ? new mongoose.Types.ObjectId(branchId) : null,
    offerId: offerId ? new mongoose.Types.ObjectId(offerId) : null,
    customerId,
    eventType: 'assigned',
    treatment: 1,
    purchase: 0,
    features,
    assignedAt: now,
  });
}

export interface RecordConversionInput {
  restaurantId: string;
  offerId?: string | null;
  customerId: string;
  redeemedBillId?: string | null;
}

/**
 * Records a CONVERSION (offer redeemed AND billed → purchase=1). Idempotent
 * via the unique index; a replay resolves to the existing row.
 */
export async function recordOfferConversion(input: RecordConversionInput): Promise<IOfferExperimentEvent> {
  const { restaurantId, offerId, customerId, redeemedBillId } = input;
  const now = new Date();

  const existing = await OfferExperimentEvent.findOne({
    restaurantId,
    customerId,
    offerId: offerId ? new mongoose.Types.ObjectId(offerId) : null,
    eventType: 'converted',
  });
  if (existing) return existing;

  return OfferExperimentEvent.create({
    restaurantId,
    offerId: offerId ? new mongoose.Types.ObjectId(offerId) : null,
    customerId,
    eventType: 'converted',
    treatment: 1,
    purchase: 1,
    features: {},
    assignedAt: null,
    convertedAt: now,
    redeemedBillId: redeemedBillId ? new mongoose.Types.ObjectId(redeemedBillId) : null,
  });
}

// ─── Uplit export ────────────────────────────────────────────────────────────

export interface UplitExportResult {
  restaurantId: string;
  events: Array<Record<string, unknown>>;
  treatedCount: number;
  convertedCount: number;
}

/**
 * Flattens the ledger into Uplit ingest rows: one row per customer with
 * treatment=1, purchase=1 when any conversion exists, plus pre-treatment
 * features from the earliest assignment. This is the exact payload for
 * POST {UPLIT_BASE_URL}/api/ingest/experiment-events.
 *
 * Controlled-experiment CONTROL rows (treatment=0, experimentId set) are
 * EXCLUDED: Uplit's T-Learner ingest contract is treatment-only. Control-arm
 * outcomes stay in the ledger for experimentAnalyzer/experimentEval.
 */
export async function exportUplitExperimentRows(restaurantId: string): Promise<UplitExportResult> {
  const events = await OfferExperimentEvent.find({ restaurantId }).sort({ createdAt: 1 }).lean();

  const byCustomer = new Map<string, Record<string, unknown>>();
  for (const ev of events) {
    // Skip control-arm rows from the controlled flow (never legacy rows).
    if (ev.treatment === 0 && (ev as unknown as { experimentId?: string | null }).experimentId) {
      continue;
    }
    const key = ev.customerId;
    let row = byCustomer.get(key);
    if (!row) {
      row = { customer_id: ev.customerId, treatment: 1, purchase: 0 };
      byCustomer.set(key, row);
    }
    if (ev.features && Object.keys(ev.features as Record<string, unknown>).length > 0) {
      const feats = ev.features as Record<string, unknown>;
      for (const field of WHITELISTED_FEATURES) {
        if (feats[field] !== undefined && row[field] === undefined) row[field] = feats[field];
      }
    }
    if (ev.purchase === 1) row.purchase = 1;
    // Earliest assignment date enables Uplit's temporal (chronological)
    // holdout split once real data spans time (audit P3 item #8).
    if (ev.assignedAt) {
      const dateStr = new Date(ev.assignedAt).toISOString().slice(0, 10);
      const existing = row.experiment_date as string | undefined;
      if (!existing || dateStr < existing) row.experiment_date = dateStr;
    }
  }

  const rows = Array.from(byCustomer.values());
  return {
    restaurantId,
    events: rows,
    treatedCount: rows.length,
    convertedCount: rows.filter((r) => r.purchase === 1).length,
  };
}

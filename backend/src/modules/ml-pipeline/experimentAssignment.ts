/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic experiment assignment (spec Step 3).
 *
 * A customer's arm in an experiment is a PURE function of
 * (restaurantId, experimentId, customerId): SHA-256 → uniform u ∈ [0,1) →
 * cumulative allocation intervals. Consequences:
 *
 *   - STABILITY: re-assignment (same inputs) never flips a customer's arm —
 *     no "repeated assignment" contamination (spec honesty rules).
 *   - NO PEEKING: the hash is computed before any offer exists; eligibility
 *     is applied AFTER assignment so filtering cannot bias arms.
 *   - TENANT ISOLATION: the tenant id is hashed in, so the same customer id
 *     under a different tenant gets an independent draw.
 */

import { createHash } from 'crypto';

export interface AssignableVariant {
  id: string;
  kind: 'control' | 'treatment';
  allocation: number;
}

export interface AssignmentResult {
  variantId: string;
  kind: 'control' | 'treatment';
  /** Uniform draw behind the decision — exposed for tests/audits only. */
  bucket: number;
}

/**
 * The stable unit hash: SHA-256 of "tenantId|experimentId|customerId" →
 * first 8 hex chars → uniform u ∈ [0,1). Same inputs → same variant, forever.
 */
export function stableAssignmentBucket(
  restaurantId: string,
  experimentId: string,
  customerId: string
): number {
  const digest = createHash('sha256')
    .update(`${restaurantId}|${experimentId}|${customerId}`, 'utf8')
    .digest('hex');
  return parseInt(digest.slice(0, 8), 16) / 0x1_0000_0000;
}

export class ExperimentNotActiveError extends Error {
  constructor(status: string) {
    super(`Experiment is not active (status: ${status}) — refusing to assign`);
    this.name = 'ExperimentNotActiveError';
  }
}

/**
 * Pure assignment. Throws ExperimentNotActiveError unless status === 'active'.
 * Validates allocations sum to ~1 before trusting the intervals. A variant
 * with allocation 0 can never receive a customer (interval is empty).
 */
export function assignVariant(
  input: {
    restaurantId: string;
    experimentId: string;
    customerId: string;
    status: string;
  },
  variants: AssignableVariant[]
): AssignmentResult {
  if (input.status !== 'active') throw new ExperimentNotActiveError(input.status);

  const total = variants.reduce((s, v) => s + v.allocation, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(`Variant allocations must sum to 1 (got ${total})`);
  }

  const bucket = stableAssignmentBucket(input.restaurantId, input.experimentId, input.customerId);

  let cumulative = 0;
  for (const v of variants) {
    if (v.allocation === 0) continue; // empty interval — never selected
    cumulative += v.allocation;
    if (bucket < cumulative) {
      return { variantId: v.id, kind: v.kind, bucket };
    }
  }
  // Floating-point residue: snap to the last non-zero variant.
  const last = [...variants].reverse().find((v) => v.allocation > 0)!;
  return { variantId: last.id, kind: last.kind, bucket };
}

/**
 * Eligibility gates applied AFTER the arm draw (never before — pre-filtering
 * on outcomes/behavior would bias the randomization).
 */
export function isEligible(features: Record<string, unknown>): boolean {
  // Explicit opt-out always wins (spec consent rules).
  if (features.opted_in === 0 || features.opted_in === false) return false;
  return true;
}

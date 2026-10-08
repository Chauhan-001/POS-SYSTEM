/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * signalScanner.ts — the CHEAP FIRST STEP (task §3/§20).
 *
 * A bounded, deterministic pre-scan over a few fast dimensions, rendered as a
 * COMPACT digest for the Marketing Manager's first planning step. It exists so
 * the manager starts oriented instead of blind, without paying for a full
 * investigation up front: the scan is a subset of dimensions, the digest is
 * plain-language statements, and no raw ids or datasets are exposed.
 *
 * The digest is CONTEXT, never a conclusion: it names what looks notable and
 * what could not be read, and the manager still has to investigate.
 */

import { investigateBusiness } from '../intelligence/businessIntelligenceService';
import type { BusinessDimension } from '../intelligence/businessIntelligenceService';
import type { AiTenantContext } from '../shared/tenantContext';
import { isUsableFreshness } from '../intelligence/businessSignalTypes';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';

/** Dimensions the cheap scan reads — fast, high-signal, low fan-out. */
export const SCANNER_DIMENSIONS: BusinessDimension[] = ['sales', 'inventory', 'marketing'];

export interface ScannerDigest {
  /** Owner-readable notable observations, most important first. */
  notable: string[];
  /** Per-dimension outcome counts (no ids). */
  dimensions: Array<{ dimension: string; status: string; signalCount: number; reason?: string }>;
  /** Dimensions with no usable evidence. */
  unavailableDimensions: string[];
  /** Fresh vs stale split — stale evidence must be disclosed, never relied on. */
  freshness: Record<string, number>;
  usable: boolean;
  generatedAt: string;
}

/** Render the digest as prompt lines (no ids, no datasets). */
export function scannerDigestLines(digest: ScannerDigest, limit = 8): string[] {
  const lines: string[] = [];
  if (!digest.usable) {
    lines.push('Pre-scan: no usable signal was found in the fast dimensions — this is NOT evidence that the business is healthy.');
  } else {
    for (const s of digest.notable.slice(0, limit)) lines.push(`- ${s}`);
  }
  if (digest.unavailableDimensions.length) {
    lines.push(`Pre-scan could not read: ${digest.unavailableDimensions.join(', ')}.`);
  }
  const stale = (digest.freshness.stale ?? 0) + (digest.freshness.expired ?? 0);
  if (stale > 0) lines.push(`Pre-scan: ${stale} observation(s) are stale and must not be treated as current.`);
  return lines;
}

function notableLine(s: BusinessSignal): string {
  const pct = s.changePct !== undefined ? ` (${s.changePct > 0 ? '+' : ''}${(s.changePct * 100).toFixed(0)}%)` : '';
  const stale = s.freshness === 'stale' ? ' [STALE]' : '';
  return `${s.statement}${pct} [${s.category}, confidence ${Math.round(s.confidence * 100)}%]${stale}`;
}

/**
 * Run the cheap scan. NEVER throws: a failed scan yields `usable:false` with
 * the reason carried in `unavailableDimensions`, and the manager proceeds
 * without a digest (it is orientation, not evidence).
 */
export async function scanSignals(input: {
  tenant: AiTenantContext;
  branchId?: string;
  budgetMs?: number;
  lookbackDays?: number;
  dimensions?: BusinessDimension[];
}): Promise<ScannerDigest> {
  const generatedAt = new Date().toISOString();
  try {
    const investigation = await investigateBusiness({
      tenant: input.tenant,
      branchId: input.branchId,
      dimensions: input.dimensions ?? SCANNER_DIMENSIONS,
      budgetMs: Math.max(1_000, Math.min(input.budgetMs ?? 6_000, 12_000)),
      lookbackDays: input.lookbackDays,
    });
    const usableSignals = investigation.signals.filter((s) => isUsableFreshness(s.freshness));
    return {
      notable: investigation.topSignals.filter((s) => isUsableFreshness(s.freshness)).map(notableLine),
      dimensions: investigation.dimensions.map((d) => ({
        dimension: d.dimension,
        status: d.status,
        signalCount: d.signalCount,
        reason: d.reason,
      })),
      unavailableDimensions: investigation.unavailableDimensions,
      freshness: investigation.freshness,
      usable: usableSignals.length > 0,
      generatedAt,
    };
  } catch (err) {
    return {
      notable: [],
      dimensions: [],
      unavailableDimensions: (input.dimensions ?? SCANNER_DIMENSIONS) as unknown as string[],
      freshness: {},
      usable: false,
      generatedAt,
    };
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportContext.ts — PHASE 2 context builder for the Daily Summary /
 * Z-Report Intelligence pipeline.
 *
 * Responsibilities (and explicit non-responsibilities):
 *   - Resolve the BUSINESS DATE (default: yesterday, LOCAL calendar date —
 *     the same convention as salesReportService.dateRange: bills are stamped
 *     with the store's local date, so a UTC "yesterday" would silently pick
 *     the wrong day in timezones east of UTC).
 *   - Validate a requested branch via the SHARED resolveBranchScope
 *     (tenant isolation P0: a foreign branchId is rejected with
 *     TOOL_TENANT_MISMATCH, exactly like every existing AI tool).
 *   - Compute comparison windows (v1 = previous-period only).
 *   - Load the tenant-scoped memory snapshot through the EXISTING
 *     memoryManager (never throws — memory is context, not a gate).
 *   - NO tool execution and NO LLM access happen here: evidence batches are
 *     fetched through the shared tool registry in Phase 3.
 */

import { AiError } from '../shared/aiErrors';
import type { AiTenantContext } from '../shared/tenantContext';
import { resolveBranchScope } from '../../services/recommendationContext';
import { loadMemoryContext } from '../memory/memoryManager';
import type { AgentMemoryContext } from '../memory/memoryTypes';
import { Z_REPORT_AGENT_PROMPT_VERSION } from './policies/zReportAgentPolicy';

/** Comparison windows around the closing business date. */
export interface ZReportBusinessDateWindow {
  /** Business date being summarized (YYYY-MM-DD). */
  businessDate: string;
  /** Previous calendar date — v1 primary baseline (previous-period only). */
  previousDate: string;
  /** Rolling 7-day window ENDING on the previous date. */
  weekStartDate: string;
  weekEndDate: string;
  /** Rolling 30-day window ENDING on the previous date. */
  monthStartDate: string;
  monthEndDate: string;
}

/** Everything downstream phases need before any batch may run. */
export interface ZReportContext {
  restaurantId: string;
  /** Validated branch scope — absent = tenant-wide (all branches). */
  branchId?: string;
  branchName?: string;
  businessDate: string;
  comparison: ZReportBusinessDateWindow;
  /** Tenant-scoped memory snapshot (degrades internally, never throws). */
  memory: AgentMemoryContext;
  promptVersion: string;
  /** ISO timestamp of context construction. */
  generatedAt: string;
}

/**
 * Parse/resolve the business date.
 * Explicit input must be a strict YYYY-MM-DD calendar date — anything else
 * is an AiError (TOOL_INPUT_INVALID), never silently reinterpreted.
 * Default: YESTERDAY as the store's LOCAL calendar date (see file header).
 */
export function normalizeBusinessDate(input?: string | null, now: number = Date.now()): string {
  if (input != null) {
    if (
      typeof input !== 'string' ||
      input.length === 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input)
    ) {
      throw new AiError('TOOL_INPUT_INVALID', 'date must be a valid YYYY-MM-DD calendar date');
    }
    // Round-trip check: Date.parse silently ROLLS OVER out-of-range ISO dates
    // (2026-02-30 → 2026-03-02, 2026-13-01 → 2027-01-01). A real calendar
    // date round-trips to itself; anything else is rejected outright.
    const parsed = new Date(`${input}T00:00:00Z`).getTime();
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== input) {
      throw new AiError('TOOL_INPUT_INVALID', 'date must be a valid YYYY-MM-DD calendar date');
    }
    return input;
  }
  // Local-adjusted date, then step back one day (mirrors the
  // salesReportService.dateRange offset convention).
  const clock = new Date(now);
  const adjusted = new Date(clock.getTime() - clock.getTimezoneOffset() * 60000);
  adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  return adjusted.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** v1 comparison windows — previous-period only (P1 decision, documented). */
export function comparisonWindows(businessDate: string): ZReportBusinessDateWindow {
  const previousDate = shiftDate(businessDate, -1);
  return {
    businessDate,
    previousDate,
    weekStartDate: shiftDate(previousDate, -6),
    weekEndDate: previousDate,
    monthStartDate: shiftDate(previousDate, -29),
    monthEndDate: previousDate,
  };
}

export interface BuildZReportContextOptions {
  /** Business date to summarize (YYYY-MM-DD). Default: yesterday (local). */
  date?: string;
  /** Requested branch scope — validated against the tenant before any query. */
  branchId?: string | null;
  /** Injectable clock (tests). */
  now?: number;
}

export async function buildZReportContext(
  tenant: AiTenantContext,
  opts: BuildZReportContextOptions = {},
): Promise<ZReportContext> {
  const now = opts.now ?? Date.now();
  const businessDate = normalizeBusinessDate(opts.date, now);
  const comparison = comparisonWindows(businessDate);

  // Tenant isolation (P0): a requested branch must genuinely belong to this
  // restaurant — the same shared validator every existing AI tool uses.
  let branchId: string | undefined;
  let branchName: string | undefined;
  if (opts.branchId) {
    const scope = await resolveBranchScope(tenant.restaurantId, opts.branchId);
    if (!scope) {
      throw new AiError('TOOL_TENANT_MISMATCH', 'branchId does not belong to this restaurant');
    }
    branchId = scope.branchId;
    branchName = scope.branchName;
  }

  // Memory is context, never a gate: loadMemoryContext degrades internally
  // (DB down / empty) and never throws.
  const memory = await loadMemoryContext(tenant, { episodeLimit: 5, memoryLimit: 5, sinceDays: 60 });

  return {
    restaurantId: tenant.restaurantId,
    ...(branchId ? { branchId } : {}),
    ...(branchName ? { branchName } : {}),
    businessDate,
    comparison,
    memory,
    promptVersion: Z_REPORT_AGENT_PROMPT_VERSION,
    generatedAt: new Date(now).toISOString(),
  };
}

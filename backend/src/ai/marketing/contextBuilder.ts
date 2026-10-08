/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * contextBuilder.ts — assemble the pre-investigation context (task §0).
 *
 * Combines: the owner objective, tenant scope, the cheap pre-scan digest
 * (Phase 2), and the tenant-scoped memory snapshot (episodic + long-term).
 *
 * The MEMORY PRIORITY LADDER is enforced by LABELLING: current measured data
 * is `authoritative`, memory is `advisory only`. Memory can therefore never
 * outrank a current fact — it is presented in a separate, clearly weaker block.
 *
 * Nothing here reads business data twice: the digest comes from the scanner and
 * memory comes from the existing memory manager.
 */

import { loadMemoryContext } from '../memory/memoryManager';
import type { AgentMemoryContext, MemoryEpisodeRecord, RestaurantMemoryRecord } from '../memory/memoryTypes';
import type { AiTenantContext } from '../shared/tenantContext';
import { scanSignals, scannerDigestLines, type ScannerDigest } from './signalScanner';
import type { BusinessDimension } from '../intelligence/businessIntelligenceService';

/** Canonical evidence priority (never reversed). */
export const EVIDENCE_PRIORITY =
  'current business data > current ML > current analytics > validated historical evidence > long-term memory > inference';

export interface MarketingContext {
  /** The objective string handed to the bounded loop (goal + orientation). */
  objective: string;
  goal: string;
  digest: ScannerDigest;
  memory: AgentMemoryContext;
  /** Owner-readable orientation lines (authoritative pre-scan facts). */
  authoritativeLines: string[];
  /** Owner-readable memory lines (advisory only). */
  advisoryLines: string[];
  degradations: string[];
  generatedAt: string;
}

function episodeLine(e: MemoryEpisodeRecord): string {
  const outcome = e.outcome ? `, outcome ${e.outcome.status}` : '';
  return `${e.episodeType} episode (${e.createdAt.slice(0, 10)}, confidence ${e.confidence.toFixed(2)}${outcome})`;
}

function memoryLine(m: RestaurantMemoryRecord): string {
  const label = m.memoryType.replace(/_/g, ' ');
  const subject = typeof m.entityRef === 'string' && m.entityRef.includes(':') ? m.entityRef.split(':').slice(1).join(':') : m.entityRef;
  return `${label}${subject ? ` — ${subject}` : ''} (confidence ${m.confidence.toFixed(2)})`;
}

const MAX_OBJECTIVE_CHARS = 4_000;

/** Build the context. NEVER throws: a degraded layer is disclosed, not fatal. */
export async function buildMarketingContext(input: {
  tenant: AiTenantContext;
  branchId?: string;
  goal?: string;
  lookbackDays?: number;
  scanBudgetMs?: number;
  scanDimensions?: BusinessDimension[];
  /** Test seam. */
  loadMemory?: (tenant: AiTenantContext) => Promise<AgentMemoryContext>;
}): Promise<MarketingContext> {
  const degradations: string[] = [];
  const goal = (input.goal ?? '').trim() || 'Review this restaurant and tell the owner what marketing action matters most right now.';

  const digest = await scanSignals({
    tenant: input.tenant,
    branchId: input.branchId,
    budgetMs: input.scanBudgetMs,
    lookbackDays: input.lookbackDays,
    dimensions: input.scanDimensions,
  });
  if (!digest.usable) {
    degradations.push('pre-scan found no usable signal in the fast dimensions (orientation only, not a health verdict)');
  }
  for (const d of digest.dimensions) {
    if (d.status === 'error') degradations.push(`pre-scan dimension ${d.dimension} could not be read (${d.reason})`);
  }

  let memory: AgentMemoryContext;
  try {
    const loader = input.loadMemory ?? ((t: AiTenantContext) => loadMemoryContext(t, { episodeLimit: 5, memoryLimit: 5 }));
    memory = await loader(input.tenant);
  } catch (err) {
    memory = {
      episodes: [],
      longTerm: [],
      priorityStatement: EVIDENCE_PRIORITY,
      loadedAt: new Date().toISOString(),
      degraded: true,
      reason: err instanceof Error ? err.message.slice(0, 200) : 'memory load failed',
    };
    degradations.push('memory context could not be loaded — the run proceeds without historical context');
  }
  if (memory.degraded) degradations.push(`memory context degraded: ${memory.reason ?? 'unknown reason'}`);

  const authoritativeLines = scannerDigestLines(digest);
  const advisoryLines = [
    ...(memory.episodes ?? []).map(episodeLine),
    ...(memory.longTerm ?? []).map(memoryLine),
  ].slice(0, 8);

  const scopeLine = input.branchId
    ? 'Scope: ONE branch of this restaurant.'
    : 'Scope: restaurant-wide (all branches).';

  const objective = [
    `Objective: ${goal}`,
    scopeLine,
    '',
    'AUTHORITATIVE pre-scan (deterministic, read-only). Orientation only — verify anything you rely on:',
    ...(authoritativeLines.length ? authoritativeLines : ['(nothing notable found in the fast dimensions)']),
    '',
    `ADVISORY memory (historical, weaker than any current data; priority: ${memory.priorityStatement || EVIDENCE_PRIORITY}). Never a reason by itself:`,
    ...(advisoryLines.length ? advisoryLines.map((l) => `- ${l}`) : ['(no stored history for this restaurant)']),
    '',
    'Investigate the domains you need, one per step, and stop when the situation is genuinely clear.',
  ]
    .join('\n')
    .slice(0, MAX_OBJECTIVE_CHARS);

  return {
    objective,
    goal,
    digest,
    memory,
    authoritativeLines,
    advisoryLines,
    degradations,
    generatedAt: new Date().toISOString(),
  };
}

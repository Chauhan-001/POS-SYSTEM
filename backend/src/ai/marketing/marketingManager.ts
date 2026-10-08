/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingManager.ts — the CENTRAL reasoning component (task §5/§6).
 *
 * It drives the EXISTING bounded loop (`runBoundedAgentLoop`) with a
 * domain-level tool surface. Nothing about the loop is re-implemented: budgets,
 * policy resolution, zod validation, tenant-arg stripping, timeout clamping,
 * observability and the LLM seam all stay in the shared loop.
 *
 * What this module adds:
 *   - the domain catalog as the tool surface (one domain per step),
 *   - `captureToolData` so the EXACT domain investigations are returned to the
 *     deterministic layers (this is the repair of the old defect where the
 *     agent's observations were discarded before recommendation generation),
 *   - a stop guard that refuses a whole-restaurant conclusion drawn from a
 *     single domain or from no investigation at all,
 *   - a deterministic SEQUENTIAL fallback sweep so an LLM outage still produces
 *     evidence-backed output instead of an empty response.
 */

import { runBoundedAgentLoop, type LoopLlmFn, type LoopMemoryFn } from '../agents/loop/agentLoop';
import { LlmError } from '../shared/llmClient';
import type { AgentBudgetLimits, AgentRunMemory } from '../shared/agentRunContext';
import type { AiTenantContext } from '../shared/tenantContext';
import { registerMarketingDomainTools, investigateDomain, domainNameForTool, DOMAIN_SPECS } from './domains';
import {
  MARKETING_MANAGER_BUDGET,
  MARKETING_MANAGER_OBSERVATION_CHARS,
  MARKETING_MANAGER_PROMPT_VERSION,
  MARKETING_MANAGER_ROLE_PROMPT,
  marketingManagerPolicy,
} from './policy';
import type { DomainInvestigation, IntelligenceDomain } from './contracts';

/** Domains the deterministic fallback sweep reads when the LLM is unusable. */
export const FALLBACK_DOMAIN_SWEEP: IntelligenceDomain[] = ['sales', 'marketing_history', 'customers', 'products'];

/** Minimum number of domains with usable evidence before a whole-restaurant stop is allowed. */
export const MIN_DOMAINS_BEFORE_CONCLUSION = 2;

/**
 * An LLM seam that is explicitly UNAVAILABLE. Used when a caller disables the
 * model (tests, offline mode): the loop terminates with `llm_unavailable`
 * immediately, so the deterministic sweep takes over and no request is ever
 * made. This keeps "no model" a normal, disclosed outcome.
 */
export const NO_LLM: LoopLlmFn = async () => {
  throw new LlmError('LLM disabled for this run', 'not_configured');
};

/**
 * Stop guard (task §6/§7): called by the loop when the model says it has
 * enough evidence. It NEVER executes a tool and NEVER picks a domain — it
 * raises an objection the model must answer with its own next move. Bounded by
 * the loop's step/time budgets, so it cannot loop forever.
 */
export function marketingManagerStopGuard(memory: AgentRunMemory): string | null {
  const usableDomains = new Set<string>();
  for (const o of memory.observations) {
    if (o.ok && o.usable !== false) {
      const domain = domainNameForTool(o.tool);
      if (domain) usableDomains.add(domain);
    }
  }
  if (memory.toolCalls.length === 0) {
    return 'No domain has been investigated yet. An answer with no investigation is not allowed — investigate the domain whose question matters most first.';
  }
  if (usableDomains.size < MIN_DOMAINS_BEFORE_CONCLUSION) {
    const read = usableDomains.size ? [...usableDomains].join(', ') : 'none';
    return `Only ${usableDomains.size} domain(s) returned usable evidence (${read}). A whole-restaurant conclusion cannot rest on one domain: investigate at least one more independent domain (prefer context, customers or marketing history) before concluding. A domain that returned nothing is not evidence that business is healthy.`;
  }
  return null;
}

export interface ManagerRunResult {
  memory: AgentRunMemory;
  /** The EXACT domain investigations the deterministic layers consume. */
  investigations: DomainInvestigation[];
  /** Order in which domains were read (first success per domain). */
  domainOrder: IntelligenceDomain[];
  /** Stop-guard objections raised during the run. */
  stopGuardObjections: string[];
  /** True when the deterministic sweep produced the investigations. */
  usedDeterministicFallback: boolean;
}

/**
 * Deterministic SEQUENTIAL sweep — one domain at a time, in a fixed order.
 * Used only when the LLM could not drive the investigation (unavailable /
 * failed / stopped with nothing captured). It is deliberately small: enough to
 * ground recommendations, never a full parallel fan-out.
 */
export async function runDeterministicDomainSweep(input: {
  tenant: AiTenantContext;
  branchId?: string;
  domains?: IntelligenceDomain[];
  perDomainTimeoutMs?: number;
  lookbackDays?: number;
}): Promise<DomainInvestigation[]> {
  const domains = (input.domains ?? FALLBACK_DOMAIN_SWEEP).filter((d) => {
    const spec = DOMAIN_SPECS.find((s) => s.domain === d);
    return Boolean(spec?.implemented);
  });
  const investigations: DomainInvestigation[] = [];
  for (const domain of domains) {
    const investigation = await investigateDomain(
      domain,
      {
        tenant: input.tenant,
        timeoutMs: input.perDomainTimeoutMs ?? 8_000,
        executionId: `fallback-sweep`,
      },
      input.lookbackDays,
    );
    investigations.push(investigation);
  }
  return investigations;
}

/** Deduplicate captured investigations: first successful read per domain wins. */
export function investigationsFromMemory(memory: AgentRunMemory): DomainInvestigation[] {
  const byDomain = new Map<IntelligenceDomain, DomainInvestigation>();
  for (const entry of memory.toolData) {
    if (!entry.ok) continue;
    const domain = domainNameForTool(entry.tool);
    if (!domain) continue;
    const investigation = entry.data as DomainInvestigation | undefined;
    if (!investigation || investigation.domain !== domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, investigation);
  }
  return [...byDomain.values()];
}

/**
 * Run the Marketing Manager investigation. NEVER throws: on any failure the
 * caller still receives the working memory (with a terminal status) and the
 * investigations it managed to capture.
 */
export async function runMarketingManager(input: {
  tenant: AiTenantContext;
  /** Full objective text from the context builder (goal + orientation). */
  objective: string;
  budget?: Partial<AgentBudgetLimits>;
  requestId?: string;
  llm?: LoopLlmFn;
  loadMemory?: LoopMemoryFn;
}): Promise<ManagerRunResult> {
  registerMarketingDomainTools();

  const memory = await runBoundedAgentLoop({
    policy: marketingManagerPolicy,
    objective: input.objective,
    tenant: {
      restaurantId: input.tenant.restaurantId,
      branchId: input.tenant.branchId,
      actorId: input.tenant.actorId,
    },
    budget: input.budget ?? MARKETING_MANAGER_BUDGET,
    requestId: input.requestId,
    rolePrompt: MARKETING_MANAGER_ROLE_PROMPT,
    promptVersion: MARKETING_MANAGER_PROMPT_VERSION,
    observationChars: MARKETING_MANAGER_OBSERVATION_CHARS,
    // The domain-level investigation is genuinely sequential: the model must be
    // able to see which domains it has already read and which it has not.
    coverageGuidance: true,
    // THE FIX: keep the exact domain outputs so the deterministic layers below
    // consume the SAME investigation instead of re-running it (or discarding it).
    captureToolData: true,
    stopGuard: marketingManagerStopGuard,
    llm: input.llm,
    loadMemory: input.loadMemory,
  });

  const investigations = investigationsFromMemory(memory);
  const domainOrder: IntelligenceDomain[] = [];
  for (const call of memory.toolCalls) {
    const domain = domainNameForTool(call.tool);
    if (domain && call.ok && !domainOrder.includes(domain)) domainOrder.push(domain);
  }
  const stopGuardObjections = memory.uncertainties
    .filter((u) => u.reason.startsWith('stop_deferred:'))
    .map((u) => u.reason.replace(/^stop_deferred:\s*/, ''));

  return {
    memory,
    investigations,
    domainOrder,
    stopGuardObjections,
    usedDeterministicFallback: false,
  };
}

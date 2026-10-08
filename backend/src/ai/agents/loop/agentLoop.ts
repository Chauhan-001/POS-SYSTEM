/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentLoop.ts — the bounded, LLM-driven investigation loop (Phase 1).
 *
 * Flow per run:
 *   create working memory (server-derived tenant)
 *   → resolve policy against the ONE shared registry (fail-closed)
 *   → loop (≤ maxSteps): LLM plans → policy-validates tool names →
 *     sanitizes args (tenant keys stripped) → executes through the shared
 *     ToolExecutor (zod in/out validation + timeout clamp) → compact
 *     observation fed back → LLM decides whether more evidence is needed
 *   → stop on sufficient evidence or budget exhaustion (steps/tool calls/
 *     wall-clock/tokens/cost)
 *   → observability (AIUsageLog per LLM call + audit row per run)
 *
 * The LLM NEVER touches MongoDB or business services directly: the only
 * execution path is `executeTool` on a tool resolved from the agent policy.
 * Every failure is contained: the loop never throws, so callers can always
 * fall back to their deterministic behavior.
 */

import { z } from 'zod';
import {
  LlmError,
  generateJsonWithMeta,
  isLlmConfigured,
  type LlmJsonRequest,
  type LlmUsage,
} from '../../shared/llmClient';
import {
  createAgentRun,
  sanitizeToolArgs,
  type AgentRunMemory,
  type AgentObservation,
} from '../../shared/agentRunContext';
import { resolveAllowedTools } from '../../tools/registry/toolResolver';
import { executeTool } from '../../tools/registry/toolExecutor';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import type { AgentStepDecision } from '../../shared/agentRunContext';
import type { AgentPolicy } from '../policies/marketingAgentPolicy';
import { calculateCost } from '../../../services/aiCostConfig';
import { config } from '../../../config';
import { recordLlmUsage, recordAgentRun } from '../../observability/agentUsage';
import { loadMemoryContext } from '../../memory/memoryManager';
import type { AgentMemoryContext, MemoryEpisodeRecord, RestaurantMemoryRecord } from '../../memory/memoryTypes';

export const LOOP_PROMPT_VERSION = 'marketing-agent-loop-v1';

/** Injectable LLM seam — tests pass a fake; production uses generateJsonWithMeta. */
export interface LoopLlmResult {
  value: unknown;
  model?: string;
  provider?: string;
  latencyMs?: number;
  usage?: LlmUsage;
}
export type LoopLlmFn = (req: LlmJsonRequest) => Promise<LoopLlmResult>;

/** Injectable memory seam — tests pass a fake; production uses memoryManager. */
export type LoopMemoryFn = (tenant: {
  restaurantId: string;
  branchId?: string;
  actorId?: string;
}) => Promise<AgentMemoryContext>;

/**
 * Does a tool RESULT actually contain evidence?
 *
 * The shared tool contract reports "nothing to say" as `available:false` plus a
 * `NO_*` reason code (for example `NO_SALES_DATA`, `NO_OFFER_PERFORMANCE_DATA`,
 * `NO_CANDIDATES`). Such a result proves only that THIS source had nothing —
 * never that the business is healthy and never that other sources are empty.
 * Callers use this to keep empty sources out of "evidence" counts.
 *
 * Deliberately conservative: only an explicit negative signal counts as
 * unusable, so a tool whose output shape is unknown is still treated as data.
 */
export function isUsableToolData(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data !== 'object') return true;
  const obj = data as Record<string, unknown>;
  if (obj.available === false) return false;
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
  if (!reason) return true;
  if (/^NO_[A-Z0-9_]*$/.test(reason)) return false;
  if (/^(NO_DATA|NOT_CONFIGURED|INSUFFICIENT_DATA|UNAVAILABLE)$/i.test(reason)) return false;
  return true;
}

export interface AgentLoopOptions {
  policy: AgentPolicy;
  objective: string;
  /** AUTHENTICATED tenant (JWT-derived) — the only tenant source. */
  tenant: { restaurantId: string; branchId?: string; actorId?: string };
  budget?: {
    maxSteps?: number;
    maxToolCalls?: number;
    durationMs?: number;
    maxTokens?: number;
    maxCostUsd?: number;
  };
  requestId?: string;
  /**
   * Agent identity lines for the system prompt. Defaults to the marketing
   * planner text so existing callers are unchanged; another agent passes its
   * own role while sharing the same hard rules and stop conditions.
   */
  rolePrompt?: string;
  /** Prompt version recorded on usage rows (defaults to the marketing one). */
  promptVersion?: string;
  /**
   * When true, full successful tool outputs are kept on the run memory
   * (`toolData`) so the caller's deterministic analyzer can consume the EXACT
   * observations instead of re-executing the same tools. Off by default so
   * existing agents keep their current memory footprint.
   */
  captureToolData?: boolean;
  /**
   * How many characters of each tool observation are replayed into the next
   * planning prompt (defaults to the historical 600 — existing agents are
   * byte-identical). A deeper agent raises this so its later tool choice can
   * genuinely depend on the DETAIL of an earlier result.
   */
  observationChars?: number;
  /**
   * Include a SOURCE COVERAGE block in every planning prompt (opt-in; OFF by
   * default so existing agents are byte-identical).
   *
   * A model that only sees its own observations has no idea which read-only
   * sources it has NOT read, so it re-reads what it already has ("random
   * tools") and tends to conclude from the first thing it sees. The block
   * lists, per area of the business, the sources already read WITH data, the
   * sources read that returned NO data, and the sources NOT YET READ — plus
   * the rule that an empty source says nothing about the others. It never
   * picks or orders a tool: it only makes the model's own coverage visible.
   */
  coverageGuidance?: boolean;
  /**
   * Record a replayable decision chain on the run memory (`memory.replay`):
   * per step, the observations the model saw, the tools it requested, its
   * stated reason and the calls that actually executed. Opt-in (OFF by
   * default so existing agents keep byte-identical behaviour); contains only
   * the already-bounded observation summaries, never raw tool payloads.
   */
  replayEpisode?: boolean;
  /**
   * Optional stop guard: called when the model asks to stop. Returning an
   * objection (string) hands the model ONE more planning step with the
   * objection visible in its prompt — the model still decides what (if
   * anything) to call. The guard never executes a tool, and it is bounded by
   * maxSteps / the wall-clock budget, so it can never loop forever. Used by
   * the inventory agent so an empty specialist result is not reported as
   * "no risk" while the authoritative stock baseline was never inspected.
   */
  stopGuard?: (memory: AgentRunMemory) => string | null;
  /**
   * Bounded duplicate suppression (opt-in, OFF by default so existing agents
   * keep byte-identical behaviour). When the model asks for a tool with args
   * that ALREADY produced a successful output earlier in this run, the loop
   * serves that cached observation instead of re-executing the identical
   * read-only call. It still consumes budget (so repeating can never loop
   * unbounded) and it never caches failures (a transient error may succeed on
   * a later attempt). Deduplication happens at the executor boundary: it can
   * never change a deterministic severity, only avoid redundant work.
   */
  dedupeIdenticalTools?: boolean;
  /** Test seam; defaults to the shared llmClient. */
  llm?: LoopLlmFn;
  /**
   * Phase 2 test seam: memory loader. Defaults to the shared memoryManager
   * (tenant-scoped, expired-excluded, never throws). Tests may inject a fake
   * or a failing loader to prove graceful degradation.
   */
  loadMemory?: LoopMemoryFn;
}

/** What the LLM must return each step. Parsed strictly before anything runs. */
const LoopPlanSchema = z.object({
  plan: z.array(z.string()).max(12).optional(),
  toolCalls: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        args: z.record(z.string(), z.any()).optional(),
      }),
    )
    .max(8)
    .optional(),
  needMoreEvidence: z.boolean(),
  reason: z.string().max(600).optional(),
});

type LoopPlan = z.infer<typeof LoopPlanSchema>;

const SCHEMA_HINT = `{
  "plan": string[] (short investigation steps),
  "toolCalls": [{ "name": string, "args": object }] (0..8, names MUST come from the tool catalog),
  "needMoreEvidence": boolean,
  "reason": string
}`;

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * A JSON-mode provider can reject a request with HTTP 400 when the model's own
 * output failed JSON validation. That is a transient generation failure (not a
 * config/auth error), so exactly one retry is permitted.
 */
export function isRetryableJsonFailure(err: unknown): boolean {
  if (!(err instanceof LlmError)) return false;
  if (err.kind === 'invalid_json') return true;
  if (err.kind !== 'http_error' || err.httpStatus !== 400) return false;
  return /validate json|json_validate|failed_generation/i.test(err.message);
}

/** Default identity — the marketing agent (preserved for existing callers). */
const DEFAULT_ROLE_PROMPT = [
  'You are the investigation planner of the ChitKuber Marketing Intelligence agent for ONE restaurant.',
  'Your job: decide which READ-ONLY tools to call to gather evidence for a marketing objective, then stop when you have enough evidence.',
].join('\n');

/**
 * System prompt for a run. `rolePrompt` lets another agent (inventory) state
 * its own identity while keeping the SAME hard rules, catalog contract and
 * stop conditions — one bounded loop, several agents, no second framework.
 */
function buildSystemPrompt(
  catalog: Array<{ name: string; description: string; access: string; category: string }>,
  rolePrompt?: string,
): string {
  return [
    ...(rolePrompt ?? DEFAULT_ROLE_PROMPT).split('\n'),
    'Hard rules:',
    '1. You may only call tools from this catalog (names are exact):',
    JSON.stringify(catalog),
    '2. You have NO database and NO write access. Tools are the only way to read business data.',
    '3. Never pass restaurantId or tenant identifiers — tenant scope is fixed by the server.',
    '4. Never invent numbers, sales, margins, stock or trends. If evidence is unavailable, say so in "reason".',
    '5. Answer ONLY with the JSON shape provided (no prose outside JSON).',
    '6. Stop (needMoreEvidence=false) as soon as the evidence is sufficient for the objective — budget is limited. What counts as sufficient is defined by your role instructions above: a narrow question can be answered from one focused source, while a broad investigation normally needs several complementary sources.',
    '7. Evidence priority: current business data > current ML > current analytics > validated historical evidence > long-term memory > your own inference.',
    '8. Stored memory (when shown) is CONTEXTUAL EVIDENCE only. It never overrides current tool data, and memory alone is never sufficient reason for a recommendation.',
  ].join('\n');
}

/** Compact one-line rendering of an episode for the prompt. */
function episodeLine(e: MemoryEpisodeRecord): string {
  const outcome = e.outcome ? ` outcome=${e.outcome.status}` : '';
  const scope = e.branchId ? 'branch' : 'global';
  const obj = e.objective ? ` — ${e.objective.slice(0, 120)}` : '';
  return `- [episode ${e.episodeType} ${scope} conf=${e.confidence.toFixed(2)} ${e.createdAt.slice(0, 10)}${outcome}]${obj}`;
}

/** Compact one-line rendering of a long-term memory for the prompt. */
function memoryLine(m: RestaurantMemoryRecord): string {
  const scope = m.branchId ? 'branch' : 'global';
  const n = m.sampleSize !== undefined ? ` n=${m.sampleSize}` : '';
  const tags = m.tags.length ? ` tags=${m.tags.join(',')}` : '';
  let value: string;
  try {
    value = JSON.stringify(m.value) ?? '';
  } catch {
    value = '[unserializable]';
  }
  if (value.length > 240) value = `${value.slice(0, 240)}…`;
  return `- [memory ${m.memoryType} ${scope} conf=${m.confidence.toFixed(2)}${n}${tags} validated=${(m.lastValidatedAt ?? m.updatedAt).slice(0, 10)}] ${value}`;
}

function buildUserPrompt(input: {
  objective: string;
  step: number;
  maxSteps: number;
  toolCallsRemaining: number;
  observations: AgentObservation[];
  rejections: string[];
  uncertainties: Array<{ reason: string }>;
  memory?: AgentMemoryContext;
  coverage?: string;
}): string {
  const obs = input.observations.length
    ? input.observations.map((o) => `- ${o.tool}: ${o.summary}`).join('\n')
    : '(no evidence gathered yet)';
  const memory = input.memory;
  const memoryBlock = !memory
    ? ''
    : [
        `Stored memory (contextual evidence only — priority: ${memory.priorityStatement}):`,
        memory.episodes.length
          ? memory.episodes.map(episodeLine).join('\n')
          : '(no recent episodes)',
        memory.longTerm.length ? memory.longTerm.map(memoryLine).join('\n') : '(no long-term memories)',
        'Memory never overrides current tool data above; verify anything load-bearing with a tool call.',
      ].join('\n');
  return [
    `Objective: ${input.objective}`,
    `Step ${input.step} of ${input.maxSteps}. Tool calls remaining: ${input.toolCallsRemaining}.`,
    memoryBlock,
    input.coverage ?? '',
    'Evidence so far:',
    obs,
    input.rejections.length ? `Refused tool requests (already handled): ${input.rejections.join('; ')}` : '',
    input.uncertainties.length ? `Known uncertainties: ${input.uncertainties.map((u) => u.reason).join('; ')}` : '',
    'Return your JSON decision now.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Render the read/not-read coverage of every allow-listed source, grouped by
 * area of the business. Prompt-only: it never selects a tool.
 */
function buildCoverageBlock(
  toolMap: Map<string, ToolDefinition<unknown, unknown>>,
  observations: AgentObservation[],
): string {
  const latestUsable = new Map<string, boolean>();
  for (const o of observations) latestUsable.set(o.tool, o.ok && o.usable !== false);

  const byArea = new Map<string, string[]>();
  for (const def of toolMap.values()) {
    const list = byArea.get(def.category) ?? [];
    list.push(def.name);
    byArea.set(def.category, list);
  }

  const readWithData: string[] = [];
  const readEmpty: string[] = [];
  const unread: string[] = [];
  for (const area of [...byArea.keys()].sort()) {
    const names = byArea.get(area) ?? [];
    const missing: string[] = [];
    for (const name of names) {
      const state = latestUsable.get(name);
      if (state === undefined) missing.push(name);
      else if (state) readWithData.push(`${area}/${name}`);
      else readEmpty.push(`${area}/${name}`);
    }
    if (missing.length) unread.push(`${area}: ${missing.join(', ')}`);
  }

  return [
    'Source coverage (which read-only sources you have ALREADY read, and which you have NOT):',
    `Read with usable data: ${readWithData.length ? readWithData.join(', ') : '(none yet)'}`,
    `Read but returned NO data: ${readEmpty.length ? readEmpty.join(', ') : '(none)'}`,
    `NOT yet read: ${unread.length ? unread.join(' | ') : '(every source has been read at least once)'}`,
    'A source that returned NO data says NOTHING about the others: it only removes that one source. Read a source from an area you have not read yet before concluding, and never present an empty source as a healthy business.',
  ].join('\n');
}

/** Order-insensitive key for duplicate detection — only ever a cache key. */
function stableArgsKey(args: Record<string, unknown>): string {
  try {
    const keys = Object.keys(args).sort();
    return JSON.stringify(keys.map((k) => [k, args[k]]));
  } catch {
    return String(Object.keys(args).sort().join(','));
  }
}

/**
 * Compact tool output for prompt feedback — headline keys plus a truncated
 * JSON body. Raw datasets are never sent back into the loop (spec §F).
 *
 * `limitChars` is the JSON body clip length (defaults to the historical 600, so
 * every existing caller is unchanged). An agent that needs a deeper chain can
 * opt into a larger — still bounded — rendering so a later decision can read
 * the detail of an earlier result instead of only its headline.
 */
export function summarizeToolOutput(data: unknown, limitChars = 600): string {
  if (data === null || data === undefined) return 'no data';
  if (typeof data !== 'object') return String(data).slice(0, 400);
  const obj = data as Record<string, unknown>;
  const headlineKeys = ['available', 'reason', 'status', 'summary', 'isTrained', 'evaluationStatus'];
  const headline = headlineKeys
    .filter((k) => obj[k] !== undefined && obj[k] !== null)
    .map((k) => `${k}=${String(obj[k]).slice(0, 120)}`);
  let json: string;
  try {
    json = JSON.stringify(data) ?? '';
  } catch {
    json = '[unserializable]';
  }
  const clip = Math.max(120, limitChars);
  const clipped = json.length > clip ? `${json.slice(0, clip)}…` : json;
  return headline.length ? `${headline.join(' | ')} || ${clipped}` : clipped;
}

/**
 * Run one bounded investigation. NEVER throws — on any failure it returns the
 * working memory with a terminal status so the caller keeps its deterministic
 * behavior.
 */
export async function runBoundedAgentLoop(options: AgentLoopOptions): Promise<AgentRunMemory> {
  const startedAtMs = Date.now();
  const memory = createAgentRun({
    tenant: options.tenant,
    objective: options.objective,
    requestId: options.requestId,
    budget: options.budget,
  });
  const finish = async (status: AgentRunMemory['status'], error?: { code: string; message: string }): Promise<AgentRunMemory> => {
    memory.status = status;
    if (error) memory.error = error;
    memory.endedAt = new Date().toISOString();
    await recordAgentRun(memory, { durationMs: Date.now() - startedAtMs, agent: options.policy.agent });
    return memory;
  };

  try {
    // ── 0. Phase 2: load the tenant-scoped memory snapshot at run start ────
    // Never throws (loader contract): degraded → empty context, run continues.
    try {
      const loader = options.loadMemory ?? ((t) => loadMemoryContext(t));
      memory.memory = await loader(options.tenant);
    } catch (err) {
      memory.memory = {
        episodes: [],
        longTerm: [],
        priorityStatement: '',
        loadedAt: new Date().toISOString(),
        degraded: true,
        reason: err instanceof Error ? err.message.slice(0, 300) : 'memory load failed',
      };
    }

    // ── 1. Resolve the policy against the shared registry (FAIL CLOSED) ──
    let toolMap: Map<string, ToolDefinition<unknown, unknown>>;
    try {
      toolMap = new Map(
        resolveAllowedTools(options.policy.allowedTools).map((t) => [t.name, t as ToolDefinition<unknown, unknown>]),
      );
    } catch (err) {
      return await finish('failed', {
        code: 'policy_resolution_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const limits = memory.budget.limits;
    const promptVersion = options.promptVersion ?? LOOP_PROMPT_VERSION;
    const observationChars = options.observationChars ?? 600;
    if (options.replayEpisode) {
      memory.replay = { promptVersion, steps: [] };
    }
    const llm: LoopLlmFn = options.llm ?? ((req) => generateJsonWithMeta(req));
    const usingDefaultLlm = !options.llm;

    // ── 2. LLM availability up front (graceful degradation) ──
    if (usingDefaultLlm && !isLlmConfigured()) {
      memory.llm.configured = false;
      await recordLlmUsage({
        restaurantId: memory.tenant.restaurantId,
        requestId: memory.runId,
        promptVersion,
        feature: options.policy.agent,
        promptText: 'llm-availability-check',
        model: '',
        provider: '',
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        success: false,
        errorType: 'not_configured',
        fallbackReason: 'AI_API_KEY unset — deterministic agent path used',
      });
      return await finish('llm_unavailable', { code: 'not_configured', message: 'LLM not configured (AI_API_KEY unset)' });
    }
    memory.llm.configured = true;

    const system = buildSystemPrompt(
      [...toolMap.values()].map((t) => ({ name: t.name, description: t.meta.description, access: t.access, category: t.category })),
      options.rolePrompt,
    );
    let consecutiveInvalidPlans = 0;
    /** key = tool + stable args → the successful observation already captured. */
    const dedupeCache = new Map<
      string,
      { ok: boolean; usable: boolean; summary: string; code?: string; message?: string; durationMs: number }
    >();
    // Provider JSON-mode gateways (e.g. Groq) can return HTTP 400 when the model
    // emits invalid JSON. That is inherently retryable, so allow ONE bounded
    // retry per run — never an unbounded retry loop.
    let jsonRetriesUsed = 0;
    const MAX_JSON_RETRIES = 1;

    // ── 3. Bounded loop ──
    for (let step = 1; step <= limits.maxSteps; step++) {
      memory.budget.stepsUsed = step;

      if (Date.now() >= memory.budget.deadlineAt) {
        return await finish('stopped_budget', { code: 'deadline', message: 'Wall-clock budget exhausted before this step' });
      }

      // 3a. LLM plans
      const prompt = buildUserPrompt({
        objective: memory.objective,
        step,
        maxSteps: limits.maxSteps,
        toolCallsRemaining: limits.maxToolCalls - memory.budget.toolCallsUsed,
        observations: memory.observations,
        rejections: memory.rejections.map((r) => `${r.ref} (${r.stage})`),
        uncertainties: memory.uncertainties,
        memory: memory.memory,
        coverage: options.coverageGuidance ? buildCoverageBlock(toolMap, memory.observations) : undefined,
      });

      let llmResult: LoopLlmResult;
      try {
        const llmRequest = {
          system,
          prompt,
          schemaHint: SCHEMA_HINT,
          timeoutMs: Math.max(1, Math.min(configuredLlmTimeout(), memory.budget.deadlineAt - Date.now())),
        };
        try {
          llmResult = await llm(llmRequest);
        } catch (firstErr) {
          // Only a provider JSON-validation failure is retried, and only once.
          if (jsonRetriesUsed < MAX_JSON_RETRIES && isRetryableJsonFailure(firstErr)) {
            jsonRetriesUsed += 1;
            memory.uncertainties.push({ step, reason: `llm_json_validation_retry: ${errorText(firstErr)}` });
            llmResult = await llm(llmRequest);
          } else {
            throw firstErr;
          }
        }
      } catch (err) {
        const kind = err instanceof LlmError ? err.kind : 'http_error';
        const message = err instanceof Error ? err.message : String(err);
        memory.llm.calls += 1;
        await recordLlmUsage({
          restaurantId: memory.tenant.restaurantId,
          requestId: memory.runId,
          promptVersion,
          feature: options.policy.agent,
          promptText: `${system}\n${prompt}`,
          model: memory.llm.model,
          provider: memory.llm.provider,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          success: false,
          errorType: kind,
          fallbackReason: `deterministic agent path used (${kind})`,
        });
        const status = kind === 'not_configured' || kind === 'unsupported_provider' ? 'llm_unavailable' : 'failed';
        return await finish(status, { code: kind, message });
      }

      memory.llm.calls += 1;
      memory.llm.model = llmResult.model ?? memory.llm.model;
      memory.llm.provider = llmResult.provider ?? memory.llm.provider;
      const usage = llmResult.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      memory.budget.tokensUsed += usage.totalTokens || 0;
      if (llmResult.model && (usage.inputTokens || usage.outputTokens)) {
        memory.budget.costUsd += calculateCost(usage.inputTokens, usage.outputTokens, llmResult.model, llmResult.provider);
      }
      await recordLlmUsage({
        restaurantId: memory.tenant.restaurantId,
        requestId: memory.runId,
        promptVersion,
        feature: options.policy.agent,
        promptText: `${system}\n${prompt}`,
        model: llmResult.model ?? '',
        provider: llmResult.provider ?? '',
        latencyMs: llmResult.latencyMs ?? 0,
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        totalTokens: usage.totalTokens || 0,
        success: true,
      });

      // 3b. Budget checks after spending tokens
      if (memory.budget.tokensUsed > limits.maxTokens || memory.budget.costUsd > limits.maxCostUsd) {
        return await finish('stopped_budget', {
          code: 'token_budget',
          message: `Token/cost budget exhausted (tokens=${memory.budget.tokensUsed}, costUsd=${memory.budget.costUsd.toFixed(4)})`,
        });
      }

      // 3c. Validate the plan strictly
      const parsed = LoopPlanSchema.safeParse(llmResult.value);
      if (!parsed.success) {
        consecutiveInvalidPlans += 1;
        memory.uncertainties.push({
          step,
          reason: `llm_invalid_plan: ${parsed.error.issues[0]?.message ?? 'unparseable decision'}`,
        });
        if (consecutiveInvalidPlans >= 2) {
          return await finish('failed', { code: 'invalid_plan', message: 'LLM returned an invalid decision twice in a row' });
        }
        continue;
      }
      consecutiveInvalidPlans = 0;
      const plan: LoopPlan = parsed.data;
      if (plan.plan?.length) memory.plan = plan.plan;

      // Replay: open this step's decision with what the model could see.
      const replayStep: AgentStepDecision | null = memory.replay
        ? {
            step,
            seen: memory.observations.map((o) => ({ tool: o.tool, ok: o.ok, summary: o.summary })),
            requested: (plan.toolCalls ?? []).map((c) => c.name),
            ...(plan.reason ? { reason: plan.reason } : {}),
            needMoreEvidence: plan.needMoreEvidence,
            executed: [],
          }
        : null;

      // 3d. Execute requested tools — policy check FIRST (fail closed)
      let toolBudgetHit = false;
      for (const call of plan.toolCalls ?? []) {
        if (!toolMap.has(call.name)) {
          memory.rejections.push({
            ref: call.name,
            reason: `tool is not in the ${options.policy.agent} policy allow-list`,
            stage: 'policy',
          });
          continue;
        }
        if (memory.budget.toolCallsUsed >= limits.maxToolCalls) {
          memory.rejections.push({ ref: call.name, reason: 'tool-call budget exhausted', stage: 'budget' });
          toolBudgetHit = true;
          break;
        }

        const def = toolMap.get(call.name)!;
        const args = sanitizeToolArgs(call.args ?? {});

        // ── Bounded duplicate suppression (opt-in: dedupeIdenticalTools) ──
        // A repeated (tool + identical args) request is served from the cached
        // SUCCESSFUL observation: same output, no second identical read, and
        // it still consumes budget so repetition can never run unbounded.
        const cacheKey = options.dedupeIdenticalTools ? `${def.name}::${stableArgsKey(args)}` : '';
        const cached = cacheKey ? dedupeCache.get(cacheKey) : undefined;
        if (cached) {
          memory.budget.toolCallsUsed += 1;
          memory.toolCalls.push({
            step,
            tool: def.name,
            args,
            ok: cached.ok,
            code: cached.code,
            message: cached.message,
            durationMs: cached.durationMs,
            deduped: true,
          });
          memory.observations.push({
            step,
            tool: def.name,
            ok: cached.ok,
            summary: cached.summary,
            usable: cached.usable,
          });
          continue;
        }

        const result = await executeTool(def, args, {
          tenant: {
            restaurantId: memory.tenant.restaurantId,
            branchId: memory.tenant.branchId,
            actorId: memory.tenant.actorId,
          },
          executionId: memory.runId,
          timeoutMs: def.timeoutMs,
          deadlineAt: memory.budget.deadlineAt,
          remainingToolCalls: limits.maxToolCalls - memory.budget.toolCallsUsed,
        });
        memory.budget.toolCallsUsed += 1;
        memory.toolCalls.push({
          step,
          tool: def.name,
          args,
          ok: result.ok,
          code: result.ok ? undefined : result.code,
          message: result.ok ? undefined : result.message.slice(0, 300),
          durationMs: result.durationMs,
        });
        const usable = result.ok && isUsableToolData(result.data);
        const observation: AgentObservation = {
          step,
          tool: def.name,
          ok: result.ok,
          usable,
          summary: result.ok
            ? summarizeToolOutput(result.data, observationChars)
            : `ERROR ${result.code}: ${result.message.slice(0, 240)}`,
        };
        memory.observations.push(observation);
        if (result.ok && options.captureToolData) {
          memory.toolData.push({ step, tool: def.name, ok: true, data: result.data });
        }
        if (!result.ok) {
          memory.uncertainties.push({ step, reason: `${def.name} failed: ${result.code}` });
        }
        // Only SUCCESSFUL outputs are cacheable — a failed call may succeed on
        // a later attempt and must never be replayed as a permanent result.
        if (cacheKey && result.ok) {
          dedupeCache.set(cacheKey, {
            ok: true,
            usable,
            summary: observation.summary,
            durationMs: result.durationMs,
          });
        }
      }

      if (toolBudgetHit) {
        return await finish('stopped_max_tool_calls', {
          code: 'tool_budget',
          message: `Tool-call budget exhausted (${limits.maxToolCalls})`,
        });
      }

      // 3e. Stop conditions
      if (!plan.needMoreEvidence) {
        const objection = options.stopGuard?.(memory) ?? null;
        if (objection) {
          memory.uncertainties.push({ step, reason: `stop_deferred: ${objection}` });
          if (replayStep) {
            replayStep.stopObjection = objection;
            replayStep.executed = memory.toolCalls
              .filter((t) => t.step === step)
              .map((t) => ({ tool: t.tool, ok: t.ok, code: t.code, deduped: t.deduped }));
            memory.replay!.steps.push(replayStep);
          }
          if (step >= limits.maxSteps || Date.now() >= memory.budget.deadlineAt) {
            return await finish('stopped_max_steps', { code: 'stop_guard', message: objection });
          }
          continue;
        }
        if (replayStep) {
          replayStep.executed = memory.toolCalls
            .filter((t) => t.step === step)
            .map((t) => ({ tool: t.tool, ok: t.ok, code: t.code, deduped: t.deduped }));
          memory.replay!.steps.push(replayStep);
        }
        return await finish('completed_sufficient');
      }
      if (replayStep) {
        replayStep.executed = memory.toolCalls
          .filter((t) => t.step === step)
          .map((t) => ({ tool: t.tool, ok: t.ok, code: t.code, deduped: t.deduped }));
        memory.replay!.steps.push(replayStep);
      }
      if (step >= limits.maxSteps) {
        return await finish('stopped_max_steps');
      }
      if (Date.now() >= memory.budget.deadlineAt) {
        return await finish('stopped_budget', { code: 'deadline', message: 'Wall-clock budget exhausted' });
      }
    }

    return await finish('stopped_max_steps');
  } catch (err) {
    // Absolute containment: the loop never throws into the caller.
    return await finish('failed', {
      code: 'unexpected',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** LLM per-call timeout: provider config, but never beyond the run deadline. */
function configuredLlmTimeout(): number {
  return config.ai.timeout || 15_000;
}

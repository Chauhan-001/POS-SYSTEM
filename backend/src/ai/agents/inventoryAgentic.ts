/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgentic.ts — REAL agentic inventory investigation (Phase 1).
 *
 * Architecture (no second inventory system, no second loop):
 *
 *   OWNER TASK
 *     ↓
 *   runBoundedAgentLoop               (EXISTING shared bounded LLM loop)
 *     ↓  policy = inventoryAgentPolicy (allow-list, fail-closed)
 *     ↓  executor = ONE shared Tool Registry (read-only inventory tools)
 *     ↓  observations fed back to the LLM each step
 *   LLM stops when evidence is sufficient
 *     ↓  the SAME tool outputs are captured (no tool is executed twice)
 *   buildInventoryAgentResult         (EXISTING deterministic analyzer)
 *     ↓  authoritative quantities / urgencies / costs / severity
 *   LLM synthesis (one call) → strict schema
 *     ↓  SERVER-SIDE validation: evidence refs, grounded numbers,
 *        authoritative quantities attached from the deterministic result
 *   OWNER-FACING RESULT (advisory only — never writes inventory)
 *
 * The LLM decides WHICH tools to call and WHAT they mean. It never becomes the
 * calculation engine: quantities, days, costs and severity are always taken
 * from the deterministic evidence, and narrative numbers that do not exist in
 * the evidence are stripped before the owner sees them.
 */

import { z } from 'zod';
import {
  isRetryableJsonFailure,
  runBoundedAgentLoop,
  summarizeToolOutput,
  type LoopLlmFn,
  type LoopMemoryFn,
} from './loop/agentLoop';
import {
  inventoryAgentPolicy,
  INVENTORY_AGENT_BUDGET,
  INVENTORY_AGENT_PROMPT_VERSION,
  INVENTORY_AGENT_ROLE_PROMPT,
} from './policies/inventoryAgentPolicy';
import {
  buildInventoryAgentResult,
  runInventoryAgent,
  type InventoryAgentEvidence,
  type InventoryAgentResult,
} from './inventoryAgent';
import { generateJsonWithMeta, LlmError, type LlmJsonRequest, type LlmJsonResult } from '../shared/llmClient';
import type { AgentBudgetLimits, AgentRunMemory } from '../shared/agentRunContext';
import { malformedReason, stripUngroundedNumbers } from '../intelligence/recommendationExplanation';
import { recordLlmUsage } from '../observability/agentUsage';
import type { AiTenantContext } from '../shared/tenantContext';
import type { ToolContext } from '../tools/registry/toolTypes';
import type { InventoryStatusOutput } from '../tools/inventory/getInventoryStatusTool';
import type { StockoutRiskOutput } from '../tools/inventory/getStockoutRiskTool';
import type { ExpiryRiskOutput } from '../tools/inventory/getExpiryRiskTool';
import type { WastageOutput } from '../tools/inventory/getWastageTool';

export type InventoryAgentMode = 'agentic' | 'deterministic_fallback';

export interface InventoryAgenticOptions {
  task?: string;
  requestId?: string;
  /** Test seam — defaults to the shared llmClient. */
  llm?: LoopLlmFn;
  /** Test seam for the final synthesis call. */
  synthesisLlm?: (req: LlmJsonRequest) => Promise<LlmJsonResult<unknown>>;
  /** Skip every LLM call (always deterministic fallback). */
  disableLlm?: boolean;
  /** Override loop budgets (tests / tighter routes). */
  loopBudget?: Partial<AgentBudgetLimits>;
}

/** Purpose lines are generated from a STATIC map — never from hidden reasoning. */
const TOOL_PURPOSE: Record<string, string> = {
  getInventoryStatus: 'Inspect current stock levels before assessing urgency',
  getStockoutRisk: 'Determine whether low stock is likely to run out soon',
  getExpiryRisk: 'Check which perishable stock is close to expiry',
  getWastage: 'Review recent wastage for the items involved',
  getDemandForecast: 'Read stored ML demand predictions for the affected products',
  getSalesTrends: 'Review recent revenue and order trends behind stock movement',
  getMenuPerformance: 'Identify which menu items drive the most demand',
  getProductMargins: 'Review per-item margins to prioritise replenishment',
  getProductCombinations: 'Check which products are commonly bought together',
  getFestivalContext: 'Check upcoming festivals that may change demand',
  getSportsContext: 'Check upcoming local events that may change demand',
};

/** The deterministic agent executes exactly these four tools (see inventoryAgent.ts). */
const DETERMINISTIC_TOOLS = ['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage'];

const DEFAULT_TASK = 'What inventory risks should I handle today?';
const MAX_TASK_CHARS = 300;

// ─── D1: capability ↔ authoritative source ─────────────────────────────────
// An UNAVAILABLE or NEVER-INVESTIGATED source must never be rendered as "no
// risk". Every all-clear sentence the model writes is checked against this map
// server-side: a capability whose source did not return data is either dropped
// from the sentence or replaced with an explicit uncertainty statement.
//
// 'stock' | 'stockout' | 'expiry' | 'wastage' are the AUTHORITATIVE inventory
// capabilities backed by the deterministic analyzer. The remaining capabilities
// are CONTEXT capabilities backed by the extended read-only tools — they can
// support (and be cited by) claims, and their availability comes from the
// tools' own honest available/unavailable contract.
export type InventoryCapability =
  | 'stock'
  | 'stockout'
  | 'expiry'
  | 'wastage'
  | 'demand'
  | 'sales'
  | 'menu'
  | 'margins'
  | 'basket'
  | 'festival'
  | 'sports';

const CAPABILITY_SOURCE: Record<InventoryCapability, string> = {
  stock: 'current stock levels',
  stockout: 'stockout forecasting',
  expiry: 'expiry risk',
  wastage: 'wastage history',
  demand: 'stored demand predictions',
  sales: 'recent sales trends',
  menu: 'menu performance',
  margins: 'item margins',
  basket: 'bought-together patterns',
  festival: 'festival calendar',
  sports: 'sports calendar',
};

/** Explicit "this is fine" patterns per capability. */
const ALL_CLEAR_PATTERNS: Array<{ cap: InventoryCapability; re: RegExp }> = [
  { cap: 'expiry', re: /\b(?:no|none|not|without|zero|nothing)\b[^.!?]{0,70}\b(?:expir(?:y|ies|ation|ing)|perishable|best[- ]before)\b/i },
  { cap: 'expiry', re: /\b(?:expir(?:y|ies)|perishable)\b[^.!?]{0,50}\b(?:healthy|safe|fine|clear|no risk|low risk|ok(?:ay)?)\b/i },
  { cap: 'expiry', re: /\bno\s+(?:ingredients|items|products|stock)[^.!?]{0,50}(?:expir|perish)/i },
  { cap: 'stockout', re: /\b(?:no|none|not|without|zero|nothing)\b[^.!?]{0,70}\b(?:stockout|stock-out|run(?:s|ning)?\s+out|deplet(?:ion|ed|ing))\b/i },
  { cap: 'stock', re: /\b(?:all|everything)\b[^.!?]{0,60}\b(?:in stock|healthy|adequate|sufficient|fine|ok(?:ay)?)\b/i },
  { cap: 'stock', re: /\bstock\s+levels?\b[^.!?]{0,60}\b(?:healthy|adequate|sufficient|fine|good|ok(?:ay)?|in order)\b/i },
  { cap: 'stock', re: /\b(?:no|none|nothing)\b[^.!?]{0,50}\b(?:low stock|stock issues?|out of stock|shortage)\b/i },
  { cap: 'wastage', re: /\b(?:no|none|not|without|zero|nothing)\b[^.!?]{0,50}\b(?:wastage|waste|spoilage)\b/i },
  { cap: 'demand', re: /\b(?:no|none|not|without|zero|nothing)\b[^.!?]{0,70}\b(?:demand (?:change|spike|surge|drop|shift)|demand (?:is|remains)\s+(?:stable|flat|steady|normal))\b/i },
  { cap: 'sales', re: /\bsales\b[^.!?]{0,50}\b(?:are|is|remain[s]?)\s+(?:stable|flat|steady|normal|unchanged)\b/i },
];

/** Honest replacement wording when the claim cannot be made at all. */
const UNCERTAINTY_TEXT: Record<InventoryCapability, string> = {
  stock: 'Current stock levels could not be determined from the available data.',
  stockout: 'Stockout risk could not be determined from the available data.',
  expiry: 'Expiry status could not be determined from the available data.',
  wastage: 'Wastage history could not be determined from the available data.',
  demand: 'Demand predictions could not be determined from the available data.',
  sales: 'Sales trends could not be determined from the available data.',
  menu: 'Menu performance could not be determined from the available data.',
  margins: 'Item margins could not be determined from the available data.',
  basket: 'Bought-together patterns could not be determined from the available data.',
  festival: 'The festival calendar could not be determined from the available data.',
  sports: 'Upcoming sports events could not be determined from the available data.',
};

/**
 * Capabilities whose authoritative source actually returned usable data. The
 * core four come from the deterministic evidence; context capabilities come
 * from the extended tools' own honest available/unavailable contract.
 */
export function availableInventoryCapabilities(
  evidence: InventoryAgentEvidence,
  context?: ContextFacts,
): Set<InventoryCapability> {
  const ok = new Set<InventoryCapability>();
  if (evidence.inventory.available) ok.add('stock');
  if (evidence.stockout.available) ok.add('stockout');
  if (evidence.expiry.available) ok.add('expiry');
  if (evidence.wastage.available) ok.add('wastage');
  if (context?.getDemandForecast?.available) ok.add('demand');
  if (context?.getSalesTrends?.available) ok.add('sales');
  if (context?.getMenuPerformance?.available) ok.add('menu');
  if (context?.getProductMargins?.available) ok.add('margins');
  if (context?.getProductCombinations?.available) ok.add('basket');
  if (context?.getFestivalContext?.available) ok.add('festival');
  if (context?.getSportsContext?.available) ok.add('sports');
  return ok;
}

/** Capability → the tool that is its authoritative source. */
const CAPABILITY_TOOL: Record<InventoryCapability, string> = {
  stock: 'getInventoryStatus',
  stockout: 'getStockoutRisk',
  expiry: 'getExpiryRisk',
  wastage: 'getWastage',
  demand: 'getDemandForecast',
  sales: 'getSalesTrends',
  menu: 'getMenuPerformance',
  margins: 'getProductMargins',
  basket: 'getProductCombinations',
  festival: 'getFestivalContext',
  sports: 'getSportsContext',
};

/** Same view derived from the deterministic result (used by the fallback path). */
function availableFromDeterministic(det: InventoryAgentResult): Set<InventoryCapability> {
  const ok = new Set<InventoryCapability>();
  if (det.evidenceSources.inventory) ok.add('stock');
  if (det.evidenceSources.demandForecast) ok.add('stockout');
  if (det.evidenceSources.expiry) ok.add('expiry');
  if (det.evidenceSources.wastage) ok.add('wastage');
  return ok;
}

/**
 * Remove (or neutralize) every all-clear claim about a source that was NOT
 * available in this run. Split into sentences so unrelated, supported
 * statements survive; when nothing usable remains, the whole text becomes the
 * uncertainty statement for the first claim that was removed.
 */
export function neutralizeUnsupportedAllClear(
  text: string,
  available: Set<InventoryCapability>,
): { text: string; removed: InventoryCapability[] } {
  if (!text) return { text, removed: [] };
  const sentences = text.split(/(?<=[.!?])\s+/);
  const removed: InventoryCapability[] = [];
  const kept: string[] = [];
  for (const sentence of sentences) {
    const unsupported = ALL_CLEAR_PATTERNS.filter((p) => p.re.test(sentence)).map((p) => p.cap).filter((c) => !available.has(c));
    if (unsupported.length === 0) kept.push(sentence);
    else removed.push(...unsupported);
  }
  if (removed.length === 0) return { text, removed: [] };
  const joined = kept.join(' ').trim();
  if (joined.length >= 3 && !malformedReason(joined)) return { text: joined, removed };
  return { text: UNCERTAINTY_TEXT[removed[0]], removed };
}

export interface InventoryAgenticResult extends Omit<InventoryAgentResult, 'mode'> {
  mode: InventoryAgentMode;
  /** The owner task the investigation answered. */
  task: string;
  /** LLM synthesis, validated against deterministic evidence (null when degraded). */
  assessment: {
    title: string;
    summary: string;
    priority: InventoryPriority;
  } | null;
  issues: InventoryIssue[];
  recommendations: InventoryAgentRecommendation[];
  confidence: number;
  /** Tool names actually executed (server-side truth, never LLM-provided). */
  toolsUsed: string[];
  /**
   * Per-tool DATA availability from the tools' own available/unavailable
   * contract (a tool can execute successfully and still report that it had no
   * data). Drives the UI's honest "checked but unavailable" chips.
   */
  toolAvailability?: Record<string, boolean>;
  /** Investigation metadata — concise decision points, no chain-of-thought. */
  investigation: {
    runId: string;
    requestId: string;
    status: string;
    stepsUsed: number;
    toolCallsUsed: number;
    llmCalls: number;
    toolNames: string[];
    steps: Array<{ tool: string; ok: boolean; purpose: string; durationMs: number }>;
    /** How many tool calls were served from cache instead of re-executed (D6). */
    dedupedCalls: number;
    rejections: Array<{ ref: string; stage: string }>;
    degraded: boolean;
  };
  /** True when this result came from the deterministic fallback path. */
  degraded: boolean;
  /**
   * Why anything was degraded or dropped: a hard reason when `degraded` is
   * true (e.g. `llm_failed`, `synthesis_invalid_schema`), or the server-side
   * validation notes when an agentic result shipped with rows whose evidence
   * refs were repaired / rows that were dropped (`synthesis_partially_rejected:…`).
   */
  degradedReason?: string;
}

export type InventoryPriority = 'critical' | 'high' | 'medium' | 'low' | 'normal';

export interface InventoryIssue {
  type: string;
  itemId?: string;
  itemName?: string;
  severity: InventoryPriority;
  evidenceRefs: string[];
  explanation: string;
}

export interface InventoryAgentRecommendation {
  actionType: InventoryActionType;
  itemId?: string;
  itemName?: string;
  rationale: string;
  evidenceRefs: string[];
  requiresApproval: true;
  /**
   * Authoritative values copied from the deterministic analyzer — never from
   * the model. `null` when the deterministic layer has no row for this item,
   * in which case the recommendation is dropped entirely.
   */
  authoritative: {
    suggestedQty?: string;
    urgency?: string;
    estimatedCost?: number | null;
    daysUntilOut?: number;
    daysUntilExpiry?: number;
    severity?: string;
    wastageQty?: number;
    wastageUnit?: string;
  } | null;
}

/**
 * Synthesis contract — deliberately has NO quantity/price fields, so the model
 * structurally CANNOT present its own inventory numbers as authoritative.
 *
 * Tolerance is deliberate: unknown keys are stripped by zod and each optional
 * field is validated by the SERVER-SIDE layer below, which is stricter about
 * what actually ships (real evidence refs, grounded numbers, an authoritative
 * row per item). A rigid schema only turned a minor formatting difference into
 * a full deterministic fallback.
 */
/**
 * Model-facing enums are validated loosely and NORMALIZED server-side: a
 * cased/worded difference ("HIGH", "Replenish") must not discard an otherwise
 * correct assessment, and every normalized value still has to survive the
 * evidence checks below.
 */
const PRIORITIES: InventoryPriority[] = ['critical', 'high', 'medium', 'low', 'normal'];
const prioritySchema = z.string().max(20).optional();

function normalizePriority(value: string | undefined): InventoryPriority {
  const s = (value ?? '').trim().toLowerCase();
  return (PRIORITIES as string[]).includes(s) ? (s as InventoryPriority) : 'normal';
}

export type InventoryActionType = 'reorder' | 'review_expiry' | 'reduce_wastage' | 'monitor';

const ACTION_ALIASES: Record<string, InventoryActionType> = {
  reorder: 'reorder',
  replenish: 'reorder',
  purchase: 'reorder',
  purchase_order: 'reorder',
  order: 'reorder',
  review_expiry: 'review_expiry',
  monitor_expiry: 'review_expiry',
  expiry: 'review_expiry',
  reuse: 'review_expiry',
  reduce_wastage: 'reduce_wastage',
  wastage: 'reduce_wastage',
  reduce: 'reduce_wastage',
  monitor: 'monitor',
  review: 'monitor',
};

function normalizeActionType(value: string): InventoryActionType {
  const s = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ACTION_ALIASES[s] ?? 'monitor';
}

const synthesisSchema = z.object({
  assessment: z.object({
    title: z.string().min(3).max(120),
    summary: z.string().min(3).max(600),
    priority: prioritySchema.optional(),
  }),    issues: z
    .array(
      z.object({
        type: z.string().min(2).max(60),
        itemId: z.string().max(80).optional(),
        itemName: z.string().max(120).optional(),
        severity: prioritySchema,
        evidenceRefs: z.array(z.string().max(60)).max(4).optional(),
        explanation: z.string().min(3).max(400),
      }),
    )
    // A model listing MORE rows than the owner UX shows is a formatting
    // difference, not a broken assessment: the server caps the list instead of
    // discarding the whole synthesis.
    .max(30)
    .optional(),
  recommendations: z
    .array(
      z.object({
        actionType: z.string().min(2).max(40),
        itemId: z.string().max(80).optional(),
        itemName: z.string().max(120).optional(),
        rationale: z.string().min(3).max(400),
        evidenceRefs: z.array(z.string().max(60)).max(4).optional(),
      }),
    )
    .max(20)
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * Synthesis rules. The exact tool names that actually ran are injected so the
 * model can only cite real evidence (an unlisted ref is repaired server-side).
 */
function synthesisSystemPrompt(toolsUsed: string[]): string {
  return [
    'You explain an inventory situation to a restaurant owner who does not know AI or technical terms.',
    'Hard rules:',
    '1. Use ONLY the facts in the input JSON. Never invent or estimate stock, expiry dates, days, quantities, reorder amounts, costs or demand.',
    '2. The reorder quantities and urgency in the facts are authoritative — never propose a different number, and never state a number that is not in the facts.',
    '3. Evidence priority: current stock/expiry facts > predicted depletion/reorder > wastage history > your own inference.',
    '4. You are advisory only: recommend what the owner should review or approve. Never claim an action was performed.',
    '5. An unavailable source in the facts means that source had no data — it is not a fact that the restaurant is healthy.',
    `6. EVERY issue and recommendation MUST include a non-empty "evidenceRefs" array. Values may contain ONLY these exact tool names (the tools this investigation actually ran): ${toolsUsed.join(', ')}. Any other value is discarded, and a row without refs is dropped entirely.`,
    '7. Stock, expiry and wastage quantities come ONLY from the authoritative inventory facts. Context signals (demand forecast, sales trends, menu performance, margins, bought-together patterns, festival and sports calendars) may explain WHY demand is changing — never quote a stock, expiry or reorder number from them, and never treat an unavailable context source as good or bad news.',
    '8. Answer ONLY with the JSON object matching the schema.',
  ].join('\n');
}

const SYNTHESIS_SCHEMA_HINT = `{
  "assessment": { "title": string, "summary": string, "priority": "critical" | "high" | "medium" | "low" | "normal" },
  "issues": [{ "type": string, "itemId"?: string, "itemName"?: string, "severity": string, "evidenceRefs": string[] (REQUIRED, non-empty, exact tool names), "explanation": string }],
  "recommendations": [{ "actionType": "reorder" | "review_expiry" | "reduce_wastage" | "monitor", "itemId"?: string, "itemName"?: string, "rationale": string, "evidenceRefs": string[] (REQUIRED, non-empty, exact tool names) }],
  "confidence": number
}`;

/**
 * Stop guard passed to the shared loop. It does NOT pick tools and does NOT
 * execute anything: it only objects when the model is about to conclude while
 * (a) a called tool returned `available=false` and (b) current stock levels
 * (`getInventoryStatus`) have never been read successfully. The model then
 * gets one more planning step — an empty specialist source must not become a
 * "stock is healthy" answer.
 */
export function inventoryBaselineStopGuard(
  memory: Pick<AgentRunMemory, 'toolCalls' | 'toolData'>,
): string | null {
  const emptySource = memory.toolData.some(
    (t) => t.ok && (t.data as { available?: boolean } | null | undefined)?.available === false,
  );
  if (!emptySource) return null;
  const baselineRead = memory.toolCalls.some((t) => t.ok && t.tool === 'getInventoryStatus');
  if (baselineRead) return null;
  return 'a tool returned no data for this restaurant and current stock levels (getInventoryStatus) were never inspected — call getInventoryStatus before concluding.';
}

/** Inventory investigations use NO stored memory in this phase. */
const noInventoryMemory: LoopMemoryFn = async () => ({
  episodes: [],
  longTerm: [],
  priorityStatement: 'Stored long-term memory is not used for inventory investigations.',
  loadedAt: new Date().toISOString(),
  degraded: false,
});

function normalizeTask(task: unknown): string {
  if (typeof task !== 'string') return DEFAULT_TASK;
  const trimmed = task.trim();
  if (!trimmed) return DEFAULT_TASK;
  return trimmed.slice(0, MAX_TASK_CHARS);
}

function toUnitConfidence(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

const PRIORITY_RANK: Record<InventoryPriority, number> = { critical: 4, high: 3, medium: 2, low: 1, normal: 0 };

/**
 * Deterministic floor for the owner-facing priority: the model may raise the
 * urgency the evidence implies, never lower it (the deterministic layer stays
 * authoritative).
 */
function deterministicPriority(det: InventoryAgentResult): InventoryPriority {
  if (det.status === 'insufficient_data') return 'normal';
  const criticalStockout = det.stockoutPredictions.some((s) => s.severity === 'critical');
  const criticalExpiry = det.expiryRisks.some((e) => e.severity === 'critical');
  if (criticalStockout || criticalExpiry) return 'critical';
  if (det.purchaseRecommendations.some((r) => r.urgency === 'high')) return 'high';
  if (det.purchaseRecommendations.length > 0 || det.expiryRisks.length > 0) return 'medium';
  if (det.wastageSignals.length > 0) return 'low';
  return 'normal';
}

function maxPriority(a: InventoryPriority, b: InventoryPriority): InventoryPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

/**
 * Numbers the model is allowed to state.
 *
 * D3: the set is harvested from the EVIDENCE (every numeric field the tools
 * actually returned: stock/min/max/cost, days until depletion/expiry, reorder
 * quantities, wastage qty/cost, dates) plus the numbers inside the
 * deterministic layer's OWN strings (summary, reasons, next actions), plus —
 * when the extended context tools ran and returned data — the numbers inside
 * those server-produced outputs. Only server-produced values are ever
 * admitted — arbitrary digits are not, so an invented number is still stripped.
 */
function allowedNumbersFromEvidence(
  det: InventoryAgentResult,
  evidence: InventoryAgentEvidence,
  contextFacts?: ContextFacts,
): Set<string> {
  const allowed = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n === 'string') {
      for (const token of n.match(/-?\d+(?:[.,]\d+)?/g) ?? []) add(token);
      return;
    }
    if (typeof n !== 'number' || !Number.isFinite(n)) return;
    allowed.add(String(n));
    allowed.add(String(Math.round(n)));
    allowed.add(String(Math.round(n * 100) / 100));
    allowed.add(String(Math.abs(n)));
    allowed.add(String(Math.round(Math.abs(n) * 100) / 100));
  };
  /** A number-shaped token straight out of an authoritative string. */
  const addToken = (raw: string) => {
    allowed.add(raw);
    const clean = raw.replace(/,/g, '');
    allowed.add(clean);
    const n = Number(clean);
    if (Number.isFinite(n)) {
      allowed.add(String(n));
      allowed.add(String(Math.round(n)));
      allowed.add(String(Math.round(n * 10) / 10));
      allowed.add(String(Math.round(n * 100) / 100));
    }
  };
  const addText = (value: unknown) => {
    if (typeof value !== 'string') return;
    for (const token of value.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) addToken(token);
    // ISO dates ("2026-10-04T00:00:00.000Z") — every component is authoritative.
    for (const part of value.match(/-?\d+/g) ?? []) addToken(part);
  };

  // ── raw evidence fields ──
  for (const item of evidence.inventory.items ?? []) {
    add(item.currentStock);
    add(item.minStock);
    add(item.maxStock);
    add(item.price);
    add(item.averageCost);
    add(item.unit);
  }
  for (const alert of evidence.stockout.alerts ?? []) {
    add(alert.currentStock);
    add(alert.daysUntilDepletion);
    add(alert.recommendedReorderQuantity);
    addText(String(alert.predictedDepletionDate ?? ''));
  }
  for (const alert of evidence.expiry.alerts ?? []) {
    add(alert.currentStock);
    add(alert.daysUntilExpiry);
    addText(String(alert.expiryDate ?? ''));
    for (const line of alert.recommendedActions ?? []) addText(line);
  }
  for (const row of evidence.wastage.topItems ?? []) {
    add(row.qty);
    add(row.cost);
  }

  // ── deterministic layer's own strings ──
  addText(det.summary);
  for (const line of det.nextActions) addText(line);
  for (const r of det.purchaseRecommendations) {
    add(r.estimatedCost ?? NaN);
    addText(r.suggestedQty);
    addText(r.reason);
  }
  for (const s of det.stockoutPredictions) {
    add(s.daysUntilOut);
    add(s.currentStock);
    addText(s.suggestedAction);
  }
  for (const e of det.expiryRisks) {
    add(e.daysUntilExpiry);
    add(e.currentStock);
    addText(String(e.expiryDate ?? ''));
    for (const line of e.recommendedActions ?? []) addText(line);
  }
  for (const w of det.wastageSignals) add(w.qty);

  add(det.purchaseRecommendations.length);
  add(det.stockoutPredictions.length);
  add(det.expiryRisks.length);
  add(det.wastageSignals.length);

  // ── Extended-tool observations ──────────────────────────────────────────
  // Every number in a SUCCESSFUL extended-tool output is server truth the
  // model was shown in the facts, so it is admissible in the narrative (D3's
  // guarantee is unchanged: arbitrary model-invented digits are still
  // stripped). Unavailable outputs contribute nothing.
  if (contextFacts) {
    const walk = (value: unknown, depth: number): void => {
      if (depth > 6 || value === null || value === undefined) return;
      if (typeof value === 'number') {
        add(value);
        return;
      }
      if (typeof value === 'string') {
        addText(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 100)) walk(item, depth + 1);
        return;
      }
      if (typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>).slice(0, 120)) walk(v, depth + 1);
      }
    };
    for (const fact of Object.values(contextFacts)) {
      if (fact?.available) walk(fact.data, 0);
    }
  }

  return allowed;
}

/**
 * Ground a model sentence against the authoritative numbers. Stripped text
 * that no longer reads as a sentence is replaced by a deterministic fallback.
 */
function groundText(text: string, allowed: Set<string>, fallback: string): string {
  const { text: stripped } = stripUngroundedNumbers(text, allowed);
  const candidate = stripped.trim();
  if (candidate.length < 3 || malformedReason(candidate)) return fallback;
  return candidate;
}

/** Tool → the evidence key it fills (used to build evidence + refs). */
const TOOL_EVIDENCE_KEY: Record<string, keyof InventoryEvidenceInput> = {
  getInventoryStatus: 'inventory',
  getStockoutRisk: 'stockout',
  getExpiryRisk: 'expiry',
  getWastage: 'wastage',
};

type InventoryEvidenceInput = InventoryAgentEvidence;

/**
 * Extended (context) tools — real, registered, read-only tools that WIDEN an
 * investigation without changing the authoritative inventory analysis. Their
 * observations never feed the deterministic analyzer; they flow into the
 * synthesis facts, the grounded-number allow-list and the per-tool
 * availability map so the owner-facing explanation can honestly use them.
 */
const CONTEXT_TOOLS = [
  'getDemandForecast',
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getProductCombinations',
  'getFestivalContext',
  'getSportsContext',
] as const;

type ContextTool = (typeof CONTEXT_TOOLS)[number];

/** Observation of one extended tool: available/unavailable is the tool's OWN contract. */
interface ContextFact {
  available: boolean;
  reason?: string;
  data: unknown;
}

type ContextFacts = Partial<Record<ContextTool, ContextFact>>;

/** Source state as told to the model: NEVER investigated vs investigated-but-empty. */
function sourceFact(
  ran: Set<string>,
  toolName: string,
  source: { available: boolean; reason?: string },
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (source.available) return { available: true, ...data };
  return ran.has(toolName)
    ? { investigated: true, available: false, reason: source.reason ?? 'no data' }
    : { investigated: false, available: false, note: 'This source was NOT investigated in this run — do not describe it as empty data.' };
}

/** Compact, privacy-safe facts handed to the synthesis call. */
function synthesisFacts(
  task: string,
  det: InventoryAgentResult,
  evidence: InventoryAgentEvidence,
  toolsUsed: string[],
  contextFacts?: ContextFacts,
) {
  const ran = new Set(toolsUsed);
  /** Extended-tool observations the model may reference (bounded, honest). */
  const contextSignals = (Object.keys(contextFacts ?? {}) as ContextTool[])
    .filter((t) => contextFacts?.[t] !== undefined)
    .map((t) => {
      const fact = contextFacts![t]!;
      const base: Record<string, unknown> = { tool: t, available: fact.available };
      if (!fact.available) {
        base.reason = fact.reason ?? 'no data';
        base.note = 'This source returned no usable data in this run — it is NOT evidence that the underlying trend is good or bad.';
      } else {
        base.summary = summarizeToolOutput(fact.data);
      }
      return base;
    });
  return {
    task,
    inventoryStatus: sourceFact(ran, 'getInventoryStatus', evidence.inventory, {
      itemCount: evidence.inventory.items?.length ?? 0,
      summary: summarizeToolOutput(evidence.inventory),
    }),
    stockoutRisk: sourceFact(ran, 'getStockoutRisk', evidence.stockout, { alerts: evidence.stockout.alerts ?? [] }),
    expiryRisk: sourceFact(ran, 'getExpiryRisk', evidence.expiry, { alerts: evidence.expiry.alerts ?? [] }),
    wastage: sourceFact(ran, 'getWastage', evidence.wastage, { topItems: evidence.wastage.topItems ?? [] }),
    contextSignals,
    authoritativeRecommendations: det.purchaseRecommendations,
    authoritativeStockouts: det.stockoutPredictions,
    authoritativeExpiry: det.expiryRisks,
    authoritativeWastage: det.wastageSignals,
    deterministicSummary: det.summary,
    evidenceSources: det.evidenceSources,
  };
}

/**
 * Build evidence from the EXACT outputs the loop already executed.
 *
 * Core tools fill the deterministic evidence slots; extended context tools are
 * collected SEPARATELY (their shapes differ and must not reach the
 * deterministic analyzer). `toolsUsed` reports every tool that produced an
 * observation — the UI chips and the synthesis citation allow-list are built
 * from this server-side truth.
 */
function evidenceFromToolData(
  toolData: Array<{ step: number; tool: string; ok: boolean; data: unknown }>,
  generatedAt: string,
): { evidence: InventoryAgentEvidence; toolsUsed: string[]; contextFacts: ContextFacts } {
  const byKey: Partial<Record<keyof InventoryEvidenceInput, unknown>> = {};
  const toolsUsed: string[] = [];
  const contextFacts: ContextFacts = {};
  for (const entry of toolData) {
    if (!toolsUsed.includes(entry.tool)) toolsUsed.push(entry.tool);
    const key = TOOL_EVIDENCE_KEY[entry.tool];
    if (key) {
      if (byKey[key] === undefined) byKey[key] = entry.data; // first observation wins; never re-execute
      continue;
    }
    if (CONTEXT_TOOLS.includes(entry.tool as ContextTool) && contextFacts[entry.tool as ContextTool] === undefined) {
      const payload = entry.data as { available?: boolean; reason?: string } | null;
      contextFacts[entry.tool as ContextTool] = {
        available: payload?.available === true,
        reason: payload?.available === false ? String(payload?.reason ?? 'no data') : undefined,
        data: entry.data,
      };
    }
  }
  const missing = (reason: string) => ({ available: false, reason, generatedAt });
  return {
    toolsUsed,
    contextFacts,
    evidence: {
      inventory: (byKey.inventory as InventoryStatusOutput | undefined) ?? missing('NOT_INVESTIGATED'),
      stockout: (byKey.stockout as StockoutRiskOutput | undefined) ?? missing('NOT_INVESTIGATED'),
      expiry: (byKey.expiry as ExpiryRiskOutput | undefined) ?? missing('NOT_INVESTIGATED'),
      wastage: (byKey.wastage as WastageOutput | undefined) ?? missing('NOT_INVESTIGATED'),
      generatedAt,
    },
  };
}

/** Authoritative row for an item named by the model, if one exists. */
function authoritativeFor(
  itemName: string | undefined,
  itemId: string | undefined,
  det: InventoryAgentResult,
): InventoryAgentRecommendation['authoritative'] | undefined {
  const name = itemName?.trim().toLocaleLowerCase();
  const id = itemId?.trim();
  if (!name && !id) return undefined;
  const matches = (candidate: string) => {
    const c = candidate.trim().toLocaleLowerCase();
    return (name && c === name) || (id && c === id);
  };
  const purchase = det.purchaseRecommendations.find((r) => matches(r.item));
  if (purchase) {
    return {
      suggestedQty: purchase.suggestedQty,
      urgency: purchase.urgency,
      estimatedCost: purchase.estimatedCost,
    };
  }
  const stockout = det.stockoutPredictions.find((s) => matches(s.item));
  if (stockout) {
    return { daysUntilOut: stockout.daysUntilOut, severity: stockout.severity, urgency: stockout.severity === 'critical' ? 'high' : 'medium' };
  }
  const expiry = det.expiryRisks.find((e) => matches(e.itemName));
  if (expiry) {
    return { daysUntilExpiry: expiry.daysUntilExpiry, severity: expiry.severity };
  }
  const wastage = det.wastageSignals.find((w) => matches(w.name));
  if (wastage) {
    return { wastageQty: wastage.qty, wastageUnit: wastage.unit };
  }
  return undefined;
}

function deterministicAssessment(task: string, det: InventoryAgentResult): { title: string; summary: string; priority: InventoryPriority } {
  return {
    title: det.status === 'insufficient_data' ? 'Inventory data unavailable' : 'Inventory situation',
    summary: det.summary,
    priority: deterministicPriority(det),
  };
}

/**
 * Deterministic issues. EVERY ref names a tool that ACTUALLY RAN — a fallback
 * issue must never cite evidence the run never gathered.
 */
function deterministicIssues(det: InventoryAgentResult, toolsUsed: string[]): InventoryIssue[] {
  const used = new Set(toolsUsed);
  const refsFor = (...candidates: string[]) => candidates.filter((c) => used.has(c));
  const issues: InventoryIssue[] = [];

  for (const r of det.purchaseRecommendations.slice(0, 5)) {
    const refs = refsFor('getStockoutRisk', 'getInventoryStatus');
    if (refs.length === 0) continue;
    issues.push({
      type: /out of stock/i.test(r.reason) ? 'out_of_stock' : 'low_stock',
      itemName: r.item,
      severity: r.urgency === 'high' ? 'high' : 'medium',
      evidenceRefs: refs,
      explanation: r.reason,
    });
  }
  for (const s of det.stockoutPredictions.slice(0, 5)) {
    const refs = refsFor('getStockoutRisk');
    if (refs.length === 0) continue;
    issues.push({
      type: 'stockout_risk',
      itemName: s.item,
      severity: s.severity === 'critical' ? 'critical' : 'high',
      evidenceRefs: refs,
      explanation: `Forecast indicates ${s.item} runs out in ${s.daysUntilOut} day(s) at the current rate.`,
    });
  }
  for (const e of det.expiryRisks.slice(0, 5)) {
    const refs = refsFor('getExpiryRisk');
    if (refs.length === 0) continue;
    issues.push({
      type: 'expiry_risk',
      itemId: e.itemId,
      itemName: e.itemName,
      severity: e.severity === 'critical' ? 'critical' : 'high',
      evidenceRefs: refs,
      explanation: `${e.itemName} expires in ${e.daysUntilExpiry} day(s).`,
    });
  }
  if (issues.length > 0) return issues;
  // No actionable row was found IN THE EVIDENCE THAT WAS GATHERED. An
  // unavailable source is NOT "no risk": the two claims must stay distinct,
  // and the all-clear may only mention sources that actually returned data.
  const available = availableFromDeterministic(det);
  const availableTools = [...available].map((c) => CAPABILITY_TOOL[c]).filter((t) => used.has(t));
  if (det.status === 'insufficient_data' || availableTools.length === 0) {
    return toolsUsed.length > 0
      ? [
          {
            type: 'data_unavailable',
            severity: 'normal',
            evidenceRefs: [toolsUsed[0]],
            explanation: 'The investigated sources returned no data for this restaurant in the requested window.',
          },
        ]
      : [];
  }
  const labels = [...available].map((c) => CAPABILITY_SOURCE[c]);
  return [
    {
      type: 'no_immediate_risk',
      severity: 'normal',
      evidenceRefs: availableTools.slice(0, 4),
      explanation: `No immediate risk was found in the sources that returned data (${labels.join(', ')}).`,
    },
  ];
}

function deterministicRecommendations(det: InventoryAgentResult, toolsUsed: string[]): InventoryAgentRecommendation[] {
  const used = new Set(toolsUsed);
  const refsFor = (...candidates: string[]) => candidates.filter((c) => used.has(c));
  const recs: InventoryAgentRecommendation[] = [];
  for (const r of det.purchaseRecommendations.slice(0, 5)) {
    const refs = refsFor('getStockoutRisk', 'getInventoryStatus');
    if (refs.length === 0) continue;
    recs.push({
      actionType: 'reorder',
      itemName: r.item,
      rationale: r.reason,
      evidenceRefs: refs,
      requiresApproval: true,
      authoritative: { suggestedQty: r.suggestedQty, urgency: r.urgency, estimatedCost: r.estimatedCost },
    });
  }
  for (const e of det.expiryRisks.slice(0, 3)) {
    const refs = refsFor('getExpiryRisk');
    if (refs.length === 0) continue;
    recs.push({
      actionType: 'review_expiry',
      itemId: e.itemId,
      itemName: e.itemName,
      rationale: `Review usage or rotation for ${e.itemName} before it expires in ${e.daysUntilExpiry} day(s).`,
      evidenceRefs: refs,
      requiresApproval: true,
      authoritative: { daysUntilExpiry: e.daysUntilExpiry, severity: e.severity },
    });
  }
  for (const w of det.wastageSignals.slice(0, 2)) {
    const refs = refsFor('getWastage');
    if (refs.length === 0) continue;
    recs.push({
      actionType: 'reduce_wastage',
      itemName: w.name,
      rationale: `Wastage of ${w.qty}${w.unit ? ` ${w.unit}` : ''} was recorded for ${w.name} in the window.`,
      evidenceRefs: refs,
      requiresApproval: true,
      authoritative: { wastageQty: w.qty, wastageUnit: w.unit },
    });
  }
  return recs;
}

/**
 * D7: which authoritative sources can actually SUPPORT a given claim. A row
 * may only cite a tool whose capability the claim is about — an expiry claim
 * proven only by stock data is unsupported and is dropped (never "repaired"
 * into a claim the evidence cannot carry).
 *
 * Stock/expiry/wastage claims stay anchored to their AUTHORITATIVE source.
 * Demand-adjacent claims (stockout pressure, upcoming demand) may additionally
 * cite the context tools that ran and returned data — the demand forecast,
 * sales/menu history and calendar context genuinely bear on WHY demand is
 * changing. They can never replace the authoritative source: a low_stock row
 * still requires stock/stockout evidence to survive, context tools only add
 * traceability for the model's explanation.
 */
const ISSUE_SUPPORT: Record<string, InventoryCapability[]> = {
  low_stock: ['stock', 'stockout', 'demand', 'sales', 'menu', 'festival', 'sports'],
  out_of_stock: ['stock', 'stockout', 'demand', 'sales', 'menu', 'festival', 'sports'],
  stockout_risk: ['stockout', 'demand', 'sales', 'menu', 'festival', 'sports'],
  expiry_risk: ['expiry'],
  wastage_risk: ['wastage'],
  data_unavailable: ['stock', 'stockout', 'expiry', 'wastage', 'demand', 'sales', 'menu', 'margins', 'basket', 'festival', 'sports'],
  no_immediate_risk: ['stock', 'stockout', 'expiry', 'wastage', 'demand', 'sales', 'menu', 'margins', 'basket', 'festival', 'sports'],
};

const ACTION_SUPPORT: Record<InventoryActionType, InventoryCapability[]> = {
  reorder: ['stock', 'stockout', 'demand', 'sales', 'menu', 'margins', 'basket', 'festival', 'sports'],
  review_expiry: ['expiry'],
  reduce_wastage: ['wastage'],
  monitor: ['stock', 'stockout', 'expiry', 'wastage', 'demand', 'sales', 'menu', 'margins', 'basket', 'festival', 'sports'],
};

/**
 * D8: the authoritative severity for an item/type, taken ONLY from the
 * deterministic rows. The model can raise urgency but can never downgrade a
 * critical/high finding to low/normal.
 */
export function authoritativeSeverity(
  type: string,
  itemName: string | undefined,
  itemId: string | undefined,
  det: InventoryAgentResult,
): InventoryPriority | undefined {
  if (type === 'data_unavailable' || type === 'no_immediate_risk') return 'normal';
  const name = itemName?.trim().toLocaleLowerCase();
  const id = itemId?.trim();
  const matches = (candidate: string) => {
    const c = candidate.trim().toLocaleLowerCase();
    return (name && c === name) || (id && c === id);
  };
  const purchase = det.purchaseRecommendations.find((r) => matches(r.item));
  if (purchase) return purchase.urgency === 'high' ? 'high' : 'medium';
  const stockout = det.stockoutPredictions.find((s) => matches(s.item));
  if (stockout) return stockout.severity === 'critical' ? 'critical' : 'high';
  const expiry = det.expiryRisks.find((e) => matches(e.itemName));
  if (expiry) return expiry.severity === 'critical' ? 'critical' : 'high';
  return undefined;
}

/** Row identity used to match a model row against its deterministic twin. */
function rowKey(kind: 'i' | 'r', type: string, itemName?: string, itemId?: string): string {
  return `${kind}:${type}::${(itemName || itemId || '').trim().toLocaleLowerCase()}`;
}

const INFORMATIONAL_TYPES = new Set(['data_unavailable', 'no_immediate_risk']);

/**
 * D8 — the single severity rule:
 *   informational rows          → normal (authoritative)
 *   authoritative row exists    → max(model, authoritative)  (never downgrades)
 *   no authoritative row        → max(model, medium)         (conservative floor)
 * The model can raise urgency; it can never turn critical/high into low.
 */
export function floorSeverity(
  model: InventoryPriority,
  type: string,
  itemName?: string,
  itemId?: string,
  det?: InventoryAgentResult,
): InventoryPriority {
  if (INFORMATIONAL_TYPES.has(type)) return 'normal';
  if (!det) return maxPriority(model, 'medium');
  const auth = authoritativeSeverity(type, itemName, itemId, det);
  return auth ? maxPriority(model, auth) : maxPriority(model, 'medium');
}

/**
 * Validate the model's synthesis against deterministic evidence. Returns the
 * validated pieces and the reason when anything was dropped/replaced.
 *
 * D1  an all-clear about an unavailable source is removed/neutralized
 * D2  deterministic rows can never be hidden by an empty model list
 * D3  numbers are grounded in the EVIDENCE (not just the risk rows)
 * D7  a ref must name a tool whose capability supports the claim
 * D8  severity is floored at the authoritative severity
 */
function validateSynthesis(
  raw: z.infer<typeof synthesisSchema>,
  toolsUsed: string[],
  det: InventoryAgentResult,
  evidence: InventoryAgentEvidence,
  contextFacts?: ContextFacts,
): {
  assessment: { title: string; summary: string; priority: InventoryPriority };
  issues: InventoryIssue[];
  recommendations: InventoryAgentRecommendation[];
  confidence: number;
  rejected: string[];
} {
  const allowed = allowedNumbersFromEvidence(det, evidence, contextFacts);
  const available = availableInventoryCapabilities(evidence, contextFacts);
  const toolSet = new Set(toolsUsed);
  const rejected: string[] = [];

  /** D1: strip an all-clear the evidence cannot support (ground first). */
  const safeText = (text: string, fallback: string): string =>
    neutralizeUnsupportedAllClear(groundText(text, allowed, fallback), available).text;

  /**
   * Traceability, not gatekeeping: a ref the model got wrong is REPAIRED to a
   * tool that actually ran AND supports the claim (recorded in `rejected`),
   * instead of silently dropping a real finding. A row with no refs at all is
   * dropped; a claim whose capability was never investigated is dropped too.
   */
  const repairRefs = (refs: string[] | undefined, label: string, supportCaps?: InventoryCapability[]): string[] => {
    if (!refs || refs.length === 0) {
      rejected.push(`${label}:missing_evidence_ref`);
      return [];
    }
    const ranRefs = refs.filter((r) => toolSet.has(r));
    const misCited = refs.filter((r) => !toolSet.has(r));
    if (misCited.length > 0) rejected.push(`${label}:ref_repaired:${misCited.join('|')}`);

    let supportTools: Set<string> | undefined;
    if (supportCaps) {
      const supported = new Set(supportCaps.map((c) => CAPABILITY_TOOL[c]).filter((t) => toolSet.has(t)));
      if (supported.size === 0) {
        // D1/D7: the capability this claim is about was never investigated.
        rejected.push(`${label}:source_not_investigated`);
        return [];
      }
      supportTools = supported;
      const supporting = ranRefs.filter((r) => supported.has(r));
      if (supporting.length > 0) {
        if (supporting.length !== ranRefs.length) rejected.push(`${label}:non_supporting_ref_dropped`);
        return supporting;
      }
      // Every ran ref is on the wrong capability: repair to a supporting tool
      // (the capability IS evidenced in this run) rather than dropping the row.
      rejected.push(`${label}:evidence_does_not_support_claim`);
      return [...supportTools];
    }

    if (ranRefs.length === 0) {
      rejected.push(`${label}:no_evidence_ran`);
      return [];
    }
    return ranRefs;
  };

  const issues: InventoryIssue[] = [];
  for (const issue of raw.issues ?? []) {
    const refs = repairRefs(issue.evidenceRefs, `issue:${issue.type}`, ISSUE_SUPPORT[issue.type]);
    if (refs.length === 0) continue;
    const fallback = issue.itemName ? `${issue.itemName}: ${issue.type.replace(/_/g, ' ')}.` : issue.type.replace(/_/g, ' ');
    // D8: never below the authoritative severity; unknown rows stay conservative.
    const severity = floorSeverity(normalizePriority(issue.severity), issue.type, issue.itemName, issue.itemId, det);
    issues.push({
      type: issue.type,
      itemId: issue.itemId,
      itemName: issue.itemName,
      severity,
      evidenceRefs: refs,
      explanation: safeText(issue.explanation, fallback),
    });
  }

  const recommendations: InventoryAgentRecommendation[] = [];
  for (const rec of raw.recommendations ?? []) {
    const actionType = normalizeActionType(rec.actionType);
    const refs = repairRefs(rec.evidenceRefs, `recommendation:${actionType}`, ACTION_SUPPORT[actionType]);
    if (refs.length === 0) continue;
    const authoritative = authoritativeFor(rec.itemName, rec.itemId, det);
    if (!authoritative) {
      // The model named something the deterministic layer has no row for —
      // that claim cannot be presented with authoritative values.
      rejected.push(`recommendation:${actionType}:no_authoritative_row`);
      continue;
    }
    recommendations.push({
      actionType,
      itemId: rec.itemId,
      itemName: rec.itemName,
      rationale: safeText(rec.rationale, 'Review this item against the inventory evidence.'),
      evidenceRefs: refs,
      requiresApproval: true,
      authoritative,
    });
  }

  const priority = maxPriority(normalizePriority(raw.assessment.priority), deterministicPriority(det));
  const assessment = {
    title: safeText(raw.assessment.title, 'Inventory situation'),
    summary: safeText(raw.assessment.summary, det.summary),
    priority,
  };

  // ── D2: deterministic coverage floor ────────────────────────────────────
  // The model controls ordering and wording; it can NOT hide an authoritative
  // row by omitting it. Every deterministic row the run gathered that the
  // model did not represent is appended (LLM rows stay first), and the merge
  // is recorded as `synthesisCoverage`.
  const detIssues = deterministicIssues(det, toolsUsed);
  const detRecs = deterministicRecommendations(det, toolsUsed);
  const detIssueRows = detIssues.filter((i) => !INFORMATIONAL_TYPES.has(i.type));
  const issueKeys = new Set(issues.map((i) => rowKey('i', i.type, i.itemName, i.itemId)));
  const extraIssues = detIssueRows.filter((i) => !issueKeys.has(rowKey('i', i.type, i.itemName, i.itemId)));
  const recKeys = new Set(recommendations.map((r) => rowKey('r', r.actionType, r.itemName, r.itemId)));
  const extraRecs = detRecs.filter((r) => !recKeys.has(rowKey('r', r.actionType, r.itemName, r.itemId)));

  const mergedIssues = [...issues, ...extraIssues];
  const mergedRecommendations = [...recommendations, ...extraRecs];
  if (extraIssues.length > 0 || extraRecs.length > 0) {
    rejected.push(
      `synthesisCoverage:authoritative=${detIssueRows.length + detRecs.length},llm=${issues.length + recommendations.length},` +
        `final=${Math.min(mergedIssues.length, 8) + Math.min(mergedRecommendations.length, 6)},supplemented=${extraIssues.length + extraRecs.length}`,
    );
  }

  // Owner-facing caps (the schema tolerates more so a long list never voids
  // the whole synthesis); anything beyond the cap is recorded, not hidden.
  const cappedIssues = mergedIssues.slice(0, 8);
  if (mergedIssues.length > cappedIssues.length) rejected.push(`issues:truncated:${mergedIssues.length}`);
  const cappedRecommendations = mergedRecommendations.slice(0, 6);
  if (mergedRecommendations.length > cappedRecommendations.length) rejected.push(`recommendations:truncated:${mergedRecommendations.length}`);

  const complete = cappedIssues.length > 0 && cappedRecommendations.length > 0;
  return {
    assessment,
    issues: cappedIssues,
    recommendations: cappedRecommendations,
    confidence: toUnitConfidence(raw.confidence, complete ? 0.6 : 0.4),
    rejected,
  };
}

/**
 * Run the inventory investigation. NEVER throws: any failure degrades to the
 * existing deterministic agent result with explicit `degraded` metadata.
 */
export async function runInventoryAgentic(
  ctx: { tenant: AiTenantContext },
  options: InventoryAgenticOptions = {},
): Promise<InventoryAgenticResult> {
  const task = normalizeTask(options.task);
  const toolCtx: ToolContext = { tenant: ctx.tenant };

  /**
   * Deterministic fallback. When a loop ran, its investigation metadata is
   * preserved (status, steps, tool calls, POLICY/BUDGET REJECTIONS) so the
   * fallback is still auditable — a refused write tool must remain visible.
   */
  const finishFallback = async (reason: string, run?: Readonly<{ runId: string; status: string; budget: { stepsUsed: number; toolCallsUsed: number }; llm: { calls: number }; toolCalls: ReadonlyArray<{ tool: string; ok: boolean; durationMs: number; deduped?: boolean }>; rejections: ReadonlyArray<{ ref: string; stage: string }> }>): Promise<InventoryAgenticResult> => {
    const det = await runInventoryAgent(toolCtx);
    return {
      ...det,
      mode: 'deterministic_fallback',
      task,
      assessment: deterministicAssessment(task, det),
      issues: deterministicIssues(det, DETERMINISTIC_TOOLS),
      recommendations: deterministicRecommendations(det, DETERMINISTIC_TOOLS),
      confidence: det.status === 'insufficient_data' ? 0 : 0.5,
      // The deterministic agent really did run all four read-only tools, so the
      // fallback's evidence refs are truthful (never an empty/unsupported set).
      toolsUsed: DETERMINISTIC_TOOLS,
      investigation: {
        runId: run?.runId ?? 'deterministic',
        requestId: options.requestId ?? 'deterministic',
        status: run?.status ?? 'deterministic_fallback',
        stepsUsed: run?.budget.stepsUsed ?? 0,
        toolCallsUsed: run?.budget.toolCallsUsed ?? 0,
        llmCalls: run?.llm.calls ?? 0,
        toolNames: run?.toolCalls.map((t) => t.tool) ?? [],
        steps: run?.toolCalls.map((t) => ({
          tool: t.tool,
          ok: t.ok,
          purpose: TOOL_PURPOSE[t.tool] ?? 'Inspect inventory evidence',
          durationMs: t.durationMs,
        })) ?? [],
        dedupedCalls: run?.toolCalls.filter((t) => t.deduped).length ?? 0,
        rejections: run?.rejections.map((r) => ({ ref: r.ref, stage: r.stage })) ?? [],
        degraded: true,
      },
      // The deterministic agent ran its four read-only tools; their data
      // availability is exactly det.evidenceSources.
      toolAvailability: {
        getInventoryStatus: det.evidenceSources.inventory,
        getStockoutRisk: det.evidenceSources.demandForecast,
        getExpiryRisk: det.evidenceSources.expiry,
        getWastage: det.evidenceSources.wastage,
      },
      degraded: true,
      degradedReason: reason,
    };
  };

  if (options.disableLlm) return finishFallback('llm_disabled');

  const run = await runBoundedAgentLoop({
    policy: inventoryAgentPolicy as never,
    rolePrompt: INVENTORY_AGENT_ROLE_PROMPT,
    promptVersion: INVENTORY_AGENT_PROMPT_VERSION,
    objective: task,
    tenant: ctx.tenant,
    budget: { ...INVENTORY_AGENT_BUDGET, ...options.loopBudget },
    requestId: options.requestId,
    llm: options.llm,
    loadMemory: noInventoryMemory,
    captureToolData: true,
    stopGuard: inventoryBaselineStopGuard,
    // D6: a repeated identical read-only call is served from the run's own
    // cache instead of being executed again — still bounded by the budget.
    dedupeIdenticalTools: true,
  });

  const generatedAt = new Date().toISOString();
  const { evidence, toolsUsed, contextFacts } = evidenceFromToolData(run.toolData, generatedAt);
  /** Per-tool data availability from the tools' OWN contract (UI chip honesty). */
  const toolAvailability: Record<string, boolean> = {
    getInventoryStatus: evidence.inventory.available,
    getStockoutRisk: evidence.stockout.available,
    getExpiryRisk: evidence.expiry.available,
    getWastage: evidence.wastage.available,
  };
  for (const [tool, fact] of Object.entries(contextFacts)) {
    if (fact) toolAvailability[tool] = fact.available;
  }
  // D5: a loop that failed AFTER capturing evidence must not report success.
  const loopFailed = run.status === 'failed' || run.status === 'llm_unavailable';
  const investigation = {
    runId: run.runId,
    requestId: run.requestId,
    status: run.status,
    stepsUsed: run.budget.stepsUsed,
    toolCallsUsed: run.budget.toolCallsUsed,
    llmCalls: run.llm.calls,
    toolNames: run.toolCalls.map((t) => t.tool),
    steps: run.toolCalls.map((t) => ({
      tool: t.tool,
      ok: t.ok,
      purpose: TOOL_PURPOSE[t.tool] ?? 'Inspect inventory evidence',
      durationMs: t.durationMs,
    })),
    dedupedCalls: run.toolCalls.filter((t) => t.deduped).length,
    rejections: run.rejections.map((r) => ({ ref: r.ref, stage: r.stage })),
    degraded: loopFailed,
  };

  // No tool evidence at all → the deterministic agent must supply the facts.
  if (toolsUsed.length === 0) {
    return finishFallback(
      run.status === 'failed' || run.status === 'llm_unavailable' ? `llm_${run.status}` : 'no_tool_evidence',
      run,
    );
  }

  // ── Deterministic analysis of the exact observations ──────────────────────
  const det = buildInventoryAgentResult(evidence);

  // ── Synthesis (one bounded call) ──────────────────────────────────────────
  const synth = options.synthesisLlm ?? ((req: LlmJsonRequest) => generateJsonWithMeta(req));
  const synthesisRequest: LlmJsonRequest = {
    system: synthesisSystemPrompt(toolsUsed),
    prompt: `Owner task: ${task}\n\nFACTS (the only allowed source of numbers):\n${JSON.stringify(synthesisFacts(task, det, evidence, toolsUsed, contextFacts))}`,
    schemaHint: SYNTHESIS_SCHEMA_HINT,
    timeoutMs: 12_000,
  };

  /**
   * D4: the synthesis call is an LLM call and must be observable EXACTLY like
   * the planning calls — one AIUsageLog row per attempt (privacy: hashed
   * prompt only, never the prompt text). Reconciles planning + synthesis.
   */
  const logSynthesis = async (
    ok: boolean,
    result?: LlmJsonResult<unknown>,
    failure?: { kind?: string; message?: string },
  ): Promise<void> => {
    await recordLlmUsage({
      restaurantId: ctx.tenant.restaurantId,
      requestId: run.runId,
      promptVersion: `${INVENTORY_AGENT_PROMPT_VERSION}-synthesis`,
      feature: inventoryAgentPolicy.agent,
      promptText: `${synthesisRequest.system}\n${synthesisRequest.prompt}`,
      model: result?.model ?? '',
      provider: result?.provider ?? '',
      latencyMs: result?.latencyMs ?? 0,
      inputTokens: result?.usage?.inputTokens ?? 0,
      outputTokens: result?.usage?.outputTokens ?? 0,
      totalTokens: result?.usage?.totalTokens ?? 0,
      success: ok,
      errorType: ok ? null : failure?.kind ?? 'http_error',
      fallbackReason: ok ? null : (failure?.message ?? '').slice(0, 300),
    });
  };

  let validated: ReturnType<typeof validateSynthesis> | null = null;
  let degradedReason: string | undefined;
  try {
    let result: LlmJsonResult<unknown>;
    try {
      result = await synth(synthesisRequest);
    } catch (firstErr) {
      // Same bounded contract as the loop: a provider JSON-validation 400 is a
      // transient generation failure, so exactly ONE retry is allowed.
      if (!isRetryableJsonFailure(firstErr)) throw firstErr;
      await logSynthesis(false, undefined, {
        kind: firstErr instanceof LlmError ? firstErr.kind : 'http_error',
        message: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });
      result = await synth(synthesisRequest);
    }
    await logSynthesis(true, result);
    const parsed = synthesisSchema.safeParse(result.value);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.join('.') || 'root';
      degradedReason = `synthesis_invalid_schema:${where}:${first?.code ?? 'invalid'}`;
    } else {
      validated = validateSynthesis(parsed.data, toolsUsed, det, evidence, contextFacts);
      if (validated.rejected.length > 0) degradedReason = `synthesis_partially_rejected:${validated.rejected.join(',')}`;
    }
  } catch (err) {
    degradedReason =
      err instanceof LlmError
        ? `synthesis_${err.kind}${err.httpStatus ? `:${err.httpStatus}` : ''}`
        : 'synthesis_failed';
    await logSynthesis(false, undefined, {
      kind: err instanceof LlmError ? err.kind : 'http_error',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── D5: partial evidence + a failed loop is NEVER reported as full success.
  const degraded = validated === null || loopFailed;
  const reason = loopFailed
    ? degradedReason
      ? `agent_loop_failed_after_evidence:${degradedReason}`
      : 'agent_loop_failed_after_evidence'
    : degradedReason;
  return {
    ...det,
    mode: 'agentic',
    task,
    assessment: validated ? validated.assessment : deterministicAssessment(task, det),
    issues: validated ? validated.issues : deterministicIssues(det, toolsUsed),
    recommendations: validated ? validated.recommendations : deterministicRecommendations(det, toolsUsed),
    confidence: validated
      ? validated.confidence
      : Math.min(0.5, toUnitConfidence(det.status === 'insufficient_data' ? 0 : 0.5, 0.4)),
    toolsUsed,
    toolAvailability,
    investigation,
    degraded,
    degradedReason: reason,
  };
}

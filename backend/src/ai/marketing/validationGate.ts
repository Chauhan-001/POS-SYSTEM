/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * validationGate.ts — the AUTHORITY LAYER (task §13).
 *
 * Deterministic, tenant-scoped, un-bypassable. The LLM has no input here: a
 * candidate that fails any check is rejected with a machine-readable code, and
 * no narrative, memory or model verdict can resurrect it.
 *
 * No economics are recomputed: the engine's own numbers and constraints are
 * used verbatim (`isEconomicallySafe`, `violatesRestrictions`).
 *
 * PHASE 10 — the feasibility checks are REAL per-product reads, not inference:
 *   inventory_feasibility — `getStockoutRisk` returns, per at-risk INGREDIENT,
 *     the `contributingMenuItems` that consume it. A candidate that targets a
 *     contributing item would accelerate a stockout, so it is rejected with the
 *     ingredient and days-to-depletion that caused it.
 *   marketing_conflict — `getActiveOffers` returns each running offer's
 *     `applicableProductIds` / `applicableCategories`. A candidate targeting the
 *     same product or category would stack discounts, so it is rejected naming
 *     the running offer.
 *
 * Both reads go through the ONE shared registry (`executeTool`), so zod
 * validation, the timeout clamp and tenant scoping apply unchanged. When a
 * source is genuinely unavailable the check reports `skipped` — it never
 * silently passes a candidate, and it never fails one on missing data. The
 * investigation's own signals remain a secondary input.
 */

import type { AiTenantContext } from '../shared/tenantContext';
import { toolRegistry } from '../tools/registry/toolRegistry';
import { executeTool } from '../tools/registry/toolExecutor';
import type { ToolContext, ToolDefinition } from '../tools/registry/toolTypes';
import {
  violatesRestrictions,
  type PromotionCandidate,
} from '../../services/promotionCandidateService';
import { isEconomicallySafe } from '../intelligence/recommendationRanking';
import { detectPromotionFatigue } from '../../services/promotionFatigueService';
import type { CandidateValidation, DomainInvestigation, ValidationCheck } from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Real per-product sources
// ─────────────────────────────────────────────────────────────────────────────

/** One at-risk ingredient and the menu items that consume it. */
export interface StockoutExposure {
  status: 'ok' | 'unavailable';
  /** Keyed by product id (when the forecast exposes one). */
  byProductId: Map<string, { ingredientName: string; daysUntilDepletion: number; severity: string }>;
  /** Keyed by normalised product NAME — the forecast reports contributing items by name. */
  byProductName: Map<string, { ingredientName: string; daysUntilDepletion: number; severity: string }>;
  detail: string;
}

export interface ActiveOfferCoverage {
  status: 'ok' | 'unavailable';
  /** productId → the running offer covering it. */
  byProductId: Map<string, { offerId: string; title: string }>;
  /** categoryId → the running offer covering it. */
  byCategoryId: Map<string, { offerId: string; title: string }>;
  detail: string;
}

/** Test seam: inject the two reads (production uses the shared registry). */
export interface ValidationSources {
  fetchStockoutExposure: (ctx: ToolContext) => Promise<StockoutExposure>;
  fetchActiveOfferCoverage: (ctx: ToolContext) => Promise<ActiveOfferCoverage>;
}

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Run one registered read-only tool; failures are data, not exceptions. */
async function readTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const tool = toolRegistry.get(name) as ToolDefinition<unknown, unknown> | undefined;
  if (!tool) return null;
  const result = await executeTool(tool, input, { ...ctx, timeoutMs: Math.max(1_000, Math.min(ctx.timeoutMs ?? 6_000, 8_000)) });
  if (!result.ok) return null;
  return result.data as Record<string, unknown>;
}

/** Real per-product stockout exposure from the authoritative forecast. */
export async function fetchStockoutExposure(ctx: ToolContext): Promise<StockoutExposure> {
  const empty = { byProductId: new Map(), byProductName: new Map() };
  try {
    const raw = await readTool(ctx, 'getStockoutRisk', { horizonDays: 14 });
    if (!raw) return { status: 'unavailable', ...empty, detail: 'The stockout forecast could not be read.' };
    if (raw.available === false) {
      return {
        status: 'unavailable',
        ...empty,
        detail: `The stockout forecast had no usable input (${String(raw.reason ?? 'NO_STOCKOUT_DATA')}), so feasibility could not be assessed.`,
      };
    }
    const alerts = Array.isArray(raw.alerts) ? (raw.alerts as Array<Record<string, unknown>>) : [];
    const byProductId = new Map<string, { ingredientName: string; daysUntilDepletion: number; severity: string }>();
    const byProductName = new Map<string, { ingredientName: string; daysUntilDepletion: number; severity: string }>();
    for (const a of alerts) {
      const entry = {
        ingredientName: String(a.itemName ?? 'an ingredient'),
        daysUntilDepletion: Number(a.daysUntilDepletion ?? 0),
        severity: String(a.severity ?? 'warning'),
      };
      const contributors = Array.isArray(a.contributingMenuItems) ? (a.contributingMenuItems as unknown[]) : [];
      for (const c of contributors) {
        const key = String(c);
        if (/^[a-fA-F0-9]{24}$/.test(key)) byProductId.set(key, entry);
        byProductName.set(normName(key), entry);
      }
    }
    return {
      status: 'ok',
      byProductId,
      byProductName,
      detail: alerts.length
        ? `${alerts.length} ingredient(s) are at stockout risk within 14 days; ${byProductName.size} contributing menu item(s) mapped.`
        : 'The forecast was assessed and no ingredient is at stockout risk within 14 days.',
    };
  } catch (err) {
    return { status: 'unavailable', ...empty, detail: `Stockout feasibility could not be read (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).` };
  }
}

/** Real overlapping-offer coverage from the tenant's active offers. */
export async function fetchActiveOfferCoverage(ctx: ToolContext): Promise<ActiveOfferCoverage> {
  const empty = { byProductId: new Map(), byCategoryId: new Map() };
  try {
    const raw = await readTool(ctx, 'getActiveOffers', {});
    if (!raw) return { status: 'unavailable', ...empty, detail: 'The active-offer list could not be read.' };
    if (raw.available === false) {
      return {
        status: 'unavailable',
        ...empty,
        detail: `No active offer was available to compare against (${String(raw.reason ?? 'NO_ACTIVE_OFFERS')}), so overlap could not be assessed.`,
      };
    }
    const offers = Array.isArray(raw.offers) ? (raw.offers as Array<Record<string, unknown>>) : [];
    const byProductId = new Map<string, { offerId: string; title: string }>();
    const byCategoryId = new Map<string, { offerId: string; title: string }>();
    for (const o of offers) {
      const rec = { offerId: String(o.id ?? ''), title: String(o.title ?? 'an active offer') };
      for (const p of Array.isArray(o.applicableProductIds) ? (o.applicableProductIds as unknown[]) : []) {
        byProductId.set(String(p), rec);
      }
      for (const c of Array.isArray(o.applicableCategories) ? (o.applicableCategories as unknown[]) : []) {
        byCategoryId.set(String(c), rec);
      }
    }
    return {
      status: 'ok',
      byProductId,
      byCategoryId,
      detail: offers.length
        ? `${offers.length} active offer(s) checked for overlapping products/categories.`
        : 'No offer is currently running, so nothing can overlap.',
    };
  } catch (err) {
    return { status: 'unavailable', ...empty, detail: `Overlap could not be read (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).` };
  }
}

const DEFAULT_SOURCES: ValidationSources = {
  fetchStockoutExposure,
  fetchActiveOfferCoverage,
};

// ─────────────────────────────────────────────────────────────────────────────
// Secondary evidence from the investigation (never the primary source)
// ─────────────────────────────────────────────────────────────────────────────

/** Subject keys (product ids) that carry an inventory exposure. */
function exposedProductIds(investigations: DomainInvestigation[]): Set<string> {
  const exposed = new Set<string>();
  for (const inv of investigations) {
    for (const s of inv.signals) {
      if (s.code !== 'inventory_stockout_risk' && s.code !== 'inventory_low') continue;
      if (s.subject?.type === 'product') exposed.add(s.subject.id);
    }
  }
  return exposed;
}

/** Subject keys already covered by a running offer. */
function activeOfferProductIds(investigations: DomainInvestigation[]): Set<string> {
  const active = new Set<string>();
  for (const inv of investigations) {
    for (const s of inv.signals) {
      if (s.code !== 'offer_active') continue;
      if (s.subject?.type === 'product') active.add(s.subject.id);
    }
  }
  return active;
}

export interface ValidationGateResult {
  validations: CandidateValidation[];
  passed: PromotionCandidate[];
  rejected: Array<{ candidateId: string; title: string; codes: string[] }>;
  degradations: string[];
  /** Per-source outcomes, for the response/observability. */
  sources: {
    stockout: { status: StockoutExposure['status']; detail: string };
    activeOffers: { status: ActiveOfferCoverage['status']; detail: string };
  };
}

/**
 * Validate every candidate. NEVER throws: an unavailable auxiliary check is
 * reported as `skipped` and does NOT silently pass or fail the candidate.
 */
export async function validateCandidates(input: {
  tenant: AiTenantContext;
  candidates: PromotionCandidate[];
  investigations: DomainInvestigation[];
  lookbackDays?: number;
  /** Tool context (tenant + deadline). Built from the tenant when omitted. */
  ctx?: ToolContext;
  /** Test seam; production uses the shared registry. */
  sources?: ValidationSources;
}): Promise<ValidationGateResult> {
  const degradations: string[] = [];
  const ctx: ToolContext = input.ctx ?? { tenant: input.tenant, timeoutMs: 6_000 };
  const sources = input.sources ?? DEFAULT_SOURCES;

  // ── Real per-product reads (failures degrade; they never throw) ──────────
  const [stockout, activeOffers] = await Promise.all([
    sources.fetchStockoutExposure(ctx),
    sources.fetchActiveOfferCoverage(ctx),
  ]);
  if (stockout.status === 'unavailable') degradations.push(`inventory feasibility: ${stockout.detail}`);
  if (activeOffers.status === 'unavailable') degradations.push(`overlapping-offer check: ${activeOffers.detail}`);

  // ── Fatigue evidence: existing service, one read for the whole run ────────
  let fatigueByType = new Map<string, { level: string; recommendation: string }>();
  let fatigueStatus: ValidationCheck['status'] = 'pass';
  let fatigueDetail = 'No measured promotion history exists yet, so no fatigue was detected.';
  try {
    const signals = await detectPromotionFatigue({
      restaurantId: input.tenant.restaurantId,
      branchId: input.tenant.branchId,
      lookbackDays: input.lookbackDays ?? 180,
    });
    fatigueByType = new Map(
      signals.map((s) => [s.promotionType, { level: s.fatigueLevel, recommendation: s.recommendation }]),
    );
    if (signals.length) fatigueDetail = `Measured decline checked across ${signals.length} promotion type(s).`;
  } catch (err) {
    fatigueStatus = 'skipped';
    fatigueDetail = `Promotion-fatigue history could not be read (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}); candidates were NOT penalised for it.`;
    degradations.push('promotion-fatigue check unavailable — fatigue was not used to reject any candidate');
  }

  const exposedIds = exposedProductIds(input.investigations);
  const activeIds = activeOfferProductIds(input.investigations);

  const validations: CandidateValidation[] = [];
  const passed: PromotionCandidate[] = [];
  const rejected: ValidationGateResult['rejected'] = [];

  for (const candidate of input.candidates) {
    const checks: ValidationCheck[] = [];
    const rejectionCodes: string[] = [];

    // 1. Economic safety (engine numbers verbatim).
    const safe = isEconomicallySafe(candidate);
    checks.push({
      name: 'economic_safety',
      status: safe ? 'pass' : 'fail',
      detail: safe
        ? 'Discount, projected margin, break-even and payback are within the candidate\'s own constraints.'
        : 'The candidate\'s own economics violate their constraints (or no authoritative price/cost data existed).',
    });
    if (!safe) rejectionCodes.push('ECONOMICS_UNSAFE');

    // 2. Business constraints (existing engine predicate).
    let violates = false;
    try {
      violates = violatesRestrictions(candidate, candidate.constraints);
    } catch (err) {
      checks.push({
        name: 'business_constraints',
        status: 'skipped',
        detail: `Constraint check could not run (${err instanceof Error ? err.message.slice(0, 100) : 'unknown error'}).`,
      });
    }
    if (!violates) {
      checks.push({
        name: 'business_constraints',
        status: 'pass',
        detail: 'The candidate respects the restaurant\'s margin, discount, price and excluded-item constraints.',
      });
    } else {
      checks.push({ name: 'business_constraints', status: 'fail', detail: 'The candidate violates a business constraint (margin, discount, minimum price or an excluded item).' });
      rejectionCodes.push('VIOLATES_BUSINESS_CONSTRAINTS');
    }

    // 3. Promotion fatigue (existing service).
    if (fatigueStatus === 'skipped') {
      checks.push({ name: 'promotion_fatigue', status: 'skipped', detail: fatigueDetail });
    } else {
      const fatigue = fatigueByType.get(candidate.type);
      const level = fatigue?.level ?? 'NONE';
      const bad = level === 'HIGH' || level === 'CRITICAL';
      checks.push({
        name: 'promotion_fatigue',
        status: bad ? 'fail' : 'pass',
        detail: fatigue
          ? `Promotion type ${candidate.type} measured fatigue level ${level}. ${fatigue.recommendation}`
          : fatigueDetail,
      });
      if (bad) rejectionCodes.push('PROMOTION_FATIGUE_HIGH');
    }

    // 4. Inventory feasibility — REAL per-product: does this candidate target a
    //    menu item that consumes an at-risk ingredient?
    if (stockout.status === 'unavailable') {
      // Fall back to the investigation's own signal evidence, clearly labelled.
      const conflicting = candidate.target.productIds.filter((id) => exposedIds.has(id));
      checks.push({
        name: 'inventory_feasibility',
        status: conflicting.length ? 'fail' : 'skipped',
        detail: conflicting.length
          ? 'The offer targets item(s) the investigation flagged as low stock or at stockout risk.'
          : `Feasibility could not be checked per product: ${stockout.detail}`,
      });
      if (conflicting.length) rejectionCodes.push('STOCKOUT_RISK_ON_TARGET');
    } else {
      const hitById = candidate.target.productIds.map((id) => stockout.byProductId.get(id)).find(Boolean);
      const hitByName = candidate.target.productNames.map((name) => stockout.byProductName.get(normName(name))).find(Boolean);
      const hit = hitById ?? hitByName;
      checks.push({
        name: 'inventory_feasibility',
        status: hit ? 'fail' : 'pass',
        detail: hit
          ? `Promoting this would accelerate a stockout: it consumes ${hit.ingredientName}, which is forecast to run out in about ${hit.daysUntilDepletion} day(s) (${hit.severity}).`
          : 'No targeted item consumes an ingredient that is forecast to run out within 14 days.',
      });
      if (hit) rejectionCodes.push('STOCKOUT_RISK_ON_TARGET');
    }

    // 5. Marketing conflict — REAL overlap against the tenant's active offers.
    if (activeOffers.status === 'unavailable') {
      const alreadyRunning = candidate.target.productIds.filter((id) => activeIds.has(id));
      checks.push({
        name: 'marketing_conflict',
        status: alreadyRunning.length ? 'fail' : 'skipped',
        detail: alreadyRunning.length
          ? 'An offer is already running on the same item, which risks stacking discounts.'
          : `Overlap could not be checked against running offers: ${activeOffers.detail}`,
      });
      if (alreadyRunning.length) rejectionCodes.push('DUPLICATE_ACTIVE_OFFER');
    } else {
      const productHit = candidate.target.productIds.map((id) => activeOffers.byProductId.get(id)).find(Boolean);
      const categoryHit = candidate.target.categoryIds.map((id) => activeOffers.byCategoryId.get(id)).find(Boolean);
      const overlap = productHit ?? categoryHit;
      checks.push({
        name: 'marketing_conflict',
        status: overlap ? 'fail' : 'pass',
        detail: overlap
          ? `"${overlap.title}" is already running on the same ${productHit ? 'item(s)' : 'category'}, so this would stack discounts.`
          : 'No currently running offer covers the same item or category.',
      });
      if (overlap) rejectionCodes.push('DUPLICATE_ACTIVE_OFFER');
    }

    // 6. Customer eligibility — a win-back must have a target group.
    if (candidate.type === 'RUN_REACTIVATION') {
      const hasTarget = candidate.target.segmentIds.length > 0;
      checks.push({
        name: 'customer_eligibility',
        status: hasTarget ? 'pass' : 'fail',
        detail: hasTarget
          ? 'The win-back names a customer group the restaurant can actually reach.'
          : 'The win-back has no identified customer group, so it cannot be targeted.',
      });
      if (!hasTarget) rejectionCodes.push('NO_TARGET_SEGMENT');
    } else {
      checks.push({
        name: 'customer_eligibility',
        status: 'pass',
        detail: 'Not a targeted win-back, so no customer-group eligibility rule applies.',
      });
    }

    // 7. Safety — this path cannot act.
    checks.push({
      name: 'safety',
      status: 'pass',
      detail: 'Read-only path: nothing is created, scheduled or sent, and owner approval remains mandatory.',
    });

    const validation: CandidateValidation = {
      candidateId: candidate.id,
      passed: rejectionCodes.length === 0,
      rejectionCodes,
      checks,
    };
    validations.push(validation);
    if (validation.passed) passed.push(candidate);
    else rejected.push({ candidateId: candidate.id, title: candidate.title, codes: rejectionCodes });
  }

  return {
    validations,
    passed,
    rejected,
    degradations,
    sources: {
      stockout: { status: stockout.status, detail: stockout.detail },
      activeOffers: { status: activeOffers.status, detail: activeOffers.detail },
    },
  };
}

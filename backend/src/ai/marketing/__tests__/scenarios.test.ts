/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scenarios.test.ts — the Phase 17 scenario matrix.
 *
 * Every scenario is executed through the REAL canonical path (domain
 * capabilities → situation model → candidate engine → deterministic gate →
 * ranking → critic) against an in-memory MongoDB with the LLM stubbed or
 * disabled. No layer is mocked, so what passes here is the code the owner's
 * request actually runs.
 *
 * Two structural rules this file enforces on itself:
 *
 *   1. NO SILENT SKIP — each registered case must make at least one assertion.
 *      A scenario that runs without asserting anything fails, so a case can
 *      never be "covered" by merely existing in the registry.
 *   2. Every assertion is EVIDENCE-GROUNDED or a disclosure/absence check. A
 *      scenario may assert that the system said something honest; it may never
 *      assert a flattering rewrite of the data.
 *
 * MATRIX STATUS: the four honest-negative cases named in the Phase 17
 * acceptance criteria are implemented below (no data, conflicting evidence,
 * missing ML, new restaurant). The remaining scenarios and the 11
 * cross-dimensional combinations are added to `SCENARIO_CASES` — one entry
 * each, with its `specRef` — once the spec's §27 list is supplied. The registry
 * shape is fixed; adding a case is a single object literal.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  startScenarioDb,
  stopScenarioDb,
  resetScenarioDb,
  runScenario,
  digest,
  seedProduct,
  seedOffer,
  seedCampaignHistory,
  TENANT_A,
  TENANT_B,
  disclosureText,
} from './scenarios.harness';
import { buildSituationModel } from '../situationModel';
import type { BusinessSignal } from '../../intelligence/businessSignalTypes';
import type { DomainInvestigation } from '../contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

interface ScenarioCase {
  /** Stable slug — referenced by the matrix doc and by failure output. */
  id: string;
  /** The axis this case exercises (domain x data condition). */
  axis: string;
  /** Spec reference (e.g. `§27.4`); empty until the §27 list is supplied. */
  specRef: string;
  run: () => Promise<void>;
}

/** Minimal real investigation carrying only the signals a case needs. */
function investigation(over: Partial<DomainInvestigation> & Pick<DomainInvestigation, 'domain'>): DomainInvestigation {
  return {
    status: 'ok',
    question: 'scenario question',
    findings: [],
    signals: [],
    evidenceRefs: [],
    implemented: true,
    durationMs: 1,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

function signal(over: Partial<BusinessSignal> & Pick<BusinessSignal, 'signalId' | 'code'>): BusinessSignal {
  return {
    category: 'product',
    source: 'menu_engineering',
    statement: 'scenario statement',
    direction: 'down',
    confidence: 0.8,
    freshness: 'fresh',
    generatedAt: new Date().toISOString(),
    scope: { restaurantId: TENANT_A.restaurantId, branchId: null, scope: 'tenant' },
    // Contradiction detection keys on `subject` (`type:id`), NOT on `scope`
    // (situationModel.ts). Both signals below must name the SAME subject or
    // there is nothing to disagree about.
    subject: { type: 'product', id: 'product-1' },
    evidence: [],
    ...over,
  } as BusinessSignal;
}

const SCENARIO_CASES: ScenarioCase[] = [
  // ── Honest-negative: NEW RESTAURANT (empty database) ──────────────────────
  {
    id: 'new_restaurant_empty_database',
    axis: 'new restaurant x empty database',
    specRef: '',
    run: async () => {
      const r = await runScenario({ goal: 'What should I do first?', lookbackDays: 90 });
      const d = digest(r);

      // Nothing may be invented from an empty database.
      expect(d.recommendations).toBe(0);
      expect(d.rejected).toBe(0);

      // It must never present itself as a clean, healthy analysis.
      expect(d.status).not.toBe('completed');
      expect(d.status).toBe('degraded_no_llm');
      expect(d.degradations.length).toBeGreaterThan(0);

      // The two declared-only capabilities are disclosed, never dropped.
      const text = disclosureText(r);
      expect(text).toContain('feedback');
      expect(text).toContain('competition');

      // Confidence bound DERIVED from the orchestrator's own formula
      // (`0.5 * situation.confidence + 0.5 * mean(recommendation confidences)`):
      // with no recommendations the second term is 0, so a run that found
      // nothing can never report more than 50%.
      expect(d.confidence).toBeLessThanOrEqual(0.5);

      // An empty restaurant must not be flattered as low risk.
      expect(d.risk).not.toBe('low');
    },
  },

  // ── Honest-negative: NO DATA (menu exists, no trading history) ────────────
  {
    id: 'no_trading_history_with_menu',
    axis: 'existing restaurant x menu but no trading history',
    specRef: '',
    run: async () => {
      // A real menu, but nothing has ever been sold through it.
      await seedProduct(TENANT_A.restaurantId, { name: 'Paneer Tikka', price: 320 });
      await seedProduct(TENANT_A.restaurantId, { name: 'Dal Makhani', price: 280 });

      const r = await runScenario({ goal: 'What should I promote?', lookbackDays: 90 });
      const d = digest(r);

      // With no trading history there is no evidence for a promotion.
      expect(d.recommendations).toBe(0);

      // Whatever the deficient areas are, they are enumerated rather than
      // silently treated as fine.
      const text = disclosureText(r);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/no usable evidence|no usable input|declared only|not implemented|stopped early|No .*data/i);

      // The run is still usable and bounded: it completes with honest gaps
      // instead of failing the owner's request outright.
      expect(d.status).not.toBe('failed');
      expect(d.confidence).toBeLessThanOrEqual(0.5);
    },
  },

  // ── Honest-negative: MISSING ML ───────────────────────────────────────────
  {
    id: 'ml_unavailable_disclosed',
    axis: 'ml unavailable x deterministic path intact',
    specRef: '',
    run: async () => {
      const r = await runScenario({ goal: 'Where is my margin leaking?', lookbackDays: 60 });
      const d = digest(r);

      // Every ML source that could not answer is disclosed by name — the run
      // must not quietly imply it had predictions.
      expect(d.degradations).toMatch(/uplift|response|segment|demand|combo|ML/i);

      // A missing prediction source must not break the deterministic path.
      expect(d.status).not.toBe('failed');

      // The run still enumerates its own limits rather than going quiet.
      expect(r.situation.missingEvidence.length + r.degradations.length).toBeGreaterThan(0);

      // And a missing prediction must not inflate confidence: nothing was
      // measured, so the recommendation term of the confidence formula is 0.
      expect(d.confidence).toBeLessThanOrEqual(0.5);
    },
  },

  // ── Honest-negative: CONFLICTING EVIDENCE ─────────────────────────────────
  {
    id: 'conflicting_evidence_surfaced',
    axis: 'two readings of the same subject x disagreement',
    specRef: '',
    run: async () => {
      // (a) Through the REAL situation-model logic with the same signal objects
      // the domain capabilities emit: a subject reported as both rising and
      // falling must be surfaced, not silently resolved.
      const model = buildSituationModel({
        objective: 'Is this dish working?',
        investigations: [
          investigation({
            domain: 'products',
            signals: [signal({ signalId: 'up-1', code: 'product_growing', direction: 'up' })],
          }),
          investigation({
            domain: 'sales',
            signals: [signal({ signalId: 'down-1', code: 'product_slow_moving', direction: 'down' })],
          }),
        ],
      });
      expect(model.contradictions.length).toBeGreaterThan(0);
      expect(model.contradictions.join(' ')).toMatch(/not resolved automatically/i);

      // The disagreement is also reported as risk, not hidden behind confidence.
      expect(model.uncertainties.length + model.contradictions.length).toBeGreaterThan(0);

      // (b) Through the REAL canonical path: when the domains agree, no
      // contradiction may be invented. (Fabricated disagreement is as bad as
      // hidden disagreement — it would push the owner toward a false caution.)
      await seedProduct(TENANT_A.restaurantId, { name: 'Scenario Dish', price: 250 });
      const r = await runScenario({ goal: 'Anything contradictory?', lookbackDays: 60 });
      expect(r.situation.contradictions).toEqual([]);
      expect(r.risk).toBeDefined();
    },
  },

  // ── Cross-dimensional: TENANT ISOLATION ───────────────────────────────────
  {
    id: 'cross_tenant_blindness',
    axis: 'cross-dimensional x tenant isolation',
    specRef: '',
    run: async () => {
      // Tenant B owns the data; tenant A must not be able to see any of it.
      await seedProduct(TENANT_B.restaurantId, { name: 'Tenant B Dish', price: 999 });
      await seedOffer(TENANT_B.restaurantId, { title: 'Tenant B Offer', value: 25 });
      await seedCampaignHistory(TENANT_B.restaurantId, { name: 'Tenant B Campaign' });

      const a = await runScenario({ tenant: TENANT_A, goal: 'What do I have?', lookbackDays: 60 });
      const b = await runScenario({ tenant: TENANT_B, goal: 'What do I have?', lookbackDays: 60 });

      // Tenant A has nothing, so it must not report tenant B's evidence.
      const aText = JSON.stringify(a);
      expect(aText).not.toContain('Tenant B Dish');
      expect(aText).not.toContain('Tenant B Offer');
      expect(aText).not.toContain('Tenant B Campaign');
      expect(aText).not.toContain(TENANT_B.restaurantId);

      // Tenant B's run is a different analysis, not a copy of A's.
      expect(b.runId).not.toBe(a.runId);
      expect(b.objective).toBe(a.objective); // same question, different tenant
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 17 — scenario matrix', () => {
  beforeAll(async () => {
    await startScenarioDb();
  }, 60_000);

  afterAll(async () => {
    await stopScenarioDb();
  });

  beforeEach(async () => {
    await resetScenarioDb();
  });

  it('registers every scenario with a stable id, an axis and a spec slot', () => {
    expect(SCENARIO_CASES.length).toBeGreaterThan(0);
    const ids = SCENARIO_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SCENARIO_CASES) {
      expect(c.id).toMatch(/^[a-z0-9_]+$/);
      expect(c.axis.trim().length).toBeGreaterThan(0);
      expect(typeof c.specRef).toBe('string');
    }
  });

  /**
   * The no-silent-skip guard is only worth anything if `assertionCalls`
   * actually stops increasing when a scenario asserts nothing. If vitest ever
   * changed that behaviour the guard would silently become vacuous and every
   * empty scenario would "pass", so the predicate itself is pinned here.
   */
  it('the no-silent-skip guard is not vacuous', async () => {
    const before = expect.getState().assertionCalls;
    await (async () => {
      /* an assertion-free scenario */
    })();
    const after = expect.getState().assertionCalls;
    // The guard's condition must be FALSE here — i.e. it WOULD fail this case.
    expect(after > before).toBe(false);
  });

  for (const c of SCENARIO_CASES) {
    it(`[${c.axis}] ${c.id}${c.specRef ? ` (${c.specRef})` : ''}`, async () => {
      const before = expect.getState().assertionCalls;
      await c.run();
      // NO SILENT SKIP: a scenario that asserts nothing is a failure.
      expect(expect.getState().assertionCalls).toBeGreaterThan(before);
    }, 90_000);
  }
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlSemantics.test.ts — PHASE 5 acceptance: ML semantics are honest.
 * The load-bearing assertions: response probability is NEVER labelled causal,
 * uplift is causal ONLY with gate-passed evidence, missing services degrade
 * with reasons, and no unsupported causal claim can be produced.
 */

import { describe, it, expect } from 'vitest';
import {
  basketEvidence,
  causalClaim,
  forecastEvidence,
  mlDegradationLines,
  responseEvidence,
  segmentEvidence,
  summarizeMlEvidence,
  upliftEvidence,
} from '../mlSemantics';

describe('1. uplift evidence is causal ONLY when the upstream gate passed', () => {
  it('gate-passed uplift is causal:true', () => {
    const e = upliftEvidence({
      available: true,
      modelId: 'uplift',
      evaluationStatus: 'evaluated',
      freshnessAgeDays: 1,
    });
    expect(e.available).toBe(true);
    expect(e.causal).toBe(true);
  });

  it('gate-failed uplift is NOT causal and keeps the gate reasons', () => {
    const e = upliftEvidence({
      available: false,
      modelId: 'uplift',
      evaluationStatus: 'not_evaluable',
      gateReasons: ['treated rows 30 < 100 minimum'],
      detail: 'Experiment data does not support trustworthy uplift estimates.',
    });
    expect(e.available).toBe(false);
    expect(e.causal).toBe(false);
    expect(e.degradation?.status).toBe('not_evaluable');
    expect(e.degradation?.gateReasons).toContain('treated rows 30 < 100 minimum');
  });

  it('unconfigured uplift service degrades as unavailable (never a fake score)', () => {
    const e = upliftEvidence({ available: false, modelId: 'uplift', detail: 'Uplift service not configured (ML_UPLIT_BASE_URL unset).' });
    expect(e.causal).toBe(false);
    expect(e.degradation?.status).toBe('unavailable');
    expect(e.degradation?.detail).toContain('not configured');
  });

  it('stale uplift stays causal but is flagged stale', () => {
    const e = upliftEvidence({ available: true, modelId: 'uplift', evaluationStatus: 'evaluated', freshnessAgeDays: 30 });
    expect(e.causal).toBe(true);
    expect(e.stale).toBe(true);
    expect(e.degradation?.status).toBe('stale');
  });

  it('not-fetched uplift is unavailable and non-causal', () => {
    const e = upliftEvidence(undefined);
    expect(e.available).toBe(false);
    expect(e.causal).toBe(false);
    expect(e.reason).toBe('NOT_FETCHED');
  });
});

describe('2. response probability is NEVER causal uplift', () => {
  it('available response scores stay causal:false', () => {
    const e = responseEvidence({ available: true, modelId: 'response', evaluationStatus: 'evaluated' });
    expect(e.available).toBe(true);
    expect(e.causal).toBe(false);
    expect(e.kind).toBe('response_model');
  });

  it('a response summary never enables a causal claim', () => {
    const summary = summarizeMlEvidence([
      upliftEvidence({ available: false, evaluationStatus: 'not_evaluable' }),
      responseEvidence({ available: true, modelId: 'response' }),
    ]);
    expect(summary.hasCausalEvidence).toBe(false);
    expect(summary.hasTargetingEvidence).toBe(true); // response can still target
    expect(causalClaim(summary, 'uplift will add 5pp', 'customers likely to respond')).toBe('customers likely to respond');
  });

  it('only gate-passed uplift enables the causal claim', () => {
    const summary = summarizeMlEvidence([
      upliftEvidence({ available: true, modelId: 'uplift', evaluationStatus: 'evaluated' }),
      responseEvidence({ available: true, modelId: 'response' }),
    ]);
    expect(summary.hasCausalEvidence).toBe(true);
    expect(causalClaim(summary, 'uplift adds 5pp', 'response only')).toBe('uplift adds 5pp');
  });
});

describe('3. segmentation / forecast / basket semantics', () => {
  it('segments are descriptive and non-causal', () => {
    const e = segmentEvidence({ available: true, modelId: 'segment' });
    expect(e.kind).toBe('segment');
    expect(e.causal).toBe(false);
  });

  it('forecast is a prediction, not a measured effect', () => {
    const e = forecastEvidence({ available: true, modelId: 'demand', freshnessAgeDays: 1 });
    expect(e.kind).toBe('forecast');
    expect(e.causal).toBe(false);
    expect(e.stale).toBe(false);
  });

  it('stale forecast is flagged', () => {
    const e = forecastEvidence({ available: true, modelId: 'demand', freshnessAgeDays: 30 });
    expect(e.stale).toBe(true);
  });

  it('heuristic basket rows are disclosed', () => {
    const e = basketEvidence({ available: true, modelId: 'combo', predictionSource: 'manager_table' });
    expect(e.heuristic).toBe(true);
    expect(e.causal).toBe(false);
    expect(e.degradation?.status).toBe('heuristic');
  });

  it('model basket rows are not labelled heuristic', () => {
    const e = basketEvidence({ available: true, modelId: 'combo', predictionSource: 'stored_predictions' });
    expect(e.heuristic).toBe(false);
    expect(e.degradation).toBeUndefined();
  });
});

describe('4. safe degradation when services are missing', () => {
  it('summarizes missing kinds without inventing evidence', () => {
    const summary = summarizeMlEvidence([upliftEvidence(undefined), responseEvidence(undefined), forecastEvidence(undefined)]);
    expect(summary.availableKinds).toEqual([]);
    expect(summary.hasTargetingEvidence).toBe(false);
    expect(summary.hasCausalEvidence).toBe(false);
    expect(summary.strongest).toBeNull();
    expect(summary.missingKinds).toEqual(expect.arrayContaining(['causal_uplift', 'response_model', 'segment', 'forecast', 'basket']));
  });

  it('degrades one model at a time without affecting the others', () => {
    const summary = summarizeMlEvidence([
      upliftEvidence({ available: false, evaluationStatus: 'not_evaluable', detail: 'small experiment' }),
      responseEvidence({ available: true, modelId: 'response' }),
      segmentEvidence({ available: true, modelId: 'segment' }),
      forecastEvidence({ available: false, detail: 'Demand prediction store unavailable.' }),
    ]);
    expect(summary.availableKinds).toEqual(['response_model', 'segment']);
    expect(summary.strongest).toBe('response_model');
    expect(summary.degradations.map((d) => d.model).sort()).toEqual(['demand', 'uplift']);
  });

  it('strongest evidence ordering prefers causal > response > segment', () => {
    const withUplift = summarizeMlEvidence([
      upliftEvidence({ available: true, evaluationStatus: 'evaluated' }),
      responseEvidence({ available: true }),
      segmentEvidence({ available: true }),
    ]);
    expect(withUplift.strongest).toBe('causal_uplift');

    const noUplift = summarizeMlEvidence([
      upliftEvidence({ available: false, evaluationStatus: 'not_evaluable' }),
      responseEvidence({ available: true }),
      segmentEvidence({ available: true }),
    ]);
    expect(noUplift.strongest).toBe('response_model');

    const segmentsOnly = summarizeMlEvidence([segmentEvidence({ available: true })]);
    expect(segmentsOnly.strongest).toBe('segment');
  });

  it('degradation lines are owner-readable and never expose internals', () => {
    const summary = summarizeMlEvidence([
      upliftEvidence({ available: false, evaluationStatus: 'not_evaluable', gateReasons: ['treated rows 30 < 100 minimum'] }),
    ]);
    const lines = mlDegradationLines(summary);
    expect(lines[0]).toContain('not usable yet');
    expect(lines[0]).toContain('treated rows 30 < 100 minimum');
    expect(lines[0]).not.toMatch(/ML_UPLIT_BASE_URL|http/);
  });
});
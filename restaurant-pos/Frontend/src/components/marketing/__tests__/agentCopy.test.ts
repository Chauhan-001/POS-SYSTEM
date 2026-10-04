/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentCopy.test.ts — the plain-language layer must:
 *   - rewrite every targetingReason shape marketingAgent.ts can produce;
 *   - keep the honesty caveats (never turn "non-causal" into "proven");
 *   - pass unknown strings through unchanged (never hide evidence).
 */

import { describe, it, expect } from 'vitest';
import {
  friendlyProposalTitle,
  friendlyTargetingReason,
  friendlyScope,
  friendlyEvidenceLine,
  friendlyDeal,
  customerGroupPhrase,
  customerScoreHint,
  sourceFromProposalName,
  friendlySignals,
  friendlyMlKinds,
  friendlyMoney,
  friendlyBreakEven,
  friendlyEconomics,
} from '../agentCopy';

describe('friendlyTargetingReason', () => {
  it('rewrites the composed RESPONSE_MODEL reason (gate note + batch counts)', () => {
    const raw =
      'Uplift gate not passed: experiment too small: 1 treatment assignments < 100 minimum; no control arm: application assigns offers without randomized holdout, so uplift cannot be causally estimated from this ledger. ' +
      'Trained offer-response model used: 45 of 50 recent customers ranked by p(redeem | offer) — non-causal.';
    const out = friendlyTargetingReason(raw);
    expect(out).toMatch(/Not enough experiment data to prove extra sales yet/);
    expect(out).toMatch(/only 1 offers assigned \(100 needed\)/);
    expect(out).toMatch(/no control group yet/);
    expect(out).toMatch(/response model ranked 45 of 50 recent customers/);
    // Jargon gone, honesty kept.
    expect(out).not.toContain('p(redeem');
    expect(out).toContain('not proven extra sales');
  });

  it('rewrites the ML_SEGMENTS fallback with both rung reasons named', () => {
    const raw =
      'Uplift gate not passed: no assignment events recorded. ' +
      'Offer-response rung unavailable: treated rows 30 < 100 minimum; conversions 4 < 20 minimum. ' +
      'Falling back to stored segmentation.';
    const out = friendlyTargetingReason(raw);
    expect(out).toContain('Not enough experiment data');
    expect(out).toContain('no offers have been tracked yet');
    expect(out).toContain("The customer response model isn't ready");
    expect(out).toContain('only 30 offers tracked (100 needed)');
    expect(out).toContain('only 4 redemptions recorded (20 needed)');
    expect(out).toContain('Using your saved customer groups instead');
    expect(out).not.toContain('rung');
    expect(out).not.toContain('stored segmentation');
  });

  it('handles the offline/uplift-unavailable variants', () => {
    expect(friendlyTargetingReason('Uplift service unavailable; using stored segmentation.')).toBe(
      'The experiment tracker is offline; using your saved customer groups.',
    );
    expect(
      friendlyTargetingReason(
        'Uplift service unavailable. Offer-response rung unavailable: Uplift service not configured (ML_UPLIT_BASE_URL unset) — offer-response batch scoring unavailable. Falling back to stored segmentation.',
      ),
    ).toContain("isn't switched on");
  });

  it('handles the uplift-passed and NONE reasons', () => {
    expect(friendlyTargetingReason('Experiment passed the evaluability gate (120 eligible customers).')).toBe(
      'Proven by a live experiment with 120 eligible customers.',
    );
    expect(
      friendlyTargetingReason('No evaluable uplift experiment, no response-model batch scoring, and no stored segments.'),
    ).toContain('No targeting signal yet');
  });

  it('passes unknown text through unchanged (never hides evidence)', () => {
    const odd = 'Some future reason format nobody mapped yet.';
    expect(friendlyTargetingReason(odd)).toBe(odd);
    expect(friendlyTargetingReason('')).toBe('');
  });
});

describe('friendlyScope', () => {
  it('maps the four rung scopes to plain confidence lines', () => {
    expect(friendlyScope('causal uplift — estimated additional response in percentage points from a statistically evaluable experiment')).toContain('High confidence');
    expect(friendlyScope('response likelihood (non-causal) — p(redeem | offer, pre-treatment features); not proof of incremental effect')).toContain('Moderate confidence');
    expect(friendlyScope('segment membership — descriptive grouping; no per-customer model score')).toContain('Low confidence');
    expect(friendlyScope('no ML signal available')).toBe('No targeting signal yet.');
  });
  it('keeps the non-causal caveat visible', () => {
    expect(friendlyScope('response likelihood (non-causal) — p(redeem | offer, pre-treatment features); not proof of incremental effect')).toMatch(/not who would have bought anyway/);
  });
  it('passes unknown scopes through', () => {
    expect(friendlyScope('some future scope')).toBe('some future scope');
  });
});

describe('friendlyEvidenceLine', () => {
  it('humanizes Targeting source + Scope lines', () => {
    expect(
      friendlyEvidenceLine('Targeting source: ML_SEGMENTS — Uplift gate not passed: no assignment events recorded. Falling back to stored segmentation.'),
    ).toContain('Using your saved customer groups instead');
    expect(friendlyEvidenceLine('Scope: segment membership — descriptive grouping; no per-customer model score')).toContain('Low confidence');
  });
  it('leaves context lines (festival/cricket/basket/demand) untouched', () => {
    const cricket = 'Cricket context: IND vs AUS — ICC Champions Trophy, starts 2026-10-05 14:00 (Asia/Kolkata), high relevance.';
    expect(friendlyEvidenceLine(cricket)).toBe(cricket);
  });
});

describe('friendlyProposalTitle + sourceFromProposalName', () => {
  it('parses the agent name pattern into a friendly title, keeping the raw receipt line', () => {
    const { title, raw } = friendlyProposalTitle('INCREASE_ORDERS • RESPONSE_MODEL • 2026-10-03', 'agent');
    expect(title).toBe('Boost sales — AI suggestion');
    expect(raw).toBe('INCREASE_ORDERS • RESPONSE_MODEL • 2026-10-03');
  });
  it('labels owner drafts as their own', () => {
    expect(friendlyProposalTitle('WINBACK • OWNER • 2026-10-03', 'owner').title).toBe('Win back lost customers — Your draft');
  });
  it('falls back to the raw name when it does not parse', () => {
    expect(friendlyProposalTitle('My custom promo', 'owner')).toEqual({ title: 'My custom promo', raw: 'My custom promo' });
    expect(friendlyProposalTitle('', undefined)).toEqual({ title: '', raw: '' });
  });
  it('extracts the rung encoded in the name', () => {
    expect(sourceFromProposalName('INCREASE_ORDERS • RESPONSE_MODEL • 2026-10-03')).toBe('RESPONSE_MODEL');
    expect(sourceFromProposalName('WINBACK • OWNER • 2026-10-03')).toBeUndefined();
  });
});

describe('grouped-audience helpers', () => {
  it('describes customer groups per rung (never per single customer)', () => {
    expect(customerGroupPhrase('RESPONSE_MODEL')).toBe('most likely to use an offer');
    expect(customerGroupPhrase('CAUSAL_UPLIFT')).toBe('most likely to bring extra sales');
    expect(customerGroupPhrase(undefined)).toBe('picked from your customer list');
  });
  it('renders score hints in rung vocabulary', () => {
    expect(customerScoreHint('CAUSAL_UPLIFT', 12.34)).toBe(' · best +12.3 pp');
    expect(customerScoreHint('RESPONSE_MODEL', 0.87)).toBe(' · top 87% likely to redeem');
    expect(customerScoreHint('RESPONSE_MODEL', null)).toBe('');
    expect(customerScoreHint('ML_SEGMENTS', 0.5)).toBe('');
  });
});

describe('friendlyDeal', () => {
  it('renders real deal shorthands', () => {
    expect(friendlyDeal({ type: 'percentage', value: 20 })).toBe('20% off');
    expect(friendlyDeal({ type: 'flat', value: 50 })).toBe('₹50 off');
    expect(friendlyDeal({ type: 'combo', value: 199 })).toBe('Combo at ₹199');
    expect(friendlyDeal({ type: 'buy_x_get_y' })).toBe('Buy X get Y');
    expect(friendlyDeal({})).toBeNull();
    expect(friendlyDeal(null)).toBeNull();
  });
});

// ─── Phase 3–7 intelligence copy ───────────────────────────────────────────

describe('friendlySignals / friendlyMlKinds', () => {
  it('translates canonical signal codes into owner language', () => {
    expect(friendlySignals(['product_high_demand', 'basket_pair_strength'])).toBe(
      'a popular dish, dishes bought together',
    );
    expect(friendlySignals([])).toBe('');
    expect(friendlySignals(undefined)).toBe('');
  });

  it('translates ML evidence kinds without over-claiming', () => {
    expect(friendlyMlKinds(['response_model'])).toContain('a prediction');
    expect(friendlyMlKinds(['response_model'])).not.toMatch(/proven/);
    expect(friendlyMlKinds(['causal_uplift'])).toContain('proven extra sales');
    expect(friendlyMlKinds(undefined)).toBe('');
  });

  it('passes unknown codes through readably', () => {
    expect(friendlySignals(['some_new_signal'])).toBe('some new signal');
  });
});

describe('friendlyEconomics / friendlyBreakEven / friendlyMoney', () => {
  it('states safe economics plainly', () => {
    expect(friendlyEconomics(10, 55, true)).toContain('55% profit');
    expect(friendlyEconomics(10, 55, true)).toContain('10% discount');
  });

  it('warns instead of hiding unsafe economics', () => {
    const line = friendlyEconomics(45, 8, false);
    expect(line).toContain('Careful');
    expect(line).toContain('8% profit');
  });

  it('formats money and break-even honestly', () => {
    expect(friendlyMoney(12000)).toBe('₹12,000');
    expect(friendlyMoney(Number.NaN)).toBe('not available');
    expect(friendlyBreakEven(5)).toBe('needs about 5 extra sales to cover the discount');
    expect(friendlyBreakEven(1)).toBe('needs about 1 extra sale to cover the discount');
    expect(friendlyBreakEven(0)).toBe('no extra sales needed to cover the discount');
    expect(friendlyBreakEven(-1)).toBe('break-even point not available');
  });
});

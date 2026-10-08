/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentCopy.test.ts — the plain-language layer for the Intelligence Pipeline
 * (System #3) must:
 *   - translate canonical signal codes / ML kinds into owner language;
 *   - keep the honesty caveats (never turn "a prediction" into "proven");
 *   - pass unknown codes through readably (never hide evidence);
 *   - render economics without inventing values.
 */

import { describe, it, expect } from 'vitest';
import {
  friendlySignals,
  friendlyMlKinds,
  friendlyMoney,
  friendlyBreakEven,
  friendlyEconomics,
  friendlyToolLabels,
  friendlyCategory,
  aiFailureCopy,
} from '../agentCopy';

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

describe('friendlyToolLabels — "What the AI checked" chips', () => {
  it('maps internal tool ids to owner-friendly labels and dedupes', () => {
    expect(
      friendlyToolLabels(['getSalesTrends', 'getSalesTrends', 'getMenuPerformance', 'getCustomerSegments']),
    ).toEqual(['Sales', 'Menu performance', 'Customers']);
  });

  it('never leaks an internal tool name — unknown ids are skipped', () => {
    const labels = friendlyToolLabels(['getSalesTrends', 'someBrandNewTool', 'getSalesTrendsV2']);
    expect(labels).toEqual(['Sales']);
    for (const label of labels) {
      expect(label).not.toMatch(/^get[A-Z]/);
      expect(label).not.toContain('someBrandNewTool');
    }
  });

  it('returns nothing for no sources', () => {
    expect(friendlyToolLabels([])).toEqual([]);
    expect(friendlyToolLabels(undefined)).toEqual([]);
  });
});

describe('friendlyCategory — card category badge', () => {
  it('prefers the engine strategy label', () => {
    expect(friendlyCategory({ type: 'CREATE_PROMOTION', strategyLabel: 'PROMOTION' })).toBe('PROMOTION');
    expect(friendlyCategory({ type: 'CREATE_PROMOTION', strategyLabel: '  WEEKDAY  ' })).toBe('WEEKDAY');
  });

  it('falls back to the recommendation type, never invented', () => {
    expect(friendlyCategory({ type: 'CREATE_PROMOTION' })).toBe('PROMOTION');
    expect(friendlyCategory({ type: 'WEEKDAY_SPECIAL' })).toBe('WEEKDAY SPECIAL');
    expect(friendlyCategory({})).toBe('RECOMMENDATION');
    expect(friendlyCategory(null)).toBe('RECOMMENDATION');
  });
});

describe('aiFailureCopy — owner language for a failed AI request', () => {
  it('adds an honest, remediation-specific sentence per recorded reason', () => {
    expect(aiFailureCopy('offline')).toMatch(/offline\. Reconnect/i);
    expect(aiFailureCopy('timeout')).toMatch(/run it again/i);
    expect(aiFailureCopy('network_error')).toMatch(/connection .* dropped/i);
    // The historical 429 copy, so "wait and retry" guidance is preserved.
    expect(aiFailureCopy('rate_limited')).toMatch(/already running|too many/i);
    expect(aiFailureCopy('auth_required')).toMatch(/sign in again/i);
    expect(aiFailureCopy('server_error')).toMatch(/server is having trouble/i);
  });

  it('never leaks technical kinds like the HTTP status or error code', () => {
    for (const reason of ['offline', 'timeout', 'network_error', 'rate_limited', 'auth_required', 'server_error']) {
      const copy = aiFailureCopy(reason);
      expect(copy).not.toMatch(/\b429\b/);
      expect(copy).not.toMatch(/\b失败\b|error code|exception/i);
    }
  });

  it('degrades to no extra copy for unknown reasons, matching the old generic behavior', () => {
    expect(aiFailureCopy(undefined)).toBe('');
    expect(aiFailureCopy('')).toBe('');
    expect(aiFailureCopy('some_future_kind')).toBe('');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentContext.test.ts — contract test for the agent's context lines.
 *
 * History: festivalLine read a non-existent `festivals` field, so the agent
 * NEVER surfaced festival evidence even when the festival tool returned data
 * (the real output shape is { available, nearest, upcoming }). These tests pin
 * the line-builder to the real tool output shape so the evidence lines cannot
 * silently go dark again.
 */

import { describe, it, expect } from 'vitest';
import { festivalLine } from '../marketingAgent';

describe('festivalLine contract (festival tool output shape)', () => {
  it('surfaces the nearest festival with its day count', () => {
    const toolOutput = {
      available: true,
      nearest: { name: 'Navratri', date: '2026-10-11', daysAway: 8 },
      upcoming: [{ name: 'Navratri', date: '2026-10-11', daysAway: 8 }],
    };
    expect(festivalLine(toolOutput)).toBe('Upcoming festival context: Navratri in 8 day(s).');
  });

  it('falls back to the first upcoming festival when nearest is missing', () => {
    const toolOutput = {
      available: true,
      nearest: null,
      upcoming: [{ name: 'Dussehra', date: '2026-10-20', daysAway: 17 }],
    };
    expect(festivalLine(toolOutput)).toBe('Upcoming festival context: Dussehra in 17 day(s).');
  });

  it('returns null when the tool reports unavailable — never fabricates evidence', () => {
    expect(festivalLine({ available: false, upcoming: [{ name: 'X', daysAway: 1 }] })).toBeNull();
    expect(festivalLine(null)).toBeNull();
    expect(festivalLine(undefined)).toBeNull();
    expect(festivalLine({ available: true, upcoming: [] })).toBeNull();
  });

  it('rejects the legacy (never-real) `festivals` shape instead of guessing', () => {
    // The old bug: the builder read `festivals` — a field the tool never returned.
    expect(festivalLine({ festivals: [{ name: 'Diwali' }] })).toBeNull();
  });
});

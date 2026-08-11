/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing state machine tests (Phase 4) — offers and campaigns must never
 * accept arbitrary status transitions.
 */

import { describe, expect, it } from 'vitest';
import {
  OFFER_TRANSITIONS,
  CAMPAIGN_TRANSITIONS,
  canTransition,
} from '../marketingStates';

describe('canTransition / OFFER_TRANSITIONS (Phase 4)', () => {
  it('allows valid offer transitions', () => {
    expect(canTransition('draft', 'active', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('draft', 'scheduled', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('draft', 'cancelled', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('scheduled', 'active', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('scheduled', 'paused', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('active', 'paused', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('active', 'expired', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('paused', 'active', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('paused', 'expired', OFFER_TRANSITIONS)).toBe(true);
  });

  it('rejects nonsensical offer transitions', () => {
    expect(canTransition('expired', 'active', OFFER_TRANSITIONS)).toBe(false);
    expect(canTransition('cancelled', 'active', OFFER_TRANSITIONS)).toBe(false);
    expect(canTransition('expired', 'draft', OFFER_TRANSITIONS)).toBe(false);
    expect(canTransition('cancelled', 'scheduled', OFFER_TRANSITIONS)).toBe(false);
    expect(canTransition('active', 'draft', OFFER_TRANSITIONS)).toBe(false);
  });

  it('treats same-state transitions as a no-op (allowed)', () => {
    expect(canTransition('active', 'active', OFFER_TRANSITIONS)).toBe(true);
    expect(canTransition('expired', 'expired', OFFER_TRANSITIONS)).toBe(true);
  });
});

describe('canTransition / CAMPAIGN_TRANSITIONS (Phase 4)', () => {
  it('allows valid campaign transitions', () => {
    expect(canTransition('draft', 'scheduled', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('draft', 'sending', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('draft', 'cancelled', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('scheduled', 'sending', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('scheduled', 'cancelled', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('sending', 'sent', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('sending', 'failed', CAMPAIGN_TRANSITIONS)).toBe(true);
    // Retry path
    expect(canTransition('failed', 'draft', CAMPAIGN_TRANSITIONS)).toBe(true);
    expect(canTransition('failed', 'scheduled', CAMPAIGN_TRANSITIONS)).toBe(true);
  });

  it('rejects invalid campaign transitions', () => {
    expect(canTransition('sent', 'sending', CAMPAIGN_TRANSITIONS)).toBe(false);
    expect(canTransition('sent', 'draft', CAMPAIGN_TRANSITIONS)).toBe(false);
    expect(canTransition('cancelled', 'active', CAMPAIGN_TRANSITIONS)).toBe(false);
    expect(canTransition('sending', 'draft', CAMPAIGN_TRANSITIONS)).toBe(false);
    expect(canTransition('draft', 'sent', CAMPAIGN_TRANSITIONS)).toBe(false);
  });
});

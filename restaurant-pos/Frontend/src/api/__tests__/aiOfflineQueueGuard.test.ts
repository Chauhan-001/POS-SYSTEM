/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline-queue replay guard — AI + owner-invoked action endpoints.
 *
 * writeOfflineAware queues failed writes into the sync engine for replay when
 * connectivity returns. That is correct for optimistic POS mutations (a bill
 * must not vanish), but WRONG for AI/owner-invoked actions: the replayed
 * response is discarded, so the owner never sees it — yet the server-side
 * side effect still happens again. Concrete cases:
 *
 *   - POST /advisor/recommend  PERSISTS its recommendations (insertMany,
 *     status 'shown'; fingerprint dedup only suppresses converted/cooldown
 *     ones) ⇒ a queued replay silently inserts up to 5 duplicate rows.
 *   - POST /advisor/:id/action|outcome|converted are $set status transitions ⇒
 *     a delayed replay (7-day queue retention) can clobber a newer decision.
 *   - POST /marketing/test-message sends a message ⇒ a replay re-sends it.
 *   - POST /ml-pipeline/experiments/assign|convert record experiment ledger
 *     rows ⇒ a replay double-records them.
 *   - POST /ai/marketing-agent/proposal creates a CampaignProposal ⇒ the
 *     original fix this guard covers.
 *
 * These all go through postNoQueue: offline or network failure ⇒ null, never
 * queued. This test pins that behaviour so a future refactor cannot silently
 * route an AI endpoint back through the replay queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncEngine } from '../../lib/syncEngine';
import {
  advisorRecommend,
  advisorAction,
  advisorOutcome,
  advisorMarkConverted,
  sendTestMessage,
  recordOfferAssignment,
  recordOfferConversion,
  createMarketingAgentProposal,
  runMarketingAgent,
  runInventoryAgentRecommendation,
  submitCampaignProposal,
  approveCampaignProposal,
  createPromotion,
} from '../client';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

/** Every AI / owner-action client call that must never be queued. */
const AI_CALLS: Array<[string, () => Promise<unknown>]> = [
  ['advisorRecommend', () => advisorRecommend({ goal: 'increase_sales' })],
  ['advisorAction', () => advisorAction('rec_1', { status: 'accepted' })],
  ['advisorOutcome', () => advisorOutcome('rec_1', 'Offer worked')],
  ['advisorMarkConverted', () => advisorMarkConverted('rec_1', 'offer_1')],
  ['sendTestMessage', () => sendTestMessage({ target: '+910000000000', message: 'hi', channels: ['whatsapp'] })],
  ['recordOfferAssignment', () => recordOfferAssignment('cust_1', 'offer_1')],
  ['recordOfferConversion', () => recordOfferConversion('cust_1', 'offer_1', 'bill_1')],
  ['runMarketingAgent', () => runMarketingAgent({})],
  ['createMarketingAgentProposal', () => createMarketingAgentProposal({})],
  ['runInventoryAgentRecommendation', () => runInventoryAgentRecommendation()],
  ['submitCampaignProposal', () => submitCampaignProposal('prop_1')],
  ['approveCampaignProposal', () => approveCampaignProposal('prop_1')],
];

describe('AI endpoints never enter the offline replay queue', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    syncEngine.clearQueue();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setOnline(true);
  });

  it('offline: returns null without touching the network or the queue', async () => {
    setOnline(false);
    for (const [name, run] of AI_CALLS) {
      expect(await run(), `${name} should return null while offline`).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncEngine.getQueue()).toHaveLength(0);
  });

  it('network failure: returns null and is NOT queued for replay', async () => {
    setOnline(true);
    fetchMock.mockRejectedValue(new Error('network down'));
    for (const [name, run] of AI_CALLS) {
      expect(await run(), `${name} must surface null, not enqueue`).toBeNull();
    }
    expect(syncEngine.getQueue()).toHaveLength(0);
  });

  it('HTTP error (4xx/5xx): returns null and is NOT queued (server already saw it)', async () => {
    setOnline(true);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    for (const [, run] of AI_CALLS) {
      expect(await run()).toBeNull();
    }
    expect(syncEngine.getQueue()).toHaveLength(0);
  });

  it('control: a normal POS write still queues when offline (guard is AI-specific)', async () => {
    setOnline(false);
    expect(await createPromotion({ title: 'Diwali deal' })).toBeNull();
    const queue = syncEngine.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].method).toBe('POST');
    expect(queue[0].path).toBe('/promotions');
  });
});

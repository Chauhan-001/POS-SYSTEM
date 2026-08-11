/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingStates.ts — Canonical status state machines for Offers and Campaigns.
 *
 * Both entities previously accepted ANY status string via their PATCH endpoints,
 * which allowed nonsensical transitions (expired → active, cancelled → active).
 * These maps are the single source of truth for valid transitions and are used
 * by the controllers/services AND the background scheduler.
 */

export type OfferStatus = 'draft' | 'active' | 'scheduled' | 'paused' | 'expired' | 'cancelled';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'cancelled' | 'failed';

/**
 * Offer transitions:
 *   draft     → active | scheduled | cancelled
 *   scheduled → active | paused    | cancelled
 *   active    → paused | expired   | cancelled
 *   paused    → active | expired   | cancelled
 *   expired / cancelled → (terminal — no transitions)
 */
export const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  draft: ['active', 'scheduled', 'cancelled'],
  scheduled: ['active', 'paused', 'cancelled'],
  active: ['paused', 'expired', 'cancelled'],
  paused: ['active', 'expired', 'cancelled'],
  expired: [],
  cancelled: [],
};

/**
 * Campaign transitions:
 *   draft     → scheduled | sending | cancelled
 *   scheduled → sending   | cancelled
 *   sending   → sent      | failed | partial   (partial = some recipients failed)
 *   failed    → draft     | scheduled   (retry)
 *   sent / partial / cancelled → (terminal)
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['scheduled', 'sending', 'cancelled'],
  scheduled: ['sending', 'cancelled'],
  sending: ['sent', 'failed', 'partial'],
  sent: [],
  partial: [],
  failed: ['draft', 'scheduled'],
  cancelled: [],
};

/** Whether a transition from → to is allowed (same-state is a no-op and allowed). */
export function canTransition(
  from: string,
  to: string,
  map: Record<string, string[]> = OFFER_TRANSITIONS,
): boolean {
  if (from === to) return true;
  const allowed = (map as Record<string, string[]>)[from] || [];
  return allowed.includes(to);
}

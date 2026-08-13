/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerMath — deterministic OFFLINE offer math.
 *
 * The backend (/offers/validate) is ALWAYS the authoritative source when the
 * POS is online. These helpers exist so the cashier can keep applying a LIVE
 * offer during an internet outage:
 *
 *   1. The active offer list (with expiry dates) is cached in localStorage
 *      (pos_offers) whenever the POS is online.
 *   2. While offline, OffersPopup shows the cached offers with their expiry
 *      dates and computes the discount with computeOfferDiscountLocally() —
 *      a strict mirror of OfferValidationService.computeDiscount().
 *   3. The applied offer is flagged offlineApplied, recorded on the bill, and
 *      re-validated server-side when the offline write queue replays
 *      (POST /offers/apply), so usage limits / segment / tier / branch rules
 *      are still enforced once connectivity returns.
 *
 * Nothing here mutates anything — it is pure math + date checks, unit-tested
 * against the same numbers the server produces.
 */

/** Shape returned by the backend's /offers/validate sanitize(). */
export interface SanitizedOffer {
  id: string;
  title: string;
  description?: string;
  type: string;
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  couponCode?: string;
  stackingAllowed?: boolean;
  mutuallyExclusiveGroup?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Normalize a cached lean Offer doc (from GET /offers, which keeps _id and the
 * full schema) into the exact shape /offers/validate returns — so callers like
 * useBilling can read appliedOffer.offer.id / .couponCode uniformly whether the
 * offer came from the server or from the offline cache.
 */
export function sanitizeOffer(raw: any): SanitizedOffer {
  return {
    id: String(raw?._id || raw?.id || ''),
    title: raw?.title || '',
    description: raw?.description,
    type: raw?.type || 'percentage',
    value: Number(raw?.value) || 0,
    minOrderValue: raw?.minOrderValue != null ? Number(raw.minOrderValue) : undefined,
    maxDiscount: raw?.maxDiscount != null ? Number(raw.maxDiscount) : undefined,
    couponCode: raw?.couponCode,
    stackingAllowed: raw?.stackingAllowed,
    mutuallyExclusiveGroup: raw?.mutuallyExclusiveGroup,
    startDate: raw?.startDate,
    endDate: raw?.endDate,
  };
}

/**
 * Strict mirror of OfferValidationService.computeDiscount().
 * percentage → subtotal × value/100, capped at maxDiscount.
 * flat / cashback / coupon → min(value, subtotal).
 * Everything else (bogo / free_item / combo / reward_points) → 0, matching the
 * server, which handles those at line level.
 */
export function computeOfferDiscountLocally(offer: { type?: string; value?: number; maxDiscount?: number }, subtotal: number): number {
  const total = Number(subtotal) || 0;
  const type = offer?.type;
  const value = Number(offer?.value) || 0;
  if (type === 'percentage') {
    const raw = total * (value / 100);
    const max = Number(offer?.maxDiscount) || 0;
    return max > 0 ? Math.min(raw, max) : raw;
  }
  if (type === 'flat' || type === 'cashback' || type === 'coupon') {
    return Math.min(value, total);
  }
  return 0;
}

export interface OfflineEligibility {
  valid: boolean;
  reason?: string;
}

/**
 * Checks every eligibility rule that CAN be evaluated offline (status, dates,
 * day-of-week, hour window, min order). Rules requiring server state (usage
 * limits, per-customer cap, segment/tier targeting, branch scope, stacking)
 * are NOT checked here — the offline apply is always flagged and re-validated
 * on sync, where those rules are enforced authoritatively.
 */
export function checkOfferEligibilityLocally(
  offer: any,
  ctx: { subtotal?: number; now?: Date } = {},
): OfflineEligibility {
  if (!offer || offer.status !== 'active' || offer.isDeleted) {
    return { valid: false, reason: 'This offer is not active right now.' };
  }
  const now = ctx.now || new Date();
  const nowStr = now.toISOString().slice(0, 10);
  if (offer.startDate && String(offer.startDate) > nowStr) {
    return { valid: false, reason: "This offer hasn't started yet." };
  }
  if (offer.endDate && String(offer.endDate) < nowStr) {
    return { valid: false, reason: 'This offer has expired.' };
  }
  if (Array.isArray(offer.daysOfWeek) && offer.daysOfWeek.length > 0 && !offer.daysOfWeek.includes(now.getDay())) {
    return { valid: false, reason: "This offer isn't available today." };
  }
  if (typeof offer.startHour === 'number' && typeof offer.endHour === 'number') {
    const hour = now.getHours();
    if (hour < offer.startHour || hour >= offer.endHour) {
      return { valid: false, reason: 'This offer is only valid during its scheduled hours.' };
    }
  }
  const subtotal = Number(ctx.subtotal) || 0;
  if (offer.minOrderValue && subtotal < Number(offer.minOrderValue)) {
    return { valid: false, reason: 'This offer needs a higher bill amount.' };
  }
  return { valid: true };
}

/**
 * Human label for the cached offer's expiry, shown on every offer card so the
 * cashier knows exactly how long a cached offer is good for.
 */
export function formatOfferExpiry(offer: any, now: Date = new Date()): string | null {
  if (!offer?.endDate) return null;
  const end = String(offer.endDate);
  const today = now.toISOString().slice(0, 10);
  if (end < today) return 'Expired';
  if (end === today) return 'Ends today';
  // Compare calendar dates (UTC, matching the server's date-only comparison),
  // not hours — "tomorrow" must hold regardless of the current clock time.
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  if (end === tomorrow) return 'Ends tomorrow';
  const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  if (days <= 7) return `Ends in ${days} days`;
  const d = new Date(`${end}T00:00:00`);
  return `Valid until ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * Filter the cached offer list down to what is genuinely usable RIGHT NOW and
 * sort like the server list endpoint (sortOrder, then newest first). Callers
 * still run checkOfferEligibilityLocally at apply time for min-order etc.
 */
export function visibleOffersFromCache(list: any[] | null | undefined, now: Date = new Date()): any[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((o) => o && o.status === 'active' && !o.isDeleted
      && !(o.startDate && String(o.startDate) > now.toISOString().slice(0, 10))
      && !(o.endDate && String(o.endDate) < now.toISOString().slice(0, 10)))
    .sort((a, b) => {
      const sa = Number(a.sortOrder) || 0;
      const sb = Number(b.sortOrder) || 0;
      if (sa !== sb) return sa - sb;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
}

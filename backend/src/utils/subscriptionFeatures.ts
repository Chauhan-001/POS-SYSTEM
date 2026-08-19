/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * subscriptionFeatures.ts — Single source of truth for a subscription's
 * EFFECTIVE feature set.
 *
 * A subscription carries two feature lists:
 *   - `features`         — the snapshot of the plan's features (overwritten on
 *                          every plan change / free-tier fallback).
 *   - `grantedFeatures`  — add-on features the platform admin grants beyond
 *                          the plan. These are NOT part of the plan snapshot,
 *                          so they survive plan changes and downgrades.
 *
 * Every entitlement check (requireFeature middleware, entitlementService,
 * subscriptionService.getSubscriptionStatus, admin display endpoints) must
 * use this union so a grant takes effect everywhere at once — and a revoke
 * locks the feature everywhere immediately.
 */

/** Union of the plan snapshot and admin-granted add-ons, de-duplicated. */
export function effectiveFeatures(
  features: string[] | undefined,
  grantedFeatures: string[] | undefined
): string[] {
  if (!grantedFeatures || grantedFeatures.length === 0) {
    return features || [];
  }
  return Array.from(new Set([...(features || []), ...grantedFeatures]));
}

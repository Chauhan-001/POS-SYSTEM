/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * directionPolicy.ts — Phase 8: the investigated DIRECTIONS constrain the
 * deterministic candidate engine (task §11).
 *
 * A `CandidateDirection` is a strategic hypothesis derived from evidence
 * ("activate a slow-moving item", "protect margin on a demand item", …). This
 * module translates those hypotheses into the engine's OWN promotion-type
 * vocabulary, so generation can be genuinely RESTRICTED to the types the
 * investigation directed — rather than generating everything and re-labelling.
 *
 * Two honesty rules are encoded here:
 *   1. A direction with no engine-type representation is REPORTED as
 *      unrepresentable — never silently dropped and never forced into an offer
 *      the engine does not produce.
 *   2. A direction that produced no candidate is REPORTED as unrealised. The
 *      engine's output is never padded to make a direction look satisfied.
 *
 * Nothing here invents a promotion type: the mapping only uses the nine
 * existing `PromotionType` values.
 */

import type { PromotionType } from '../../services/promotionCandidateService';
import type { CandidateDirection, DirectionPolicyReport } from './contracts';

export type { DirectionPolicyReport };

/**
 * Direction → engine types. Keys are the direction codes produced by
 * `situationModel.ts`. Every target type is an EXISTING engine type.
 */
export const DIRECTION_TO_TYPES: Record<string, PromotionType[]> = {
  // Menu / economics
  activate_slow_item: ['PROMOTE_SLOW_ITEM', 'CREATE_ADDON'],
  protect_margin: ['REVIEW_RECIPE_COST', 'REVIEW_PRICE'],
  amplify_high_margin: ['CREATE_ADDON', 'CREATE_COMBO'],
  meet_demand: ['PROTECT_HIGH_DEMAND_STOCK'],
  lift_weak_category: ['CREATE_COMBO', 'CREATE_PROMOTION'],
  build_combo: ['CREATE_COMBO'],
  // Customers
  win_back: ['RUN_REACTIVATION'],
  // No engine type represents a pure retention play. It is deliberately
  // UNREPRESENTABLE so it is reported instead of being turned into a discount.
  retain_high_value: [],
  // Marketing history
  replace_underperforming_offer: ['CREATE_PROMOTION'],
  replace_underperforming_campaign: ['CREATE_PROMOTION', 'CREATE_COMBO'],
  // Inventory
  move_overstock: ['CREATE_PROMOTION', 'REDUCE_WASTAGE'],
  reduce_wastage: ['REDUCE_WASTAGE'],
  protect_stock: ['PROTECT_HIGH_DEMAND_STOCK'],
  // Demand shape
  fill_weak_slots: ['CREATE_PROMOTION'],
  // Context
  align_with_festival: ['CREATE_PROMOTION', 'CREATE_COMBO'],
  align_with_event: ['CREATE_PROMOTION'],
  align_with_weather: ['CREATE_PROMOTION'],
};

export interface DirectionNarrowing {
  /** Union of the engine types the directions point at (deduplicated, stable order). */
  types: PromotionType[];
  /** Direction → the types it directed (only representable directions). */
  directed: Array<{ direction: string; types: PromotionType[] }>;
  /** Directions with no engine representation — reported, never forced. */
  unrepresentable: Array<{ direction: string; objective: string }>;
}

/** Translate the situation model's directions into an engine type restriction. */
export function promotionTypesForDirections(directions: CandidateDirection[]): DirectionNarrowing {
  const types: PromotionType[] = [];
  const directed: DirectionNarrowing['directed'] = [];
  const unrepresentable: DirectionNarrowing['unrepresentable'] = [];

  for (const d of directions) {
    const mapped = DIRECTION_TO_TYPES[d.direction] ?? [];
    if (!mapped.length) {
      unrepresentable.push({ direction: d.direction, objective: d.objective });
      continue;
    }
    directed.push({ direction: d.direction, types: mapped });
    for (const t of mapped) if (!types.includes(t)) types.push(t);
  }

  return { types, directed, unrepresentable };
}

interface DirectionTargetable {
  type: string;
  target: { productIds: string[]; categoryIds: string[]; segmentIds: string[] };
}

/**
 * Was a direction realised by the engine's output?
 *
 * A direction is realised when a candidate has one of its types AND — when the
 * direction names a target — that candidate actually touches the target. A
 * type-only hit for a targeted direction is NOT counted, so a direction cannot
 * look satisfied by an unrelated offer of the same shape.
 */
export function directionRealised(direction: CandidateDirection, candidates: DirectionTargetable[]): boolean {
  const types = DIRECTION_TO_TYPES[direction.direction] ?? [];
  const ids = new Set([...direction.target.productIds, ...direction.target.categoryIds, ...direction.target.segmentIds]);
  return candidates.some((c) => {
    if (!types.includes(c.type as PromotionType)) return false;
    if (ids.size === 0) return true;
    return (
      c.target.productIds.some((id) => ids.has(id)) ||
      c.target.categoryIds.some((id) => ids.has(id)) ||
      c.target.segmentIds.some((id) => ids.has(id))
    );
  });
}

/** Build the disclosure report from the narrowing + the engine's actual output. */
export function reportDirectionPolicy(
  narrowing: DirectionNarrowing,
  directions: CandidateDirection[],
  candidates: DirectionTargetable[],
  applied: boolean,
  fallbackUsed: boolean,
): DirectionPolicyReport {
  const realised: string[] = [];
  const unrealised: string[] = [];
  for (const d of directions) {
    if (!(DIRECTION_TO_TYPES[d.direction] ?? []).length) continue; // unrepresentable, reported separately
    (directionRealised(d, candidates) ? realised : unrealised).push(d.direction);
  }
  const note = !directions.length
    ? 'No direction was derived from the investigation, so the engine ran unrestricted.'
    : fallbackUsed
      ? 'The direction-restricted engine run produced no candidate; the unrestricted engine was used and every direction is reported as unrealised rather than forced into an offer.'
      : applied
        ? `Engine generation was restricted to the types the investigation directed (${narrowing.types.join(', ')}).`
        : 'No direction mapped onto an engine promotion type, so the engine ran unrestricted.';
  return {
    applied,
    types: narrowing.types,
    unrepresentableDirections: narrowing.unrepresentable.map((u) => u.direction),
    realisedDirections: [...new Set(realised)],
    unrealisedDirections: [...new Set(unrealised)],
    fallbackUsed,
    note,
  };
}

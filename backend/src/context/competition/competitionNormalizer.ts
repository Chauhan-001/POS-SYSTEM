/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionNormalizer.ts — Competition Phase 2 normalizer (spec §2).
 * Converts raw Google Places rows into canonical NearbyCompetitor records,
 * computing ChitKuber-derived distances (deterministic haversine) and
 * enforcing dedup + current-restaurant exclusion. Google's raw shape never
 * spreads beyond competitionProvider → this file.
 *
 * Determinism (spec §25): no LLM anywhere — pure arithmetic and string maps.
 */

import type { GooglePlaceRaw } from './competitionProvider';
import type { NearbyCompetitor } from './competitionTypes';

/** Great-circle distance in meters (haversine, mean Earth radius 6,371,000 m). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Stable location key for cache invalidation — 'lat,lng' rounded to 6dp (~0.1m). */
export function locationKeyOf(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Parse the Restaurant model's string coordinates; null when unusable. */
export function parseCoordinates(
  latitude?: string | null,
  longitude?: string | null,
): { latitude: number; longitude: number } | null {
  const lat = parseFloat((latitude ?? '').trim());
  const lng = parseFloat((longitude ?? '').trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

/** A restaurant's own Place ID, when previously stored — used for self-exclusion. */
const SELF_PLACE_IDS = new Map<string, string>(); // restaurantId → placeId (in-process)

export function registerSelfPlaceId(restaurantId: string, placeId: string): void {
  SELF_PLACE_IDS.set(restaurantId, placeId);
}

/** Deterministic Google display name → comparable tokens (lowercase, alnum). */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Normalize one raw place. Returns null for unusable rows (no id or no name).
 * `selfName` excludes the restaurant's own listing if Google returns it
 * (name-similarity + tiny distance), because Places Nearby Search may include
 * the searched POI itself.
 */
export function normalizeCompetitor(
  raw: GooglePlaceRaw,
  center: { latitude: number; longitude: number },
  fetchedAt: string,
  self: { restaurantName?: string | null; selfPlaceId?: string | null } = {},
): NearbyCompetitor | null {
  const placeId = (raw.id ?? '').trim();
  const name = raw.displayName?.text?.trim() ?? '';
  if (!placeId || !name) return null;
  if (self.selfPlaceId && placeId === self.selfPlaceId) return null;

  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  const distanceMeters =
    typeof lat === 'number' && typeof lng === 'number'
      ? Math.round(haversineMeters(center.latitude, center.longitude, lat, lng))
      : undefined;

  // Self-exclusion fallback: near-identical name AND (no distance data or
  // within 50m). Conservative — avoids dropping genuine neighbors.
  if (self.restaurantName) {
    const a = nameTokens(name);
    const b = nameTokens(self.restaurantName);
    if (a.size > 0 && b.size > 0) {
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap >= 0.9 && (distanceMeters === undefined || distanceMeters <= 50)) return null;
    }
  }

  return {
    placeId,
    name,
    address: raw.formattedAddress?.trim() || undefined,
    latitude: typeof lat === 'number' ? lat : undefined,
    longitude: typeof lng === 'number' ? lng : undefined,
    primaryType: raw.primaryType?.trim() || undefined,
    types: Array.isArray(raw.types) ? raw.types.filter((t) => typeof t === 'string') : undefined,
    googleMapsUri: raw.googleMapsUri?.trim() || undefined,
    distanceMeters,
    source: 'google_places',
    fetchedAt,
  };
}

/** Normalize a raw response → competitors, deduped by placeId, sorted by distance. */
export function normalizeCompetitors(
  places: GooglePlaceRaw[] | undefined,
  center: { latitude: number; longitude: number },
  fetchedAt: string,
  self: { restaurantName?: string | null; selfPlaceId?: string | null } = {},
): NearbyCompetitor[] {
  const seen = new Set<string>();
  const out: NearbyCompetitor[] = [];
  for (const raw of Array.isArray(places) ? places : []) {
    const c = normalizeCompetitor(raw, center, fetchedAt, self);
    if (!c || seen.has(c.placeId)) continue;
    seen.add(c.placeId);
    out.push(c);
  }
  return out.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

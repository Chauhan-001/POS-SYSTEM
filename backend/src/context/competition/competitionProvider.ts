/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionProvider.ts — the ONLY file that talks to Google Places (spec §5).
 * Endpoint: POST https://places.googleapis.com/v1/places:searchNearby
 *   (Places API — New, Nearby Search)
 *
 * The API key travels in the X-Goog-Api-Key header, sourced from server env,
 * and is NEVER logged, returned, or included in errors. A minimal
 * X-Goog-FieldMask is always sent (spec §4) so we request only the fields the
 * competition module needs — avoiding unnecessary SKUs/billing.
 */

import { config } from '../../config';

/** Field mask — minimum useful set (spec §4). Rating/userRatingCount are
 *  deliberately NOT requested in Phase 1: the module does not use them yet,
 *  and they change the billing SKU. */
export const COMPETITION_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.googleMapsUri',
].join(',');

export interface GooglePlaceRaw {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
}

export interface GoogleNearbySearchResponse {
  places?: GooglePlaceRaw[];
  error?: { code?: number; message?: string; status?: string };
}

export interface CompetitionProviderConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export function getCompetitionProviderConfig(): CompetitionProviderConfig | null {
  const { enabled, apiKey, baseUrl, timeoutMs } = config.competition;
  if (!enabled || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, timeoutMs };
}

export class CompetitionProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'http_error' | 'invalid_json' | 'timeout' | 'quota' | 'api_disabled',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CompetitionProviderError';
  }
}

export interface NearbySearchInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxResults: number;
}

/**
 * Google implementation of the CompetitionProvider interface (spec §6):
 * findNearbyRestaurants({ latitude, longitude, radiusMeters, maxResults }).
 */
export async function findNearbyRestaurants(
  cfg: CompetitionProviderConfig,
  input: NearbySearchInput,
): Promise<GoogleNearbySearchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': cfg.apiKey,
        'X-Goog-FieldMask': COMPETITION_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ['restaurant'],
        maxResultCount: Math.min(Math.max(input.maxResults, 1), 20), // Places (New) caps at 20
        rankPreference: 'POPULARITY', // Google's own ranking (spec §9) — no invented score
        locationRestriction: {
          circle: {
            center: { latitude: input.latitude, longitude: input.longitude },
            radius: Math.min(Math.max(input.radiusMeters, 1), 50_000), // Places max radius
          },
        },
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new CompetitionProviderError('Google Places quota/rate limit reached', 'quota', 429);
    }
    if (res.status === 403) {
      throw new CompetitionProviderError('Google Places rejected the request (API not enabled or key restricted)', 'api_disabled', 403);
    }
    if (!res.ok) {
      throw new CompetitionProviderError(`Google Places searchNearby failed (HTTP ${res.status})`, 'http_error', res.status);
    }
    try {
      return (await res.json()) as GoogleNearbySearchResponse;
    } catch {
      throw new CompetitionProviderError('Google Places returned invalid JSON', 'invalid_json');
    }
  } catch (err) {
    if (err instanceof CompetitionProviderError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CompetitionProviderError('Google Places request timed out', 'timeout');
    }
    throw new CompetitionProviderError(
      `Google Places unavailable: ${err instanceof Error ? err.message : String(err)}`,
      'http_error',
    );
  } finally {
    clearTimeout(timer);
  }
}

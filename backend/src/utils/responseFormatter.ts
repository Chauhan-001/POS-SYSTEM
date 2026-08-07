/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * responseFormatter.ts — Compatibility layer over the standardized response
 * envelope helpers in apiResponse.ts.
 *
 * The AI Analytics controller (Phase 2.7) imports `formatSuccess`/`formatError`
 * from this module. This adapter preserves the ONE consistent API response
 * shape documented in apiResponse.ts:
 *
 *   2xx   → { data: <payload>, message? }
 *   4xx/5xx → { error: string, code? }
 */

import { fail } from './apiResponse';

/** Standard success envelope: `{ data, message? }`. */
export function formatSuccess<T>(data: T, message?: string): { data: T; message?: string } {
  const out: { data: T; message?: string } = { data };
  if (message) out.message = message;
  return out;
}

/** Standard error envelope: `{ error, code? }`. */
export function formatError(message: string, code?: string) {
  return fail(message, code);
}

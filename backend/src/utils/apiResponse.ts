/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * apiResponse.ts — Standardized API response envelope.
 *
 * Every controller should build responses through these helpers so the API
 * has ONE consistent shape:
 *
 *   2xx   → { data: <payload>, meta?: { pagination } }
 *   4xx/5xx → { error: string, details?: Array<{ path, message, code }> }
 *
 * `paginated` derives next/previous cursors from page/totalPages and merges
 * them into the `meta` block. Helpers are pure and safe to unit test.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  next: number | null;
  previous: number | null;
}

/** Build pagination metadata (clamped, never negative) from a page result. */
export function paginationMeta(p: {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}): PaginationMeta {
  const page = Math.max(1, p.page);
  const totalPages = Math.max(1, p.totalPages);
  return {
    page,
    limit: p.limit,
    total: p.total,
    totalPages,
    next: page < totalPages ? page + 1 : null,
    previous: page > 1 ? page - 1 : null,
  };
}

/** Standard success payload. */
export function ok<T>(data: T): { data: T } {
  return { data };
}

/** Standard success payload with metadata. */
export function okWithMeta<T>(data: T, meta: Record<string, unknown>): { data: T; meta: Record<string, unknown> } {
  return { data, meta };
}

/** Standard paginated response: `{ data, meta: { pagination } }`. */
export function paginated<T>(rows: T[], p: { page: number; limit: number; total: number; totalPages: number }) {
  return {
    data: rows,
    meta: { pagination: paginationMeta(p) },
  };
}

/**
 * Alias — the session controller ships `data` as a payload and already has
 * a precomputed PaginationMeta. Accepts either the raw four-field shape or an
 * object exposing `.page/.limit/.total/.totalPages`.
 */
export function paginatedResponse<T>(
  data: T,
  meta: { page: number; limit: number; total: number; totalPages: number },
) {
  return { data, meta: { pagination: paginationMeta(meta) } };
}

export interface ErrorEnvelope {
  error: string;
  code?: string;
  details?: Array<{ path: string; message: string; code: string }>;
}

/** Standard error payload. */
export function fail(message: string, code?: string): ErrorEnvelope {
  const out: ErrorEnvelope = { error: message };
  if (code) out.code = code;
  return out;
}

/** Standard validation-error payload (mirrors the validate middleware shape). */
export function validationError(
  details: Array<{ path: string; message: string; code: string }>,
  message = 'Validation failed',
): ErrorEnvelope {
  return { error: message, code: 'VALIDATION', details };
}
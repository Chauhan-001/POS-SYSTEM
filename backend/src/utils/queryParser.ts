/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * queryParser.ts — Reusable, safe parsing of list-query parameters
 * (pagination, filtering, search, sorting) from `req.query`.
 *
 * WHERE:
 *   paginate      — derive { page, limit } with clamps and requested metadata.
 *   parseSearch   — build a case-insensitive $or regex filter over the given
 *                   searchable fields (safe — values are escaped, never used
 *                   verbatim in a dangerous context).
 *   parseSort     — whitelist sort fields so clients can never sort on
 *                   arbitrary/internal fields.
 *   parseStatus   — build an equality filter for a single status field.
 *   parseDateRange — build a { $gte, $lte } filter over a date field.
 *
 * All helpers are pure and unit-testable; they return plain Mongo filter/options.
 */

const MAX_LIMIT = 200;

/** Clamp a numeric query value into a safe page/limit. */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  defaults: { page?: number; limit?: number } = {},
): { page: number; limit: number; skip: number } {
  const rawPage = Number.parseInt(String(query.page ?? ''), 10);
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defaults.page || 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : defaults.limit || 25;
  return { page, limit, skip: (page - 1) * limit };
}

export interface SortOption {
  field: string;
  order: 'asc' | 'desc';
}

export interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Parse a whitelisted sort argument (e.g. "createdAt:desc,name:asc") into a
 * Mongo sort object. Unknown fields are dropped so callers can never sort on
 * sensitive/arbitrary columns. Falls back to a stable default when empty.
 */
export function parseSort(
  raw: unknown,
  allowedFields: string[],
  defaultSort: Record<string, 1 | -1> = { createdAt: -1 },
): Record<string, 1 | -1> {
  if (typeof raw !== 'string' || raw.trim() === '') return defaultSort;
  const allowed = new Set(allowedFields);
  const sort: Record<string, 1 | -1> = {};
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const desc = trimmed.startsWith('-');
    const f = desc ? trimmed.slice(1) : trimmed;
    if (!allowed.has(f)) continue;
    sort[f] = desc ? -1 : 1;
  }
  return Object.keys(sort).length > 0 ? sort : defaultSort;
}

/**
 * Build a case-insensitive partial-text search `$or` over the given fields.
 * The term is regex-escaped so user input can never mutate the pattern.
 */
export function parseSearch(raw: unknown, fields: string[]): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const term = raw.trim();
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const or = fields.map((f) => ({ [f]: { $regex: safe, $options: 'i' } }));
  return { $or: or };
}

/** Build an equality filter for a single field when a status/flag value is given. */
export function parseEquality(
  raw: unknown,
  field: string,
  allowedValues: (string | number | boolean)[] = [],
): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'string' ? raw : raw;
  if (allowedValues.length > 0 && typeof value === 'string' && !allowedValues.includes(value)) return null;
  return { [field]: value };
}

/**
 * Build a Mongo date-range filter `{ from?, to? }` on a given date field.
 * Accepts YYYY-MM-DD or full ISO strings and normalizes to DateTime range.
 */
export function parseDateRange(raw: unknown, field: string): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: Record<string, Date> = {};
  for (const p of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const [y, m, d] = p.split('-');
      const prefix = `${y}-${m}-${d}`;
      if (out.$gte === undefined) out.$gte = new Date(`${prefix}T00:00:00.000Z`);
      else if (out.$lte === undefined) out.$lte = new Date(`${prefix}T23:59:59.999Z`);
    } else {
      const d = new Date(p);
      if (!Number.isNaN(d.getTime())) {
        if (out.$gte === undefined) out.$gte = d;
        else out.$lte = d;
      }
    }
  }
  if (Object.keys(out).length === 0) return null;
  return { [field]: out };
}
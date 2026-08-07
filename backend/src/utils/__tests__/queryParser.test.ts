/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * queryParser tests — safe pagination / sorting / search / filter / date-range
 * parsing. All helpers are pure (no DB) so these run instantly.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePagination,
  parseSort,
  parseSearch,
  parseEquality,
  parseDateRange,
} from '../queryParser';

describe('parsePagination', () => {
  it('applies clamps and defaults', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 25, skip: 0 });
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(parsePagination({ page: '0', limit: '-5' })).toEqual({ page: 1, limit: 25, skip: 0 });
    expect(parsePagination({ page: '2', limit: '9999' })).toEqual({ page: 2, limit: 200, skip: 200 });
    expect(parsePagination({ page: 'abc', limit: 'xyz' }, { page: 2, limit: 50 })).toEqual({ page: 2, limit: 50, skip: 50 });
  });
});

describe('parseSort', () => {
  const allowed = ['name', 'createdAt', 'total'];

  it('parses whitelisted fields and drops unknown', () => {
    const s = parseSort('name,-total,secret', allowed);
    expect(s).toEqual({ name: 1, total: -1 });
  });

  it('falls back to default sort when empty or all fields are disallowed', () => {
    expect(parseSort('', allowed, { createdAt: -1 })).toEqual({ createdAt: -1 });
    expect(parseSort('-hack', allowed, { createdAt: 1 })).toEqual({ createdAt: 1 });
  });

  it('defaults to createdAt desc when no default provided', () => {
    expect(parseSort(null, allowed)).toEqual({ createdAt: -1 });
  });
});

describe('buildSearch', () => {
  it('builds an $or regex filter over multiple fields', () => {
    const f = parseSearch('alice', ['name', 'phone']);
    expect(f).toHaveProperty('$or');
    expect((f!.$or as any[]).length).toBe(2);
    expect((f!.$or as any[])[0]).toEqual({ name: { $regex: 'alice', $options: 'i' } });
  });

  it('returns null for empty/non-string input', () => {
    expect(parseSearch('', ['name'])).toBeNull();
    expect(parseSearch(undefined, ['name'])).toBeNull();
    expect(parseSearch(123 as any, ['name'])).toBeNull();
  });

  it('regex-escapes metacharacters (no pattern injection)', () => {
    const f = parseSearch('a.*+b', ['name']);
    const pattern = (f!.$or as any[])[0].name.$regex as string;
    expect(pattern).toContain('\\*');
    expect(pattern).not.toContain('(?');
  });
});

describe('parseEquality', () => {
  it('builds an equality filter for a given value', () => {
    expect(parseEquality('active', 'status')).toEqual({ status: 'active' });
  });

  it('rejects disallowed values', () => {
    expect(parseEquality('bogus', 'status', ['active', 'inactive'])).toBeNull();
  });

  it('returns null for empty', () => {
    expect(parseEquality('', 'status')).toBeNull();
    expect(parseEquality(undefined, 'status')).toBeNull();
  });
});

describe('parseDateRange', () => {
  it('parses a comma-separated YYYY-MM-DD range into $gte/$lte', () => {
    const r = parseDateRange('2026-08-01,2026-08-31', 'createdAt');
    expect(r).toHaveProperty('createdAt');
    const range = (r! as any).createdAt as { $gte?: Date; $lte?: Date };
    expect(range.$gte!.toISOString()).toContain('2026-08-01T00:00:00');
    expect(range.$lte!.toISOString()).toContain('2026-08-31T23:59:59');
  });

  it('returns null for empty input', () => {
    expect(parseDateRange('', 'createdAt')).toBeNull();
    expect(parseDateRange(undefined, 'createdAt')).toBeNull();
  });
});
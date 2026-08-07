/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * apiResponse tests — pagination metadata derivation + envelope shape.
 */

import { describe, it, expect } from 'vitest';
import { paginationMeta, ok, okWithMeta, paginated, paginatedResponse, fail, validationError } from '../apiResponse';

describe('apiResponse paginationMeta', () => {
  it('derives next/previous on a middle page', () => {
    const meta = paginationMeta({ page: 2, limit: 10, total: 50, totalPages: 5 });
    expect(meta.next).toBe(3);
    expect(meta.previous).toBe(1);
  });

  it('returns null next on the last page', () => {
    const meta = paginationMeta({ page: 5, limit: 10, total: 50, totalPages: 5 });
    expect(meta.next).toBeNull();
    expect(meta.previous).toBe(4);
  });

  it('returns null previous/null next on the first of one page', () => {
    const meta = paginationMeta({ page: 1, limit: 10, total: 4, totalPages: 1 });
    expect(meta.next).toBeNull();
    expect(meta.previous).toBeNull();
  });

  it('never returns a negative page/totalPages', () => {
    const meta = paginationMeta({ page: 0, limit: 10, total: 4, totalPages: 0 });
    expect(meta.page).toBe(1);
    expect(meta.totalPages).toBe(1);
  });
});

describe('apiResponse envelopes', () => {
  it('ok wraps payload in data', () => {
    expect(ok({ id: 1 })).toEqual({ data: { id: 1 } });
  });

  it('okWithMeta adds a meta block', () => {
    const r = okWithMeta('x', { pagination: { page: 1 } });
    expect(r.data).toBe('x');
    expect(r.meta).toEqual({ pagination: { page: 1 } });
  });

  it('paginated wraps rows with a pagination meta block', () => {
    const r = paginated([1, 2], { page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(r.data).toEqual([1, 2]);
    expect(r.meta.pagination.previous).toBeNull();
    expect(r.meta.pagination.next).toBeNull();
  });

  it('paginatedResponse is compatible with paginated', () => {
    const r = paginatedResponse({ items: [] }, { page: 1, limit: 25, total: 0, totalPages: 1 });
    expect(r.meta.pagination).toBeDefined();
    expect(r.meta.pagination.total).toBe(0);
  });

  it('fail carries an optional code', () => {
    expect(fail('bad')).toEqual({ error: 'bad' });
    expect(fail('bad', 'INTERNAL')).toEqual({ error: 'bad', code: 'INTERNAL' });
  });

  it('validationError mirrors the middleware details shape', () => {
    const r = validationError([{ path: 'name', message: 'x', code: 'too_small' }]);
    expect(r.code).toBe('VALIDATION');
    expect(r.details?.[0].path).toBe('name');
  });
});
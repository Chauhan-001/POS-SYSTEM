/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * validate middleware tests — Phase 1.10 validation of the input-validation
 * layer: valid bodies pass through (parsed), invalid bodies 400 with detailed
 * errors, and unknown non-Zod errors are forwarded to the error handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../validate';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockReq(body: unknown, query: unknown = {}, params: unknown = {}): Request {
  return { body, query, params } as unknown as Request;
}

const schema = z.object({
  name: z.string().min(2),
  amount: z.number().min(0),
});

describe('validate middleware', () => {
  it('passes a valid body through and calls next()', () => {
    const req = mockReq({ name: 'Bill', amount: 100 });
    const res = mockRes();
    const next = vi.fn();
    validate({ body: schema })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // Parsed (coerced) value is written back to req.body
    expect((req.body as any).name).toBe('Bill');
  });

  it('returns 400 with detailed errors for an invalid body', () => {
    const req = mockReq({ name: 'X', amount: -5 });
    const res = mockRes();
    const next = vi.fn();
    validate({ body: schema })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(json.error).toBe('Validation failed');
    expect(Array.isArray(json.details)).toBe(true);
    expect(json.details.length).toBeGreaterThan(0);
  });

  it('does not require a schema for parts not provided', () => {
    const req = mockReq({ name: 'Valid', amount: 1 }, { page: '1' });
    const res = mockRes();
    const next = vi.fn();
    // Only body is validated — query/params have no schema → ignored.
    validate({ body: schema })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('forwards non-Zod errors to the next handler', () => {
    const boom = new Error('boom');
    // validate() calls schema.parse() (not safeParse()) — mimic that contract.
    const throwingSchema = {
      parse: () => { throw boom; },
    } as unknown as z.ZodTypeAny;
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();
    validate({ body: throwingSchema })(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});

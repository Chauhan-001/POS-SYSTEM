/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * errorHandler tests — known AppError, Mongo duplicate-key (11000), Mongo
 * validation, and unexpected errors all map to safe, consistent responses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { errorHandler } from '../errorHandler';
import { AppError } from '../../utils/AppError';

function mockRes(): Response {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return res;
}

afterEach(() => {
  delete process.env.NODE_ENV;
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('maps an AppError to its statusCode + message', () => {
    const res = mockRes();
    errorHandler(new AppError(404, 'Customer not found'), {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Customer not found' });
  });

  it('maps a duplicate-key error (11000) to 409 with a safe message', () => {
    const res = mockRes();
    const dup = new Error('E11000 duplicate key error collection: test.bills index: restaurantId_1_clientRef_1 dup key'); 
    (dup as any).code = 11000;
    errorHandler(dup, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.error).toMatch(/already exists/);
    expect(payload.error).not.toContain('dup key');
  });

  it('maps a Mongo validation error to 400', () => {
    const res = mockRes();
    const err = new Error('validation failed'); 
    (err as any).errors = { name: { message: 'required' } };
    errorHandler(err, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Validation failed', code: 'VALIDATION' });
  });

  it('hides the raw message in production for unexpected errors', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    const boom = new Error('database connection string leaked');
    errorHandler(boom, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('reveals the raw message in development for unexpected errors', () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    const boom = new Error('weird bug for a dev');
    errorHandler(boom, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'weird bug for a dev' });
  });
});
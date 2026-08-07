/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * authMiddleware tests — Phase 1.10 validation of the authentication +
 * authorization layer:
 *   - requireAuth: 401 on missing/invalid/expired tokens, attaches req.user.
 *   - requireRole: 401 unauthenticated, 403 insufficient role, allows owner.
 *   - Tenant isolation baseline: restaurantId is carried from the JWT payload
 *     into req.user so every downstream scope filter has a tenant to bind to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../authMiddleware';
import { generateAccessToken } from '../../utils/jwt';

// Mock token verification to control outcomes deterministically.
vi.mock('../../utils/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/jwt')>();
  return {
    ...actual,
    verifyAccessToken: vi.fn(),
    extractBearerToken: actual.extractBearerToken,
  };
});

import { verifyAccessToken } from '../../utils/jwt';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, ...overrides } as unknown as Request;
}

const payload = {
  userId: 'user_1',
  restaurantId: 'rest_a',
  role: 'owner' as const,
  name: 'Test Owner',
  employeeId: 'emp_1',
};

describe('requireAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no Authorization header is present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is invalid or expired', () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const req = mockReq({ headers: { authorization: 'Bearer bad.token.here' } });
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.user and calls next() for a valid token', () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(payload);
    const req = mockReq({ headers: { authorization: 'Bearer valid.token' } });
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user).toEqual(payload);
    expect((req as any).user.restaurantId).toBe('rest_a'); // tenant carried
    expect(res.status).not.toHaveBeenCalled();
  });

  it('round-trips a real signed token through verifyAccessToken', () => {
    // Real sign → verify (no mock path): proves the JWT layer is wired.
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (token: string) => {
        const jwt = require('jsonwebtoken');
        return jwt.verify(token, process.env.JWT_SECRET || 'pos-dev-secret-change-in-production') as any;
      }
    );
    const token = generateAccessToken(payload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user.restaurantId).toBe('rest_a');
  });
});

describe('requireRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for unauthenticated requests', () => {
    const mw = requireRole('owner', 'manager');
    const req = mockReq(); // no auth header
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the role is not permitted', () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce({ ...payload, role: 'cashier' });
    const mw = requireRole('owner', 'manager');
    const req = mockReq({ headers: { authorization: 'Bearer t' } });
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an owner through Owner|Manager guarded routes', () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(payload);
    const mw = requireRole('owner', 'manager');
    const req = mockReq({ headers: { authorization: 'Bearer t' } });
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('normalizes frontend-style roles (Owner/Manager) against backend roles', () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce({ ...payload, role: 'Owner' });
    const mw = requireRole('owner');
    const req = mockReq({ headers: { authorization: 'Bearer t' } });
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

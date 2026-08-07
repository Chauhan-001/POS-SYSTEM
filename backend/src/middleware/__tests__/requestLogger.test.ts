/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * requestLogger tests — Phase 1.10 validation of the structured logging +
 * mutation audit trail:
 *   - Every request emits a structured JSON log line with tenant context.
 *   - Attributable mutations (POST/PUT/PATCH/DELETE with req.user.restaurantId)
 *     write an append-only AuditLog entry.
 *   - GET / non-attributable requests never write audit entries.
 *   - Secret-bearing payload fields are redacted before persisting.
 *   - Logging failures never break the request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { requestLogger } from '../requestLogger';

// Mock AuditLog so no DB is needed.
vi.mock('../../models/AuditLog', () => ({
  default: { create: vi.fn().mockResolvedValue({ _id: 'log_1' }) },
}));

import AuditLog from '../../models/AuditLog';

/** Build a fake res that supports res.on('finish') and status/json. */
function fakeRes(): EventEmitter & { statusCode: number; status: any; json: any } {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn(() => res);
  return res;
}

function fakeReq(over: Record<string, any> = {}) {
  return {
    method: 'GET',
    path: '/api/health',
    headers: {},
    body: undefined,
    ip: '127.0.0.1',
    ...over,
  };
}

function runToFinish(req: any, res: any, mw = requestLogger()) {
  mw(req, res, vi.fn());
  res.emit('finish');
  return res;
}

describe('requestLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a structured line for every request (method, path, status)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = fakeRes();
    runToFinish(
      fakeReq({ method: 'POST', path: '/api/bills', headers: { 'x-device-id': 'dev_1' } }),
      res
    );
    const line = logSpy.mock.calls[0][0] as string;
    expect(line.startsWith('[req]')).toBe(true);
    const entry = JSON.parse(line.replace('[req] ', ''));
    expect(entry.method).toBe('POST');
    expect(entry.path).toBe('/api/bills');
    expect(entry.status).toBe(200);
    expect(entry.deviceId).toBe('dev_1');
    logSpy.mockRestore();
  });

  it('writes an audit entry for an attributable mutation (tenant context)', () => {
    const res = fakeRes();
    runToFinish(
      fakeReq({
        method: 'PATCH',
        path: '/api/expenses/abc123',
        headers: { 'x-device-id': 'dev_2' },
        body: { amount: 500 },
        user: { userId: 'u1', restaurantId: 'rest_a', branchId: 'br_1', name: 'Owner' },
      }),
      res
    );
    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    const entry = (AuditLog.create as any).mock.calls[0][0];
    expect(entry.action).toBe('PATCH_EXPENSES');
    expect(entry.entityType).toBe('expenses');
    expect(entry.restaurantId).toBe('rest_a');
    expect(entry.branchId).toBe('br_1');
    expect(entry.performedBy).toBe('Owner');
  });

  it('does NOT audit GET requests or non-attributable mutations', () => {
    // GET with tenant context → no audit (read-only).
    runToFinish(fakeReq({ method: 'GET', path: '/api/bills', user: { restaurantId: 'rest_a' } }), fakeRes());
    // POST but no restaurant context (public) → no audit.
    runToFinish(fakeReq({ method: 'POST', path: '/api/auth/register-owner' }), fakeRes());
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing fields before persisting to the audit trail', () => {
    runToFinish(
      fakeReq({
        method: 'POST',
        path: '/api/employees',
        body: { name: 'Staff', password: 'hunter2', pin: '1234', managerPin: '9999' },
        user: { userId: 'u1', restaurantId: 'rest_a', name: 'Owner' },
      }),
      fakeRes()
    );
    const entry = (AuditLog.create as any).mock.calls[0][0];
    expect(entry.details.body.password).toBe('[REDACTED]');
    expect(entry.details.body.pin).toBe('[REDACTED]');
    expect(entry.details.body.managerPin).toBe('[REDACTED]');
    expect(entry.details.body.name).toBe('Staff'); // non-sensitive kept
  });

  it('never breaks the request when the audit write fails', async () => {
    (AuditLog.create as any).mockRejectedValueOnce(new Error('db down'));
    const res = fakeRes();
    expect(() =>
      runToFinish(
        fakeReq({ method: 'DELETE', path: '/api/bills/x', user: { restaurantId: 'rest_a', name: 'Mgr' } }),
        res
      )
    ).not.toThrow();
    // Allow the rejected promise to settle.
    await new Promise((r) => setTimeout(r, 10));
  });
});

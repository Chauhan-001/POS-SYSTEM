/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * requestLogger.ts — Structured application logging + mutation audit trail.
 *
 * Phase 1.10: every request is logged as a single JSON line with user /
 * restaurant / branch / device context, latency, and status. State-changing
 * requests (POST/PUT/PATCH/DELETE) additionally write an append-only AuditLog
 * entry (actor, entity, IP, device) so every mutation is attributable.
 *
 * Design notes:
 *  - Mounted early (before routes) so the audit trail sees every endpoint.
 *  - Logging is ALWAYS non-blocking: failures never fail the request.
 *  - Secret-bearing fields (password, PIN, tokens, keys) are redacted.
 *  - Audit entries are only written when an authenticated tenant context
 *    exists; public/unauth'd mutation attempts log to the console only.
 */

import { NextFunction, Request, Response } from 'express';
import AuditLog from '../models/AuditLog';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Fields that must never be persisted or logged in plaintext. */
const SENSITIVE_KEYS = [
  'password', 'pin', 'token', 'secret', 'key', 'authorization',
  'refreshToken', 'managerPin', 'otp', 'otpCode', 'cvv',
];

/** Paths that should never produce an audit entry (noise, or pre-auth). */
const NO_AUDIT_PREFIXES = [
  '/api/auth/refresh',
  '/api/health',
  '/api/otp/verify',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

/**
 * Recursively strip secret-bearing fields from a request body before it is
 * logged or stored. Arrays are truncated defensively (bills can carry up to
 * 500 line items — the audit trail only needs the shape, not every row).
 */
function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) {
    if (value.length > 20) return `[array:${value.length}]`;
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Extract an entity label for audit from the request path, e.g.
 * /api/customers/abc123 → customer. Used as the AuditLog entityType.
 */
function entityTypeFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // /api/<resource>/... or /api/<module>/<resource>/...
  const resource = segments.find((s) => s !== 'api');
  return resource || 'unknown';
}

function ipFrom(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip;
}

function deviceFrom(req: Request): string | undefined {
  const d = req.headers['x-device-id'] || req.headers['x-client-id'];
  if (typeof d === 'string' && d.length > 0) return d.slice(0, 120);
  return undefined;
}

/**
 * Factory middleware. Options:
 *  - `auditMutations` (default true): write AuditLog entries for mutating calls.
 */
export function requestLogger(options: { auditMutations?: boolean } = {}) {
  const { auditMutations = true } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const auth = (req as any).user as
        | { userId?: string; restaurantId?: string; branchId?: string; name?: string; role?: string; employeeId?: string }
        | undefined;

      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        userId: auth?.userId || null,
        employeeId: auth?.employeeId || null,
        restaurantId: auth?.restaurantId ? String(auth.restaurantId) : null,
        branchId: auth?.branchId ? String(auth.branchId) : null,
        role: auth?.role || null,
        operator: auth?.name || null,
        deviceId: deviceFrom(req),
        ip: ipFrom(req),
      };
      console.log(`[req] ${JSON.stringify(entry)}`);

      if (!auditMutations || !MUTATING_METHODS.has(req.method)) return;
      // Skip auth-replay and pre-auth paths — no stable tenant context yet.
      if (NO_AUDIT_PREFIXES.some((p) => req.path.startsWith(p))) return;
      // Only attributable mutations become audit entries (tenant context).
      if (!auth?.restaurantId) return;

      const auditEntry: Record<string, unknown> = {
        action: `${req.method}_${entityTypeFromPath(req.path).toUpperCase()}`,
        entityType: entityTypeFromPath(req.path),
        performedBy: auth.name || 'System',
        performedById: auth.userId || auth.employeeId,
        restaurantId: auth.restaurantId,
        ipAddress: ipFrom(req),
        details: {
          deviceId: deviceFrom(req),
          path: req.path,
          status: res.statusCode,
          body: req.body ? sanitizeForLog(req.body) : undefined,
        },
      };
      if (auth.branchId) auditEntry.branchId = auth.branchId;
      AuditLog.create(auditEntry).catch((err: any) => {
        // Audit logging must never break a request.
        console.warn('[requestLogger] audit write failed:', err?.message);
      });
    });
    next();
  };
}

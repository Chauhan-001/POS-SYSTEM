/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * audit.ts — Small helper to write consistent AuditLog entries from
 * controllers/services. Centralizes actor/request context so mutations never
 * bypass the audit trail and never forget IP/device attribution.
 *
 * Usage:
 *   await audit.action(req, 'OWNER_RESET_PIN', 'user', id, { ... });
 *
 * The helper reads actor + tenant + ip/device context from the (authenticated)
 * Express request, and always resolves — a failed audit write logs a warning
 * but never throws into the caller's request path.
 */

import { Request } from 'express';
import { auditLogRepo } from '../repositories';

interface AuditCtx {
  userId?: string;
  employeeId?: string | null;
  restaurantId?: string;
  branchId?: string;
  name?: string;
}

function ctxFromRequest(req: Request): AuditCtx {
  const auth = (req as any).user;
  return {
    userId: auth?.userId,
    employeeId: auth?.employeeId || null,
    restaurantId: auth?.restaurantId ? String(auth.restaurantId) : undefined,
    branchId: auth?.branchId ? String(auth.branchId) : undefined,
    name: auth?.name,
  };
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

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  /** Explicit override for unauthenticated/system actions. */
  performedBy?: string;
  performedById?: string;
  restaurantId?: string;
}

/**
 * Write an audit entry using request context. Never throws.
 */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  const ctx = ctxFromRequest(req);
  try {
    const entry: Record<string, unknown> = {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      performedBy: input.performedBy || ctx.name || ctx.userId || 'System',
      performedById: input.performedById || ctx.userId || ctx.employeeId || undefined,
      restaurantId: input.restaurantId || ctx.restaurantId || undefined,
      branchId: ctx.branchId,
      ipAddress: ipFrom(req),
      details: {
        ...(input.details || {}),
        ...(deviceFrom(req) ? { deviceId: deviceFrom(req) } : {}),
      },
    };
    auditLogRepo.create(entry as any).catch((err: any) => {
      console.warn('[audit] write failed:', err?.message);
    });
  } catch (err: any) {
    console.warn('[audit] failed to prepare entry:', err?.message);
  }
}
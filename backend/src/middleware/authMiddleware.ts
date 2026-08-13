/**
 * =============================================================================
 *  authMiddleware.ts — JWT Authentication & Role Authorization
 * =============================================================================
 *
 * Purpose:
 *   - requireAuth: Validates JWT Bearer token from Authorization header.
 *   - requireRole: Validates token AND checks user has one of the required roles.
 *   - requireAdmin / requireOwner: Convenience shortcuts for common role checks.
 *
 * Usage:
 *   router.get('/employees', requireAuth, handler)
 *   router.post('/products', requireRole('owner', 'manager'), handler)
 *
 * Dependencies:
 *   - utils/jwt.ts for token verification
 *   - models for UserRole type
 *
 * Security:
 *   - Tokens are extracted from "Authorization: Bearer <token>" header
 *   - Role normalization maps frontend role names ("Owner") to backend ("owner")
 *   - 401 for missing/invalid tokens, 403 for insufficient role permissions
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, extractBearerToken } from '../utils/jwt';
import type { UserRole } from '../models';

// ─── Constants ───────────────────────────────────────────────────

/** All available roles (for validation/comparison) */
export const ALL_ROLES: UserRole[] = ['super_admin', 'owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory'];

// ─── Types ───────────────────────────────────────────────────────

/** Extended Request with authenticated user payload */
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    restaurantId: string;
    role: UserRole;
    name?: string;
    employeeId?: string | null;
    branchIds?: string[];
  };
}

// ─── Helper: Role Normalization ──────────────────────────────────

/** Maps frontend-style roles ("Owner") to backend UserRole ("owner") */
const ROLE_MAP: Record<string, UserRole> = {
  'Owner': 'owner',
  'Manager': 'manager',
  'Cashier': 'cashier',
  'Waiter': 'waiter',
  'Kitchen': 'kitchen',
  'Inventory': 'inventory',
  'super_admin': 'super_admin',
  'owner': 'owner',
  'manager': 'manager',
  'cashier': 'cashier',
  'waiter': 'waiter',
  'kitchen': 'kitchen',
  'inventory': 'inventory',
};

function normalizeRole(role: string): UserRole | null {
  return ROLE_MAP[role] || null;
}

// ─── Middleware: requireAuth ─────────────────────────────────────

/**
 * Validates JWT Bearer token. Injects req.user on success.
 * Returns 401 with descriptive error if token is missing or invalid.
 *
 * Surface guard: this is the POS-terminal gate — tokens minted for the admin
 * dashboard (surface 'admin') are rejected here with 403, so an admin can never
 * act as a restaurant user on the POS. Legacy tokens without a surface claim
 * are treated as POS tokens.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Provide a valid JWT token via Authorization: Bearer <token>' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (payload.surface === 'admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Admin dashboard tokens cannot be used on POS routes',
    });
    return;
  }

  (req as AuthenticatedRequest).user = payload;
  next();
}

/**
 * Admin-dashboard gate. Accepts ONLY tokens minted by the admin login
 * (surface 'admin' — i.e. super_admin). POS tokens are rejected with 403,
 * so a restaurant user can never act as the platform admin.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Provide a valid JWT token via Authorization: Bearer <token>' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (payload.surface !== 'admin' || payload.role !== 'super_admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint requires an admin dashboard token',
    });
    return;
  }

  (req as AuthenticatedRequest).user = payload;
  next();
}

// ─── Middleware: requireRole (factory) ───────────────────────────

/**
 * Factory that returns middleware. Validates token AND checks user's role
 * is in the allowed list. Normalizes role names for compatibility.
 *
 * @param roles - One or more allowed roles
 * @returns Express middleware function
 */
export function requireRole(...roles: (UserRole | 'Owner' | 'Manager' | 'Cashier' | 'Waiter' | 'Kitchen' | 'Inventory')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    if (payload.surface === 'admin') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin dashboard tokens cannot be used on POS routes',
      });
      return;
    }

    const normalizedPayloadRole = normalizeRole(payload.role);
    const allowedRoles = roles.map(r => normalizeRole(r as string)).filter(Boolean) as UserRole[];

    if (!normalizedPayloadRole || !allowedRoles.includes(normalizedPayloadRole)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${payload.role}' does not have permission. Required: ${allowedRoles.join(' or ')}`,
      });
      return;
    }

    (req as AuthenticatedRequest).user = payload;
    next();
  };
}

// ─── Convenience Shortcuts ───────────────────────────────────────

/** Require admin-level access (super_admin, owner, or manager) */
export const requireAdmin = () => requireRole('super_admin', 'owner', 'manager');

/** Require owner-level access (owner or super_admin) */
export const requireOwner = () => requireRole('owner', 'super_admin');

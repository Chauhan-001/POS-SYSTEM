/**
 * =============================================================================
 *  authController.ts — POS Terminal Authentication
 * =============================================================================
 *
 * Controllers:
 *   login          — POST /api/auth/login (username + PIN → JWT)
 *   refresh        — POST /api/auth/refresh (refresh token → new JWT)
 *   logout         — POST /api/auth/logout (invalidate refresh token)
 *   me             — GET  /api/auth/me (current user from JWT)
 *   checkOwnerExists — GET  /api/auth/owner-exists
 *   registerOwner  — POST /api/auth/register-owner (first-time setup)
 *
 * Notes:
 *   - All business logic delegates to authService
 *   - On successful login, calls resetAccountBackoff() to clear rate limiter
 *   - Different error messages map to different HTTP status codes
 */

import { Request, Response } from 'express';
import { authService } from '../services';
import { resetAccountBackoff } from '../middleware/rateLimiter';
import { DeviceBlockedError, DeviceLimitReachedError } from '../services/devicePolicyService';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { auditLogRepo } from '../repositories';

function clientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip;
}

/**
 * Record a failed login attempt for audit + failed-attempt tracking.
 * Best-effort — never fails the request.
 */
async function recordFailedLogin(req: Request, attempted: { username?: string; phone?: string }): Promise<void> {
  try {
    const AuditLog = (await import('../models/AuditLog')).default;
    const User = (await import('../models/User')).default;
    const username = attempted.username?.toLowerCase();
    const phone = attempted.phone;

    let ownerUser = null;
    if (username) {
      ownerUser = await User.findOne({ userId: username, role: 'owner' }).lean().exec();
    }
    if (!ownerUser && phone) {
      ownerUser = await User.findOne({ phone, role: 'owner' }).lean().exec();
    }

    if (ownerUser) {
      await User.updateOne(
        { _id: ownerUser._id },
        { $inc: { failedLoginAttempts: 1 } },
      ).exec();
    }

    await AuditLog.create({
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: ownerUser?._id?.toString() || undefined,
      performedBy: ownerUser?.name || username || phone || 'unknown',
      performedById: ownerUser?._id?.toString(),
      ipAddress: clientIp(req),
      details: { username: attempted.username || null, phone: attempted.phone || null },
    } as any);
  } catch {
    /* best-effort */
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const result = await authService.login({
      ...req.body,
      ipAddress: clientIp(req),
      userAgent: (req.headers['user-agent'] as string) || undefined,
    });
    // Reset the rolling failed-login counter on success.
    if (req.body?.username) {
      const User = (await import('../models/User')).default;
      await User.updateOne({ userId: String(req.body.username).toLowerCase(), role: 'owner' }, { $set: { failedLoginAttempts: 0 } }).exec();
    }
    resetAccountBackoff(req);
    res.json(result);
  } catch (error: any) {
    recordFailedLogin(req, { username: req.body?.username, phone: req.body?.phone });
    if (error instanceof DeviceBlockedError || error instanceof DeviceLimitReachedError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error.message === 'Restaurant not found') {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error.message.includes('inactive') || error.message.includes('suspended')) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error.message === 'Invalid phone or password' || error.message === 'Invalid username or password') {
      res.status(401).json({ error: error.message });
      return;
    }
    console.error('[AuthController] Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken, deviceId } = req.body;
    const result = await authService.refresh(refreshToken, deviceId);
    res.json(result);
  } catch (error: any) {
    if (error instanceof DeviceBlockedError || error instanceof DeviceLimitReachedError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error.message.includes('expired') || error.message.includes('revoked') || error.message.includes('Invalid')) {
      res.status(401).json({ error: error.message });
      return;
    }
    if (error.message.includes('inactive') || error.message === 'User not found' || error.message === 'Restaurant is inactive') {
      res.status(403).json({ error: error.message });
      return;
    }
    console.error('[AuthController] Refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { refreshToken, allDevices } = req.body;

    if (allDevices && user) {
      await authService.logoutAll(user.userId);
      res.json({ message: 'Logged out from all devices' });
      return;
    }

    if (user) {
      await authService.logout(user.userId, refreshToken);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('[AuthController] Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    res.json({ user: authReq.user });
  } catch (error) {
    console.error('[AuthController] Me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function checkOwnerExists(_req: Request, res: Response): Promise<void> {
  try {
    const exists = await authService.ownerExists();
    res.json({ exists });
  } catch (error) {
    console.error('[AuthController] checkOwnerExists error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function registerOwner(req: Request, res: Response): Promise<void> {
  try {
    const result = await authService.registerOwner(req.body);
    res.status(201).json({ success: true, token: result.accessToken, employee: result.employee, user: result.user, restaurant: result.restaurant });
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[AuthController] registerOwner error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/generate-credentials — mint a unique User ID + hashed password
 * for a staff member (Owner role only). Returns the plaintext userId/password
 * exactly once so it can be handed to the staff member; only the hash persists.
 */
export async function generateCredentials(req: Request, res: Response): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, role, avoid } = req.body || {};

    const generated = await authService.generateStaffCredentials(
      String(name || 'staff').slice(0, 40),
      ['Owner', 'Manager', 'Cashier'].includes(role) ? role : 'Cashier',
      Array.isArray(avoid) ? avoid.map(String) : undefined,
    );

    await auditLogRepo.create({
      action: 'CREDENTIALS_GENERATED',
      entityType: 'employee',
      performedBy: authReq.user?.name || 'unknown',
      performedById: authReq.user?.userId,
      restaurantId: authReq.user?.restaurantId,
      details: { role: generated.role, userId: generated.userId, name: String(name || 'staff').slice(0, 40) },
    } as any);

    res.json({ userId: generated.userId, password: generated.password, passwordHash: generated.passwordHash, role: generated.role });
  } catch (error) {
    console.error('[AuthController] generateCredentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

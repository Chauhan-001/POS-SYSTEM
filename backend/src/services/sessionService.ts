/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sessionService.ts — Centralized session & refresh-token management.
 *
 * Builds on the existing refresh-token rotation in authService but adds the
 * platform-level session concerns Phase 2.1 requires:
 *
 *   - listSessions   : active refresh sessions for a user (with device context).
 *   - revokeSession  : force-logout of a single session (token hash).
 *   - revokeAll      : force-logout of every session for a user.
 *   - detectReuse    : claims a presented refresh token for replay detection.
 *     When a token that was already rotated/revoked is presented again, the
 *     account's other sessions are revoked and an audit event is written.
 *     This is the "compromised token protection" safeguard.
 *
 * Session metadata is stored on the RefreshToken document (deviceId, deviceName,
 * os, appVersion, lastActivityAt), so no new collection is introduced.
 *
 * All writes go through the existing auditLog repo so nothing bypasses audit.
 */

import { refreshTokenRepo, auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import crypto from 'crypto';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireUser(actor: { performedBy: string; performedById?: string }, restaurantId?: string) {
  return {
    action: '', // caller sets
    entityType: 'session',
    performedBy: actor.performedBy,
    performedById: actor.performedById,
    restaurantId,
  };
}

export class SessionService {
  /**
   * Attach device/session metadata to an existing refresh token (called by
   * authService after minting). Best-effort — never fails the request.
   */
  async touchSession(
    tokenHash: string,
    meta: { deviceId?: string; deviceName?: string; os?: string; appVersion?: string; restaurantId?: string },
  ): Promise<void> {
    try {
      await refreshTokenRepo.update(
        tokenHash,
        {
          ...(meta.deviceId ? { deviceId: meta.deviceId } : {}),
          ...(meta.deviceName ? { deviceName: meta.deviceName } : {}),
          ...(meta.os ? { os: meta.os } : {}),
          ...(meta.appVersion ? { appVersion: meta.appVersion } : {}),
          ...(meta.restaurantId ? { restaurantId: meta.restaurantId } : {}),
          lastActivityAt: new Date(),
        } as any,
      );
    } catch {
      /* non-blocking */
    }
  }

  /**
   * List active (non-revoked, not-expired) refresh sessions for a user.
   * Each row carries the device context captured at login/refresh.
   */
  async listSessions(userId: string) {
    const now = new Date();
    const [docs, total] = await Promise.all([
      refreshTokenRepo.findAll(
        { userId: userId as any, isRevoked: false, expiresAt: { $gt: now } } as any,
        { page: 1, limit: 200, sort: { lastActivityAt: -1, createdAt: -1 } },
      ),
      refreshTokenRepo.count({ userId: userId as any, isRevoked: false, expiresAt: { $gt: now } } as any),
    ]);

    const sessions = (docs.data ?? [])
      .filter(Boolean)
      .map((d: any) => ({
        id: d._id.toString(),
        deviceId: d.deviceId || null,
        deviceName: d.deviceName || null,
        os: d.os || null,
        appVersion: d.appVersion || null,
        createdAt: d.createdAt ? d.createdAt.toISOString() : null,
        expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
        lastActivityAt: d.lastActivityAt ? d.lastActivityAt.toISOString() : null,
        isActive: !d.isRevoked && d.expiresAt > now,
      }));

    return { sessions, total };
  }

  /**
   * Revoke a single session by its refresh-token document id. The session id
   * is the RefreshToken _id returned by listSessions.
   */
  async revokeSession(
    sessionId: string,
    userId: string,
    actor: { id: string; name?: string },
    restaurantId?: string,
  ): Promise<boolean> {
    const target = await refreshTokenRepo.findById(sessionId);
    if (!target) throw new AppError(404, 'Session not found');
    // Ensure scope: a user can only revoke their own sessions.
    if (String((target as any).userId) !== userId) {
      throw new AppError(403, 'Cannot revoke another user\'s session');
    }
    await refreshTokenRepo.update(sessionId, { isRevoked: true } as any);

    await auditLogRepo.create({
      action: 'SESSION_REVOKE',
      entityType: 'session',
      entityId: sessionId,
      performedBy: actor.id || 'System',
      performedById: actor.id,
      restaurantId: restaurantId || target.restaurantId,
      details: { deviceId: (target as any).deviceId || null, deviceName: (target as any).deviceName || null },
    } as any);

    return true;
  }

  /**
   * Revoke every active session for a user (force logout all devices).
   */
  async revokeAllSessions(
    userId: string,
    actor: { id: string; name?: string },
    restaurantId?: string,
  ): Promise<number> {
    const res = await refreshTokenRepo.updateMany(
      { userId: userId as any, isRevoked: false } as any,
      { isRevoked: true } as any,
    );
    await auditLogRepo.create({
      action: 'SESSION_REVOKE_ALL',
      entityType: 'session',
      performedBy: actor.name || actor.id,
      performedById: actor.id,
      restaurantId: restaurantId || undefined,
      details: { revoked: res },
    } as any);
    return res || 0;
  }

  /**
   * Reuse (compromise) detection. Called by authService.refresh BEFORE minting
   * a new token. The provided refresh token's SHA-256 hash is looked up:
   *  - Found + not revoked     → normal, first presentation. No action.
   *    (the caller immediately issues a new rotated token / revokes old).
   *  - Found + already revoked → the token was rotated already and is being
   *    replayed → revoke ALL of the user's other active sessions and audit.
   *
   * Returns true when a compromise is detected so the caller can short-circuit.
   */
  async detectReuse(
    refreshToken: string,
    userId: string,
    restaurantId?: string,
  ): Promise<boolean> {
    const tokenHash = hashToken(refreshToken);
    const stored = await refreshTokenRepo.findOne({ tokenHash } as any);
    if (!stored) return false;

    if (stored.isRevoked || (stored.expiresAt && new Date() > stored.expiresAt)) {
      // This token was rotated/expired and is now being replayed.
      await this.revokeAllSessions(userId, { id: userId, name: 'reuse-detection' }, restaurantId);
      await auditLogRepo.create({
        action: 'TOKEN_REUSE',
        entityType: 'session',
        performedBy: userId,
        performedById: userId,
        restaurantId: restaurantId || stored.restaurantId,
        details: { tokenId: stored._id.toString(), deviceId: (stored as any).deviceId || null },
      } as any);
      return true;
    }
    return false;
  }
}

export const sessionService = new SessionService();
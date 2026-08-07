/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sessionController.ts — Session & refresh-token management endpoints.
 *
 *   GET    /api/sessions          — list the caller's active sessions
 *   DELETE /api/sessions/:id      — revoke one session (force logout device)
 *   POST   /api/sessions/revoke-all — revoke every session for the caller
 *
 * These are scoped to the authenticated user: a user can only list/revoke
 * their own sessions (ownership enforced in the service). Responses use the
 * standardized envelope from utils/apiResponse.
 */

import { Response } from 'express';
import { sessionService } from '../services/sessionService';
import { ok, paginatedResponse, fail, paginationMeta } from '../utils/apiResponse';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function listSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json(fail('Authentication required', 'UNAUTHENTICATED'));
      return;
    }
    const { sessions, total } = await sessionService.listSessions(req.user.userId);
    const page = 1;
    const limit = 200;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json(
      paginatedResponse(
        sessions,
        paginationMeta({ page, limit, total, totalPages }),
      ),
    );
  } catch (error) {
    console.error('[SessionController] list error:', error);
    res.status(500).json(fail('Internal server error', 'INTERNAL'));
  }
}

export async function revokeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json(fail('AuthenticationRequired', 'UNAUTHENTICATED'));
      return;
    }
    const { id } = req.params;
    await sessionService.revokeSession(id, req.user.userId, { id: req.user.userId, name: req.user.name }, req.user.restaurantId);
    res.json({ data: { message: 'Session revoked' } });
  } catch (error: any) {
    if (error?.statusCode === 404) { res.status(404).json(fail('Session not found', 'NOT_FOUND')); return; }
    if (error?.statusCode === 403) { res.status(403).json(fail(error.message, 'FORBIDDEN')); return; }
    console.error('[SessionController] revoke error:', error);
    res.status(500).json(fail('Internal server error', 'INTERNAL'));
  }
}

export async function revokeAllSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json(fail('AuthenticationRequired', 'UNAUTHENTICATED'));
      return;
    }
    const revoked = await sessionService.revokeAllSessions(req.user.userId, { id: req.user.userId, name: req.user.name }, req.user.restaurantId);
    res.json({ data: { message: 'All sessions revoked', revokedCount: revoked } });
  } catch (error) {
    console.error('[SessionController] revoke-all error:', error);
    res.status(500).json(fail('Internal server error', 'INTERNAL'));
  }
}
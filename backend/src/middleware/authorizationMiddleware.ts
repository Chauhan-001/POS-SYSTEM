/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authorization Middleware — Collection-level access enforcement for admin routes.
 *
 * Usage:
 *   router.get('/admin/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'read'), handler)
 *
 * The middleware looks up the authenticated user's authorization record in the
 * 'authorizations' collection. If the user has the required action (or 'admin'
 * which grants all actions) on the target collection, the request proceeds.
 * Otherwise, a 403 Forbidden response is returned.
 *
 * Note: This middleware MUST be placed AFTER requireAuth, since it depends on
 * req.user being populated by the JWT auth middleware.
 */

import { Response, NextFunction } from 'express';
import Authorization from '../models/Authorization';
import type { AuthenticatedRequest } from './authMiddleware';
import type { AuthorizationAction } from '../models/Authorization';

/**
 * Middleware factory — returns middleware that checks if the authenticated user
 * has the required `action` on the given `collection`.
 *
 * @param collection - Target MongoDB collection name (e.g. 'Restaurant', 'User')
 * @param action - Required action ('create' | 'read' | 'update' | 'delete' | 'admin')
 */
export function requireCollectionAccess(collection: string, action: AuthorizationAction) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const authz = await Authorization.findOne({
        principalId: req.user.userId,
        principalType: 'user',
        targetCollection: collection,
        isActive: true,
      }).exec();

      if (!authz) {
        res.status(403).json({
          error: 'Forbidden',
          message: `No authorization granted for collection '${collection}'`,
        });
        return;
      }

      // 'admin' action grants all permissions on the collection
      if (authz.actions.includes('admin') || authz.actions.includes(action)) {
        next();
      } else {
        res.status(403).json({
          error: 'Forbidden',
          message: `Action '${action}' not allowed on collection '${collection}'`,
        });
      }
    } catch (error) {
      console.error('[AuthzMiddleware] Error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
}

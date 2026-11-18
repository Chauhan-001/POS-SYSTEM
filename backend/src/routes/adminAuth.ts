import type { Router } from 'express';
import {
  adminLogin,
  adminProfile,
  adminUpdateProfile,
  adminChangePassword,
} from '../controllers/admin/adminAuthController';
import { authIpLimiter, accountBackoff } from '../middleware/rateLimiter';
import { requireAdminAuth as requireAuth } from '../middleware/authMiddleware';
import { requireCollectionAccess } from '../middleware/authorizationMiddleware';
import { validate } from '../middleware/validate';
import { adminLoginSchema } from '../validation';

/**
 * Register the admin authentication/profile surface separately from the
 * platform resource routes. Keeping this boundary explicit makes the large
 * admin route registry easier to audit without changing its public paths.
 */
export function registerAdminAuthRoutes(router: Router): void {
  router.post(
    '/auth/admin/login',
    validate({ body: adminLoginSchema }),
    authIpLimiter,
    accountBackoff,
    adminLogin,
  );
  router.get('/auth/admin/profile', requireAuth, requireCollectionAccess('User', 'read'), adminProfile);
  router.put('/auth/admin/profile', requireAuth, requireCollectionAccess('User', 'update'), adminUpdateProfile);
  router.put('/auth/admin/change-password', requireAuth, requireCollectionAccess('User', 'update'), adminChangePassword);
}

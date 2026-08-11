/**
 * =============================================================================
 *  auth.ts — Authentication API Routes
 * =============================================================================
 *
 * Purpose:
 *   POS terminal authentication routes.
 *   Handles owner registration, employee/PIN login, token refresh, and logout.
 *
 * Routes:
 *   GET  /owner-exists   — Check if any Owner is registered (first-time setup)
 *   POST /register-owner — Register the first Owner (first-time setup)
 *   POST /login          — Employee login via username + PIN
 *   POST /refresh        — Refresh JWT access token
 *   POST /logout         — Invalidate refresh token
 *   GET  /me             — Get current user profile
 *
 * Security:
 *   - Login has authIpLimiter + accountBackoff (brute-force protection)
 *   - Public endpoints (owner-exists, register-owner) use publicLimiter
 *   - Protected endpoints (logout, me) require valid JWT
 */

import { Router } from 'express';
import { login, refresh, logout, me, checkOwnerExists, registerOwner, generateCredentials } from '../controllers/authController';
import { authIpLimiter, accountBackoff, publicLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { loginSchema, refreshTokenSchema, logoutSchema, ownerRegistrationSchema, generateCredentialsSchema } from '../validation';
import { requireAuth, requireOwner } from '../middleware/authMiddleware';

const router = Router();

// ─── Public Routes ──────────────────────────────────────────────
router.get('/owner-exists', publicLimiter, checkOwnerExists);
router.post('/register-owner', validate({ body: ownerRegistrationSchema }), publicLimiter, registerOwner);

// ─── Authenticated Routes ───────────────────────────────────────
router.post('/login', validate({ body: loginSchema }), authIpLimiter, accountBackoff, login);
router.post('/refresh', validate({ body: refreshTokenSchema }), publicLimiter, refresh);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.post('/generate-credentials', requireAuth, requireOwner(), validate({ body: generateCredentialsSchema }), generateCredentials);

export default router;

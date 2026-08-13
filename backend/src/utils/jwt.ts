/**
 * =============================================================================
 *  jwt.ts — JWT Token Generation & Verification
 * =============================================================================
 *
 * Purpose:
 *   Generate and verify JWT access tokens and refresh tokens.
 *   Used by authMiddleware.ts for authentication and by auth controllers.
 *
 * Token Types:
 *   1. Access Token  (short-lived: 15min default, 24h with rememberMe)
 *      - Payload: userId, restaurantId, role, name, employeeId, branchIds
 *   2. Refresh Token (long-lived: 7d default, 30d with rememberMe)
 *      - Payload: userId, tokenId
 *
 * Usage:
 *   import { generateAccessToken, verifyAccessToken, extractBearerToken } from '../utils/jwt';
 *
 * Security:
 *   - Access tokens signed with config.jwtSecret
 *   - Refresh tokens signed with config.refreshSecret (separate rotation)
 *   - Bearer token extraction from Authorization header
 *   - Verification returns null on any error (expired, invalid signature, etc.)
 */

import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { UserRole } from '../models';

// ─── Types ───────────────────────────────────────────────────────

export interface AccessTokenPayload {
  userId: string;
  restaurantId: string;
  role: UserRole;
  name?: string;
  employeeId?: string | null;
  branchIds?: string[];
  /**
   * Which product surface this token was minted for.
   *   - 'pos'   → POS terminal / restaurant staff tokens (owner/manager/cashier/...)
   *   - 'admin' → Admin dashboard (super_admin) tokens
   * Middleware rejects tokens presented on the wrong surface, so an admin token
   * can never act as a POS user (or vice versa). Missing = legacy POS token.
   */
  surface?: 'pos' | 'admin';
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

// ─── Access Tokens (short-lived) ────────────────────────────────

/** Generate a JWT access token with configurable expiry */
export function generateAccessToken(payload: AccessTokenPayload, rememberMe = false): string {
  const expiresIn = rememberMe ? '24h' : '15m';
  return jwt.sign(payload, config.jwtSecret, { expiresIn, issuer: config.jwtIssuer });
}

/** Verify a JWT access token. Returns decoded payload or null on failure. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret, { issuer: config.jwtIssuer }) as AccessTokenPayload;
  } catch {
    return null;
  }
}

// ─── Refresh Tokens (long-lived) ────────────────────────────────

/** Generate a JWT refresh token with configurable expiry */
export function generateRefreshToken(payload: RefreshTokenPayload, rememberMe = false): string {
  const expiresIn = rememberMe ? '30d' : '7d';
  return jwt.sign(payload, config.refreshSecret, { expiresIn, issuer: config.jwtIssuer });
}

/** Verify a JWT refresh token. Returns decoded payload or null on failure. */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return jwt.verify(token, config.refreshSecret, { issuer: config.jwtIssuer }) as RefreshTokenPayload;
  } catch {
    return null;
  }
}

// ─── Token Extraction ────────────────────────────────────────────

/** Extract Bearer token from Authorization header string */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bcrypt Utility — PIN hashing and verification for employee authentication.
 *
 * PINs are hashed with bcrypt before storage (10 salt rounds).
 * Verification uses bcrypt.compare() to prevent timing attacks.
 *
 * Usage:
 *   import { hashPin, verifyPin } from '../utils/bcrypt';
 *
 *   // Before saving a new/modified PIN:
 *   const hashed = await hashPin('3333');
 *
 *   // During login:
 *   const isValid = await verifyPin('3333', storedHash);
 */

import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext PIN with bcrypt.
 * Returns the hashed string suitable for storage.
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Verify a plaintext PIN against a bcrypt hash.
 * Returns true if the PIN matches, false otherwise.
 * Silently catches errors (returns false) to avoid leaking valid employee info.
 */
export async function verifyPin(plainPin: string, hashedPin: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plainPin, hashedPin);
  } catch {
    return false;
  }
}

/**
 * Check if a PIN string is already a bcrypt hash.
 * Useful to avoid double-hashing when updating employee records.
 */
export function isBcryptHash(str: string): boolean {
  return str.startsWith('$2b$') || str.startsWith('$2a$') || str.startsWith('$2y$');
}

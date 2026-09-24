/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * credentialCrypto.ts — Centralized WhatsApp credential encryption/decryption.
 *
 * This is the SINGLE implementation for WhatsApp credential encryption.
 * All other modules MUST import from here and MUST NOT duplicate this logic.
 *
 * Algorithm: AES-256-GCM with random 12-byte IV and authentication tag.
 * Key derivation: SHA-256 of the configured encryption key.
 * AAD: fixed string for additional authentication.
 *
 * Production requirement:
 *   - WHATSAPP_ENCRYPTION_KEY must be set in the environment.
 *   - If missing in production, the application MUST fail at startup.
 *
 * Format: base64(iv):base64(tag):base64(ciphertext)
 */

import crypto from 'node:crypto';
import { config } from '../../../config';

const ALGO = 'aes-256-gcm';
const AAD = 'whatsapp-integration-credentials';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = config.whatsapp.encryptionKey;

  if (!raw || raw === 'pos-whatsapp-dev-key-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WHATSAPP_ENCRYPTION_KEY must be set in production');
    }
  }

  cachedKey = crypto.createHash('sha256').update(raw).digest();
  return cachedKey;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  cipher.setAAD(Buffer.from(AAD));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid credential format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const data = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAAD(Buffer.from(AAD));
  decipher.setAuthTag(tag);

  return decipher.update(data).toString('utf8') + decipher.final().toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.includes(':') && value.split(':').length === 3;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * masking.ts — Centralized sensitive-field masking.
 *
 * Applied on WRITE (before a detail/metadata payload is persisted) and on READ
 * (before an audit entry leaves the API). Nothing sensitive is ever stored or
 * served; `[REDACTED]` is the only visible representation.
 */

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /^pin$/i,
  /managerpin/i,
  /otp/i,
  /token/i,
  /refreshToken/i,
  /accessToken/i,
  /api[_-]?key/i,
  /apikey/i,
  /secret/i,
  /authorization/i,
  /^key$/i,
  /cvv/i,
  /card[_-]?number/i,
  /pan/i,
  /cardno/i,
  /client[_-]?secret/i,
  /private[_-]?key/i,
  /signature/i,
  /bearer/i,
];

const PII_KEY_PATTERNS = [
  /phone/i,
  /mobile/i,
  /^email$/i,
  /aadhaar/i,
  /ssn/i,
  /id_number/i,
  /passport/i,
];

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(lower));
}

export function isPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PII_KEY_PATTERNS.some((p) => p.test(lower));
}

/** Recursively mask secret-bearing fields. Arrays are truncated defensively. */
export function maskSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) {
    if (value.length > 50) return `[array:${value.length}]`;
    return value.map((v) => maskSecrets(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = '[REDACTED]';
      else out[k] = maskSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Mask PII in addition to secrets. Used on the READ path (queries, exports,
 * detail views) so phone numbers / emails are never served, even though the
 * write path already avoids the worst offenders.
 */
export function maskPii(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) {
    return value.map((v) => maskPii(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = '[REDACTED]';
      else if (isPiiKey(k)) out[k] = '[REDACTED]';
      else out[k] = maskPii(v, depth + 1);
    }
    return out;
  }
  return value;
}
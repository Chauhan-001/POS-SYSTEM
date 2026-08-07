/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * security.ts — Zod validation for the Admin Security (IP blocklist) module.
 *
 * Supports blocking exact IPs, CIDR ranges and prefixes. Duration is expressed
 * in hours (permanent when omitted / 0).
 */

import { z } from 'zod';
import { objectId } from './common';

/** IP / CIDR / prefix matcher — e.g. 203.0.113.7, 203.0.113.0/24, 203.0.113., ::1, 2001:db8::/32. */
export const ipOrRangeSchema = z
  .string()
  .min(1)
  .max(64)
  .trim()
  .regex(
    /^[0-9a-fA-F:.]+(\/\d{1,3})?\.?$/,
    'Must be a valid IP, CIDR range, or prefix (e.g. 203.0.113.7, 203.0.113.0/24)'
  );

/** Params for /admin/security/blocked-ips/:id */
export const blockedIpParamsSchema = z.object({
  id: objectId,
}).strict();

/** Body for POST /admin/security/blocked-ips — block an IP/range. */
export const blockIpSchema = z.object({
  ip: ipOrRangeSchema,
  reason: z.string().max(500).trim().default(''),
  /** Duration in hours; 0 or omitted = permanent. */
  hours: z.coerce.number().int().min(0).max(24 * 365 * 5).optional(),
}).strict();

/** List query for GET /admin/security/blocked-ips. */
export const blockedIpListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(200)).optional(),
  search: z.string().max(200).optional(),
  status: z.enum(['active', 'expired']).optional(),
  sortBy: z.enum(['createdAt', 'expiresAt', 'ip']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).strict();

export default {
  ipOrRangeSchema,
  blockedIpParamsSchema,
  blockIpSchema,
  blockedIpListQuerySchema,
};

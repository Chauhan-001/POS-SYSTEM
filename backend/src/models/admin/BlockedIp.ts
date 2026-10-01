/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BlockedIp Model — Manual IP blocklist.
 *
 * An admin can block an attacker IP from the admin dashboard. The ipBlocklist
 * middleware checks every incoming request against this collection (with an
 * in-memory cache) and rejects blocked IPs with 403.
 *
 * Supports:
 *   - Exact IPs (IPv4 / IPv6)
 *   - CIDR ranges (e.g. 203.0.113.0/24) and bare prefixes (203.0.113.)
 *   - Permanent blocks and temporary blocks (expiresAt)
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IBlockedIp extends Document {
  /** Exact IP, CIDR range, or prefix (e.g. "203.0.113.7", "203.0.113.0/24", "203.0.113."). */
  ip: string;
  /** Why this IP was blocked (admin-provided). */
  reason: string;
  /** Admin who blocked it. */
  blockedBy: string;
  blockedById?: string | null;
  /** True = never expires; false = expires at expiresAt. */
  permanent: boolean;
  /** When the block auto-expires (permanent blocks have null). */
  expiresAt?: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BlockedIpSchema = new Schema<IBlockedIp>(
  {
    ip: { type: String, required: true, trim: true },
    reason: { type: String, trim: true, default: '' },
    blockedBy: { type: String, default: 'System' },
    blockedById: { type: String, default: null },
    permanent: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

BlockedIpSchema.index({ isActive: 1, expiresAt: 1 });
// Only one ACTIVE entry per IP/range — concurrent block requests can't create
// duplicates. Inactive (unblocked) entries are excluded so a previously
// unblocked IP can be re-blocked later.
BlockedIpSchema.index({ ip: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export default mongoose.model<IBlockedIp>('BlockedIp', BlockedIpSchema);

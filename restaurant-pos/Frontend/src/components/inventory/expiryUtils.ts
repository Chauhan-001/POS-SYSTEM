/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * expiryUtils — shared expiry-date helpers for the inventory module.
 */

/** Whole days from today until a YYYY-MM-DD expiry (negative = already expired). */
export function daysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(`${expiryDate}T00:00:00`);
  if (isNaN(t.getTime())) return Infinity;
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}

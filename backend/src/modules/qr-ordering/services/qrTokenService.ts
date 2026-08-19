/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QrTokenService — shared QR sticker helpers.
 *
 * Single source of truth for building sticker URLs and creating table
 * stickers. Used by:
 *   - qrTokenController (QR Studio: manual create / regenerate / seed)
 *   - tableService (AUTOMATIC generation whenever a new table is created)
 *
 * Sticker lifecycle guarantee:
 *   Printed stickers NEVER expire — there is no TTL on QrToken rows and the
 *   `active` flag is never flipped automatically. A sticker only changes when
 *   an Owner/Manager explicitly regenerates it in QR Studio (delete + create
 *   for the same table) or retires it. Auto-generation on table creation only
 *   ADDS a sticker for a brand-new table; it never touches existing stickers,
 *   so a freshly printed QR keeps working forever unless the owner refreshes
 *   it.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import QrToken from '../models/QrToken';
import Restaurant from '../../../models/Restaurant';
import { ensurePublicToken } from '../../../utils/publicToken';
import { config } from '../../../config';

/** Mint a new opaque sticker capability (unique across the deployment). */
export function genQrToken(): string {
  return 'qr_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Resolve the restaurant's public token — the capability the customer site
 * resolves a sticker to. Returns null (not throws) when the owner hasn't
 * enabled an online storefront yet; callers treat that as "no sticker for
 * now" and QR Studio still offers a manual Create once the store is on.
 *
 * Self-heals restaurants that predate the public-token feature (or were
 * registered through a path that skipped it): the token is minted on first
 * sticker request, so table/car/pickup stickers always work. Tokens are NOT
 * secrets — they only expose the public (read-only) storefront — so minting
 * one is safe and never rotates an existing token (ensurePublicToken is
 * atomic and returns the existing token when present).
 */
export async function resolvePublicToken(restaurantId: mongoose.Types.ObjectId | string): Promise<string | null> {
  const rid = new mongoose.Types.ObjectId(String(restaurantId));
  const restaurant = await Restaurant.findById(rid).select('publicToken brandName name').lean().exec();
  const pub = (restaurant as any)?.publicToken;
  if (pub && /^pbl_[A-Za-z0-9]{10,64}$/.test(pub)) return pub;
  return (await ensurePublicToken(String(rid))) || null;
}

/** Build the customer-site sticker URL (base URL from config, baked at gen). */
export function buildQrUrl(
  publicToken: string,
  type: 'table' | 'car' | 'pickup',
  ref: string,
  tableNumber?: number | null,
  branchId?: string | null
): string {
  const branch = branchId && mongoose.Types.ObjectId.isValid(branchId) ? `&b=${encodeURIComponent(branchId)}` : '';
  const query =
    type === 'pickup'
      ? `?mode=pickup${branch}`
      : `?mode=${type}&ref=${encodeURIComponent(ref)}${tableNumber ? `&t=${tableNumber}` : ''}${branch}`;
  return `${config.qrBaseUrl}/#/${publicToken}${query}`;
}

/**
 * Create (or replace) the sticker for ONE table.
 *
 * - Called automatically by tableService when a new table is created, and by
 *   QR Studio's per-table "Regen".
 * - Replacing an existing sticker (same tableId) is the ONLY way a table QR
 *   changes — a deliberate owner action, never automatic. Auto-generation on
 *   a brand-new table finds no existing sticker, so deleteMany is a no-op.
 * - Returns null when the restaurant has no public token yet (non-fatal; the
 *   owner can seed stickers from QR Studio after enabling the store).
 */
/**
 * Retire the sticker for a table (called when the table is deleted — an
 * explicit owner action). Scanning a retired sticker is dead; the owner can
 * create a fresh one for a re-added table. No-op when the table had none.
 */
export async function retireTableSticker(
  restaurantId: mongoose.Types.ObjectId | string,
  tableId: mongoose.Types.ObjectId | string
): Promise<void> {
  try {
    await QrToken.deleteMany({
      restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
      type: 'table',
      tableId: new mongoose.Types.ObjectId(String(tableId)),
    });
  } catch (error) {
    // Best-effort — sticker cleanup must never fail the table deletion.
    console.warn('[QrTokenService] sticker retirement skipped (non-fatal):', (error as Error).message);
  }
}

export async function upsertTableSticker(
  restaurantId: mongoose.Types.ObjectId | string,
  table: { _id: mongoose.Types.ObjectId | string; number?: number | null; branchId?: mongoose.Types.ObjectId | string | null }
): Promise<any | null> {
  try {
    const rid = new mongoose.Types.ObjectId(String(restaurantId));
    const tableOid = new mongoose.Types.ObjectId(String(table._id));
    const publicToken = await resolvePublicToken(rid);
    if (!publicToken) return null;

    const rawBranch = table.branchId && mongoose.Types.ObjectId.isValid(String(table.branchId))
      ? String(table.branchId)
      : null;

    // Atomic upsert on the (restaurantId, tableId) unique partial index — one
    // sticker per table, no delete-then-create race. Replacing an existing row
    // is the owner's explicit "refresh" (new token + url); a brand-new table
    // simply inserts. The old token stops working the moment this commits.
    const url = buildQrUrl(publicToken, 'table', String(tableOid), table.number ?? null, rawBranch);
    const doc = await QrToken.findOneAndUpdate(
      { restaurantId: rid, type: 'table', tableId: tableOid },
      {
        $set: {
          restaurantId: rid,
          branchId: rawBranch ? new mongoose.Types.ObjectId(rawBranch) : null,
          type: 'table',
          tableId: tableOid,
          tableNumber: table.number ?? null,
          token: genQrToken(),
          url,
        },
      },
      { upsert: true, new: true }
    ).exec();
    return doc;
  } catch (error) {
    // Auto-generation is best-effort: a sticker failure must never fail table
    // creation itself. QR Studio keeps a manual Create/Regen path as fallback.
    console.warn('[QrTokenService] table sticker generation skipped (non-fatal):', (error as Error).message);
    return null;
  }
}

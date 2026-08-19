/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QrTokenController — QR Studio API (Owner / Manager only).
 *
 * GET    /api/qr-tokens        → list stickers for the restaurant
 * POST   /api/qr-tokens        → generate a new sticker (table / car / pickup)
 * DELETE /api/qr-tokens/:id    → retire a sticker
 * POST   /api/qr-tokens/seed   → generate stickers for every unstickered table
 *
 * Tokens are opaque capabilities (not guessable), scoped to the authenticated
 * restaurant. The printed URL points at the customer QR ordering site; the
 * customer site resolves the restaurant through its own public-token flow.
 *
 * Stickers never expire: nothing here rotates or deactivates a printed QR.
 * A table sticker changes ONLY via the owner's explicit Regen (delete +
 * recreate for the same table) here, or via automatic creation when the table
 * is first added (tableService → qrTokenService.upsertTableSticker).
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import QrToken from '../models/QrToken';
import Table from '../../../models/Table';
import Branch from '../../../models/Branch';
import { genQrToken, resolvePublicToken, buildQrUrl, upsertTableSticker } from '../services/qrTokenService';
import { restaurantRepo, userRepo, employeeRepo } from '../../../repositories';
import { verifyPin } from '../../../utils/bcrypt';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';

/**
 * Verify the CURRENT user's password/PIN before a destructive QR action
 * (regenerating a table sticker invalidates the printed one, so it must be
 * an explicit, credential-confirmed owner/manager action).
 *
 * Resolution order:
 *   1. Employee login (JWT carries employeeId) → the employee's own PIN, or
 *      their password hash when a password-mode login is set.
 *   2. Restaurant-identity login (owner) → restaurant.ownerPin, falling back
 *      to the owner User doc's password hash.
 *
 * Returns true only when the supplied credential verifies against the logged
 * in user — never against a caller-supplied identity.
 */
async function verifyCurrentUserPassword(auth: AuthenticatedRequest, password: string): Promise<boolean> {
  if (!password) return false;
  const rid = auth.user?.restaurantId;
  if (!rid) return false;

  // 1. Employee / staff login — verify against their own PIN (or password).
  const employeeId = auth.user?.employeeId;
  if (employeeId) {
    const emp = await employeeRepo.findById(String(employeeId));
    const hash = emp ? ((emp as any).password || (emp as any).pin) : null;
    if (hash) return verifyPin(password, hash);
  }

  // 2. Owner / restaurant-identity login.
  const restaurant = await restaurantRepo.findById(String(rid));
  if (restaurant && (restaurant as any).ownerPin) {
    const ok = await verifyPin(password, (restaurant as any).ownerPin);
    if (ok) return true;
  }
  const ownerUser = await userRepo.findOne({ restaurantId: rid, role: 'owner', isDeleted: { $ne: true } } as any);
  if (ownerUser && (ownerUser as any).password) {
    return verifyPin(password, (ownerUser as any).password);
  }
  return false;
}

/** GET /api/qr-tokens — list this restaurant's stickers (newest first). */
export async function listQrTokens(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const rid = auth.user?.restaurantId;
    const branchId = (req.query.branchId as string) || undefined;

    const filter: any = { restaurantId: new mongoose.Types.ObjectId(rid) };
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) filter.branchId = new mongoose.Types.ObjectId(branchId);

    const tokens = await QrToken.find(filter).sort({ createdAt: -1 }).lean().exec();
    res.json({ tokens });
  } catch (error) {
    console.error('[QrToken] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/qr-tokens — create one sticker. */
export async function createQrToken(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const rid = new mongoose.Types.ObjectId(String(auth.user?.restaurantId || ''));
    const { type, tableId, parkingSlot, branchId } = req.body || {};
    const reqBranchOid = branchId && mongoose.Types.ObjectId.isValid(String(branchId))
      ? new mongoose.Types.ObjectId(String(branchId))
      : null;
    // A caller-supplied branchId must belong to THIS restaurant — a foreign
    // branch baked into a sticker would 400 the customer-site menu load.
    if (reqBranchOid) {
      const branch = await Branch.findOne({ _id: reqBranchOid, restaurantId: rid }).lean().exec();
      if (!branch) {
        res.status(400).json({ error: 'Branch does not belong to this restaurant' });
        return;
      }
    }

    if (!['table', 'car', 'pickup'].includes(type)) {
      res.status(400).json({ error: 'Invalid type' });
      return;
    }

    const publicToken = await resolvePublicToken(rid);
    if (!publicToken) {
      res.status(400).json({
        error: 'No public store token configured yet — enable the online store first',
      });
      return;
    }

    if (type === 'table') {
      if (!mongoose.Types.ObjectId.isValid(String(tableId || ''))) {
        res.status(400).json({ error: 'A table must be selected' });
        return;
      }
      const table = await Table.findOne({
        _id: new mongoose.Types.ObjectId(String(tableId)),
        restaurantId: rid,
        isDeleted: { $ne: true },
      }).lean().exec();
      if (!table) {
        res.status(404).json({ error: 'Table not found' });
        return;
      }
      // REGENERATION GATE — replacing an existing sticker invalidates the
      // printed QR, so it requires the current user's password/PIN. Creating
      // a sticker for a table that has none (backfill / seed / auto-gen on
      // table creation) stays password-free — it only ADDS a QR.
      const existingSticker = await QrToken.findOne({
        restaurantId: rid,
        type: 'table',
        tableId: table._id,
      }).lean().exec();
      if (existingSticker) {
        const passwordOk = await verifyCurrentUserPassword(auth, String(req.body?.password || ''));
        if (!passwordOk) {
          res.status(403).json({ error: 'Enter the current user password to regenerate this QR' });
          return;
        }
      }
      // The table's own branch is the source of truth; a caller-supplied
      // branchId wins when provided (QR Studio lets an owner pin a sticker
      // to any branch). Baked into the URL as &b= so the customer site can
      // scope its menu to this branch.
      const effBranchId = reqBranchOid
        ? reqBranchOid
        : (table as any).branchId && mongoose.Types.ObjectId.isValid(String((table as any).branchId))
          ? new mongoose.Types.ObjectId(String((table as any).branchId))
          : null;
      // Regenerating a table sticker replaces the old one (unique index) —
      // this is the owner's explicit refresh. Auto-generation for NEW tables
      // happens in tableService via the same upsertTableSticker. A null doc
      // means generation failed (or the store isn't enabled) — never report
      // a false success.
      const doc = await upsertTableSticker(rid, {
        _id: table._id,
        number: (table as any).number ?? null,
        branchId: effBranchId,
      });
      if (!doc) {
        res.status(500).json({ error: 'Could not generate the sticker — enable the online store or try again.' });
        return;
      }
      res.status(201).json({ token: doc });
      return;
    }

    if (type === 'car') {
      const slot = String(parkingSlot || '').trim();
      if (!slot) {
        res.status(400).json({ error: 'A parking slot label is required' });
        return;
      }
      const url = buildQrUrl(publicToken, 'car', slot, null, reqBranchOid ? reqBranchOid.toString() : null);
      const doc = await QrToken.create({
        restaurantId: rid,
        branchId: reqBranchOid,
        type,
        parkingSlot: slot,
        token: genQrToken(),
        url,
      });
      res.status(201).json({ token: doc });
      return;
    }

    // pickup
    const url = buildQrUrl(publicToken, 'pickup', '', null, reqBranchOid ? reqBranchOid.toString() : null);
    const doc = await QrToken.create({
      restaurantId: rid,
      branchId: reqBranchOid,
      type,
      token: genQrToken(),
      url,
    });
    res.status(201).json({ token: doc });
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ error: 'A sticker for this target already exists' });
      return;
    }
    console.error('[QrToken] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/qr-tokens/seed — generate stickers for every unstickered table. */
export async function seedQrTokens(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const rid = new mongoose.Types.ObjectId(String(auth.user?.restaurantId || ''));
    const branchId = (req.body?.branchId as string) || undefined;

    const publicToken = await resolvePublicToken(rid);
    if (!publicToken) {
      res.status(400).json({ error: 'No public store token configured yet — enable the online store first' });
      return;
    }

    const tables = await Table.find({
      restaurantId: rid,
      isDeleted: { $ne: true },
      ...(branchId && mongoose.Types.ObjectId.isValid(branchId) ? { branchId: new mongoose.Types.ObjectId(branchId) } : {}),
    }).lean().exec();

    const existing = await QrToken.find({ restaurantId: rid, type: 'table' }).select('tableId').lean().exec();
    const stickered = new Set(existing.map((t) => String((t as any).tableId || '')));

    let created = 0;
    for (const table of tables) {
      if (stickered.has(String(table._id))) continue;
      const tBranch = (table as any).branchId && mongoose.Types.ObjectId.isValid(String((table as any).branchId))
        ? new mongoose.Types.ObjectId(String((table as any).branchId))
        : null;
      const doc = await upsertTableSticker(rid, {
        _id: table._id,
        number: (table as any).number ?? null,
        branchId: tBranch,
      });
      if (doc) created += 1;
    }

    res.status(201).json({ created, total: tables.length });
  } catch (error) {
    console.error('[QrToken] seed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/qr-tokens/:id — retire a sticker (idempotent). */
export async function deleteQrToken(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const rid = new mongoose.Types.ObjectId(String(auth.user?.restaurantId || ''));
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const result = await QrToken.deleteOne({ _id: new mongoose.Types.ObjectId(String(req.params.id)), restaurantId: rid });
    res.json({ deleted: result.deletedCount ?? 0 });
  } catch (error) {
    console.error('[QrToken] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

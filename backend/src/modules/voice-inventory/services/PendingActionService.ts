/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PendingActionService — Create and consume server-side pending voice actions.
 *
 * Every inventory-mutating voice action is staged here FIRST and only executed
 * on `/confirm` with the matching single-use token. This guarantees:
 *   - the LLM can never write to the DB (it only proposes)
 *   - confirmations are scoped to the user+restaurant that created them
 *   - a token can be used at most once (atomic findOneAndUpdate)
 *   - stale actions expire (default 5 minutes)
 *
 * SECURITY:
 *   - Only the token hash is persisted; the raw token travels once to the
 *     frontend and is compared against the hash.
 *   - Consumption is atomic and idempotent.
 */

import mongoose from 'mongoose';
import VoicePendingAction, {
  IVoicePendingAction,
  hashToken,
  generateConfirmationToken,
  PendingActionStatus,
} from '../models/VoicePendingAction';

const DEFAULT_TTL_MS = parseInt(process.env.VOICE_CONFIRM_TTL_MS || (5 * 60 * 1000).toString(), 10);

export interface PendingActionInput {
  restaurantId: string;
  branchId?: string;
  employeeId: string;
  employeeName: string;
  auditLogId: string;
  intent: string;
  items: Array<{ name: string; quantity: number; unit: string; productId?: string; rate?: number }>;
  transcript?: string;
  ttlMs?: number;
}

export interface PendingActionIssue {
  pendingActionId: string;
  confirmationToken: string;
  expiresAt: Date;
  expiresInMs: number;
}

/**
 * Create a pending action bound to user/restaurant/items. Returns the opaque
 * id + one-time token that the frontend must present on confirm.
 */
export async function issuePendingAction(
  input: PendingActionInput
): Promise<PendingActionIssue> {
  const token = generateConfirmationToken();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  const doc = await VoicePendingAction.create({
    restaurantId: new mongoose.Types.ObjectId(input.restaurantId),
    branchId: input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)
      ? new mongoose.Types.ObjectId(input.branchId)
      : undefined,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    auditLogId: new mongoose.Types.ObjectId(input.auditLogId),
    intent: input.intent,
    items: input.items,
    transcriptPreview: (input.transcript || '').slice(0, 300),
    tokenHash: hashToken(token),
    status: 'pending',
    ttlMs,
    expiresAt,
  });

  return {
    pendingActionId: doc._id.toString(),
    confirmationToken: token,
    expiresAt,
    expiresInMs: ttlMs,
  };
}

export type ConsumeResult =
  | { ok: true; action: IVoicePendingAction }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'MISMATCHED_RESTAURANT' | 'MISMATCHED_TOKEN'; message: string };

/**
 * Atomically consume a pending action. Requires the correct id + token from
 * the SAME restaurant. Single-use: an already-consumed/expired action is
 * rejected. Returns the action only when the status flip to 'pending'
 * succeeded (i.e., nobody else used it first).
 */
export async function consumePendingAction(
  pendingActionId: string,
  confirmationToken: string,
  restaurantId: string
): Promise<ConsumeResult> {
  if (!mongoose.Types.ObjectId.isValid(pendingActionId) || !confirmationToken) {
    return { ok: false, code: 'NOT_FOUND', message: 'Invalid or missing pending action' };
  }

  const action = await VoicePendingAction.findById(pendingActionId).lean();
  if (!action) {
    return { ok: false, code: 'NOT_FOUND', message: 'Pending action not found' };
  }

  // Tenant scoping — never allow confirming another restaurant's action.
  if (String(action.restaurantId) !== String(restaurantId)) {
    return { ok: false, code: 'MISMATCHED_RESTAURANT', message: 'Not authorized for this action' };
  }

  if (action.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED', message: 'Confirmation window expired. Please re-say the command.' };
  }

  if (action.status !== 'pending') {
    return { ok: false, code: 'USED', message: `Action already ${action.status}` };
  }

  const expected = hashToken(confirmationToken);
  if (expected !== action.tokenHash) {
    return { ok: false, code: 'MISMATCHED_TOKEN', message: 'Invalid confirmation token' };
  }

  // Atomic single-use flip. The filter prevents double-consumption even if two
  // confirm requests arrive concurrently.
  const flipped = await VoicePendingAction.findOneAndUpdate(
    {
      _id: action._id,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: 'confirmed', consumedAt: new Date() } },
    { new: true }
  ).lean();

  if (!flipped) {
    return { ok: false, code: 'USED', message: 'Action already confirmed by another request' };
  }

  return { ok: true, action: flipped as IVoicePendingAction };
}

/**
 * NON-CONSUMING verification. Validates id+token+tenant+expiry without
 * flipping the status. Use for edit/cancel/clarify flows — the token stays
 * usable so the merchant can still confirm afterwards.
 */
export async function verifyPendingAction(
  pendingActionId: string,
  confirmationToken: string,
  restaurantId: string
): Promise<ConsumeResult> {
  if (!mongoose.Types.ObjectId.isValid(pendingActionId) || !confirmationToken) {
    return { ok: false, code: 'NOT_FOUND', message: 'Invalid or missing pending action' };
  }

  const action = await VoicePendingAction.findById(pendingActionId).lean();
  if (!action) {
    return { ok: false, code: 'NOT_FOUND', message: 'Pending action not found' };
  }

  if (String(action.restaurantId) !== String(restaurantId)) {
    return { ok: false, code: 'MISMATCHED_RESTAURANT', message: 'Not authorized for this action' };
  }

  if (action.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED', message: 'Confirmation window expired. Please re-say the command.' };
  }

  if (action.status !== 'pending') {
    return { ok: false, code: 'USED', message: `Action already ${action.status}` };
  }

  const expected = hashToken(confirmationToken);
  if (expected !== action.tokenHash) {
    return { ok: false, code: 'MISMATCHED_TOKEN', message: 'Invalid confirmation token' };
  }

  return { ok: true, action: action as IVoicePendingAction };
}

/**
 * Mark a pending action as rejected (cancel flow). Idempotent.
 */
export async function rejectPendingAction(
  pendingActionId: string,
  restaurantId: string
): Promise<boolean> {
  const res = await VoicePendingAction.updateOne(
    { _id: pendingActionId, restaurantId, status: 'pending' },
    { $set: { status: 'rejected', consumedAt: new Date() } }
  );
  return res.modifiedCount > 0;
}

/**
 * Expire any pending actions past their TTL. Called on a schedule or lazily.
 */
export async function expireStaleActions(): Promise<number> {
  const res = await VoicePendingAction.updateMany(
    { status: 'pending', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired', consumedAt: new Date() } }
  );
  return res.modifiedCount;
}

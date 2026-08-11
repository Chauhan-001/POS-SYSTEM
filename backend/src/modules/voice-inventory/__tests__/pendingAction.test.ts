/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PendingActionService tests — verify the mandatory backend-side confirmation
 * token for voice inventory mutations:
 *   - tokens are single-use (atomic consumption)
 *   - only the SHA-256 hash is stored, never the plaintext token
 *   - tenant scoping (a restaurant cannot confirm another's action)
 *   - TTL expiry and cross-handshake mismatch rejection
 *   - verify() is non-consuming so edit/cancel can be followed by confirm
 *   - reject + stale expiry handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import VoicePendingAction from '../models/VoicePendingAction';
import {
  issuePendingAction,
  consumePendingAction,
  verifyPendingAction,
  rejectPendingAction,
  expireStaleActions,
} from '../services/PendingActionService';

let mongod: MongoMemoryServer;

const REST = new mongoose.Types.ObjectId().toString();
const OTHER_REST = new mongoose.Types.ObjectId().toString();
const AUDIT_LOG_ID = new mongoose.Types.ObjectId().toString();

function makeInput(overrides: Partial<Record<string, any>> = {}) {
  return {
    restaurantId: REST,
    employeeId: 'emp1',
    employeeName: 'Ravi',
    auditLogId: AUDIT_LOG_ID,
    intent: 'inventory_add',
    items: [{ name: 'Milk', quantity: 20, unit: 'L' }],
    transcript: 'add 20 litre milk',
    ...overrides,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await VoicePendingAction.deleteMany({}).exec();
});

describe('issuePendingAction', () => {
  it('returns an opaque id + one-time token and stores only the token hash', async () => {
    const issued = await issuePendingAction(makeInput());

    expect(issued.pendingActionId).toBeTruthy();
    expect(issued.confirmationToken).toBeTruthy();
    expect(issued.confirmationToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(issued.expiresInMs).toBeGreaterThan(0);

    const doc = await VoicePendingAction.findById(issued.pendingActionId).lean();
    expect(doc).toBeTruthy();
    expect(doc!.status).toBe('pending');
    expect(doc!.tokenHash).not.toBe(issued.confirmationToken);
    expect(doc!.tokenHash.length).toBe(64); // SHA-256 hex
    expect(String(doc!.restaurantId)).toBe(REST);
  });
});

describe('consumePendingAction', () => {
  it('consumes on first use and atomically rejects a second use', async () => {
    const issued = await issuePendingAction(
      makeInput({ intent: 'inventory_remove', items: [{ name: 'Bread', quantity: 3, unit: 'pcs' }] })
    );

    const first = await consumePendingAction(issued.pendingActionId, issued.confirmationToken, REST);
    expect(first.ok).toBe(true);

    const second = await consumePendingAction(issued.pendingActionId, issued.confirmationToken, REST);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('USED');
  });

  it('rejects a mismatched token for the same action', async () => {
    const issued = await issuePendingAction(makeInput());

    const res = await consumePendingAction(issued.pendingActionId, 'wrong-token-value', REST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MISMATCHED_TOKEN');
  });

  it('rejects cross-tenant consumption (tenant scoping)', async () => {
    const issued = await issuePendingAction(makeInput());

    const res = await consumePendingAction(issued.pendingActionId, issued.confirmationToken, OTHER_REST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MISMATCHED_RESTAURANT');
  });

  it('rejects an already-expired action', async () => {
    const issued = await issuePendingAction(makeInput({ ttlMs: -1 }));

    const res = await consumePendingAction(issued.pendingActionId, issued.confirmationToken, REST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EXPIRED');
  });
});

describe('verifyPendingAction', () => {
  it('verifies WITHOUT consuming, so edit/cancel can be followed by confirm', async () => {
    const issued = await issuePendingAction(makeInput());

    const verified = await verifyPendingAction(issued.pendingActionId, issued.confirmationToken, REST);
    expect(verified.ok).toBe(true);

    // Still consumable after a non-consuming verification.
    const consumed = await consumePendingAction(issued.pendingActionId, issued.confirmationToken, REST);
    expect(consumed.ok).toBe(true);
  });

  it('rejects a wrong token even without consuming', async () => {
    const issued = await issuePendingAction(makeInput());

    const res = await verifyPendingAction(issued.pendingActionId, 'bogus-token', REST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MISMATCHED_TOKEN');
  });
});

describe('rejectPendingAction & expireStaleActions', () => {
  it('rejects a pending action (cancel flow) idempotently', async () => {
    const issued = await issuePendingAction(makeInput());

    expect(await rejectPendingAction(issued.pendingActionId, REST)).toBe(true);
    // Second cancel is a no-op (already rejected).
    expect(await rejectPendingAction(issued.pendingActionId, REST)).toBe(false);

    const doc = await VoicePendingAction.findById(issued.pendingActionId).lean();
    expect(doc!.status).toBe('rejected');
  });

  it('expires stale (overdue) pending actions', async () => {
    const issued = await issuePendingAction(makeInput({ ttlMs: -1 }));

    const expired = await expireStaleActions();
    expect(expired).toBeGreaterThanOrEqual(1);

    const doc = await VoicePendingAction.findById(issued.pendingActionId).lean();
    expect(doc!.status).toBe('expired');
  });
});
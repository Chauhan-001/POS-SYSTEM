/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sessionService tests — session listing, single/all revocation, and
 * compromised-token (reuse) detection against in-memory MongoDB.
 */

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { sessionService, hashToken } from '../sessionService';
import RefreshToken from '../../models/RefreshToken';
import AuditLog from '../../models/AuditLog';

let mongod: MongoMemoryServer;
const USER = new mongoose.Types.ObjectId();
const REST = new mongoose.Types.ObjectId();

const RAW_TOKEN = 'super-secret-refresh-token-string-1';

async function seedSession(over: Record<string, unknown> = {}) {
  return RefreshToken.create({
    userId: USER,
    restaurantId: REST,
    deviceId: 'dev-1',
    deviceName: 'Terminal A',
    os: 'Windows',
    appVersion: '1.0.0',
    tokenHash: hashToken(RAW_TOKEN),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isRevoked: false,
    lastActivityAt: new Date(),
    ...over,
  });
}

describe('SessionService (Phase 2.1)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await RefreshToken.deleteMany({}).exec();
    await AuditLog.deleteMany({}).exec();
  });

  it('lists only active (non-revoked, unexpired) sessions with device context', async () => {
    await seedSession();
    await seedSession({ tokenHash: hashToken('revoked-hash'), isRevoked: true });
    await seedSession({ tokenHash: hashToken('expired-hash'), expiresAt: new Date(Date.now() - 1000) });

    const { sessions, total } = await sessionService.listSessions(USER.toString());
    expect(total).toBe(1);
    expect(sessions[0].deviceName).toBe('Terminal A');
    expect(sessions[0].expiresAt).toBeTruthy();
  });

  it('lists an empty set for a user with no sessions', async () => {
    const otherUser = new mongoose.Types.ObjectId();
    const { sessions, total } = await sessionService.listSessions(otherUser.toString());
    expect(total).toBe(0);
    expect(sessions).toEqual([]);
  });

  it('revokes a single session and audits it', async () => {
    const s = await seedSession();
    const okS = await sessionService.revokeSession(s._id.toString(), USER.toString(), { id: USER.toString() }, REST.toString());
    expect(okS).toBe(true);
    const reloaded = await RefreshToken.findById(s._id).exec();
    expect(reloaded!.isRevoked).toBe(true);
    const audit = await AuditLog.findOne({ action: 'SESSION_REVOKE' }).exec();
    expect(audit).toBeTruthy();
  });

  it('refuses to revoke another user session', async () => {
    const s = await seedSession();
    const otherUser = new mongoose.Types.ObjectId().toString();
    await expect(sessionService.revokeSession(s._id.toString(), otherUser, { id: otherUser }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('revokes all sessions for a user', async () => {
    await seedSession();
    await seedSession({ deviceId: 'dev-2' });
    await seedSession({ deviceId: 'dev-3', isRevoked: true });

    const revoked = await sessionService.revokeAllSessions(USER.toString(), { id: USER.toString() }, REST.toString());
    expect(revoked).toBe(2);
    const activeLeft = await RefreshToken.countDocuments({ userId: USER, isRevoked: false });
    expect(activeLeft).toBe(0);
  });

  it('detects reuse of a revoked token and revokes the account&apos;s other sessions', async () => {
    // Two active sessions for the user.
    await seedSession(); // revokes with RAW_TOKEN
    await seedSession({ deviceId: 'dev-2', tokenHash: hashToken('other-token') });

    // Replay the RAW_TOKEN: it is still active on first use → no detection.
    const first = await sessionService.detectReuse(RAW_TOKEN, USER.toString(), REST.toString());
    expect(first).toBe(false);

    // Claim it (rotate) — simulates authService marking it revoked.
    await RefreshToken.updateOne({ userId: USER, tokenHash: hashToken(RAW_TOKEN) }, { isRevoked: true }).exec();

    // Replaying the SAME token again is now a compromise → revoke all + audit.
    const detected = await sessionService.detectReuse(RAW_TOKEN, USER.toString(), REST.toString());
    expect(detected).toBe(true);

    const activeLeft = await RefreshToken.countDocuments({ userId: USER, isRevoked: false });
    expect(activeLeft).toBe(0);
  });

  it('does not flag an unknown (never issued) token as reuse', async () => {
    const detected = await sessionService.detectReuse('never-issued-token', USER.toString(), REST.toString());
    expect(detected).toBe(false);
  });
});
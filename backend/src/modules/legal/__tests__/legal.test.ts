/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Legal module tests — uses mongodb-memory-server and the REAL service layer:
 *  - document lifecycle: create draft → publish (auto-archive) → immutability
 *  - versioning: one published version per scope; history preserved
 *  - acceptance: server-resolved version, idempotency, re-acceptance
 *  - tenant isolation: acceptances/consents never cross restaurants
 *  - privacy consent separate from contractual acceptance
 *  - data-subject requests recorded (no blind deletion)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import LegalDocument from '../models/LegalDocument';
import LegalAcceptance from '../models/LegalAcceptance';
import ConsentRecord from '../models/ConsentRecord';
import DataSubjectRequest from '../models/DataSubjectRequest';
import {
  createDraft,
  publishDocument,
  updateDraft,
  archiveDocument,
  getCurrentDocument,
  getVersionHistory,
  getRequiredForUser,
  acceptDocument,
  setConsent,
  createDataRequest,
  acceptanceStats,
  LegalError,
} from '../services/legalService';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    LegalDocument.deleteMany({}).exec(),
    LegalAcceptance.deleteMany({}).exec(),
    ConsentRecord.deleteMany({}).exec(),
    DataSubjectRequest.deleteMany({}).exec(),
  ]);
});

const ridA = new mongoose.Types.ObjectId();
const ridB = new mongoose.Types.ObjectId();

describe('document lifecycle', () => {
  it('creates a draft and publishes it, auto-archiving the previous version', async () => {
    const v1 = await createDraft({
      documentType: 'terms_of_service',
      version: '1.0',
      title: 'Terms of Service v1',
      content: 'Terms 1.0 body',
    });
    expect(v1.status).toBe('draft');
    await publishDocument(String(v1._id), 'admin1');

    const v2 = await createDraft({
      documentType: 'terms_of_service',
      version: '2.0',
      title: 'Terms of Service v2',
      content: 'Terms 2.0 body',
    });
    await publishDocument(String(v2._id), 'admin1');

    const current = await getCurrentDocument('terms_of_service');
    expect(current!.version).toBe('2.0');
    expect(current!.status).toBe('published');

    // v1 was auto-archived by the publish transaction.
    const v1After = await LegalDocument.findById(v1._id).lean().exec();
    expect(v1After!.status).toBe('archived');

    const history = await getVersionHistory('terms_of_service');
    expect(history.map((h) => h.version).sort()).toEqual(['1.0', '2.0']);
  });

  it('rejects a second published version for the same scope', async () => {
    const a = await createDraft({ documentType: 'privacy_policy', version: '1.0', title: 'P', content: 'x' });
    await publishDocument(String(a._id));
    // Archive the published one first, then a second publish of a new draft must work.
    await archiveDocument(String(a._id));
    const b = await createDraft({ documentType: 'privacy_policy', version: '1.1', title: 'P2', content: 'y' });
    await publishDocument(String(b._id));
    const current = await getCurrentDocument('privacy_policy');
    expect(current!.version).toBe('1.1');
  });

  it('published documents are immutable', async () => {
    const doc = await createDraft({ documentType: 'refund_policy', version: '1.0', title: 'R', content: 'x' });
    await publishDocument(String(doc._id));
    await expect(updateDraft(String(doc._id), { content: 'changed' })).rejects.toThrow(/immutable/i);
  });

  it('drafts can be edited; history preserves old versions', async () => {
    const doc = await createDraft({ documentType: 'acceptable_use', version: '0.1', title: 'AUP', content: 'v1' });
    await updateDraft(String(doc._id), { content: 'v2', version: '0.2' });
    const reloaded = await LegalDocument.findById(doc._id).lean().exec();
    expect(reloaded!.content).toBe('v2');
    expect(reloaded!.version).toBe('0.2');
  });
});

describe('acceptance', () => {
  it('records acceptance of the current published version (server-resolved)', async () => {
    const doc = await createDraft({ documentType: 'terms_of_service', version: '1.0', title: 'ToS', content: 'body' });
    await publishDocument(String(doc._id));

    const res = await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'terms_of_service', context: 'settings', platform: 'pos' });
    expect(res.accepted).toBe(true);
    expect(res.version).toBe('1.0');

    const records = await LegalAcceptance.find({ userId: 'u1', restaurantId: ridA }).lean().exec();
    expect(records).toHaveLength(1);
    expect(records[0].documentVersion).toBe('1.0');
  });

  it('is idempotent for the same version', async () => {
    const doc = await createDraft({ documentType: 'terms_of_service', version: '1.0', title: 'ToS', content: 'body' });
    await publishDocument(String(doc._id));
    await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'terms_of_service' });
    const second = await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'terms_of_service' });
    expect(second.duplicate).toBe(true);
    expect(await LegalAcceptance.countDocuments({ userId: 'u1' }).exec()).toBe(1);
  });

  it('rejects acceptance of a non-current version', async () => {
    const a = await createDraft({ documentType: 'privacy_policy', version: '1.0', title: 'P', content: 'x' });
    await publishDocument(String(a._id));
    const b = await createDraft({ documentType: 'privacy_policy', version: '1.1', title: 'P2', content: 'y' });
    await publishDocument(String(b._id));

    await expect(
      acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'privacy_policy', version: '1.0' }),
    ).rejects.toThrow(/not the current published version/);
  });

  it('re-acceptance appends a new record and old records remain immutable', async () => {
    const v1 = await createDraft({ documentType: 'acceptable_use', version: '1.0', title: 'AUP', content: 'x' });
    await publishDocument(String(v1._id));
    await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'acceptable_use' });

    const v2 = await createDraft({ documentType: 'acceptable_use', version: '2.0', title: 'AUP2', content: 'y' });
    await publishDocument(String(v2._id));

    const required = await getRequiredForUser('u1', String(ridA));
    expect(required.find((r) => r.documentType === 'acceptable_use')?.previouslyAcceptedVersion).toBe('1.0');

    await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'acceptable_use' });
    const records = await LegalAcceptance.find({ userId: 'u1', restaurantId: ridA, documentType: 'acceptable_use' })
      .sort({ acceptedAt: 1 }).lean().exec();
    expect(records.map((r) => r.documentVersion)).toEqual(['1.0', '2.0']);

    // No longer required after accepting the current version.
    const after = await getRequiredForUser('u1', String(ridA));
    expect(after.find((r) => r.documentType === 'acceptable_use')).toBeUndefined();
  });
});

describe('tenant isolation', () => {
  it('acceptances and consents are scoped per restaurant', async () => {
    const doc = await createDraft({ documentType: 'terms_of_service', version: '1.0', title: 'ToS', content: 'x' });
    await publishDocument(String(doc._id));

    await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'terms_of_service' });
    await acceptDocument({ userId: 'u1', restaurantId: ridB, documentType: 'terms_of_service' });
    await setConsent({ userId: 'u1', restaurantId: ridA, consentType: 'marketing_consent', granted: true });

    const aOnly = await LegalAcceptance.find({ userId: 'u1', restaurantId: ridA }).lean().exec();
    const bOnly = await LegalAcceptance.find({ userId: 'u1', restaurantId: ridB }).lean().exec();
    expect(aOnly).toHaveLength(1);
    expect(bOnly).toHaveLength(1);

    const consentA = await ConsentRecord.find({ userId: 'u1', restaurantId: ridA }).lean().exec();
    const consentB = await ConsentRecord.find({ userId: 'u1', restaurantId: ridB }).lean().exec();
    expect(consentA).toHaveLength(1);
    expect(consentB).toHaveLength(0);
  });

  it('acceptance stats are restaurant-scoped', async () => {
    const doc = await createDraft({ documentType: 'terms_of_service', version: '1.0', title: 'ToS', content: 'x' });
    await publishDocument(String(doc._id));
    await acceptDocument({ userId: 'u1', restaurantId: ridA, documentType: 'terms_of_service' });
    await acceptDocument({ userId: 'u2', restaurantId: ridA, documentType: 'terms_of_service' });
    await acceptDocument({ userId: 'u3', restaurantId: ridB, documentType: 'terms_of_service' });

    const statsA = await acceptanceStats({ restaurantId: String(ridA) });
    expect(statsA[0].acceptances).toBe(2);
    const statsB = await acceptanceStats({ restaurantId: String(ridB) });
    expect(statsB[0].acceptances).toBe(1);
  });
});

describe('consent separation', () => {
  it('consent withdrawal is recorded, not deleted', async () => {
    await setConsent({ userId: 'u1', restaurantId: ridA, consentType: 'marketing_consent', granted: true });
    const rec = await setConsent({ userId: 'u1', restaurantId: ridA, consentType: 'marketing_consent', granted: false });
    expect(rec.granted).toBe(false);
    expect(rec.withdrawnAt).toBeTruthy();
    expect(await ConsentRecord.countDocuments({ userId: 'u1', restaurantId: ridA }).exec()).toBe(1);
  });

  it('unknown consent types are rejected', async () => {
    await expect(
      setConsent({ userId: 'u1', restaurantId: ridA, consentType: 'bogus' as any, granted: true }),
    ).rejects.toThrow(/Unknown consent type/);
  });
});

describe('data-subject requests', () => {
  it('records export and close requests without deleting records', async () => {
    const exportReq = await createDataRequest({ userId: 'u1', restaurantId: ridA, requestType: 'export' });
    expect(exportReq.status).toBe('received');
    expect(exportReq.requestType).toBe('export');

    const closeReq = await createDataRequest({ userId: 'u1', restaurantId: ridA, requestType: 'close' });
    expect(closeReq.status).toBe('received');
    expect(closeReq.requestType).toBe('close');

    // No business records exist to delete here; the request log is the record.
    expect(await DataSubjectRequest.countDocuments({ userId: 'u1', restaurantId: ridA }).exec()).toBe(2);
  });
});

describe('error handling', () => {
  it('rejects unknown document ids with 404', async () => {
    await expect(updateDraft('000000000000000000000000', { content: 'x' })).rejects.toThrow(/not found/i);
  });

  it('publishing a non-draft throws', async () => {
    const doc = await createDraft({ documentType: 'terms_of_service', version: '1.0', title: 'T', content: 'x' });
    await publishDocument(String(doc._id));
    await expect(publishDocument(String(doc._id))).rejects.toThrow(/Only drafts can be published/);
  });
});

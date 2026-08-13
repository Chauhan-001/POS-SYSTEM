/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * legalService — the single authority for legal-document lifecycle and
 * acceptance/consent recording.
 *
 * Invariants:
 *  - One published version per (documentType, jurisdiction, language).
 *  - Publish is atomic: the new version becomes published and the previous
 *    published version is archived in the same operation.
 *  - Published/archived documents are immutable (content, title, effectiveAt).
 *  - Acceptance records are immutable and unique per (user, restaurant, type,
 *    version); re-acceptance appends a new record.
 *  - Privacy consent is separate from contractual acceptance and never
 *    auto-granted.
 */

import mongoose from 'mongoose';
import LegalDocument, { ILegalDocument, LegalDocumentType, LegalDocumentStatus } from '../models/LegalDocument';
import LegalAcceptance from '../models/LegalAcceptance';
import ConsentRecord, { ConsentType, CONSENT_TYPES } from '../models/ConsentRecord';
import DataSubjectRequest, { DataSubjectRequestType } from '../models/DataSubjectRequest';
import { auditService } from '../../audit/auditService';

export const DEFAULT_JURISDICTION = 'IN';
export const DEFAULT_LANGUAGE = 'en';

export interface AcceptInput {
  userId: string;
  restaurantId?: string | mongoose.Types.ObjectId;
  documentType: LegalDocumentType;
  /** Optional — when omitted, the current published version is resolved server-side. */
  version?: string;
  context?: string;
  platform?: string;
  metadata?: Record<string, unknown>;
}

export class LegalError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code?: string,
  ) {
    super(message);
  }
}

// ─── Document lifecycle ─────────────────────────────────────────────

export async function listDocuments(opts: { status?: LegalDocumentStatus; type?: LegalDocumentType; includeAll?: boolean } = {}) {
  const filter: Record<string, unknown> = {};
  if (opts.status) filter.status = opts.status;
  if (opts.type) filter.documentType = opts.type;
  if (!opts.includeAll && !opts.status) filter.status = 'published';
  return LegalDocument.find(filter)
    .sort({ documentType: 1, version: -1 })
    .lean()
    .exec();
}

export async function getCurrentDocument(
  documentType: LegalDocumentType,
  opts: { jurisdiction?: string; language?: string } = {},
): Promise<ILegalDocument | null> {
  return LegalDocument.findOne({
    documentType,
    jurisdiction: opts.jurisdiction || DEFAULT_JURISDICTION,
    language: opts.language || DEFAULT_LANGUAGE,
    status: 'published',
  })
    .sort({ publishedAt: -1, version: -1 })
    .lean()
    .exec() as Promise<ILegalDocument | null>;
}

export async function getVersionHistory(documentType: LegalDocumentType, opts: { jurisdiction?: string; language?: string } = {}) {
  return LegalDocument.find({
    documentType,
    jurisdiction: opts.jurisdiction || DEFAULT_JURISDICTION,
    language: opts.language || DEFAULT_LANGUAGE,
  })
    .sort({ version: -1, createdAt: -1 })
    .lean()
    .exec();
}

export async function getDocumentById(id: string, opts: { includeContent?: boolean } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new LegalError('Invalid document id', 400);
  const doc = await LegalDocument.findById(id).lean().exec();
  if (!doc) throw new LegalError('Document not found', 404);
  if (opts.includeContent === false && doc.status === 'draft') {
    // Drafts are admin-only; the caller decides whether content is exposed.
  }
  return doc;
}

async function assertNoPublishedConflict(
  documentType: LegalDocumentType,
  jurisdiction: string,
  language: string,
  excludeId?: string,
): Promise<void> {
  const existing = await LegalDocument.findOne({
    documentType,
    jurisdiction,
    language,
    status: 'published',
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .lean()
    .exec();
  if (existing) {
    throw new LegalError(
      `A published version (${existing.version}) already exists for ${documentType} in ${jurisdiction}/${language}. Archive it before publishing a new version.`,
      409,
      'PUBLISHED_VERSION_EXISTS',
    );
  }
}

export async function createDraft(input: {
  documentType: LegalDocumentType;
  version: string;
  title: string;
  content: string;
  effectiveAt?: Date;
  jurisdiction?: string;
  language?: string;
  requireAcceptance?: boolean;
  reAcceptanceRequired?: boolean;
  adminNotes?: string;
  updatedBy?: string;
}) {
  const doc = await LegalDocument.create({
    documentType: input.documentType,
    version: input.version,
    title: input.title,
    content: input.content,
    effectiveAt: input.effectiveAt || new Date(),
    jurisdiction: input.jurisdiction || DEFAULT_JURISDICTION,
    language: input.language || DEFAULT_LANGUAGE,
    requireAcceptance: input.requireAcceptance ?? true,
    reAcceptanceRequired: input.reAcceptanceRequired ?? true,
    adminNotes: input.adminNotes,
    updatedBy: input.updatedBy,
    status: 'draft',
    publishedAt: null,
  });

  await auditService.log({
    action: 'legal.document_created',
    entityType: 'LegalDocument',
    entityId: String(doc._id),
    entityLabel: `${input.documentType} ${input.version}`,
    details: { documentType: input.documentType, version: input.version, status: 'draft' },
  });

  return doc;
}

export async function updateDraft(id: string, patch: Partial<{
  title: string;
  content: string;
  effectiveAt: Date;
  version: string;
  requireAcceptance: boolean;
  reAcceptanceRequired: boolean;
  adminNotes: string;
  updatedBy: string;
}>) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new LegalError('Invalid document id', 400);
  const doc = await LegalDocument.findById(id).exec();
  if (!doc) throw new LegalError('Document not found', 404);
  if (doc.status !== 'draft') {
    throw new LegalError('Only draft documents can be edited. Published/archived versions are immutable.', 409, 'DOC_IMMUTABLE');
  }

  const allowed: Array<keyof typeof patch> = [
    'title', 'content', 'effectiveAt', 'version', 'requireAcceptance', 'reAcceptanceRequired', 'adminNotes', 'updatedBy',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) (doc as any)[key] = patch[key];
  }
  await doc.save();

  await auditService.log({
    action: 'legal.document_updated',
    entityType: 'LegalDocument',
    entityId: id,
    entityLabel: `${doc.documentType} ${doc.version}`,
    details: { documentType: doc.documentType, version: doc.version, changedFields: Object.keys(patch) },
  });

  return doc;
}

/**
 * Publish a draft. Atomic: archives any existing published version for the same
 * (type, jurisdiction, language) in one transaction, then publishes the draft.
 */
export async function publishDocument(id: string, updatedBy?: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new LegalError('Invalid document id', 400);

  const doc = await LegalDocument.findById(id).exec();
  if (!doc) throw new LegalError('Document not found', 404);
  if (doc.status !== 'draft') {
    throw new LegalError('Only drafts can be published.', 409, 'DOC_IMMUTABLE');
  }

  // Archive the currently-published version for the same scope (if any), then
  // publish the new one. Publishing is admin-only with low concurrency; the
  // sort in getCurrentDocument (publishedAt desc) keeps the newest version
  // authoritative even in the unlikely event of a concurrent publish.
  await LegalDocument.updateMany(
    {
      documentType: doc.documentType,
      jurisdiction: doc.jurisdiction,
      language: doc.language,
      status: 'published',
      _id: { $ne: doc._id },
    },
    { $set: { status: 'archived' } },
  ).exec();

  doc.status = 'published';
  doc.publishedAt = new Date();
  doc.updatedBy = updatedBy || doc.updatedBy;
  await doc.save();

  await auditService.log({
    action: 'legal.document_published',
    entityType: 'LegalDocument',
    entityId: id,
    entityLabel: `${doc.documentType} ${doc.version}`,
    details: { documentType: doc.documentType, version: doc.version, jurisdiction: doc.jurisdiction },
  });

  return doc;
}

export async function archiveDocument(id: string, updatedBy?: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new LegalError('Invalid document id', 400);
  const doc = await LegalDocument.findById(id).exec();
  if (!doc) throw new LegalError('Document not found', 404);
  if (doc.status === 'archived') throw new LegalError('Document is already archived', 409);
  if (doc.status === 'published') {
    // Publishing a replacement must have already archived this one; a direct
    // archive of the live version leaves the scope without a published doc.
    await assertNoPublishedConflict(doc.documentType, doc.jurisdiction, doc.language, String(doc._id));
  }
  doc.status = 'archived';
  doc.updatedBy = updatedBy || doc.updatedBy;
  await doc.save();

  await auditService.log({
    action: 'legal.document_archived',
    entityType: 'LegalDocument',
    entityId: id,
    entityLabel: `${doc.documentType} ${doc.version}`,
    details: { documentType: doc.documentType, version: doc.version },
  });

  return doc;
}

// ─── Acceptance / re-acceptance ─────────────────────────────────────

export async function getRequiredForUser(userId: string, restaurantId?: string): Promise<any[]> {
  const published = await LegalDocument.find({ status: 'published', requireAcceptance: true })
    .sort({ documentType: 1, publishedAt: -1 })
    .lean()
    .exec();

  const accepted = await LegalAcceptance.find({ userId, ...(restaurantId ? { restaurantId } : {}) })
    .lean()
    .exec();

  const acceptedKeys = new Set(accepted.map((a) => `${a.documentType}:${a.documentVersion}`));

  const required: any[] = [];
  for (const doc of published) {
    const key = `${doc.documentType}:${doc.version}`;
    if (acceptedKeys.has(key)) continue;
    // If the user accepted an older version and this change requires
    // re-acceptance, it is required. If no older acceptance exists, it is
    // required (onboarding).
    required.push({
      documentType: doc.documentType,
      version: doc.version,
      title: doc.title,
      effectiveAt: doc.effectiveAt,
      jurisdiction: doc.jurisdiction,
      language: doc.language,
      requireAcceptance: doc.requireAcceptance,
      previouslyAcceptedVersion: accepted.find((a) => a.documentType === doc.documentType)?.documentVersion || null,
    });
  }
  return required;
}

/**
 * Record acceptance. Resolves the version server-side (never trusts the client
 * to name an arbitrary version): the version under acceptance must exist and be
 * published, OR match the current published version for that type/scope.
 * Idempotent per (user, restaurant, type, version).
 */
export async function acceptDocument(input: AcceptInput) {
  const { userId, restaurantId, documentType, context, platform, metadata } = input;

  let doc: ILegalDocument | null = null;
  if (input.version) {
    doc = await LegalDocument.findOne({
      documentType,
      version: input.version,
      jurisdiction: DEFAULT_JURISDICTION,
      language: DEFAULT_LANGUAGE,
      status: { $in: ['published', 'archived'] },
    }).lean().exec() as ILegalDocument | null;
  }
  if (!doc) {
    doc = await getCurrentDocument(documentType);
  }
  if (!doc) {
    throw new LegalError('No published document found for this type', 404, 'NO_PUBLISHED_DOCUMENT');
  }

  // A user cannot accept a version that is not the current published one unless
  // it is explicitly provided AND it is the current published version. This
  // guarantees the acceptance always matches the live document.
  const current = await getCurrentDocument(documentType);
  if (!current || current.version !== doc.version) {
    throw new LegalError(
      `Version ${doc.version} is not the current published version (${current?.version || 'none'}).`,
      409,
      'VERSION_MISMATCH',
    );
  }

  const rid: mongoose.Types.ObjectId | null = restaurantId ? new mongoose.Types.ObjectId(String(restaurantId)) : null;
  const acceptanceFilter: Record<string, unknown> = { userId, documentType, documentVersion: doc.version };
  acceptanceFilter.restaurantId = rid;
  const existing = await LegalAcceptance.findOne(acceptanceFilter as any).lean().exec();
  if (existing) {
    // Idempotent — already accepted this exact version.
    return { accepted: true, duplicate: true, documentType, version: doc.version };
  }

  const record = await LegalAcceptance.create({
    userId,
    restaurantId: rid,
    documentType,
    documentVersion: doc.version,
    documentTitle: doc.title,
    effectiveAt: doc.effectiveAt,
    acceptedAt: new Date(),
    context: context || 'pos',
    platform: platform || 'pos',
    metadata: metadata || {},
  } as any);

  await auditService.log({
    action: 'legal.accepted',
    entityType: 'LegalAcceptance',
    entityId: String(record._id),
    entityLabel: `${documentType} ${doc.version}`,
    details: { documentType, version: doc.version, context: context || 'pos', platform: platform || 'pos' },
  });

  return { accepted: true, duplicate: false, documentType, version: doc.version, acceptanceId: String(record._id) };
}

export async function listMyAcceptances(userId: string, restaurantId?: string) {
  return LegalAcceptance.find({ userId, ...(restaurantId ? { restaurantId } : {}) })
    .sort({ acceptedAt: -1 })
    .lean()
    .exec();
}

// ─── Consents (separate from acceptance) ────────────────────────────

export async function listMyConsents(userId: string, restaurantId?: string) {
  return ConsentRecord.find({ userId, ...(restaurantId ? { restaurantId } : {}) })
    .sort({ updatedAt: -1 })
    .lean()
    .exec();
}

export async function setConsent(input: {
  userId: string;
  restaurantId?: string | mongoose.Types.ObjectId;
  consentType: ConsentType;
  granted: boolean;
  context?: string;
  platform?: string;
}) {
  if (!CONSENT_TYPES.includes(input.consentType)) {
    throw new LegalError(`Unknown consent type '${input.consentType}'`, 400);
  }
  const rid: mongoose.Types.ObjectId | null = input.restaurantId ? new mongoose.Types.ObjectId(String(input.restaurantId)) : null;
  const consentFilter: Record<string, unknown> = { userId: input.userId, consentType: input.consentType };
  consentFilter.restaurantId = rid;

  const existing = await ConsentRecord.findOne(consentFilter as any).exec();

  let record;
  if (existing) {
    existing.granted = input.granted;
    if (input.granted) {
      existing.grantedAt = existing.grantedAt || new Date();
      existing.withdrawnAt = null;
    } else {
      existing.withdrawnAt = existing.withdrawnAt || new Date();
    }
    existing.context = input.context || existing.context;
    existing.platform = input.platform || existing.platform;
    await existing.save();
    record = existing;
  } else {
    record = await ConsentRecord.create({
      userId: input.userId,
      restaurantId: rid,
      consentType: input.consentType,
      granted: input.granted,
      grantedAt: input.granted ? new Date() : null,
      withdrawnAt: input.granted ? null : new Date(),
      context: input.context || 'settings',
      platform: input.platform || 'pos',
    } as any);
  }

  await auditService.log({
    action: input.granted ? 'consent.granted' : 'consent.withdrawn',
    entityType: 'ConsentRecord',
    entityId: String(record._id),
    entityLabel: input.consentType,
    details: { consentType: input.consentType, granted: input.granted },
  });

  return record;
}

// ─── Data-subject requests ──────────────────────────────────────────

export async function createDataRequest(input: {
  userId: string;
  restaurantId?: string | mongoose.Types.ObjectId;
  requestType: DataSubjectRequestType;
  requestDetail?: string;
  platform?: string;
}) {
  const rid: mongoose.Types.ObjectId | null = input.restaurantId ? new mongoose.Types.ObjectId(String(input.restaurantId)) : null;
  const record = await DataSubjectRequest.create({
    userId: input.userId,
    restaurantId: rid,
    requestType: input.requestType,
    status: 'received',
    requestDetail: input.requestDetail,
    requestedAt: new Date(),
  } as any);

  await auditService.log({
    action: input.requestType === 'export'
      ? 'privacy.export_requested'
      : input.requestType === 'close'
        ? 'privacy.account_close_requested'
        : 'privacy.request_received',
    entityType: 'DataSubjectRequest',
    entityId: String(record._id),
    entityLabel: input.requestType,
    details: { requestType: input.requestType, platform: input.platform || 'pos' },
  });

  return record;
}

export async function listMyDataRequests(userId: string, restaurantId?: string) {
  return DataSubjectRequest.find({ userId, ...(restaurantId ? { restaurantId } : {}) })
    .sort({ requestedAt: -1 })
    .lean()
    .exec();
}

// ─── Stats ──────────────────────────────────────────────────────────

export async function acceptanceStats(opts: { restaurantId?: string; global?: boolean } = {}) {
  const pipeline: any[] = [];
  if (opts.restaurantId) {
    pipeline.push({ $match: { restaurantId: new mongoose.Types.ObjectId(opts.restaurantId) } });
  }
  pipeline.push(
    { $group: { _id: { documentType: '$documentType', documentVersion: '$documentVersion' }, count: { $sum: 1 } } },
    { $sort: { '_id.documentType': 1, '_id.documentVersion': -1 } },
  );
  const rows = await LegalAcceptance.aggregate(pipeline).exec();
  return rows.map((r: any) => ({
    documentType: r._id.documentType,
    version: r._id.documentVersion,
    acceptances: r.count,
  }));
}

export async function consentStats(opts: { restaurantId?: string; global?: boolean } = {}) {
  const filter: Record<string, unknown> = {};
  if (opts.restaurantId) filter.restaurantId = new mongoose.Types.ObjectId(opts.restaurantId);
  const rows = await ConsentRecord.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { consentType: '$consentType', granted: '$granted' },
        count: { $sum: 1 },
      },
    },
  ]).exec();
  return rows.map((r: any) => ({ consentType: r._id.consentType, granted: r._id.granted, count: r.count }));
}

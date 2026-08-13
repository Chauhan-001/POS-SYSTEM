/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * legalController — HTTP layer for the legal/compliance module.
 *
 * Access model:
 *  - Public: current published documents (read-only, no PII).
 *  - Authenticated POS user: their own acceptance/consent/data-rights, and
 *    owner-level acceptance stats for their own restaurant.
 *  - Platform admin (super_admin surface): full document lifecycle + global
 *    acceptance stats. Restaurant tokens can never reach admin endpoints.
 *
 * Every tenant-scoped query is derived from req.user (JWT), never from
 * client-supplied ids.
 */

import { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import {
  listDocuments,
  getCurrentDocument,
  getVersionHistory,
  getDocumentById,
  createDraft,
  updateDraft,
  publishDocument,
  archiveDocument,
  getRequiredForUser,
  acceptDocument,
  listMyAcceptances,
  listMyConsents,
  setConsent,
  createDataRequest,
  listMyDataRequests,
  acceptanceStats,
  consentStats,
  LegalError,
  DEFAULT_JURISDICTION,
  DEFAULT_LANGUAGE,
} from '../services/legalService';
import { LEGAL_DOCUMENT_TYPES } from '../models/LegalDocument';
import { CONSENT_TYPES } from '../models/ConsentRecord';

function handleError(res: Response, err: unknown): void {
  if (err instanceof LegalError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  console.error('[Legal] error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// ─── Public (no auth) ───────────────────────────────────────────────

export async function getPublishedList(req: Request, res: Response): Promise<void> {
  try {
    const docs = await listDocuments({ status: 'published' });
    res.json({
      documents: docs.map((d) => ({
        documentType: d.documentType,
        version: d.version,
        title: d.title,
        effectiveAt: d.effectiveAt,
        publishedAt: d.publishedAt,
        jurisdiction: d.jurisdiction,
        language: d.language,
        content: d.content,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
}

export async function getCurrent(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || '');
    if (!LEGAL_DOCUMENT_TYPES.includes(type as any)) {
      res.status(400).json({ error: `Unknown document type '${type}'` });
      return;
    }
    const jurisdiction = String(req.query.jurisdiction || DEFAULT_JURISDICTION);
    const language = String(req.query.language || DEFAULT_LANGUAGE);
    const doc = await getCurrentDocument(type as any, { jurisdiction, language });
    if (!doc) {
      res.status(404).json({ error: 'No published document for this type' });
      return;
    }
    res.json({
      documentType: doc.documentType,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      effectiveAt: doc.effectiveAt,
      publishedAt: doc.publishedAt,
      jurisdiction: doc.jurisdiction,
      language: doc.language,
    });
  } catch (err) {
    handleError(res, err);
  }
}

// ─── Authenticated POS user ─────────────────────────────────────────

export async function myRequired(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const required = await getRequiredForUser(user.userId, user.restaurantId);
    res.json({ required });
  } catch (err) {
    handleError(res, err);
  }
}

export async function accept(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { documentType, version, context, platform, metadata } = req.body || {};
    if (!LEGAL_DOCUMENT_TYPES.includes(documentType)) {
      res.status(400).json({ error: `Unknown document type '${documentType}'` });
      return;
    }
    const result = await acceptDocument({
      userId: user.userId,
      restaurantId: user.restaurantId,
      documentType,
      version: version || undefined,
      context: String(context || 'pos'),
      platform: String(platform || 'pos'),
      metadata,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
}

export async function myAcceptances(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const records = await listMyAcceptances(user.userId, user.restaurantId);
    res.json({ acceptances: records });
  } catch (err) {
    handleError(res, err);
  }
}

export async function myConsents(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const records = await listMyConsents(user.userId, user.restaurantId);
    res.json({ consents: records });
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateConsent(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { consentType, granted, context, platform } = req.body || {};
    if (!CONSENT_TYPES.includes(consentType)) {
      res.status(400).json({ error: `Unknown consent type '${consentType}'` });
      return;
    }
    if (typeof granted !== 'boolean') {
      res.status(400).json({ error: 'granted must be a boolean' });
      return;
    }
    const record = await setConsent({
      userId: user.userId,
      restaurantId: user.restaurantId,
      consentType,
      granted,
      context: String(context || 'settings'),
      platform: String(platform || 'pos'),
    });
    res.json({ consent: record });
  } catch (err) {
    handleError(res, err);
  }
}

export async function createExportRequest(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const record = await createDataRequest({
      userId: user.userId,
      restaurantId: user.restaurantId,
      requestType: 'export',
      requestDetail: 'Requested a copy of personal data',
      platform: 'pos',
    });
    res.status(201).json({ request: record, message: 'Data export request received. It will be processed by the platform.' });
  } catch (err) {
    handleError(res, err);
  }
}

export async function createCloseRequest(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const record = await createDataRequest({
      userId: user.userId,
      restaurantId: user.restaurantId,
      requestType: 'close',
      requestDetail: 'Requested account closure',
      platform: 'pos',
    });
    res.status(201).json({ request: record, message: 'Account closure request received and recorded. Business records will be retained per applicable law; personal data handling will follow our documented policy.' });
  } catch (err) {
    handleError(res, err);
  }
}

export async function myDataRequests(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const records = await listMyDataRequests(user.userId, user.restaurantId);
    res.json({ requests: records });
  } catch (err) {
    handleError(res, err);
  }
}

// ─── Owner (own restaurant stats) ───────────────────────────────────

export async function ownerAcceptanceStats(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const [acceptances, consents] = await Promise.all([
      acceptanceStats({ restaurantId: user.restaurantId }),
      consentStats({ restaurantId: user.restaurantId }),
    ]);
    res.json({ acceptances, consents });
  } catch (err) {
    handleError(res, err);
  }
}

// ─── Platform admin (super_admin only) ──────────────────────────────

export async function adminListDocuments(req: Request, res: Response): Promise<void> {
  try {
    const docs = await listDocuments({
      status: (req.query.status as any) || undefined,
      type: (req.query.type as any) || undefined,
      includeAll: true,
    });
    res.json({ documents: docs });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminCreateDraft(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const doc = await createDraft({ ...req.body, updatedBy: user.userId });
    res.status(201).json({ document: doc });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminUpdateDraft(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const doc = await updateDraft(String(req.params.id), { ...req.body, updatedBy: user.userId });
    res.json({ document: doc });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminPublish(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const doc = await publishDocument(String(req.params.id), user.userId);
    res.json({ document: doc });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminArchive(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const doc = await archiveDocument(String(req.params.id), user.userId);
    res.json({ document: doc });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminGetDocument(req: Request, res: Response): Promise<void> {
  try {
    const doc = await getDocumentById(String(req.params.id), { includeContent: true });
    res.json({ document: doc });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminVersions(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || '');
    if (!LEGAL_DOCUMENT_TYPES.includes(type as any)) {
      res.status(400).json({ error: `Unknown document type '${type}'` });
      return;
    }
    const versions = await getVersionHistory(type as any, {
      jurisdiction: String(req.query.jurisdiction || DEFAULT_JURISDICTION),
      language: String(req.query.language || DEFAULT_LANGUAGE),
    });
    res.json({ versions });
  } catch (err) {
    handleError(res, err);
  }
}

export async function adminGlobalStats(req: Request, res: Response): Promise<void> {
  try {
    const [acceptances, consents] = await Promise.all([
      acceptanceStats({ global: true }),
      consentStats({ global: true }),
    ]);
    res.json({ acceptances, consents });
  } catch (err) {
    handleError(res, err);
  }
}

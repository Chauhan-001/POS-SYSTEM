/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * legal.ts — Legal & Compliance API routes.
 *
 * Mounted at /api/legal in server.ts BEFORE the global apiLimiter (public
 * document reads must never be throttled by the business budget).
 *
 * Admin endpoints are gated by requireAdminAuth (super_admin surface only) +
 * collection access, so restaurant tokens can never manage platform documents.
 */

import { Router } from 'express';
import { requireAuth, requireAdminAuth, requireRole } from '../../../middleware/authMiddleware';
import { requireCollectionAccess } from '../../../middleware/authorizationMiddleware';
import {
  getPublishedList,
  getCurrent,
  myRequired,
  accept,
  myAcceptances,
  myConsents,
  updateConsent,
  createExportRequest,
  createCloseRequest,
  myDataRequests,
  ownerAcceptanceStats,
  adminListDocuments,
  adminCreateDraft,
  adminUpdateDraft,
  adminPublish,
  adminArchive,
  adminGetDocument,
  adminVersions,
  adminGlobalStats,
} from '../controllers/legalController';

const router = Router();

// ─── Public — published documents (read-only) ─────────────────────
router.get('/documents', getPublishedList);
router.get('/current/:type', getCurrent);

// ─── Authenticated POS user ───────────────────────────────────────
router.get('/my-required', requireAuth, myRequired);
router.post('/accept', requireAuth, accept);
router.get('/my-acceptances', requireAuth, myAcceptances);
router.get('/consents', requireAuth, myConsents);
router.post('/consents', requireAuth, updateConsent);
router.post('/export-request', requireAuth, createExportRequest);
router.post('/close-request', requireAuth, createCloseRequest);
router.get('/my-requests', requireAuth, myDataRequests);

// ─── Owner — own-restaurant acceptance statistics ─────────────────
router.get('/acceptance-stats', requireRole('Owner', 'Manager'), ownerAcceptanceStats);

// ─── Platform admin — full document lifecycle + global stats ──────
router.get('/admin/documents', requireAdminAuth, requireCollectionAccess('LegalDocument', 'read'), adminListDocuments);
router.post('/admin/documents', requireAdminAuth, requireCollectionAccess('LegalDocument', 'create'), adminCreateDraft);
router.get('/admin/documents/:id', requireAdminAuth, requireCollectionAccess('LegalDocument', 'read'), adminGetDocument);
router.patch('/admin/documents/:id', requireAdminAuth, requireCollectionAccess('LegalDocument', 'update'), adminUpdateDraft);
router.post('/admin/documents/:id/publish', requireAdminAuth, requireCollectionAccess('LegalDocument', 'update'), adminPublish);
router.post('/admin/documents/:id/archive', requireAdminAuth, requireCollectionAccess('LegalDocument', 'update'), adminArchive);
router.get('/admin/versions/:type', requireAdminAuth, requireCollectionAccess('LegalDocument', 'read'), adminVersions);
router.get('/admin/stats', requireAdminAuth, requireCollectionAccess('LegalDocument', 'read'), adminGlobalStats);

export default router;

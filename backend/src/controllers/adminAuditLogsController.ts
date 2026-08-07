/**
 * =============================================================================
 *  adminAuditLogsController.ts — Enterprise Audit Trail (Phase 2.9)
 * =============================================================================
 *
 * Endpoints:
 *   GET    /admin/audit-logs             → searchable/filterable/sortable list (cursor or page)
 *   GET    /admin/audit-logs/stats       → dashboard statistics
 *   GET    /admin/audit-logs/registry    → action/module/category reference
 *   GET    /admin/audit-logs/:id         → single entry (read-masked detail)
 *   POST   /admin/audit-logs/exports     → create background export job
 *   GET    /admin/audit-logs/exports/:id → job status
 *   GET    /admin/audit-logs/exports/:id/download → download artifact
 *   GET    /admin/audit-logs/integrity/verify  → hash-chain verification report
 *   GET    /admin/audit-logs/integrity/checksum → deterministic data checksum
 *   GET    /admin/audit-logs/retention   → retention rules
 *   POST   /admin/audit-logs/retention/run → run cleanup (+archive)
 *   GET    /admin/audit-logs/archive     → archived rows
 *   POST   /admin/audit-logs/archive/restore → restore archived rows
 *   GET/POST/DELETE /admin/audit-logs/legal-holds →
 *   GET/POST/DELETE /admin/audit-logs/saved-searches →
 *   GET/POST/DELETE /admin/audit-logs/alerts → alert feed
 *
 * Security: all behind requireAuth + requireCollectionAccess('AuditLog','read')
 * Read outputs pass through toReadSafe which masks PII on read.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { ok, okWithMeta, fail } from '../utils/apiResponse';
import {
  queryAuditLogs,
  getAuditById,
} from '../modules/audit/queryService';
import { getAuditStats } from '../modules/audit/statsService';
import { allActions, allModules, allCategories, getActionMeta } from '../modules/audit/actionRegistry';
import { verifyIntegrity, checksumIntegrity } from '../modules/audit/integrityService';
import {
  getRetentionRules,
  runRetentionCleanup,
  restoreArchived,
  listArchived,
} from '../modules/audit/retentionService';
import { createExportJob, getJobStatus, resolveJobFile } from '../modules/audit/exportService';
import { AuditExportJob } from '../modules/audit/models';
import {
  listAlerts, alertSummary, resolveAlert, deleteAlert,
  listSavedSearches, saveSearch, deleteSavedSearch,
  listLegalHolds, createLegalHold, releaseLegalHold,
} from '../modules/audit/alertsService';

function actorFrom(req: AuthenticatedRequest): { id?: string; name: string } {
  const user = req.user as any;
  return { id: user?.userId || user?.id, name: user?.name || user?.userId || 'System' };
}

function mapQuery(req: any): Record<string, any> {
  const q = req.query ?? {};
  return {
    page: q.page, limit: q.limit, cursor: q.cursor, search: q.search,
    action: q.action, actionContains: q.actionContains, module: q.module,
    category: q.category, severity: q.severity, result: q.result,
    performedBy: q.performedBy, performedById: q.performedById, role: q.role,
    restaurantId: q.restaurantId, branchId: q.branchId, restaurantName: q.restaurantName,
    entityType: q.entityType, entityId: q.entityId, ipAddress: q.ipAddress,
    deviceId: q.deviceId, sessionId: q.sessionId, requestId: q.requestId,
    correlationId: q.correlationId, from: q.from || q.startDate, to: q.to || q.endDate,
    sortBy: q.sortBy, sortOrder: q.sortOrder, includeStack: q.includeStack,
  };
}

// ─── List ──────────────────────────────────────────────────────────

export async function getAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const params = mapQuery(req);
    const result = await queryAuditLogs(params);
    res.json({
      data: result.data,
      meta: {
        pagination: {
          page: result.page, limit: result.limit, total: result.total,
          totalPages: result.totalPages, nextCursor: result.nextCursor, hasMore: result.hasMore,
        },
      },
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list audit logs', error?.statusCode));
  }
}

export async function getAuditLogDetail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const includeStack = req.query.includeStack === 'true';
    const doc = await getAuditById((req.params as any).id, includeStack);
    if (!doc) {
      res.status(404).json(fail('Audit entry not found'));
      return;
    }
    res.json(ok(doc));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load audit entry', error?.statusCode));
  }
}

export async function getAuditStatsEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const stats = await getAuditStats();
    res.json(ok(stats));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load audit stats', error?.statusCode));
  }
}

export async function getAuditRegistry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    res.json(ok({
      actions: allActions().map((a) => ({ action: a, meta: getActionMeta(a) })),
      modules: allModules(),
      categories: allCategories(),
    }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load registry', error?.statusCode));
  }
}

// ─── Integrity ─────────────────────────────────────────────────────

export async function getIntegrityReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const report = await verifyIntegrity();
    res.json(ok(report));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Integrity verification failed', error?.statusCode));
  }
}

export async function getIntegrityChecksum(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const checksum = await checksumIntegrity();
    res.json(ok(checksum));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Checksum failed', error?.statusCode));
  }
}

// ─── Retention / archive ───────────────────────────────────────────

export async function getRetention(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    res.json(ok(getRetentionRules()));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load retention rules', error?.statusCode));
  }
}

export async function runRetention(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const force = (req.body as any)?.force === true;
    const result = await runRetentionCleanup({ force });
    res.json(ok(result));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Retention cleanup failed', error?.statusCode));
  }
}

export async function getArchive(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const result = await listArchived({
      page: q.page, limit: q.limit, module: q.module, from: q.from, to: q.to,
    });
    res.json(okWithMeta(result.data, { pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages } }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list archive', error?.statusCode));
  }
}

export async function restoreArchive(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const ids = (req.body as any)?.ids || [];
    const result = await restoreArchived(ids);
    res.json(ok(result));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Restore failed', error?.statusCode));
  }
}

// ─── Exports ───────────────────────────────────────────────────────

export async function createAuditExport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = (req.body as any) ?? {};
    const actor = actorFrom(req);
    const job = await createExportJob(
      {
        format: body.format || 'csv',
        search: body.search, action: body.action, module: body.module,
        category: body.category, severity: body.severity, result: body.result,
        performedBy: body.performedBy, restaurantId: body.restaurantId,
        entityType: body.entityType, from: body.from, to: body.to,
        password: body.password,
      },
      actor.name,
      actor.id,
    );
    res.status(202).json(ok({ id: String(job._id), status: job.status }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to create export', error?.statusCode));
  }
}

export async function getAuditExportStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status = await getJobStatus((req.params as any).id);
    if (!status) {
      res.status(404).json(fail('Export job not found'));
      return;
    }
    res.json(ok(status));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load export status', error?.statusCode));
  }
}

export async function downloadAuditExport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const job = await AuditExportJob.findById((req.params as any).id).lean().exec();
    if (!job) {
      res.status(404).json(fail('Export job not found'));
      return;
    }
    if (job.status !== 'completed' || !job.outputPath) {
      res.status(409).json(fail('Export not ready'));
      return;
    }
    const { buffer, fileName } = resolveJobFile(job);
    const rawFormat = (job.filters as any)?.format;
    const format: string = rawFormat === 'xlsx' || rawFormat === 'json' || rawFormat === 'pdf' || rawFormat === 'csv' ? rawFormat : 'csv';
    const mimes: Record<string, string> = {
      csv: 'text/csv',
      json: 'application/json',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    };
    res.setHeader('Content-Type', mimes[format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Audit-Signature', job.signedHash || '');
    res.end(buffer);
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Download failed', error?.statusCode));
  }
}

// ─── Alerts ────────────────────────────────────────────────────────

export async function getAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const result = await listAlerts({ page: q.page, limit: q.limit, severity: q.severity, resolved: q.resolved });
    res.json({ data: result.data, meta: { pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages } } });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list alerts', error?.statusCode));
  }
}

export async function getAlertSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    res.json(ok(await alertSummary()));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load alert summary', error?.statusCode));
  }
}

export async function resolveAlertEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const actor = actorFrom(req);
    const done = await resolveAlert((req.params as any).id, actor.name);
    if (!done) {
      res.status(404).json(fail('Alert not found or already resolved'));
      return;
    }
    res.json(ok({ resolved: true }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to resolve alert', error?.statusCode));
  }
}

export async function removeAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const done = await deleteAlert((req.params as any).id);
    if (!done) {
      res.status(404).json(fail('Alert not found'));
      return;
    }
    res.json(ok({ deleted: true }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to delete alert', error?.statusCode));
  }
}

// ─── Saved searches ────────────────────────────────────────────────

export async function getSavedSearches(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const actor = actorFrom(req);
    const list = await listSavedSearches(actor.id);
    res.json(ok(list));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list saved searches', error?.statusCode));
  }
}

export async function createSavedSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const actor = actorFrom(req);
    const body = (req.body as any) ?? {};
    const id = await saveSearch({
      name: body.name, filters: body.filters || {}, isGlobal: body.isGlobal, createdBy: actor.name, createdById: actor.id,
    });
    res.status(201).json(ok({ id }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to save search', error?.statusCode));
  }
}

export async function removeSavedSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const done = await deleteSavedSearch((req.params as any).id);
    if (!done) {
      res.status(404).json(fail('Saved search not found'));
      return;
    }
    res.json(ok({ deleted: true }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to delete saved search', error?.statusCode));
  }
}

// ─── Legal holds ───────────────────────────────────────────────────

export async function getLegalHolds(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    res.json(ok(await listLegalHolds({ active: q.active === undefined ? undefined : q.active === 'true' })));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list legal holds', error?.statusCode));
  }
}

export async function createLegalHoldEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const actor = actorFrom(req);
    const body = (req.body as any) ?? {};
    const id = await createLegalHold({
      module: body.module, entityType: body.entityType, entityId: body.entityId,
      caseRef: body.caseRef, reason: body.reason, expiresAt: body.expiresAt, createdBy: actor.name,
    });
    res.status(201).json(ok({ id }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to create legal hold', error?.statusCode));
  }
}

export async function releaseLegalHoldEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const done = await releaseLegalHold((req.params as any).id);
    if (!done) {
      res.status(404).json(fail('Legal hold not found or already released'));
      return;
    }
    res.json(ok({ released: true }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to release legal hold', error?.statusCode));
  }
}
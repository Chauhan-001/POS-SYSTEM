/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * modules/audit/index.ts — Enterprise audit subsystem barrel.
 */

export { auditService, stableStringify, recomputeDocHash } from './auditService';
export type { AuditWriteResult, AuditLogInput } from './auditService';

export { maskSecrets, maskPii, isSensitiveKey, isPiiKey } from './masking';

export {
  getActionMeta,
  canonicalizeAction,
  moduleFor,
  categoryFor,
  severityFor,
  labelFor,
  isSecurityAction,
  isCritical,
  allActions,
  allModules,
  allCategories,
} from './actionRegistry';
export type { AuditCategory, AuditSeverity, ActionMeta } from './actionRegistry';

export { auditStorage, getAuditStore, withAuditStore, parseUserAgent, requestIp, requestDeviceId } from './auditContext';
export type { AuditRequestStore, ParsedUserAgent } from './auditContext';

export { auditContextMiddleware } from './auditContextMiddleware';

export { verifyIntegrity, checksumIntegrity } from './integrityService';
export type { IntegrityReport, IntegrityRow } from './integrityService';

export {
  getRetentionRules,
  retentionDaysFor,
  isUnderLegalHold,
  runRetentionCleanup,
  restoreArchived,
  listArchived,
  ensureGlobalTtlIndex,
  startRetentionScheduler,
  stopRetentionScheduler,
} from './retentionService';
export type { RetentionRule } from './retentionService';

export { getAuditStats } from './statsService';

export {
  createExportJob,
  getJobStatus,
  buildCSV,
  buildJSON,
  buildXLSX,
  buildPDF,
  sha256,
  encryptPayload,
  decryptOrNull,
  resolveJobFile,
  MIME,
} from './exportService';
export type { ExportPayload, ExportFormat } from './exportService';

export {
  buildAuditFilter,
  buildAuditSort,
  encodeCursor,
  decodeCursor,
  queryAuditLogs,
  getAuditById,
  toReadSafe,
} from './queryService';
export type { AuditQueryParams, AuditQueryResult } from './queryService';

export {
  AuditChainMeta,
  AuditLogArchive,
  AuditExportJob,
  AuditAlert,
  AuditLegalHold,
  AuditSavedSearch,
  AUDIT_META_ID,
} from './models';
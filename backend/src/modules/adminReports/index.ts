/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * index.ts — Admin Reports module barrel (Phase 2.10).
 *
 * Exposes the unified reporting service, models, export + job subsystems so the
 * rest of the codebase (controllers, server bootstrap, hooks) imports one file.
 */

export * from './models';
export {
  AdminReportingService,
  adminReportingService,
  invalidateReportCache,
} from './adminReportingService';
export type { ReportOptions } from './adminReportingService';
export {
  buildWindow,
  previousWindow,
  buildForecastBuckets,
  pctChange,
} from './reportQueryBuilder';
export type { DateWindow } from './reportQueryBuilder';
export {
  createExportJob,
  getJobStatus,
  resolveJobFile,
  buildCSV,
  buildJSON,
  buildXLSX,
  buildPDF,
  sha256,
  encryptPayload,
  MIME,
} from './exporters/reportExportService';
export {
  startReportScheduler,
  stopReportScheduler,
  runNightlySnapshots,
  runInactiveSnapshotJob,
  writeSnapshot,
  snapshotTimerState,
} from './jobs/reportJobs';
export {
  getGrowthReport,
} from './aggregations/growth';
export {
  getRevenueReport,
  recordRevenueEvent,
} from './aggregations/revenue';
export {
  getSubscriptionReport,
  recordSubscriptionHistory,
  getRestaurantSubscriptionLifecycle,
} from './aggregations/subscriptions';
export {
  getAiRevenueReport,
} from './aggregations/ai';
export {
  getSupportReport,
} from './aggregations/support';
export {
  getDeviceReport,
} from './aggregations/devices';
export {
  getUsageReport,
} from './aggregations/usage';
export {
  getOwnerReport,
} from './aggregations/owners';
export {
  getInactiveReport,
  lastActivityForRestaurant,
  computeInactiveSnapshot,
} from './aggregations/inactive';
export {
  getFeatureReport,
} from './aggregations/features';
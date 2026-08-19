/**
 * =============================================================================
 *  admin.ts — Admin Dashboard API Routes
 * =============================================================================
 *
 * Purpose:
 *   All /api/auth/admin/* and /api/admin/* route definitions.
 *   Each route is authenticated + collection-access-checked.
 *
 * Route Groups:
 *   Auth:     POST /auth/admin/login, /auth/admin/profile
 *   Restaurants: CRUD + suspend/activate + branch management
 *   Owners:   CRUD + reset password + deactivate/activate
 *   Devices:  List + block/unblock
 *   Subscriptions: CRUD + renew/upgrade/downgrade/pause/resume
 *   Plans:    CRUD
 *   Analytics: Dashboard stats, charts, recent activity
 *   Settings: Company, subscription, AI, general
 *   Support:  Search
 *
 * Security:
 *   All routes behind requireAuth + requireCollectionAccess
 *   Login route has authIpLimiter + accountBackoff for brute-force protection
 */

import { Router } from 'express';
// Admin-dashboard gate: accepts ONLY admin-surface (super_admin) tokens, so
// POS/restaurant tokens can never reach the admin API. Aliased to keep the
// existing route wiring unchanged.
import { requireAdminAuth as requireAuth } from '../middleware/authMiddleware';
import { requireCollectionAccess } from '../middleware/authorizationMiddleware';
import { authIpLimiter, accountBackoff } from '../middleware/rateLimiter';
import { adminLogin, adminProfile, adminUpdateProfile, adminChangePassword } from '../controllers/adminAuthController';
import { cached, invalidateCache } from '../utils/ResponseCache';
import {
  getRestaurants, getRestaurant, createRestaurant, updateRestaurant,
  deleteRestaurant, suspendRestaurant, activateRestaurant,
  restoreRestaurant, permanentDeleteRestaurant, getRestaurantStatistics,
  getRestaurantBranchUsage, createRestaurantBranch, addAdminNote,
  getSubscriptionUsage, getDeviceActivitySummary,
  resetRestaurantPassword, regenerateRestaurantCredentials,
} from '../controllers/adminRestaurantsController';
import {
  uploadRestaurantLogo, uploadRestaurantCover,
  deleteRestaurantLogo, deleteRestaurantCover,
  getRestaurantStorage, restaurantImageUpload,
} from '../modules/media';
import {
  getOwners, getOwner, createOwner, updateOwner, resetOwnerPassword,
  deactivateOwner, activateOwner, suspendOwner, lockOwner, unlockOwner,
  deleteOwner, restoreOwner, permanentDeleteOwner,
  getOwnerRestaurants, assignOwnerRestaurant, unassignOwnerRestaurant,
  getOwnerSessions, revokeOwnerSession, revokeAllOwnerSessions,
  getOwnerDevices, getOwnerDevice, blockOwnerDevice, unblockOwnerDevice, removeOwnerDevice,
  getOwnerLoginHistory, getOwnerProfile, getOwnerStatistics,
} from '../controllers/adminOwnersController';
import {
  getDevices, getDevice, blockDevice, unblockDevice,
  approveDevice, rejectDevice, bulkApproveDevices, bulkRejectDevices,
  removeDevice, permanentDeleteDevice, removeInactiveDevices,
  forceLogoutDevices, getDeviceSessions, revokeDeviceSession,
  getDeviceHealth, getDeviceStatistics,
} from '../controllers/adminDevicesController';
import { getDeviceActivity } from '../controllers/deviceActivityController';
import {
  deviceListQuerySchema, deviceParamsSchema, deviceSessionParamsSchema,
  deviceApprovalSchema, deviceRejectSchema, deviceBulkSchema,
  deviceRemoveSchema, deviceRemoveInactiveSchema, deviceForceLogoutSchema,
} from '../validation';
import {
  getSubscriptions, getSubscription, renewSubscription, upgradeSubscription,
  downgradeSubscription, pauseSubscription, resumeSubscription,
  getSubscriptionByRestaurant, getSubscriptionPayments, updateGrantedFeatures,
} from '../controllers/adminSubscriptionsController';
import {
  getPlans, getPlan, createPlan, updatePlan, deletePlan,
  clonePlan, setPlanStatus, archivePlan, restorePlan, permanentDeletePlan,
  getPlanVersions, rollbackPlan, assignPlan, convertTrial, getPlanStatistics,
} from '../controllers/adminPlansController';

import {
  getDashboardStats, getAnalytics, getRecentActivity, getLatestRestaurants,
  getSubscriptionRevenue, getAIAnalyticsEndpoint, getDeviceAnalyticsEndpoint,
  getGrowthMetricsEndpoint, getChurnMetricsEndpoint, getActivityMetricsEndpoint,
  getApiRequestAnalyticsEndpoint,
} from '../controllers/adminAnalyticsController';
import {
  exportDashboardCSV, exportDashboardExcel, exportDashboardPDF,
} from '../controllers/adminAnalyticsExportController';
import {
  getAiQuota,
  getDashboardSummary,
  getTokenSummary, getTokenTimeSeries, getTokensByModel, getTokensByRestaurant, getTokensByOwner, getTokensByFeature,
  getRequestSummary, getRequestTimeSeries,
  getCostSummary, getCostTimeSeries, getCostByModel, getCostByFeature, getCostByRestaurant, getCostByOwner,
  getLatencySummary, getLatencyTimeSeries, getLatencyByModel, getLatencyByFeature,
  getErrorSummary,
  getModelAnalytics,
  getRestaurantAnalytics, getRestaurantDetail,
  getOwnerAnalytics, getOwnerDetail,
  getFeatureAnalytics,
  getVoiceAnalytics,
  searchAiAnalytics,
  getAvailableFilters,
} from '../controllers/aiAnalyticsController';
import {
  getCompanySettings, updateCompanySettings,
  getDefaultSubscriptionSettings, updateDefaultSubscriptionSettings,
  getAISettings, updateAISettings,
  getGeneralSettings, updateGeneralSettings,
} from '../controllers/adminSettingsController';
import { searchSupport } from '../controllers/adminSupportController';
import {
  getTickets, getTicket, createTicket, updateTicket,
  setTicketStatusEndpoint as setTicketStatus, assignTicketEndpoint as assignTicket,
  getReplies, addReply, uploadAttachment, removeAttachment,
  deleteTicketEndpoint as deleteTicket, restoreTicketEndpoint as restoreTicket,
  getActivity, getTicketStatsEndpoint as getTicketStats, setSatisfaction,
} from '../controllers/adminSupportController';
import {
  ticketParamsSchema, ticketAttachmentParamsSchema, createTicketSchema,
  updateTicketSchema, ticketStatusSchema, assignTicketSchema, replySchema,
  ticketListQuerySchema, ticketSatisfactionSchema,
} from '../validation';
import { attachmentUpload } from '../modules/media';
import {
  getAuditLogs, getAuditLogDetail, getAuditStatsEndpoint, getAuditRegistry,
  getIntegrityReport, getIntegrityChecksum,
  getRetention, runRetention, getArchive, restoreArchive,
  createAuditExport, getAuditExportStatus, downloadAuditExport,
  getAlerts, getAlertSummary, resolveAlertEndpoint, removeAlert,
  getSavedSearches, createSavedSearch, removeSavedSearch,
  getLegalHolds, createLegalHoldEndpoint, releaseLegalHoldEndpoint,
} from '../controllers/adminAuditLogsController';
import {
  auditQuerySchema, auditDetailParamsSchema, auditExportBodySchema,
  auditArchiveQuerySchema, auditArchiveRestoreBodySchema,
  auditLegalHoldBodySchema, auditLegalHoldParamsSchema,
  auditSavedSearchBodySchema, auditSavedSearchParamsSchema,
  auditAlertListQuerySchema, auditAlertParamsSchema, auditRetentionRunBodySchema,
} from '../validation/audit';
import {
  getCrmOverview, getCrmCustomers, getCrmLoyaltySettings, getCrmTiers,
  getCrmCampaigns, getCrmReferrals, getCrmReport, getCrmOffers, getCrmRewards,
} from '../controllers/adminCrmController';
import {
  listBlockedIps, blockIp, unblockIp, getSuggestedBlockedIps,
} from '../controllers/adminSecurityController';
import {
  blockedIpListQuerySchema, blockIpSchema, blockedIpParamsSchema,
} from '../validation';
import {
  getFinanceOverview, getFinancePnl, getFinanceExpenses, getFinanceExpenseRegister,
  getFinanceCashFlow, getFinanceCashLedger, getFinanceGst, getFinanceVendors,
  getFinanceRecurring, getFinanceCategories, getFinanceMonthly, getFinanceBranches,
} from '../controllers/adminFinanceController';
import {
  getAdminSalesSummary, getAdminSalesTrend, getAdminSalesPayments,
  getAdminSalesOrderTypes, getAdminSalesCashiers, getAdminProductTop,
  getAdminProductCategories, getAdminProductAbc, getAdminInventoryStock,
  getAdminInventoryValuation, getAdminEmployeePerformance, getAdminClosingZ,
  getAdminSummariesMonthly,
} from '../controllers/adminReportsController';
import { validate } from '../middleware/validate';
import {
  adminLoginSchema,
  planIdParamsSchema, planCreateSchema, planUpdateSchema, planCloneSchema,
  planStatusSchema, planAssignSchema, planRollbackSchema, planListQuerySchema,
} from '../validation';
import {
  createRestaurantSchema, updateRestaurantSchema, restaurantListQuerySchema,
  restaurantIdParamsSchema, subscriptionFeatureGrantSchema,
  ownerIdParamsSchema, ownerRestaurantParamsSchema, ownerSessionParamsSchema,
  ownerDeviceParamsSchema, ownerListQuerySchema, ownerCreateSchema,
  ownerUpdateSchema, ownerStatusSchema, ownerLoginHistoryQuerySchema,
} from '../validation';

const router = Router();

router.post('/auth/admin/login', validate({ body: adminLoginSchema }), authIpLimiter, accountBackoff, adminLogin);

router.get('/auth/admin/profile', requireAuth, requireCollectionAccess('User', 'read'), adminProfile);
router.put('/auth/admin/profile', requireAuth, requireCollectionAccess('User', 'update'), adminUpdateProfile);
router.put('/auth/admin/change-password', requireAuth, requireCollectionAccess('User', 'update'), adminChangePassword);

router.get('/admin/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'read'), validate({ query: restaurantListQuerySchema }), cached({ ttlMs: 30_000, tags: ['restaurants'] }), getRestaurants);
router.get('/admin/restaurants/:id/subscription', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: restaurantIdParamsSchema }), getSubscriptionByRestaurant);
router.put('/admin/restaurants/:id/subscription/features', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: restaurantIdParamsSchema, body: subscriptionFeatureGrantSchema }), updateGrantedFeatures, invalidateCache('analytics'));
router.get('/admin/restaurants/:id/payment-history', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: restaurantIdParamsSchema }), getSubscriptionPayments);
router.get('/admin/restaurants/:id', requireAuth, requireCollectionAccess('Restaurant', 'read'), validate({ params: restaurantIdParamsSchema }), getRestaurant);
router.get('/admin/restaurants/:id/statistics', requireAuth, requireCollectionAccess('Restaurant', 'read'), validate({ params: restaurantIdParamsSchema }), getRestaurantStatistics);
router.get('/admin/restaurants/:id/branch-usage', requireAuth, requireCollectionAccess('Restaurant', 'read'), validate({ params: restaurantIdParamsSchema }), getRestaurantBranchUsage);
router.get('/admin/restaurants/:id/subscription-usage', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: restaurantIdParamsSchema }), getSubscriptionUsage);
router.get('/admin/restaurants/:id/device-activity-summary', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: restaurantIdParamsSchema }), getDeviceActivitySummary);
router.post('/admin/restaurants/:id/branches', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), createRestaurantBranch);
router.post('/admin/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'create'), validate({ body: createRestaurantSchema }), createRestaurant, invalidateCache('analytics'));
router.put('/admin/restaurants/:id', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ body: updateRestaurantSchema, params: restaurantIdParamsSchema }), updateRestaurant, invalidateCache('analytics'));
router.delete('/admin/restaurants/:id', requireAuth, requireCollectionAccess('Restaurant', 'delete'), validate({ params: restaurantIdParamsSchema }), deleteRestaurant, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/restore', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), restoreRestaurant, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/permanent-delete', requireAuth, requireCollectionAccess('Restaurant', 'delete'), validate({ params: restaurantIdParamsSchema }), permanentDeleteRestaurant, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/suspend', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), suspendRestaurant, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/activate', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), activateRestaurant, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/notes', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), addAdminNote);
router.post('/admin/restaurants/:id/reset-password', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), resetRestaurantPassword, invalidateCache('analytics'));
router.post('/admin/restaurants/:id/regenerate-credentials', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), regenerateRestaurantCredentials, invalidateCache('analytics'));

// ─── Restaurant Media (logo / cover) + storage metrics (Phase 2.2 ext.) ─
// Upload flow: auth → RBAC → param validation → multer (size + MIME gate)
//              → controller → MediaService (magic bytes, disk, DB, audit).
router.get('/admin/restaurants/:id/media/storage', requireAuth, requireCollectionAccess('Restaurant', 'read'), validate({ params: restaurantIdParamsSchema }), getRestaurantStorage);
router.post('/admin/restaurants/:id/media/logo', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), restaurantImageUpload.single('file'), uploadRestaurantLogo, invalidateCache('analytics'), invalidateCache('restaurants'));
router.post('/admin/restaurants/:id/media/cover', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), restaurantImageUpload.single('file'), uploadRestaurantCover, invalidateCache('analytics'), invalidateCache('restaurants'));
router.delete('/admin/restaurants/:id/media/logo', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), deleteRestaurantLogo, invalidateCache('analytics'), invalidateCache('restaurants'));
router.delete('/admin/restaurants/:id/media/cover', requireAuth, requireCollectionAccess('Restaurant', 'update'), validate({ params: restaurantIdParamsSchema }), deleteRestaurantCover, invalidateCache('analytics'), invalidateCache('restaurants'));

// ─── Owners Management (Phase 2.3) — full lifecycle ─────────────
router.get('/admin/owners', requireAuth, requireCollectionAccess('User', 'read'), validate({ query: ownerListQuerySchema }), getOwners);
router.post('/admin/owners', requireAuth, requireCollectionAccess('User', 'create'), validate({ body: ownerCreateSchema }), createOwner, invalidateCache('analytics'));
router.get('/admin/owners/:id', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema }), getOwner);
router.put('/admin/owners/:id', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema, body: ownerUpdateSchema }), updateOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/reset-password', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), resetOwnerPassword, invalidateCache('analytics'));
router.post('/admin/owners/:id/deactivate', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), deactivateOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/suspend', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), suspendOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/activate', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), activateOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/lock', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema, body: ownerStatusSchema }), lockOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/unlock', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), unlockOwner, invalidateCache('analytics'));
router.delete('/admin/owners/:id', requireAuth, requireCollectionAccess('User', 'delete'), validate({ params: ownerIdParamsSchema }), deleteOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/restore', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), restoreOwner, invalidateCache('analytics'));
router.post('/admin/owners/:id/permanent-delete', requireAuth, requireCollectionAccess('User', 'delete'), validate({ params: ownerIdParamsSchema }), permanentDeleteOwner, invalidateCache('analytics'));

// Owner → restaurant mapping
router.get('/admin/owners/:id/restaurants', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema }), getOwnerRestaurants);
router.post('/admin/owners/:id/restaurants/:restaurantId', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerRestaurantParamsSchema }), assignOwnerRestaurant, invalidateCache('analytics'), invalidateCache('restaurants'));
router.delete('/admin/owners/:id/restaurants/:restaurantId', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerRestaurantParamsSchema }), unassignOwnerRestaurant, invalidateCache('analytics'), invalidateCache('restaurants'));

// Owner sessions (reuse refresh-token architecture)
router.get('/admin/owners/:id/sessions', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema }), getOwnerSessions);
router.post('/admin/owners/:id/sessions/:sessionId/revoke', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerSessionParamsSchema }), revokeOwnerSession);
router.post('/admin/owners/:id/sessions/revoke-all', requireAuth, requireCollectionAccess('User', 'update'), validate({ params: ownerIdParamsSchema }), revokeAllOwnerSessions);

// Owner devices
router.get('/admin/owners/:id/devices', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: ownerIdParamsSchema }), getOwnerDevices);
router.get('/admin/owners/:id/devices/:deviceId', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: ownerDeviceParamsSchema }), getOwnerDevice);
router.post('/admin/owners/:id/devices/:deviceId/block', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: ownerDeviceParamsSchema }), blockOwnerDevice);
router.post('/admin/owners/:id/devices/:deviceId/unblock', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: ownerDeviceParamsSchema }), unblockOwnerDevice);
router.delete('/admin/owners/:id/devices/:deviceId', requireAuth, requireCollectionAccess('Device', 'delete'), validate({ params: ownerDeviceParamsSchema }), removeOwnerDevice);

// Owner login history / profile / statistics
router.get('/admin/owners/:id/login-history', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema, query: ownerLoginHistoryQuerySchema }), getOwnerLoginHistory);
router.get('/admin/owners/:id/profile', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema }), getOwnerProfile);
router.get('/admin/owners/:id/statistics', requireAuth, requireCollectionAccess('User', 'read'), validate({ params: ownerIdParamsSchema }), getOwnerStatistics);

// ─── Device Management (Phase 2.5) — full lifecycle ────────────
// Static routes are registered BEFORE parameterized ones so 'statistics',
// 'bulk-approve', 'bulk-reject', 'remove-inactive' and 'force-logout' are
// never captured by /:id.
router.get('/admin/devices', requireAuth, requireCollectionAccess('Device', 'read'), validate({ query: deviceListQuerySchema }), getDevices);
router.get('/admin/devices/statistics', requireAuth, requireCollectionAccess('Device', 'read'), getDeviceStatistics);
router.post('/admin/devices/bulk-approve', requireAuth, requireCollectionAccess('Device', 'update'), validate({ body: deviceBulkSchema }), bulkApproveDevices, invalidateCache('analytics'));
router.post('/admin/devices/bulk-reject', requireAuth, requireCollectionAccess('Device', 'update'), validate({ body: deviceBulkSchema }), bulkRejectDevices, invalidateCache('analytics'));
router.post('/admin/devices/remove-inactive', requireAuth, requireCollectionAccess('Device', 'delete'), validate({ body: deviceRemoveInactiveSchema }), removeInactiveDevices, invalidateCache('analytics'));
router.post('/admin/devices/force-logout', requireAuth, requireCollectionAccess('Device', 'update'), validate({ body: deviceForceLogoutSchema }), forceLogoutDevices);
router.get('/admin/devices/:id', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: deviceParamsSchema }), getDevice);
router.post('/admin/devices/:id/approve', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceParamsSchema, body: deviceApprovalSchema }), approveDevice, invalidateCache('analytics'));
router.post('/admin/devices/:id/reject', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceParamsSchema, body: deviceRejectSchema }), rejectDevice, invalidateCache('analytics'));
router.post('/admin/devices/:id/block', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceParamsSchema }), blockDevice, invalidateCache('analytics'));
router.post('/admin/devices/:id/unblock', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceParamsSchema }), unblockDevice, invalidateCache('analytics'));
router.delete('/admin/devices/:id', requireAuth, requireCollectionAccess('Device', 'delete'), validate({ params: deviceParamsSchema, body: deviceRemoveSchema }), removeDevice, invalidateCache('analytics'));
router.post('/admin/devices/:id/permanent-delete', requireAuth, requireCollectionAccess('Device', 'delete'), validate({ params: deviceParamsSchema }), permanentDeleteDevice, invalidateCache('analytics'));
router.post('/admin/devices/:id/force-logout', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceParamsSchema, body: deviceForceLogoutSchema }), forceLogoutDevices);
router.get('/admin/devices/:id/activity', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: deviceParamsSchema }), getDeviceActivity);
router.get('/admin/devices/:id/sessions', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: deviceParamsSchema }), getDeviceSessions);
router.post('/admin/devices/:id/sessions/:sessionId/revoke', requireAuth, requireCollectionAccess('Device', 'update'), validate({ params: deviceSessionParamsSchema }), revokeDeviceSession);
router.get('/admin/devices/:id/health', requireAuth, requireCollectionAccess('Device', 'read'), validate({ params: deviceParamsSchema }), getDeviceHealth);

router.get('/admin/subscriptions', requireAuth, requireCollectionAccess('Subscription', 'read'), getSubscriptions);
router.get('/admin/subscriptions/:id', requireAuth, requireCollectionAccess('Subscription', 'read'), getSubscription);
router.post('/admin/subscriptions/:id/renew', requireAuth, requireCollectionAccess('Subscription', 'update'), renewSubscription, invalidateCache('analytics'));
router.put('/admin/subscriptions/:id/upgrade', requireAuth, requireCollectionAccess('Subscription', 'update'), upgradeSubscription, invalidateCache('analytics'));
router.put('/admin/subscriptions/:id/downgrade', requireAuth, requireCollectionAccess('Subscription', 'update'), downgradeSubscription, invalidateCache('analytics'));
router.post('/admin/subscriptions/:id/pause', requireAuth, requireCollectionAccess('Subscription', 'update'), pauseSubscription, invalidateCache('analytics'));
router.post('/admin/subscriptions/:id/resume', requireAuth, requireCollectionAccess('Subscription', 'update'), resumeSubscription, invalidateCache('analytics'));

// ─── Plans Management (Phase 2.4) — full lifecycle ─────────────
router.get('/admin/subscription-plans', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ query: planListQuerySchema }), cached({ ttlMs: 5 * 60_000, tags: ['plans'] }), getPlans);
router.get('/admin/subscription-plans/:id', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: planIdParamsSchema }), getPlan);
router.post('/admin/subscription-plans', requireAuth, requireCollectionAccess('Subscription', 'create'), validate({ body: planCreateSchema }), createPlan, invalidateCache('plans'), invalidateCache('analytics'));
router.put('/admin/subscription-plans/:id', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: planIdParamsSchema, body: planUpdateSchema }), updatePlan, invalidateCache('plans'), invalidateCache('analytics'));
router.post('/admin/subscription-plans/:id/clone', requireAuth, requireCollectionAccess('Subscription', 'create'), validate({ params: planIdParamsSchema, body: planCloneSchema }), clonePlan, invalidateCache('plans'), invalidateCache('analytics'));
router.post('/admin/subscription-plans/:id/status', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: planIdParamsSchema, body: planStatusSchema }), setPlanStatus, invalidateCache('plans'), invalidateCache('analytics'));
router.post('/admin/subscription-plans/:id/archive', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: planIdParamsSchema }), archivePlan, invalidateCache('plans'), invalidateCache('analytics'));
router.post('/admin/subscription-plans/:id/restore', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: planIdParamsSchema }), restorePlan, invalidateCache('plans'), invalidateCache('analytics'));
router.post('/admin/subscription-plans/:id/permanent-delete', requireAuth, requireCollectionAccess('Subscription', 'delete'), validate({ params: planIdParamsSchema }), permanentDeletePlan, invalidateCache('plans'), invalidateCache('analytics'));
router.get('/admin/subscription-plans/:id/versions', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: planIdParamsSchema }), getPlanVersions);
router.post('/admin/subscription-plans/:id/rollback', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ params: planIdParamsSchema, body: planRollbackSchema }), rollbackPlan, invalidateCache('plans'), invalidateCache('analytics'));
router.get('/admin/subscription-plans/:id/statistics', requireAuth, requireCollectionAccess('Subscription', 'read'), validate({ params: planIdParamsSchema }), getPlanStatistics);
router.post('/admin/subscription-plans/assign', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ body: planAssignSchema }), assignPlan, invalidateCache('plans'), invalidateCache('analytics'), invalidateCache('restaurants'));
router.post('/admin/subscription-plans/trial-convert', requireAuth, requireCollectionAccess('Subscription', 'update'), validate({ body: planAssignSchema.pick({ restaurantId: true, planId: true, billingPeriod: true }) }), convertTrial, invalidateCache('plans'), invalidateCache('analytics'));
router.delete('/admin/subscription-plans/:id', requireAuth, requireCollectionAccess('Subscription', 'delete'), validate({ params: planIdParamsSchema }), deletePlan, invalidateCache('plans'), invalidateCache('analytics'));

router.get('/admin/analytics/dashboard', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getDashboardStats);
router.get('/admin/analytics', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 30_000, tags: ['analytics'] }), getAnalytics);
router.get('/admin/analytics/recent-activity', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 30_000, tags: ['analytics'] }), getRecentActivity);
router.get('/admin/analytics/latest-restaurants', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getLatestRestaurants);
router.get('/admin/analytics/subscription-revenue', requireAuth, requireCollectionAccess('Subscription', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getSubscriptionRevenue);

// ─── Phase 2.6 — Advanced Analytics ───────────────────────────
router.get('/admin/analytics/ai', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getAIAnalyticsEndpoint);
router.get('/admin/analytics/devices', requireAuth, requireCollectionAccess('Device', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getDeviceAnalyticsEndpoint);
router.get('/admin/analytics/growth', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getGrowthMetricsEndpoint);
router.get('/admin/analytics/churn', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getChurnMetricsEndpoint);
router.get('/admin/analytics/activity', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 30_000, tags: ['analytics'] }), getActivityMetricsEndpoint);
router.get('/admin/analytics/api-requests', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getApiRequestAnalyticsEndpoint);

// ─── Phase 2.6 — Analytics Exports (CSV / Excel / PDF) ─────────
router.get('/admin/analytics/export/csv', requireAuth, requireCollectionAccess('Restaurant', 'read'), exportDashboardCSV);
router.get('/admin/analytics/export/excel', requireAuth, requireCollectionAccess('Restaurant', 'read'), exportDashboardExcel);
router.get('/admin/analytics/export/pdf', requireAuth, requireCollectionAccess('Restaurant', 'read'), exportDashboardPDF);

// ─── Phase 2.7 — AI Usage Dashboard ────────────────────────────
// Live per-key quota — short cache so the quota section stays fresh but the
// dashboard still doesn't hammer the provider.
router.get('/admin/analytics/ai/quota', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 30_000, tags: ['analytics'] }), getAiQuota);
router.get('/admin/analytics/ai/dashboard', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getDashboardSummary);
router.get('/admin/analytics/ai/filters', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 300_000, tags: ['analytics'] }), getAvailableFilters);
router.get('/admin/analytics/ai/search', requireAuth, requireCollectionAccess('Restaurant', 'read'), searchAiAnalytics);

// Token analytics
router.get('/admin/analytics/ai/tokens/summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokenSummary);
router.get('/admin/analytics/ai/tokens/timeseries', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokenTimeSeries);
router.get('/admin/analytics/ai/tokens/by-model', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokensByModel);
router.get('/admin/analytics/ai/tokens/by-restaurant', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokensByRestaurant);
router.get('/admin/analytics/ai/tokens/by-owner', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokensByOwner);
router.get('/admin/analytics/ai/tokens/by-feature', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getTokensByFeature);

// Request analytics
router.get('/admin/analytics/ai/requests/summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getRequestSummary);
router.get('/admin/analytics/ai/requests/timeseries', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getRequestTimeSeries);

// Cost analytics
router.get('/admin/analytics/ai/cost/summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostSummary);
router.get('/admin/analytics/ai/cost/timeseries', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostTimeSeries);
router.get('/admin/analytics/ai/cost/by-model', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostByModel);
router.get('/admin/analytics/ai/cost/by-feature', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostByFeature);
router.get('/admin/analytics/ai/cost/by-restaurant', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostByRestaurant);
router.get('/admin/analytics/ai/cost/by-owner', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getCostByOwner);

// Latency analytics
router.get('/admin/analytics/ai/latency/summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getLatencySummary);
router.get('/admin/analytics/ai/latency/timeseries', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getLatencyTimeSeries);
router.get('/admin/analytics/ai/latency/by-model', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getLatencyByModel);
router.get('/admin/analytics/ai/latency/by-feature', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getLatencyByFeature);

// Error analytics
router.get('/admin/analytics/ai/errors/summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getErrorSummary);

// Model analytics
router.get('/admin/analytics/ai/models', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getModelAnalytics);

// Restaurant AI usage
router.get('/admin/analytics/ai/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getRestaurantAnalytics);
router.get('/admin/analytics/ai/restaurants/:restaurantId', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getRestaurantDetail);

// Owner AI usage
router.get('/admin/analytics/ai/owners', requireAuth, requireCollectionAccess('User', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getOwnerAnalytics);
router.get('/admin/analytics/ai/owners/:ownerId', requireAuth, requireCollectionAccess('User', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getOwnerDetail);

// Feature analytics
router.get('/admin/analytics/ai/features', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getFeatureAnalytics);

// Voice AI analytics
router.get('/admin/analytics/ai/voice', requireAuth, requireCollectionAccess('Restaurant', 'read'), cached({ ttlMs: 60_000, tags: ['analytics'] }), getVoiceAnalytics);

router.get('/admin/settings/company', requireAuth, requireCollectionAccess('Authorization', 'read'), cached({ ttlMs: 5 * 60_000, tags: ['settings'] }), getCompanySettings);
router.put('/admin/settings/company', requireAuth, requireCollectionAccess('Authorization', 'update'), updateCompanySettings, invalidateCache('settings'));
router.get('/admin/settings/default-subscription', requireAuth, requireCollectionAccess('Authorization', 'read'), cached({ ttlMs: 5 * 60_000, tags: ['settings'] }), getDefaultSubscriptionSettings);
router.put('/admin/settings/default-subscription', requireAuth, requireCollectionAccess('Authorization', 'update'), updateDefaultSubscriptionSettings, invalidateCache('settings'));
router.get('/admin/settings/ai', requireAuth, requireCollectionAccess('Authorization', 'read'), cached({ ttlMs: 5 * 60_000, tags: ['settings'] }), getAISettings);
router.put('/admin/settings/ai', requireAuth, requireCollectionAccess('Authorization', 'update'), updateAISettings, invalidateCache('settings'));
router.get('/admin/settings/general', requireAuth, requireCollectionAccess('Authorization', 'read'), cached({ ttlMs: 5 * 60_000, tags: ['settings'] }), getGeneralSettings);
router.put('/admin/settings/general', requireAuth, requireCollectionAccess('Authorization', 'update'), updateGeneralSettings, invalidateCache('settings'));

router.get('/admin/support/search', requireAuth, requireCollectionAccess('User', 'read'), searchSupport);

// ─── Support / Help-Desk tickets (Phase 2.8) ──────────────────
// Static ticket routes are registered BEFORE the parameterized /:id routes so
// 'stats' is never captured as a ticket id.
router.get('/admin/support/tickets', requireAuth, requireCollectionAccess('SupportTicket', 'read'), validate({ query: ticketListQuerySchema }), getTickets);
router.get('/admin/support/tickets/stats', requireAuth, requireCollectionAccess('SupportTicket', 'read'), validate({ query: ticketListQuerySchema.pick({ restaurantId: true, assigneeId: true }) }), cached({ ttlMs: 15_000, tags: ['support'] }), getTicketStats);
router.post('/admin/support/tickets', requireAuth, requireCollectionAccess('SupportTicket', 'create'), validate({ body: createTicketSchema }), createTicket, invalidateCache('support'));
router.get('/admin/support/tickets/:id', requireAuth, requireCollectionAccess('SupportTicket', 'read'), validate({ params: ticketParamsSchema }), getTicket);
router.put('/admin/support/tickets/:id', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema, body: updateTicketSchema }), updateTicket, invalidateCache('support'));
router.post('/admin/support/tickets/:id/status', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema, body: ticketStatusSchema }), setTicketStatus, invalidateCache('support'));
router.post('/admin/support/tickets/:id/assign', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema, body: assignTicketSchema }), assignTicket, invalidateCache('support'));
router.get('/admin/support/tickets/:id/replies', requireAuth, requireCollectionAccess('SupportTicket', 'read'), validate({ params: ticketParamsSchema }), getReplies);
router.post('/admin/support/tickets/:id/replies', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema, body: replySchema }), addReply, invalidateCache('support'));
router.post('/admin/support/tickets/:id/attachments', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema }), attachmentUpload.single('file'), uploadAttachment, invalidateCache('support'));
router.delete('/admin/support/tickets/:id/attachments/:attachmentId', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketAttachmentParamsSchema }), removeAttachment, invalidateCache('support'));
router.post('/admin/support/tickets/:id/satisfaction', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema, body: ticketSatisfactionSchema }), setSatisfaction, invalidateCache('support'));
router.get('/admin/support/tickets/:id/activity', requireAuth, requireCollectionAccess('SupportTicket', 'read'), validate({ params: ticketParamsSchema }), getActivity);
router.delete('/admin/support/tickets/:id', requireAuth, requireCollectionAccess('SupportTicket', 'delete'), validate({ params: ticketParamsSchema }), deleteTicket, invalidateCache('support'));
router.post('/admin/support/tickets/:id/restore', requireAuth, requireCollectionAccess('SupportTicket', 'update'), validate({ params: ticketParamsSchema }), restoreTicket, invalidateCache('support'));

// ─── Enterprise Audit Log (Phase 2.9) — platform console ──────
router.get('/admin/audit-logs', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ query: auditQuerySchema }), getAuditLogs);
router.get('/admin/audit-logs/stats', requireAuth, requireCollectionAccess('AuditLog', 'read'), cached({ ttlMs: 30_000, tags: ['audit'] }), getAuditStatsEndpoint);
router.get('/admin/audit-logs/registry', requireAuth, requireCollectionAccess('AuditLog', 'read'), getAuditRegistry);
router.get('/admin/audit-logs/integrity/verify', requireAuth, requireCollectionAccess('AuditLog', 'read'), getIntegrityReport);
router.get('/admin/audit-logs/integrity/checksum', requireAuth, requireCollectionAccess('AuditLog', 'read'), getIntegrityChecksum);
router.get('/admin/audit-logs/retention', requireAuth, requireCollectionAccess('AuditLog', 'read'), getRetention);
router.post('/admin/audit-logs/retention/run', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ body: auditRetentionRunBodySchema }), runRetention, invalidateCache('audit'));
router.get('/admin/audit-logs/archive', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ query: auditArchiveQuerySchema }), getArchive);
router.post('/admin/audit-logs/archive/restore', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ body: auditArchiveRestoreBodySchema }), restoreArchive, invalidateCache('audit'));
router.post('/admin/audit-logs/exports', requireAuth, requireCollectionAccess('AuditLog', 'create'), validate({ body: auditExportBodySchema }), createAuditExport, invalidateCache('audit'));
router.get('/admin/audit-logs/exports/:id', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ params: auditDetailParamsSchema }), getAuditExportStatus);
router.get('/admin/audit-logs/exports/:id/download', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ params: auditDetailParamsSchema }), downloadAuditExport);
router.get('/admin/audit-logs/legal-holds', requireAuth, requireCollectionAccess('AuditLog', 'read'), getLegalHolds);
router.post('/admin/audit-logs/legal-holds', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ body: auditLegalHoldBodySchema }), createLegalHoldEndpoint, invalidateCache('audit'));
router.delete('/admin/audit-logs/legal-holds/:id', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ params: auditLegalHoldParamsSchema }), releaseLegalHoldEndpoint, invalidateCache('audit'));
router.get('/admin/audit-logs/saved-searches', requireAuth, requireCollectionAccess('AuditLog', 'read'), getSavedSearches);
router.post('/admin/audit-logs/saved-searches', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ body: auditSavedSearchBodySchema }), createSavedSearch, invalidateCache('audit'));
router.delete('/admin/audit-logs/saved-searches/:id', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ params: auditSavedSearchParamsSchema }), removeSavedSearch, invalidateCache('audit'));
router.get('/admin/audit-logs/alerts', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ query: auditAlertListQuerySchema }), getAlerts);
router.get('/admin/audit-logs/alerts/summary', requireAuth, requireCollectionAccess('AuditLog', 'read'), getAlertSummary);
router.post('/admin/audit-logs/alerts/:id/resolve', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ params: auditAlertParamsSchema }), resolveAlertEndpoint, invalidateCache('audit'));
router.delete('/admin/audit-logs/alerts/:id', requireAuth, requireCollectionAccess('AuditLog', 'update'), validate({ params: auditAlertParamsSchema }), removeAlert, invalidateCache('audit'));
// Detail must be registered AFTER the static sub-routes above so :id never swallows them.
router.get('/admin/audit-logs/:id', requireAuth, requireCollectionAccess('AuditLog', 'read'), validate({ params: auditDetailParamsSchema }), getAuditLogDetail);

// ─── Security — Manual IP Blocklist (attack response) ─────────
// Static routes first so 'suggested' is never captured by /:id.
router.get('/admin/security/blocked-ips/suggested', requireAuth, requireCollectionAccess('Authorization', 'read'), getSuggestedBlockedIps);
router.get('/admin/security/blocked-ips', requireAuth, requireCollectionAccess('Authorization', 'read'), validate({ query: blockedIpListQuerySchema }), listBlockedIps);
router.post('/admin/security/blocked-ips', requireAuth, requireCollectionAccess('Authorization', 'update'), validate({ body: blockIpSchema }), blockIp, invalidateCache('audit'));
router.delete('/admin/security/blocked-ips/:id', requireAuth, requireCollectionAccess('Authorization', 'update'), validate({ params: blockedIpParamsSchema }), unblockIp, invalidateCache('audit'));

// ─── Customer CRM (Phase 1.6) — platform console view of a restaurant's
//     Customer Management + Loyalty + CRM data (read-only, admin auth).
router.get('/admin/restaurants/:id/crm/overview', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmOverview);
router.get('/admin/restaurants/:id/crm/customers', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmCustomers);
router.get('/admin/restaurants/:id/crm/loyalty-settings', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmLoyaltySettings);
router.get('/admin/restaurants/:id/crm/tiers', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmTiers);
router.get('/admin/restaurants/:id/crm/campaigns', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmCampaigns);
router.get('/admin/restaurants/:id/crm/referrals', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmReferrals);
router.get('/admin/restaurants/:id/crm/report', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmReport);
router.get('/admin/restaurants/:id/crm/offers', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmOffers);
router.get('/admin/restaurants/:id/crm/rewards', requireAuth, requireCollectionAccess('Restaurant', 'read'), getCrmRewards);

// ─── Finance (Phase 1.7) — platform console view of a restaurant's
//     Expenses & Finance data (read-only, admin auth).
router.get('/admin/restaurants/:id/finance/overview', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceOverview);

// ─── Phase 1.8 — Reports (read-only platform console) ──────────
router.get('/admin/restaurants/:id/reports/sales-summary', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSalesSummary);
router.get('/admin/restaurants/:id/reports/sales-trend', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSalesTrend);
router.get('/admin/restaurants/:id/reports/sales-payments', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSalesPayments);
router.get('/admin/restaurants/:id/reports/sales-order-types', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSalesOrderTypes);
router.get('/admin/restaurants/:id/reports/sales-cashiers', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSalesCashiers);
router.get('/admin/restaurants/:id/reports/products-top', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminProductTop);
router.get('/admin/restaurants/:id/reports/products-categories', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminProductCategories);
router.get('/admin/restaurants/:id/reports/products-abc', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminProductAbc);
router.get('/admin/restaurants/:id/reports/inventory-stock', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminInventoryStock);
router.get('/admin/restaurants/:id/reports/inventory-valuation', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminInventoryValuation);
router.get('/admin/restaurants/:id/reports/employees-performance', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminEmployeePerformance);
router.get('/admin/restaurants/:id/reports/closing-z', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminClosingZ);
router.get('/admin/restaurants/:id/reports/summaries-monthly', requireAuth, requireCollectionAccess('Restaurant', 'read'), getAdminSummariesMonthly);
router.get('/admin/restaurants/:id/finance/pnl', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinancePnl);
router.get('/admin/restaurants/:id/finance/expenses', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceExpenses);
router.get('/admin/restaurants/:id/finance/expense-register', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceExpenseRegister);
router.get('/admin/restaurants/:id/finance/cashflow', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceCashFlow);
router.get('/admin/restaurants/:id/finance/cash-ledger', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceCashLedger);
router.get('/admin/restaurants/:id/finance/gst', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceGst);
router.get('/admin/restaurants/:id/finance/vendors', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceVendors);
router.get('/admin/restaurants/:id/finance/recurring', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceRecurring);
router.get('/admin/restaurants/:id/finance/categories', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceCategories);
router.get('/admin/restaurants/:id/finance/monthly', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceMonthly);
router.get('/admin/restaurants/:id/finance/branches', requireAuth, requireCollectionAccess('Restaurant', 'read'), getFinanceBranches);

export default router;
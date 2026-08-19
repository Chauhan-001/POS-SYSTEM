/**
 * =============================================================================
 *  types/index.ts — Admin Dashboard Type Definitions
 * =============================================================================
 *
 * Purpose:
 *   All shared TypeScript interfaces and types for the Admin Dashboard.
 *
 * Categories:
 *   Auth:        User, AuthResponse, LoginCredentials
 *   Restaurant:  Restaurant, Owner, BranchUsage
 *   Subscription: Subscription, SubscriptionPlan, PlanLimits
 *   Device:      Device
 *   Analytics:   DashboardStats, AnalyticsData, ChartDataPoint
 *   Common:      PaginatedResponse, ApiError
 */

// ─── Auth Types ──────────────────────────────────────────────────

export interface User {
  id: string
  userId: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN'
  avatar?: string
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface LoginCredentials {
  userId: string
  password: string
  rememberMe?: boolean
}

// ─── Restaurant Types ────────────────────────────────────────────

export interface Restaurant {
  id: string
  restaurantId?: string
  name: string
  legalName?: string
  brandName?: string
  ownerId: string
  ownerName: string
  ownerEmail: string
  phone: string
  email?: string
  plan: string
  status: 'active' | 'inactive' | 'suspended' | 'deleted'
  devices: number
  maxDevices: number
  branchCount?: number
  lastActive?: string | null
  aiEnabled: boolean
  loyaltyEnabled?: boolean
  offlineMode?: boolean
  weatherEnabled?: boolean
  address?: string
  area?: string
  city?: string
  state?: string
  district?: string
  country?: string
  gst?: string
  gstEnabled?: boolean
  fssai?: string
  pan?: string
  businessRegNumber?: string
  taxMode?: string
  printerType?: string
  receiptWidth?: string
  zip?: string
  website?: string
  description?: string
  notes?: string
  ownerPhone?: string
  emergencyContact?: string
  timezone?: string
  currency?: string
  deletedAt?: string | null
  adminNotes?: Array<{ id: string; note: string; admin: string; timestamp: string }>
  auditTrail?: Array<{ id: string; action: string; admin: string; timestamp: string; reason?: string }>
  createdAt: string
  updatedAt: string
  ownerUserId?: string
  ownerPin?: string
  logoUrl?: string | null
  coverImageUrl?: string | null
  invoice?: {
    number: string
    amount: number
    tax: number
  }
}

export interface Owner {
  id: string
  name: string
  email: string
  phone: string
  status: 'active' | 'inactive' | 'suspended' | 'deleted'
  restaurants: number
  activeRestaurants?: number
  suspendedRestaurants?: number
  branches?: number
  devices?: number
  lastLogin?: string | null
  lastActivity?: string | null
  createdAt: string
  updatedAt: string
}

export interface OwnerDetail extends Owner {
  lockedAt?: string | null
  lockedBy?: string | null
  lockReason?: string | null
  activeSessions?: number
  restaurantsList?: Array<{
    id: string
    restaurantId: string
    name: string
    isActive: boolean
    isDeleted?: boolean
  }>
}

export interface OwnerSession {
  id: string
  deviceId: string | null
  deviceName: string | null
  os: string | null
  appVersion: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string | null
  expiresAt: string | null
  lastActivityAt: string | null
  isActive: boolean
}

export interface OwnerDevice {
  id: string
  restaurantId: string | null
  restaurantName: string
  deviceId: string
  deviceName: string
  os: string
  osVersion: string
  appVersion: string
  lastLogin: string | null
  status: string
  isActive: boolean
}

export interface OwnerStatistics {
  id: string
  name: string
  status: string
  restaurantsOwned: number
  activeRestaurants: number
  suspendedRestaurants: number
  totalBranches: number
  totalDevices: number
  totalEmployees: number
  activeSessions: number
  lastLogin: string | null
  lastActivity: string | null
}

export interface OwnerLoginHistoryEntry {
  event: string
  timestamp: string | null
  deviceName?: string | null
  deviceId?: string | null
  os?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  isActive?: boolean
  loggedOut?: boolean
  lastActivityAt?: string | null
  performedBy?: string
  details?: Record<string, any> | null
}

export interface BranchUsage {
  total: number
  maximum: number | 'unlimited'
}

// ─── Subscription Types ──────────────────────────────────────────

export interface Subscription {
  id: string
  restaurantId: string
  restaurantName: string
  plan: string
  /** Billing cadence — monthly (30d) or yearly (365d). Determines the price charged and renewal period. */
  billingPeriod: 'monthly' | 'yearly'
  status: 'active' | 'paused' | 'expired' | 'cancelled' | 'trial' | 'grace'
  startDate: string
  expiryDate: string | null
  trialEnd: string | null
  graceEnd: string | null
  maxUsers: number
  maxDevices: number
  aiEnabled: boolean
  price: number
  autoRenew: boolean
  /** Effective feature set = plan snapshot + admin-granted add-ons. */
  features?: string[]
  /** Add-on features granted by the platform admin beyond the plan snapshot. */
  grantedFeatures?: string[]
  /** The plan's own feature snapshot (without admin grants). */
  planFeatures?: string[]
  lastPayment?: {
    amount: number
    date: string
    invoiceNumber: string
    method: string
  } | null
  limits?: PlanLimits
  branchUsage?: BranchUsage
}

export interface SubscriptionPlan {
  id: string
  planId: string
  name: string
  description: string
  /** Monthly price (legacy `price` — kept for billing compatibility). */
  price: number
  /** Yearly price — billed once per year. 0 = not offered. */
  yearlyPrice: number
  maxUsers: number
  maxDevices: number
  features: string[]
  aiEnabled: boolean
  trialDays: number
  sortOrder: number
  isActive: boolean
  isDefault: boolean
  limits?: PlanLimits
  createdAt: string
  updatedAt: string
}

export interface PlanLimits {
  maxBranches: number
  maxDevicesPerBranch: number
}

// ─── Subscription Usage Types ───────────────────────────────────

export interface ResourceUsage {
  current: number
  limit: number
  percentage: number
  remaining: number
  isUnlimited: boolean
}

export interface UsageFeature {
  key: string
  label: string
  description: string
  enabled: boolean
}

export interface SubscriptionUsage {
  restaurantId: string
  restaurantName: string
  plan: {
    id: string
    name: string
    status: string
    /** Active billing cadence — monthly (30d) or yearly (365d). */
    billingPeriod: 'monthly' | 'yearly'
    /** Monthly price of the plan. */
    price: number
    /** Yearly price of the plan (0 = not offered). */
    yearlyPrice: number
    /** Price actually charged for the active billing period. */
    billingPrice: number
    expiryDate: string | null
    /** End of the 2-day expiry warning window (status 'grace'). */
    graceEnd: string | null
  }
  limits: {
    branches: ResourceUsage
    devicesPerBranch: ResourceUsage
    users: ResourceUsage
  }
  features: {
    enabled: UsageFeature[]
    available: UsageFeature[]
  }
}

// ─── Device Types ────────────────────────────────────────────────

export interface Device {
  id: string
  restaurantId: string | null
  restaurantName: string
  branchId?: string | null
  branchName?: string | null
  userId?: string | null
  deviceName: string
  nickname?: string | null
  devicesUsingCount?: number
  os: string
  osVersion: string
  appVersion: string
  deviceId: string
  fingerprint?: string | null
  platform?: string | null
  browser?: string | null
  isElectron?: boolean
  isMobile?: boolean
  electronVersion?: string | null
  lastLogin: string | null
  lastActivity?: string | null
  lastHeartbeat?: string | null
  registeredAt: string | null
  firstSeenAt?: string | null
  status: 'active' | 'inactive' | 'blocked' | 'pending' | 'rejected'
  approvalStatus?: 'approved' | 'pending' | 'rejected'
  isActive?: boolean
  isOnline?: boolean
  online?: boolean
  trustLevel?: 'trusted' | 'untrusted'
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  notes?: string | null
  activeSessions?: number
  health?: {
    status: string
    online: boolean
    offline: boolean
    inactive: boolean
    lastHeartbeat: string | null
    lastActivity: string | null
    lastLogin: string | null
    lastSync: string | null
    appVersion: string | null
    osVersion: string | null
    electronVersion: string | null
    dbSyncStatus: string
    pendingSyncCount: number
    failedSyncCount: number
    activeSessions?: number
  }
  lastSync?: string | null
  dbSyncStatus?: string
  pendingSyncCount?: number
  failedSyncCount?: number
  isDeleted?: boolean
  deletedAt?: string | null
  deletionReason?: string | null
}

export interface DeviceSession {
  id: string
  deviceId: string | null
  deviceName: string | null
  os: string | null
  appVersion: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string | null
  expiresAt: string | null
  lastActivityAt: string | null
  isActive: boolean
  isRevoked: boolean
}

export interface DeviceSessionsResponse {
  device: { id: string; deviceId: string; deviceName: string }
  data: DeviceSession[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface DeviceHealth {
  id: string
  deviceId: string
  deviceName: string
  status: string
  health: {
    status: string
    online: boolean
    offline: boolean
    inactive: boolean
    lastHeartbeat: string | null
    lastActivity: string | null
    lastLogin: string | null
    lastSync: string | null
    appVersion: string | null
    osVersion: string | null
    electronVersion: string | null
    dbSyncStatus: string
    pendingSyncCount: number
    failedSyncCount: number
    activeSessions: number
  }
  activeSessions: number
}

export interface DeviceStatistics {
  total: number
  active: number
  pending: number
  rejected: number
  blocked: number
  inactive: number
  online: number
  offline: number
  activeSessions: number
  byStatus: Array<{ status: string; count: number }>
  byPlatform: Array<{ platform: string; count: number }>
  byOs: Array<{ os: string; count: number }>
  lastUpdated: string
}

// ─── Analytics Types ─────────────────────────────────────────────

export interface DashboardStats {
  totalRestaurants: number
  activeRestaurants: number
  inactiveRestaurants: number
  totalOwners: number
  activeDevices: number
  subscriptionsExpiring: number
  todayLogins: number
  aiRequests: number
  subscriptionCounts: {
    total: number
    active: number
    paused: number
    expired: number
    trial: number
  }
}

export interface ChartDataPoint {
  name: string
  value: number
}

export interface AnalyticsData {
  restaurantGrowth: ChartDataPoint[]
  dailyLogins: ChartDataPoint[]
  subscriptions: ChartDataPoint[]
  aiUsage: ChartDataPoint[]
  aiUsageByFeature: ChartDataPoint[]
  mostActiveRestaurants: ChartDataPoint[]
}

// ─── Audit Log Types ────────────────────────────────────────────

export interface AuditLogEntry {
  id: string
  action: string
  category: string | null
  module: string | null
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  result: 'success' | 'failure' | 'pending' | null
  success: boolean | null
  entityType: string
  entityId: string | null
  entityLabel: string | null
  performedBy: string
  performedById: string | null
  role: string | null
  restaurantId: string | null
  restaurantName: string | null
  branchId: string | null
  branchName: string | null
  ipAddress: string | null
  deviceId: string | null
  deviceName: string | null
  browser: string | null
  platform: string | null
  os: string | null
  sessionId: string | null
  requestId: string | null
  correlationId: string | null
  route: string | null
  method: string | null
  responseStatus: number | null
  durationMs: number | null
  executionTimeMs: number | null
  error: string | null
  stackTrace: string | null
  oldValues: Record<string, any> | null
  newValues: Record<string, any> | null
  changedFields: string[] | null
  reason: string | null
  comments: string | null
  location: string | null
  details: Record<string, any> | null
  metadata: Record<string, any> | null
  chainIndex: number | null
  prevHash: string | null
  hash: string | null
  createdAt: string
}

export interface AuditLogStats {
  totals: { total: number; today: number; thisWeek: number; last30d: number }
  health: {
    failureCount: number
    securityCount: number
    criticalToday: number
    failedLogins: number
    permissionChanges: number
    aiCount: number
    deviceCount: number
    exportCount: number
    settingsCount: number
  }
  buckets: {
    severity: { severity: string; count: number }[]
    module: { module: string; count: number }[]
    category: { category: string; count: number }[]
  }
  top: {
    actors: { performer: string; count: number }[]
    errors: { action: string; result: string; count: number }[]
  }
  heatmap: { date: string; count: number }[]
  liveFeed: Array<{
    id: string
    action: string
    module: string | null
    category: string | null
    severity: string | null
    result: string | null
    performedBy: string
    entityType: string
    entityLabel: string | null
    restaurantId: string | null
    createdAt: string
  }>
}

export interface AuditIntegrityReport {
  verified: boolean
  message: string
  totalRows: number
  chainedRows: number
  verifiedRows: number
  metaSeq: number
  expectedLastHash: string | null
  storedLastHash: string | null
  brokenAt: {
    chainIndex: number
    source: 'active' | 'archive'
    id: string
    createdAt: string
    storedHash: string
    storedPrev: string
    expectedHash: string
    ok: boolean
  } | null
  missing: number[]
  tampered: string[]
}

export type AuditExportStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface AuditExportJob {
  id: string
  format: 'csv' | 'json' | 'xlsx' | 'pdf'
  filters: Record<string, any>
  status: AuditExportStatus
  rowCount: number
  fileSizeBytes: number | null
  signature: string | null
  encrypted: boolean
  fileName: string | null
  error: string | null
  requestedBy: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface AuditAlert {
  id: string
  type: string
  message: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string | null
  module: string | null
  restaurantId: string | null
  entityType: string | null
  entityId: string | null
  metadata: Record<string, any> | null
  resolved: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface AuditSavedSearch {
  id: string
  name: string
  filters: Record<string, any>
  isGlobal: boolean
  createdBy: string
  createdById: string | null
  createdAt: string
}

export interface AuditLegalHold {
  id: string
  module: string | null
  entityType: string | null
  entityId: string | null
  caseRef: string
  reason: string
  createdBy: string
  createdById: string | null
  expiresAt: string | null
  active: boolean
  createdAt: string
}

export interface AuditRetentionRules {
  defaultDays: number
  rules: { module: string; days: number }[]
}

// ─── Common Types ────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  message: string
  status: number
  errors?: Record<string, string[]>
}

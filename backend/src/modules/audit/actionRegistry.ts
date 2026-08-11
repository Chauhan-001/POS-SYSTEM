/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * actionRegistry.ts — Single source of truth for standardized audit actions.
 *
 * Every audit event uses one canonical `action` string. This registry drives:
 *  - module / category / severity auto-derivation
 *  - readable labels for the UI
 *  - the "security" classification used by the dashboard + alerting
 *
 * Convention: <module>.<verb>[.<object>]
 *   e.g. restaurant.created, inventory.stock.in, login.failed, bill.voided
 */

export type AuditCategory =
  | 'security'
  | 'authentication'
  | 'configuration'
  | 'billing'
  | 'inventory'
  | 'ai'
  | 'support'
  | 'customer'
  | 'business'
  | 'system'
  | 'compliance'
  | 'data';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ActionMeta {
  module: string;
  category: AuditCategory;
  severity: AuditSeverity;
  label: string;
}

const REG: Record<string, ActionMeta> = {
  // ── Authentication / sessions ───────────────────────────────────
  'login.success': { module: 'auth', category: 'authentication', severity: 'info', label: 'Login success' },
  'login.failed': { module: 'auth', category: 'authentication', severity: 'medium', label: 'Login failed' },
  'logout': { module: 'auth', category: 'authentication', severity: 'info', label: 'Logout' },
  'session.revoked': { module: 'auth', category: 'security', severity: 'high', label: 'Session revoked' },
  'session.revoked_all': { module: 'auth', category: 'security', severity: 'high', label: 'All sessions revoked' },
  'token.reuse': { module: 'auth', category: 'security', severity: 'critical', label: 'Token reuse detected' },
  'otp.issued': { module: 'auth', category: 'authentication', severity: 'low', label: 'OTP issued' },
  'otp.verified': { module: 'auth', category: 'authentication', severity: 'low', label: 'OTP verified' },

  // ── Owners / users / employees ──────────────────────────────────
  'owner.created': { module: 'owner', category: 'business', severity: 'medium', label: 'Owner created' },
  'owner.updated': { module: 'owner', category: 'business', severity: 'low', label: 'Owner updated' },
  'owner.suspended': { module: 'owner', category: 'security', severity: 'high', label: 'Owner suspended' },
  'owner.activated': { module: 'owner', category: 'security', severity: 'medium', label: 'Owner activated' },
  'owner.locked': { module: 'owner', category: 'security', severity: 'high', label: 'Owner locked' },
  'owner.unlocked': { module: 'owner', category: 'security', severity: 'medium', label: 'Owner unlocked' },
  'owner.deleted': { module: 'owner', category: 'security', severity: 'critical', label: 'Owner deleted' },
  'owner.restored': { module: 'owner', category: 'security', severity: 'high', label: 'Owner restored' },
  'owner.permanently_deleted': { module: 'owner', category: 'security', severity: 'critical', label: 'Owner permanently deleted' },
  'owner.password_reset': { module: 'owner', category: 'security', severity: 'high', label: 'Owner password reset' },
  'owner.assigned_restaurant': { module: 'owner', category: 'business', severity: 'medium', label: 'Owner assigned to restaurant' },
  'owner.unassigned_restaurant': { module: 'owner', category: 'business', severity: 'medium', label: 'Owner unassigned from restaurant' },
  'owner.session_revoked': { module: 'owner', category: 'security', severity: 'high', label: 'Owner session revoked' },
  'user.invited': { module: 'user', category: 'business', severity: 'medium', label: 'User invited' },
  'user.removed': { module: 'user', category: 'security', severity: 'high', label: 'User removed' },
  'role.changed': { module: 'role', category: 'security', severity: 'high', label: 'Role changed' },
  'permission.updated': { module: 'permission', category: 'security', severity: 'critical', label: 'Permission updated' },
  'employee.created': { module: 'employee', category: 'business', severity: 'medium', label: 'Employee created' },
  'employee.updated': { module: 'employee', category: 'business', severity: 'low', label: 'Employee updated' },
  'employee.deleted': { module: 'employee', category: 'business', severity: 'high', label: 'Employee deleted' },

  // ── Restaurants / branches ──────────────────────────────────────
  'restaurant.created': { module: 'restaurant', category: 'business', severity: 'medium', label: 'Restaurant created' },
  'restaurant.updated': { module: 'restaurant', category: 'business', severity: 'low', label: 'Restaurant updated' },
  'restaurant.suspended': { module: 'restaurant', category: 'security', severity: 'high', label: 'Restaurant suspended' },
  'restaurant.activated': { module: 'restaurant', category: 'security', severity: 'medium', label: 'Restaurant activated' },
  'restaurant.deleted': { module: 'restaurant', category: 'security', severity: 'critical', label: 'Restaurant deleted' },
  'restaurant.restored': { module: 'restaurant', category: 'security', severity: 'high', label: 'Restaurant restored' },
  'restaurant.permanently_deleted': { module: 'restaurant', category: 'security', severity: 'critical', label: 'Restaurant permanently deleted' },
  'restaurant.password_reset': { module: 'restaurant', category: 'security', severity: 'high', label: 'Restaurant password reset' },
  'restaurant.credentials_regenerated': { module: 'restaurant', category: 'security', severity: 'high', label: 'Restaurant credentials regenerated' },
  'restaurant.logo_uploaded': { module: 'restaurant', category: 'business', severity: 'low', label: 'Restaurant logo uploaded' },
  'restaurant.cover_uploaded': { module: 'restaurant', category: 'business', severity: 'low', label: 'Restaurant cover uploaded' },
  'restaurant.logo_replaced': { module: 'restaurant', category: 'business', severity: 'low', label: 'Restaurant logo replaced' },
  'restaurant.logo_deleted': { module: 'restaurant', category: 'business', severity: 'low', label: 'Restaurant logo deleted' },
  'branch.created': { module: 'branch', category: 'business', severity: 'medium', label: 'Branch created' },
  'branch.updated': { module: 'branch', category: 'business', severity: 'low', label: 'Branch updated' },
  'branch.deleted': { module: 'branch', category: 'business', severity: 'high', label: 'Branch deleted' },

  // ── Catalog / products / inventory ──────────────────────────────
  'product.created': { module: 'product', category: 'business', severity: 'low', label: 'Product created' },
  'product.updated': { module: 'product', category: 'business', severity: 'low', label: 'Product updated' },
  'product.deleted': { module: 'product', category: 'business', severity: 'medium', label: 'Product deleted' },
  'category.created': { module: 'category', category: 'business', severity: 'low', label: 'Category created' },
  'category.updated': { module: 'category', category: 'business', severity: 'low', label: 'Category updated' },
  'category.deleted': { module: 'category', category: 'business', severity: 'medium', label: 'Category deleted' },
  'inventory.adjustment': { module: 'inventory', category: 'inventory', severity: 'medium', label: 'Inventory adjusted' },
  'inventory.stock.in': { module: 'inventory', category: 'inventory', severity: 'low', label: 'Stock in' },
  'inventory.stock.out': { module: 'inventory', category: 'inventory', severity: 'low', label: 'Stock out' },
  'inventory.waste': { module: 'inventory', category: 'inventory', severity: 'medium', label: 'Stock wasted' },
  'purchase.created': { module: 'purchase', category: 'inventory', severity: 'medium', label: 'Purchase created' },
  'purchase.updated': { module: 'purchase', category: 'inventory', severity: 'low', label: 'Purchase updated' },
  'purchase.deleted': { module: 'purchase', category: 'inventory', severity: 'medium', label: 'Purchase deleted' },
  'supplier.created': { module: 'supplier', category: 'business', severity: 'low', label: 'Supplier created' },
  'supplier.updated': { module: 'supplier', category: 'business', severity: 'low', label: 'Supplier updated' },
  'supplier.deleted': { module: 'supplier', category: 'business', severity: 'medium', label: 'Supplier deleted' },
  'vendor.created': { module: 'vendor', category: 'business', severity: 'low', label: 'Vendor created' },
  'vendor.updated': { module: 'vendor', category: 'business', severity: 'low', label: 'Vendor updated' },
  'vendor.deleted': { module: 'vendor', category: 'business', severity: 'medium', label: 'Vendor deleted' },
  'recipe.updated': { module: 'recipe', category: 'business', severity: 'low', label: 'Recipe updated' },
  'kitchen.updated': { module: 'kitchen', category: 'business', severity: 'low', label: 'Kitchen updated' },

  // ── Customers / loyalty / campaigns / offers ────────────────────
  'customer.created': { module: 'customer', category: 'customer', severity: 'low', label: 'Customer created' },
  'customer.updated': { module: 'customer', category: 'customer', severity: 'low', label: 'Customer updated' },
  'customer.blocked': { module: 'customer', category: 'customer', severity: 'high', label: 'Customer blocked' },
  'customer.unblocked': { module: 'customer', category: 'customer', severity: 'medium', label: 'Customer unblocked' },
  'customer.deleted': { module: 'customer', category: 'customer', severity: 'medium', label: 'Customer deleted' },
  'customer.restored': { module: 'customer', category: 'customer', severity: 'low', label: 'Customer restored' },
  'customer.merged': { module: 'customer', category: 'customer', severity: 'high', label: 'Customer merged' },
  'customer.imported': { module: 'customer', category: 'data', severity: 'medium', label: 'Customers imported' },
  'customer.exported': { module: 'customer', category: 'data', severity: 'medium', label: 'Customers exported' },
  'loyalty.settings_updated': { module: 'loyalty', category: 'configuration', severity: 'medium', label: 'Loyalty settings updated' },
  'loyalty.tier_created': { module: 'loyalty', category: 'configuration', severity: 'low', label: 'Loyalty tier created' },
  'loyalty.tier_updated': { module: 'loyalty', category: 'configuration', severity: 'low', label: 'Loyalty tier updated' },
  'loyalty.tier_deleted': { module: 'loyalty', category: 'configuration', severity: 'medium', label: 'Loyalty tier deleted' },
  'loyalty.tier_changed': { module: 'loyalty', category: 'customer', severity: 'medium', label: 'Customer tier changed' },
  'loyalty.reward_redeemed': { module: 'loyalty', category: 'customer', severity: 'low', label: 'Reward redeemed' },
  'referral.created': { module: 'referral', category: 'customer', severity: 'low', label: 'Referral created' },
  'campaign.created': { module: 'campaign', category: 'business', severity: 'medium', label: 'Campaign created' },
  'campaign.updated': { module: 'campaign', category: 'business', severity: 'low', label: 'Campaign updated' },
  'campaign.status_changed': { module: 'campaign', category: 'business', severity: 'medium', label: 'Campaign status changed' },
  'campaign.deleted': { module: 'campaign', category: 'business', severity: 'high', label: 'Campaign deleted' },
  'campaign.sent': { module: 'campaign', category: 'business', severity: 'medium', label: 'Campaign sent' },
  'offer.created': { module: 'offer', category: 'business', severity: 'medium', label: 'Offer created' },
  'offer.updated': { module: 'offer', category: 'business', severity: 'low', label: 'Offer updated' },
  'offer.deleted': { module: 'offer', category: 'business', severity: 'medium', label: 'Offer deleted' },
  'offer.status_changed': { module: 'offer', category: 'business', severity: 'medium', label: 'Offer status changed' },
  'offer.validated': { module: 'offer', category: 'business', severity: 'low', label: 'Offer validation' },
  'offer.redeemed': { module: 'offer', category: 'business', severity: 'low', label: 'Offer redeemed' },

  // ── Billing / payments ──────────────────────────────────────────
  'bill.generated': { module: 'billing', category: 'billing', severity: 'low', label: 'Bill generated' },
  'bill.voided': { module: 'billing', category: 'billing', severity: 'high', label: 'Bill voided' },
  'bill.refunded': { module: 'billing', category: 'billing', severity: 'high', label: 'Bill refunded' },
  'payment.completed': { module: 'billing', category: 'billing', severity: 'medium', label: 'Payment completed' },
  'payment.failed': { module: 'billing', category: 'billing', severity: 'medium', label: 'Payment failed' },
  'payment.verified': { module: 'billing', category: 'billing', severity: 'medium', label: 'Payment verified' },
  'invoice.generated': { module: 'billing', category: 'billing', severity: 'low', label: 'Invoice generated' },
  'cash.opening': { module: 'billing', category: 'billing', severity: 'medium', label: 'Cash opening' },
  'cash.adjustment': { module: 'billing', category: 'billing', severity: 'high', label: 'Cash adjustment' },
  'cash.shift_closed': { module: 'billing', category: 'billing', severity: 'medium', label: 'Shift closed' },

  // ── Subscriptions / plans ───────────────────────────────────────
  'subscription.created': { module: 'subscription', category: 'billing', severity: 'medium', label: 'Subscription created' },
  'subscription.updated': { module: 'subscription', category: 'billing', severity: 'medium', label: 'Subscription updated' },
  'subscription.renewed': { module: 'subscription', category: 'billing', severity: 'medium', label: 'Subscription renewed' },
  'subscription.renewed_cash': { module: 'subscription', category: 'billing', severity: 'medium', label: 'Subscription renewed (cash)' },
  'subscription.cancelled': { module: 'subscription', category: 'billing', severity: 'critical', label: 'Subscription cancelled' },
  'subscription.paused': { module: 'subscription', category: 'billing', severity: 'high', label: 'Subscription paused' },
  'subscription.resumed': { module: 'subscription', category: 'billing', severity: 'medium', label: 'Subscription resumed' },
  'subscription.plan_change': { module: 'subscription', category: 'billing', severity: 'high', label: 'Subscription plan change' },
  'plan.created': { module: 'plan', category: 'configuration', severity: 'medium', label: 'Plan created' },
  'plan.updated': { module: 'plan', category: 'configuration', severity: 'medium', label: 'Plan updated' },
  'plan.cloned': { module: 'plan', category: 'configuration', severity: 'low', label: 'Plan cloned' },
  'plan.status_changed': { module: 'plan', category: 'configuration', severity: 'high', label: 'Plan status changed' },
  'plan.rollback': { module: 'plan', category: 'configuration', severity: 'high', label: 'Plan rolled back' },

  // ── Devices ─────────────────────────────────────────────────────
  'device.registered': { module: 'device', category: 'security', severity: 'medium', label: 'Device registered' },
  'device.approved': { module: 'device', category: 'security', severity: 'medium', label: 'Device approved' },
  'device.rejected': { module: 'device', category: 'security', severity: 'medium', label: 'Device rejected' },
  'device.removed': { module: 'device', category: 'security', severity: 'high', label: 'Device removed' },
  'device.blocked': { module: 'device', category: 'security', severity: 'high', label: 'Device blocked' },
  'device.unblocked': { module: 'device', category: 'security', severity: 'medium', label: 'Device unblocked' },
  'device.force_logout': { module: 'device', category: 'security', severity: 'high', label: 'Device force logout' },
  'device.session_revoked': { module: 'device', category: 'security', severity: 'high', label: 'Device session revoked' },

  // ── Settings / printers / config ────────────────────────────────
  'settings.updated': { module: 'settings', category: 'configuration', severity: 'medium', label: 'Settings updated' },
  'settings.rollback': { module: 'settings', category: 'configuration', severity: 'high', label: 'Settings rolled back' },
  'printer.created': { module: 'printer', category: 'configuration', severity: 'low', label: 'Printer created' },
  'printer.updated': { module: 'printer', category: 'configuration', severity: 'low', label: 'Printer updated' },
  'printer.deleted': { module: 'printer', category: 'configuration', severity: 'medium', label: 'Printer deleted' },
  'printer.tested': { module: 'printer', category: 'configuration', severity: 'low', label: 'Printer tested' },

  // ── AI / Voice ──────────────────────────────────────────────────
  'ai.provider_changed': { module: 'ai', category: 'ai', severity: 'high', label: 'AI provider changed' },
  'ai.model_changed': { module: 'ai', category: 'ai', severity: 'medium', label: 'AI model changed' },
  'ai.config_updated': { module: 'ai', category: 'ai', severity: 'medium', label: 'AI configuration updated' },
  'ai.usage_limits_updated': { module: 'ai', category: 'ai', severity: 'medium', label: 'AI usage limits updated' },
  'voice.inventory.executed': { module: 'voice', category: 'ai', severity: 'low', label: 'Voice inventory executed' },

  // ── Support ─────────────────────────────────────────────────────
  'support.ticket.created': { module: 'support', category: 'support', severity: 'medium', label: 'Ticket created' },
  'support.ticket.updated': { module: 'support', category: 'support', severity: 'low', label: 'Ticket updated' },
  'support.ticket.status_changed': { module: 'support', category: 'support', severity: 'medium', label: 'Ticket status changed' },
  'support.ticket.assigned': { module: 'support', category: 'support', severity: 'medium', label: 'Ticket assigned' },
  'support.ticket.replied': { module: 'support', category: 'support', severity: 'low', label: 'Ticket replied' },
  'support.ticket.attachment_added': { module: 'support', category: 'support', severity: 'low', label: 'Attachment added' },
  'support.ticket.attachment_removed': { module: 'support', category: 'support', severity: 'low', label: 'Attachment removed' },
  'support.ticket.deleted': { module: 'support', category: 'support', severity: 'high', label: 'Ticket deleted' },
  'support.ticket.restored': { module: 'support', category: 'support', severity: 'medium', label: 'Ticket restored' },
  'support.satisfaction_recorded': { module: 'support', category: 'support', severity: 'low', label: 'Satisfaction recorded' },

  // ── Online ordering: availability + order adjustments + refunds ───
  'availability.updated': { module: 'availability', category: 'configuration', severity: 'medium', label: 'Online availability updated' },
  'order.adjusted': { module: 'order', category: 'business', severity: 'high', label: 'Order adjusted' },
  'order.cancelled': { module: 'order', category: 'business', severity: 'high', label: 'Order cancelled' },
  'refund.created': { module: 'refund', category: 'billing', severity: 'medium', label: 'Refund created' },
  'refund.completed': { module: 'refund', category: 'billing', severity: 'medium', label: 'Refund completed' },
  'refund.failed': { module: 'refund', category: 'billing', severity: 'high', label: 'Refund failed' },

  // ── Reports / analytics / data ──────────────────────────────────
  'report.exported': { module: 'report', category: 'data', severity: 'medium', label: 'Report exported' },
  'analytics.exported': { module: 'analytics', category: 'data', severity: 'medium', label: 'Analytics exported' },
  'audit.exported': { module: 'audit', category: 'data', severity: 'medium', label: 'Audit log exported' },
  'audit.verified': { module: 'audit', category: 'system', severity: 'info', label: 'Audit integrity verified' },
  'audit.tamper_detected': { module: 'audit', category: 'security', severity: 'critical', label: 'Audit tamper detected' },
  'database.import': { module: 'database', category: 'data', severity: 'high', label: 'Database import' },
  'database.export': { module: 'database', category: 'data', severity: 'high', label: 'Database export' },
  'database.backup': { module: 'database', category: 'data', severity: 'medium', label: 'Database backup' },
  'database.restore': { module: 'database', category: 'security', severity: 'critical', label: 'Database restore' },
  'database.maintenance': { module: 'database', category: 'system', severity: 'medium', label: 'Database maintenance' },
  'retention.cleanup': { module: 'audit', category: 'system', severity: 'low', label: 'Retention cleanup ran' },
  'retention.archived': { module: 'audit', category: 'system', severity: 'low', label: 'Audit logs archived' },
  'retention.legal_hold': { module: 'audit', category: 'compliance', severity: 'high', label: 'Legal hold applied' },
  'apikey.created': { module: 'apikey', category: 'security', severity: 'high', label: 'API key created' },
  'apikey.revoked': { module: 'apikey', category: 'security', severity: 'critical', label: 'API key revoked' },

  // ── Reservations / tables ───────────────────────────────────────
  'reservation.created': { module: 'reservation', category: 'business', severity: 'low', label: 'Reservation created' },
  'reservation.updated': { module: 'reservation', category: 'business', severity: 'low', label: 'Reservation updated' },
  'reservation.cancelled': { module: 'reservation', category: 'business', severity: 'medium', label: 'Reservation cancelled' },
  'reservation.seated': { module: 'reservation', category: 'business', severity: 'low', label: 'Reservation seated' },
  'table.created': { module: 'table', category: 'business', severity: 'low', label: 'Table created' },
  'table.updated': { module: 'table', category: 'business', severity: 'low', label: 'Table updated' },
  'table.deleted': { module: 'table', category: 'business', severity: 'medium', label: 'Table deleted' },
  'table.state_changed': { module: 'table', category: 'business', severity: 'low', label: 'Table state changed' },
  'floor.created': { module: 'table', category: 'business', severity: 'low', label: 'Floor created' },
  'floor.updated': { module: 'table', category: 'business', severity: 'low', label: 'Floor updated' },
  'floor.deleted': { module: 'table', category: 'business', severity: 'medium', label: 'Floor deleted' },

  // ── Expenses / finance ──────────────────────────────────────────
  'expense.created': { module: 'expense', category: 'business', severity: 'low', label: 'Expense created' },
  'expense.updated': { module: 'expense', category: 'business', severity: 'low', label: 'Expense updated' },
  'expense.deleted': { module: 'expense', category: 'business', severity: 'medium', label: 'Expense deleted' },
  'expense.restored': { module: 'expense', category: 'business', severity: 'low', label: 'Expense restored' },
  'expense_category.created': { module: 'expense', category: 'configuration', severity: 'low', label: 'Expense category created' },
  'expense_category.updated': { module: 'expense', category: 'configuration', severity: 'low', label: 'Expense category updated' },
  'expense_category.deleted': { module: 'expense', category: 'configuration', severity: 'medium', label: 'Expense category deleted' },
  'expense.recurring_created': { module: 'expense', category: 'business', severity: 'low', label: 'Recurring expense created' },
  'expense.recurring_updated': { module: 'expense', category: 'business', severity: 'low', label: 'Recurring expense updated' },
  'expense.recurring_paused': { module: 'expense', category: 'business', severity: 'medium', label: 'Recurring expense paused' },
  'expense.recurring_resumed': { module: 'expense', category: 'business', severity: 'low', label: 'Recurring expense resumed' },
  'expense.recurring_deleted': { module: 'expense', category: 'business', severity: 'medium', label: 'Recurring expense deleted' },
};

const LEGACY_TO_CANONICAL: Record<string, string> = {
  // middleware-generated generic actions are left as-is (request audit layer)
  'RESTAURANT_CREATED': 'restaurant.created',
  'RESTAURANT_UPDATED': 'restaurant.updated',
  'RESTAURANT_SUSPENDED': 'restaurant.suspended',
  'RESTAURANT_ACTIVATED': 'restaurant.activated',
  'RESTAURANT_DELETED': 'restaurant.deleted',
  'RESTAURANT_RESTORED': 'restaurant.restored',
  'RESTAURANT_PERMANENT_DELETED': 'restaurant.permanently_deleted',
  'RESTAURANT_PIN_RESET': 'restaurant.password_reset',
  'RESTAURANT_CREDENTIALS_REGENERATED': 'restaurant.credentials_regenerated',
  'RESTAURANT_LOGO_UPLOADED': 'restaurant.logo_uploaded',
  'RESTAURANT_COVER_UPLOADED': 'restaurant.cover_uploaded',
  'RESTAURANT_LOGO_REPLACED': 'restaurant.logo_replaced',
  'RESTAURANT_LOGO_DELETED': 'restaurant.logo_deleted',
  'ADMIN_OWNER_CREATE': 'owner.created',
  'ADMIN_OWNER_UPDATE': 'owner.updated',
  'ADMIN_OWNER_SUSPEND': 'owner.suspended',
  'ADMIN_OWNER_ACTIVATE': 'owner.activated',
  'ADMIN_OWNER_LOCK': 'owner.locked',
  'ADMIN_OWNER_UNLOCK': 'owner.unlocked',
  'ADMIN_OWNER_DELETE': 'owner.deleted',
  'ADMIN_OWNER_RESTORE': 'owner.restored',
  'ADMIN_OWNER_PERMANENT_DELETE': 'owner.permanently_deleted',
  'ADMIN_OWNER_RESET_PIN': 'owner.password_reset',
  'ADMIN_OWNER_ASSIGN_RESTAURANT': 'owner.assigned_restaurant',
  'ADMIN_OWNER_UNASSIGN_RESTAURANT': 'owner.unassigned_restaurant',
  'ADMIN_OWNER_SESSION_REVOKE': 'owner.session_revoked',
  'ADMIN_OWNER_SESSION_REVOKE_ALL': 'owner.session_revoked',
  'ADMIN_OWNER_DEVICE_BLOCK': 'device.blocked',
  'ADMIN_OWNER_DEVICE_UNBLOCK': 'device.unblocked',
  'ADMIN_OWNER_DEVICE_REMOVE': 'device.removed',
  'ADMIN_DEVICE_APPROVE': 'device.approved',
  'ADMIN_DEVICE_REJECT': 'device.rejected',
  'ADMIN_DEVICE_BLOCK': 'device.blocked',
  'ADMIN_DEVICE_UNBLOCK': 'device.unblocked',
  'ADMIN_DEVICE_REMOVE': 'device.removed',
  'ADMIN_DEVICE_SESSION_REVOKE': 'device.session_revoked',
  'ADMIN_PLAN_CREATE': 'plan.created',
  'ADMIN_PLAN_UPDATE': 'plan.updated',
  'ADMIN_PLAN_CLONE': 'plan.cloned',
  'ADMIN_PLAN_STATUS': 'plan.status_changed',
  'ADMIN_PLAN_ROLLBACK': 'plan.rollback',
  'SESSION_REVOKE': 'session.revoked',
  'SESSION_REVOKE_ALL': 'session.revoked_all',
  'TOKEN_REUSE': 'token.reuse',
  'LOGIN': 'login.success',
  'LOGIN_FAILED': 'login.failed',
  'OWNER_REGISTER': 'owner.created',
  'BILL_CREATED': 'bill.generated',
  'BILL_VOIDED': 'bill.voided',
  'BILL_REFUNDED': 'bill.refunded',
  'CASH_OPENING': 'cash.opening',
  'CASH_ADJUSTMENT': 'cash.adjustment',
  'SHIFT_CLOSED': 'cash.shift_closed',
  'CAMPAIGN_CREATED': 'campaign.created',
  'CAMPAIGN_UPDATED': 'campaign.updated',
  'CAMPAIGN_STATUS_CHANGED': 'campaign.status_changed',
  'CAMPAIGN_DELETED': 'campaign.deleted',
  'CAMPAIGN_SENT': 'campaign.sent',
  'OFFER_CREATED': 'offer.created',
  'OFFER_UPDATED': 'offer.updated',
  'OFFER_DELETED': 'offer.deleted',
  'OFFER_STATUS_CHANGED': 'offer.status_changed',
  'OFFER_APPLIED': 'offer.redeemed',
  'COUPON_APPLIED': 'offer.redeemed',
  'CUSTOMER_CREATED': 'customer.created',
  'CUSTOMER_UPDATED': 'customer.updated',
  'CUSTOMER_BLOCKED': 'customer.blocked',
  'CUSTOMER_UNBLOCKED': 'customer.unblocked',
  'CUSTOMER_DELETED': 'customer.deleted',
  'CUSTOMER_RESTORED': 'customer.restored',
  'CUSTOMER_MERGED': 'customer.merged',
  'CUSTOMER_IMPORT': 'customer.imported',
  'CUSTOMER_EXPORT': 'customer.exported',
  'EXPENSE_CREATED': 'expense.created',
  'EXPENSE_UPDATED': 'expense.updated',
  'EXPENSE_DELETED': 'expense.deleted',
  'EXPENSE_RESTORED': 'expense.restored',
  'EXPENSE_CATEGORY_CREATED': 'expense_category.created',
  'EXPENSE_CATEGORY_UPDATED': 'expense_category.updated',
  'EXPENSE_CATEGORY_DELETED': 'expense_category.deleted',
  'LOYALTY_SETTINGS_UPDATED': 'loyalty.settings_updated',
  'LOYALTY_TIER_CREATED': 'loyalty.tier_created',
  'LOYALTY_TIER_UPDATED': 'loyalty.tier_updated',
  'LOYALTY_TIER_DELETED': 'loyalty.tier_deleted',
  'CUSTOMER_TIER_CHANGED': 'loyalty.tier_changed',
  'REWARD_REDEEMED': 'loyalty.reward_redeemed',
  'REFERRAL_CREATED': 'referral.created',
  'RECURRING_EXPENSE_CREATED': 'expense.recurring_created',
  'RECURRING_EXPENSE_UPDATED': 'expense.recurring_updated',
  'RECURRING_EXPENSE_PAUSED': 'expense.recurring_paused',
  'RECURRING_EXPENSE_RESUMED': 'expense.recurring_resumed',
  'RECURRING_EXPENSE_DELETED': 'expense.recurring_deleted',
  'RECURRING_EXPENSES_GENERATED': 'expense.recurring_created',
  'VENDOR_CREATED': 'vendor.created',
  'VENDOR_UPDATED': 'vendor.updated',
  'VENDOR_DELETED': 'vendor.deleted',
  'SUPPORT_TICKET_CREATED': 'support.ticket.created',
  'SUPPORT_TICKET_UPDATED': 'support.ticket.updated',
  'SUPPORT_TICKET_STATUS_CHANGED': 'support.ticket.status_changed',
  'SUPPORT_TICKET_ASSIGNED': 'support.ticket.assigned',
  'SUPPORT_TICKET_REPLIED': 'support.ticket.replied',
  'SUPPORT_TICKET_ATTACHMENT_ADDED': 'support.ticket.attachment_added',
  'SUPPORT_TICKET_ATTACHMENT_REMOVED': 'support.ticket.attachment_removed',
  'SUPPORT_TICKET_DELETED': 'support.ticket.deleted',
  'SUPPORT_TICKET_RESTORED': 'support.ticket.restored',
  'SUPPORT_ATTACHMENT_UPLOADED': 'support.ticket.attachment_added',
  'SETTINGS_UPDATED': 'settings.updated',
  'SETTINGS_ROLLED_BACK': 'settings.rollback',
  'PRINTER_CREATED': 'printer.created',
  'PRINTER_UPDATED': 'printer.updated',
  'PRINTER_DELETED': 'printer.deleted',
  'PRINTER_TESTED': 'printer.tested',
  'payment.verified': 'payment.verified',
  'subscription.renewed.cash': 'subscription.renewed_cash',
  'plan.scheduled_change.applied': 'subscription.plan_change',
  'INVENTORY': 'inventory.adjustment',
};

export function getActionMeta(action: string): ActionMeta | null {
  return REG[action] ?? null;
}

/** Resolve the canonical action for any legacy or generic action string. */
export function canonicalizeAction(action: string): string {
  if (REG[action]) return action;
  if (LEGACY_TO_CANONICAL[action]) return LEGACY_TO_CANONICAL[action];
  return action;
}

export function moduleFor(action: string, entityType?: string): string {
  const meta = getActionMeta(action);
  if (meta) return meta.module;
  const base = (entityType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return base || 'system';
}

export function categoryFor(action: string): AuditCategory {
  return getActionMeta(action)?.category ?? 'business';
}

export function severityFor(action: string, severity?: AuditSeverity): AuditSeverity {
  if (severity) return severity;
  return getActionMeta(action)?.severity ?? 'info';
}

export function labelFor(action: string): string {
  return getActionMeta(action)?.label ?? action.replace(/\./g, ' ');
}

export function isSecurityAction(action: string): boolean {
  return categoryFor(action) === 'security';
}

export function isCritical(action: string, severity?: AuditSeverity): boolean {
  return severityFor(action, severity) === 'critical';
}

export function allActions(): string[] {
  return Object.keys(REG);
}

export function allModules(): string[] {
  return [...new Set(Object.values(REG).map((m) => m.module))].sort();
}

export function allCategories(): AuditCategory[] {
  return [...new Set(Object.values(REG).map((m) => m.category))].sort() as AuditCategory[];
}
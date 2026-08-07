/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Sanitizer — Strips sensitive/irrelevant fields from business data
 * before sending to the LLM. This is the security boundary between
 * the database and the AI provider.
 *
 * The sanitizer ensures:
 *   - No MongoDB _id/ObjectId leaks
 *   - No employee PII (PINs, passwords)
 *   - No customer contact details
 *   - No financial secrets
 *   - No internal metadata (isDeleted, createdAt, updatedAt)
 *   - Only the minimum fields needed for the AI task
 */

import type {
  SanitizedInventoryItem,
  SanitizedWasteEntry,
  SanitizedSalesData,
  SanitizedEmployeeInfo,
} from './types';

// ─── INVENTORY ITEMS ───────────────────────────────────────────────

export function sanitizeInventoryItems(raw: any[]): SanitizedInventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => ({
    name: String(item.name || 'Unknown'),
    category: String(item.category || 'General'),
    currentStock: safeNumber(item.currentStock),
    minStock: safeNumber(item.minStock),
    maxStock: safeNumber(item.maxStock),
    unit: String(item.unit || 'pcs'),
    averageCost: safeNumber(item.averageCost),
    status: validateStatus(item.status),
    expiryDate: item.expiryDate ? String(item.expiryDate).slice(0, 10) : undefined,
  }));
}

// ─── WASTE ENTRIES ─────────────────────────────────────────────────

export function sanitizeWasteEntries(raw: any[]): SanitizedWasteEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => ({
    item: String(entry.item || 'Unknown'),
    quantity: safeNumber(entry.quantity),
    unit: String(entry.unit || 'pcs'),
    reason: String(entry.reason || 'other'),
    cost: safeNumber(entry.cost),
    date: entry.date ? String(entry.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
  }));
}

// ─── SALES DATA ────────────────────────────────────────────────────

export function sanitizeSalesData(raw: any): SanitizedSalesData {
  return {
    totalRevenue: safeNumber(raw.totalRevenue),
    orderCount: safeNumber(raw.orderCount),
    itemCount: safeNumber(raw.itemCount),
    totalDiscount: safeNumber(raw.totalDiscount),
    totalGst: safeNumber(raw.totalGst),
    averageOrderValue: safeNumber(raw.averageOrderValue),
    topItems: (raw.topItems || []).map((item: any) => ({
      name: String(item.name || 'Unknown'),
      qty: safeNumber(item.qty),
      revenue: safeNumber(item.revenue),
    })),
    paymentMethods: (raw.paymentMethods || []).map((pm: any) => ({
      method: String(pm.method || 'Unknown'),
      amount: safeNumber(pm.amount),
      count: safeNumber(pm.count),
    })),
    categoryBreakdown: (raw.categoryBreakdown || []).map((cat: any) => ({
      category: String(cat.category || 'Unknown'),
      qty: safeNumber(cat.qty),
      revenue: safeNumber(cat.revenue),
    })),
    date: raw.date ? String(raw.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

// ─── EMPLOYEE INFO (minimal) ───────────────────────────────────────

export function sanitizeEmployee(raw: any): SanitizedEmployeeInfo {
  return {
    name: String(raw.name || 'Staff'),
    role: String(raw.role || 'Cashier'),
    branchId: raw.branchId ? String(raw.branchId) : undefined,
  };
}

// ─── HELPERS ───────────────────────────────────────────────────────

function safeNumber(val: any): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function validateStatus(status: any): SanitizedInventoryItem['status'] {
  const valid = ['healthy', 'normal', 'low', 'critical'];
  return valid.includes(status) ? status : 'normal';
}

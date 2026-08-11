/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SettingsService — Centralized, tenant-scoped POS configuration engine (Phase 1.9).
 *
 * Responsibilities:
 *  - Effective-settings resolution with priority: device → branch → restaurant.
 *  - PATCH with optimistic concurrency (baseVersion → 409 on conflict).
 *  - Version history + rollback to any prior version.
 *  - Audit logging (old/new values, actor, device, reason) via AuditLog.
 *
 * Backward compatibility: an empty restaurant-scope document is created on
 * first read, so existing localStorage-only installations migrate seamlessly
 * (the POS pushes its local snapshot on first save).
 */

import mongoose from 'mongoose';
import { AppError } from '../../../utils/AppError';
import RestaurantSettings, { SettingsScope } from '../models/RestaurantSettings';
import { SettingsPatchInput, SettingsRollbackInput, EffectiveSettingsResult } from '../types';
import { deepMerge } from '../utils/deepMerge';
import AuditLog from '../../../models/AuditLog';
import { ensurePublicToken } from '../../../utils/publicToken';

/**
 * The branchId column is an ObjectId, but older clients / demo data can send
 * non-ObjectId strings (e.g. "branch_main"). Guard every cast so a bad id
 * simply falls through to the restaurant scope instead of throwing a
 * CastError that becomes an unhandled rejection.
 */
function toOptionalObjectId(value: unknown): mongoose.Types.ObjectId | null {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) return new mongoose.Types.ObjectId(value);
  return null;
}

const HISTORY_LIMIT = 50;

export interface SettingsActor {
  performedBy: string;
  performedById?: string;
  restaurantId: string;
  branchId?: string;
  deviceId?: string;
  ipAddress?: string;
}

function scopeKey(scope: SettingsScope, branchId?: string, deviceId?: string): string {
  if (scope === 'branch') return `branch:${branchId || ''}`;
  if (scope === 'device') return `device:${deviceId || ''}`;
  return 'restaurant';
}

function findScopeDoc(restaurantId: string, scope: SettingsScope, branchId?: string, deviceId?: string) {
  const filter: Record<string, any> = { restaurantId, scope };
  if (scope === 'branch') filter.branchId = toOptionalObjectId(branchId);
  if (scope === 'device') filter.deviceId = deviceId || null;
  return RestaurantSettings.findOne(filter).exec();
}

async function ensureRestaurantDoc(restaurantId: string, actor?: SettingsActor) {
  const existing = await findScopeDoc(restaurantId, 'restaurant');
  if (existing) return existing;
  // Upsert to stay safe against concurrent first-create races (E11000).
  const doc = await RestaurantSettings.findOneAndUpdate(
    { restaurantId, scope: 'restaurant' },
    {
      $setOnInsert: {
        restaurantId,
        scope: 'restaurant',
        settingsVersion: 1,
        settings: {},
        history: [],
        updatedBy: actor?.performedBy || 'system',
      },
    },
    { upsert: true, new: true }
  ).exec();
  return doc;
}

async function writeAudit(actor: SettingsActor, action: string, entityId: string, details: Record<string, any>) {
  await AuditLog.create({
    action,
    entityType: 'RestaurantSettings',
    entityId,
    performedBy: actor.performedBy,
    performedById: actor.performedById,
    restaurantId: actor.restaurantId,
    branchId: actor.branchId as any || null,
    ipAddress: actor.ipAddress,
    details,
  }).catch(() => { /* audit failure must never break settings writes */ });
}

/** Shallow-compare two objects and return only changed keys (for audit diff). */
function changedKeys(prev: Record<string, any>, next: Record<string, any>): string[] {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(prev?.[k]) !== JSON.stringify(next?.[k])) changed.push(k);
  }
  return changed;
}

export class SettingsService {
  /**
   * Resolve effective settings with priority device → branch → restaurant.
   * Missing scopes fall through to the next level; empty restaurant scope
   * is auto-created so the chain always has a leaf.
   */
  async getEffective(restaurantId: string, branchId?: string, deviceId?: string): Promise<EffectiveSettingsResult> {
    await ensureRestaurantDoc(restaurantId);

    const restaurantDoc = await findScopeDoc(restaurantId, 'restaurant');
    const branchDoc = branchId ? await findScopeDoc(restaurantId, 'branch', branchId) : null;
    const deviceDoc = deviceId ? await findScopeDoc(restaurantId, 'device', branchId, deviceId) : null;

    let merged: Record<string, any> = { ...(restaurantDoc?.settings || {}) };
    if (branchDoc?.settings) merged = deepMerge(merged, branchDoc.settings as Record<string, any>);
    if (deviceDoc?.settings) merged = deepMerge(merged, deviceDoc.settings as Record<string, any>);

    // Meta: report the highest-priority scope that actually exists (or restaurant
    // fallback) for display, PLUS the per-scope versions so the client can send
    // the correct baseVersion for whichever scope it edits.
    const meta = deviceDoc || branchDoc || restaurantDoc;

    // Public store token: generated lazily the first time a device asks for
    // settings, so pre-existing tenants get one retroactively without a migration.
    // Exposed OUTSIDE the settings blob — it is derived identity, not a value the
    // operator edits, and it must not leak into the settings history/merge.
    let publicToken = '';
    try {
      publicToken = await ensurePublicToken(restaurantId);
    } catch { /* public token is best-effort; never fail the settings read */ }

    return {
      settings: merged,
      publicToken,
      meta: {
        version: meta?.settingsVersion || 1,
        scope: deviceDoc ? 'device' : branchDoc ? 'branch' : 'restaurant',
        branchId: branchDoc?.branchId ? String(branchDoc.branchId) : deviceDoc?.branchId ? String(deviceDoc.branchId) : null,
        deviceId: deviceDoc?.deviceId || null,
        updatedAt: meta?.updatedAt || null,
        updatedBy: meta?.updatedBy || null,
      },
      versions: {
        restaurant: restaurantDoc?.settingsVersion ?? 0,
        branch: branchDoc?.settingsVersion ?? 0,
        device: deviceDoc?.settingsVersion ?? 0,
      },
    };
  }

  /**
   * PATCH settings for a scope with optimistic concurrency.
   * When baseVersion is supplied, the write is executed as ONE conditional
   * atomic update (filter includes settingsVersion: baseVersion) so two
   * concurrent PATCHes can never both pass the check — the loser returns null
   * and surfaces a 409. On success the version increments and history appends.
   */
  async patch(input: SettingsPatchInput, actor: SettingsActor) {
    const { scope, branchId, deviceId, settings, baseVersion, changeReason } = input;
    if (!settings || typeof settings !== 'object') {
      throw new AppError(400, 'settings must be an object');
    }

    await ensureRestaurantDoc(actor.restaurantId, actor);

    const scopeFilter: Record<string, any> = { restaurantId: actor.restaurantId, scope };
    if (scope === 'branch') scopeFilter.branchId = toOptionalObjectId(branchId);
    if (scope === 'device') scopeFilter.deviceId = deviceId || null;

    const existing = await RestaurantSettings.findOne(scopeFilter).exec();

    // Optimistic concurrency: the filter carries the expected version so the
    // update itself is atomic — no read-then-write TOCTOU window.
    const updateFilter: Record<string, any> = { ...scopeFilter };
    if (baseVersion !== undefined) updateFilter.settingsVersion = baseVersion;

    let doc;
    if (existing) {
      const history = [
        ...existing.history,
        {
          version: existing.settingsVersion,
          settings: existing.settings,
          changeReason: existing.changeReason,
          updatedBy: existing.updatedBy,
          updatedAt: existing.updatedAt || new Date(),
        },
      ].slice(-HISTORY_LIMIT);

      doc = await RestaurantSettings.findOneAndUpdate(
        updateFilter,
        {
          $set: {
            settings,
            changeReason: changeReason || '',
            updatedBy: actor.performedBy,
            history,
          },
          $inc: { settingsVersion: 1 },
        },
        { new: true }
      ).exec();

      if (!doc && baseVersion !== undefined) {
        const fresh = await RestaurantSettings.findOne(scopeFilter).exec();
        throw new AppError(
          409,
          `Settings were changed by another device (server version ${fresh?.settingsVersion ?? '?'}, yours ${baseVersion}). Refresh to see the latest configuration.`
        );
      }
    } else {
      doc = await RestaurantSettings.create({
        restaurantId: actor.restaurantId,
        scope,
        branchId: scope === 'branch' ? toOptionalObjectId(branchId) : null,
        deviceId: scope === 'device' ? deviceId : null,
        settingsVersion: 1,
        settings,
        changeReason: changeReason || '',
        updatedBy: actor.performedBy,
        history: [],
      });
    }

    const changed = changedKeys(existing?.settings || {}, settings);
    await writeAudit(
      actor,
      'SETTINGS_UPDATED',
      String((doc as any)._id),
      {
        scope: scopeKey(scope, branchId, deviceId),
        version: (doc as any).settingsVersion,
        changedKeys: changed,
        changeReason: changeReason || '',
        previousVersion: existing?.settingsVersion || null,
      }
    );

    return { settings: (doc as any).settings, settingsVersion: (doc as any).settingsVersion, changedKeys: changed };
  }

  /** List version history for a scope (newest first). */
  async listHistory(restaurantId: string, scope: SettingsScope, branchId?: string, deviceId?: string) {
    const doc = await findScopeDoc(restaurantId, scope, branchId, deviceId);
    if (!doc) return { settingsVersion: 0, history: [] };
    const history = [...doc.history].reverse().map((h) => ({
      version: h.version,
      changeReason: h.changeReason || '',
      updatedBy: h.updatedBy || '',
      updatedAt: h.updatedAt,
    }));
    return { settingsVersion: doc.settingsVersion, history };
  }

  /**
   * Roll back a scope to a prior version. The restored snapshot becomes the
   * new current settings with an incremented version (audit-safe — old
   * versions are never deleted, only superseded).
   */
  async rollback(input: SettingsRollbackInput, actor: SettingsActor) {
    const { scope, branchId, deviceId, toVersion, changeReason } = input;
    const doc = await findScopeDoc(actor.restaurantId, scope, branchId, deviceId);
    if (!doc) throw new AppError(404, 'Settings not found for this scope');
    if (toVersion < 1 || toVersion >= doc.settingsVersion) {
      throw new AppError(400, `Cannot roll back to version ${toVersion} (current: ${doc.settingsVersion})`);
    }

    const entry = doc.history.find((h) => h.version === toVersion);
    if (!entry) throw new AppError(404, `Version ${toVersion} not found in history`);

    const nextVersion = doc.settingsVersion + 1;
    // Atomic: only roll back if the doc is still at the version we read, so a
    // concurrent write can't be clobbered by a stale rollback.
    const updated = await RestaurantSettings.findOneAndUpdate(
      { _id: doc._id, settingsVersion: doc.settingsVersion },
      {
        $set: {
          settings: entry.settings,
          settingsVersion: nextVersion,
          changeReason: changeReason || `Rolled back to version ${toVersion}`,
          updatedBy: actor.performedBy,
          history: [...doc.history, {
            version: doc.settingsVersion,
            settings: doc.settings,
            changeReason: doc.changeReason,
            updatedBy: doc.updatedBy,
            updatedAt: doc.updatedAt || new Date(),
          }].slice(-HISTORY_LIMIT),
        },
      },
      { new: true }
    ).exec();
    if (!updated) throw new AppError(409, 'Settings changed concurrently — refresh and retry the rollback.');

    await writeAudit(
      actor,
      'SETTINGS_ROLLED_BACK',
      String(doc._id),
      {
        scope: scopeKey(scope, branchId, deviceId),
        fromVersion: doc.settingsVersion,
        toVersion,
        restoredVersion: nextVersion,
        changeReason: changeReason || '',
      }
    );

    return { settings: (updated as any).settings, settingsVersion: (updated as any).settingsVersion };
  }

  /** List tenant-scoped settings audit entries (newest first). */
  async listAudit(restaurantId: string, page = 1, limit = 50) {
    // Match every writer that records settings changes: the settings module
    // itself (writeAudit → 'RestaurantSettings'), the request logger (path-
    // derived 'settings'), and any legacy lowercase rows ('restaurantsettings').
    // A single case-sensitive equality on 'RestaurantSettings' silently misses
    // most real entries, so the Audit Trail panel renders empty.
    const filter: Record<string, any> = {
      restaurantId,
      $or: [
        { entityType: 'RestaurantSettings' },
        { entityType: 'restaurantsettings' },
        { entityType: 'settings' },
        { action: { $regex: /^SETTINGS_/ } },
      ],
    };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      AuditLog.countDocuments(filter).exec(),
    ]);
    return {
      data: data.map((l) => ({
        id: String(l._id),
        action: l.action,
        entityId: l.entityId,
        performedBy: l.performedBy,
        details: l.details || {},
        ipAddress: l.ipAddress || null,
        createdAt: l.createdAt,
      })),
      total,
      page,
      limit,
    };
  }
}

export const settingsService = new SettingsService();

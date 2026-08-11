/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useServerSettings — backend-first settings sync (Phase 1.9).
 *
 * The backend (RestaurantSettings) is the source of truth for POS settings.
 * This hook:
 *  - Loads the effective settings (device → branch → restaurant merge) on
 *    mount and whenever the device comes back online.
 *  - Merges server values over the local snapshot ONLY for keys the server
 *    actually knows about, so first-run localStorage installs are not wiped.
 *  - Saves with optimistic concurrency (baseVersion → 409 conflict detection).
 *  - Uses the shared offline queue (syncEngine via client.writeOfflineAware),
 *    so offline saves are replayed automatically on reconnect.
 *  - Exposes sync status + conflict resolution for the Settings UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchEffectiveSettings,
  patchSettings,
  fetchSettingsHistory,
  rollbackSettings,
} from '../api/client';

export type SettingsSyncStatus = 'loading' | 'synced' | 'offline' | 'pending' | 'conflict';

export interface SettingsConflict {
  serverVersion: number;
  localVersion: number;
}

export interface ServerSettingsApi {
  syncStatus: SettingsSyncStatus;
  lastSynced: string | null;
  serverVersion: number;
  conflict: SettingsConflict | null;
  /** Save to a scope with optimistic concurrency. Returns false on conflict. */
  save: (scope: 'restaurant' | 'branch' | 'device', settings: Record<string, any>, changeReason?: string, branchId?: string, deviceId?: string) => Promise<boolean>;
  /** After a 409 conflict: pull server state (server wins) or force push (local wins). */
  resolveConflict: (winner: 'server' | 'local') => Promise<void>;
  /** Re-fetch effective settings and merge server-known keys. */
  refresh: () => Promise<void>;
  /** Version history for a scope (for the History tab). */
  history: (scope?: 'restaurant' | 'branch' | 'device', branchId?: string, deviceId?: string) => Promise<any>;
  rollback: (toVersion: number, changeReason?: string) => Promise<boolean>;
  /** True once we've successfully talked to the backend at least once. */
  hasServerData: boolean;
  /** Public store token (loyalty QR). null until the server provides one. */
  publicToken: string | null;
}

interface Options {
  settings: Record<string, any>;
  setSettings: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  branchId?: string | null;
  deviceId?: string | null;
  enabled?: boolean;
}

const DEVICE_ID_KEY = 'pos_device_id';

export function getDeviceId(): string {
  let id = '';
  try { id = localStorage.getItem(DEVICE_ID_KEY) || ''; } catch { /* ignore */ }
  if (!id) {
    id = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* ignore */ }
  }
  return id;
}

/** Merge server values over local, only for keys the server knows about. */
function mergeServerOverLocal(local: Record<string, any>, server: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...local };
  for (const key of Object.keys(server)) {
    const sv = server[key];
    if (sv === undefined || sv === null) continue;
    const lv = out[key];
    if (lv && typeof lv === 'object' && !Array.isArray(lv) && typeof sv === 'object' && !Array.isArray(sv)) {
      out[key] = { ...lv, ...sv };
    } else {
      out[key] = sv;
    }
  }
  return out;
}

export function useServerSettings(opts: Options): ServerSettingsApi {
  const { settings, setSettings, branchId, deviceId, enabled = true } = opts;
  const [syncStatus, setSyncStatus] = useState<SettingsSyncStatus>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState(0);
  const [conflict, setConflict] = useState<SettingsConflict | null>(null);
  const [hasServerData, setHasServerData] = useState(false);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const versionRef = useRef(0);
  const scopeRef = useRef<'restaurant' | 'branch' | 'device'>('restaurant');
  /**
   * Stable handle to the caller's setSettings. Callers (e.g. SettingsManager)
   * frequently pass an inline arrow (`(updater) => ...`) whose identity changes
   * on every render. If that callback were a useCallback dep of `refresh`, the
   * refresh function would get a new identity on every render and the
   * mount/online effect below would re-run on EVERY render → an infinite
   * fetch loop that exhausts the shared /api rate limit (429) and breaks the
   * whole Settings workspace (including the Subscription tab).
   */
  const setSettingsRef = useRef(setSettings);
  useEffect(() => { setSettingsRef.current = setSettings; });
  /** Per-scope versions so the baseVersion always targets the edited scope. */
  const versionsRef = useRef<{ restaurant: number; branch: number; device: number }>({ restaurant: 0, branch: 0, device: 0 });
  const branchIdRef = useRef<string | undefined>(branchId || undefined);
  const deviceIdRef = useRef<string | undefined>(deviceId || undefined);

  useEffect(() => { branchIdRef.current = branchId || undefined; }, [branchId]);
  useEffect(() => { deviceIdRef.current = deviceId || undefined; }, [deviceId]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const effective = await fetchEffectiveSettings(branchIdRef.current, deviceIdRef.current);
    if (!effective) {
      // No server response (offline or server down) — keep the last badge but
      // don't claim 'synced'. The online/offline listener updates the badge.
      if (navigator.onLine === false) setSyncStatus('offline');
      else setSyncStatus((prev) => (prev === 'loading' ? 'pending' : prev));
      return;
    }
    if (effective.settings && Object.keys(effective.settings).length > 0) {
      // Server has real config — merge over local for server-known keys.
      setSettingsRef.current((prev) => mergeServerOverLocal(prev, effective.settings));
      setHasServerData(true);
    }
    if (effective.publicToken) setPublicToken(effective.publicToken);
    if (effective.meta?.version) {
      versionRef.current = effective.meta.version;
      setServerVersion(effective.meta.version);
      scopeRef.current = effective.meta.scope || 'restaurant';
    }
    if (effective.versions) {
      versionsRef.current = effective.versions;
    }
    setLastSynced(new Date().toISOString());
    setSyncStatus('synced');
  }, [enabled]);

  // Initial load + reload on reconnect. Use the browser online/offline events
  // to avoid re-fetching while the device is known to be offline.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const goOnline = () => { void refresh(); };
    const goOffline = () => setSyncStatus('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [enabled, refresh]);

  const save = useCallback(async (
    scope: 'restaurant' | 'branch' | 'device',
    nextSettings: Record<string, any>,
    changeReason?: string,
    sBranchId?: string,
    sDeviceId?: string
  ): Promise<boolean> => {
    // Optimistic local update first — the UI reflects the change instantly.
    setSettings((prev) => mergeServerOverLocal(prev, nextSettings));

    // Optimistic concurrency: send the CURRENT known server version for this
    // scope as baseVersion. On offline saves the ref is bumped locally after
    // queueing so consecutive queued payloads carry ascending baseVersions
    // (matching the server's increments when replayed in order).
    const scopeVersion = versionsRef.current[scope] || versionRef.current || 0;

    const result = await patchSettings({
      scope,
      branchId: sBranchId || branchIdRef.current,
      deviceId: sDeviceId || deviceIdRef.current,
      settings: nextSettings,
      baseVersion: scopeVersion > 0 ? scopeVersion : undefined,
      changeReason: changeReason || '',
    });

    if (result.ok && result.data && result.data.settingsVersion) {
      versionsRef.current = { ...versionsRef.current, [scope]: result.data.settingsVersion };
      versionRef.current = result.data.settingsVersion;
      setServerVersion(result.data.settingsVersion);
      scopeRef.current = scope;
      setConflict(null);
      setLastSynced(new Date().toISOString());
      setSyncStatus('synced');
      setHasServerData(true);
      return true;
    }

    if (result.status === 409) {
      // Another device changed the same scope — surface a conflict.
      setConflict({
        serverVersion: versionsRef.current[scope] || versionRef.current,
        localVersion: (versionsRef.current[scope] || versionRef.current) + 1,
      });
      setSyncStatus('conflict');
      return false;
    }

    // status 0 (offline) → queued by syncEngine (will replay on reconnect).
    // Reflect the local bump so the next queued save uses the next version.
    if (scopeVersion > 0) {
      versionsRef.current = { ...versionsRef.current, [scope]: scopeVersion + 1 };
    }
    setSyncStatus(navigator.onLine === false ? 'offline' : 'pending');
    return true;
  }, [setSettings]);

  const resolveConflict = useCallback(async (winner: 'server' | 'local') => {
    if (winner === 'server') {
      await refresh();
      setConflict(null);
      return;
    }
    // Local wins → force push without a baseVersion so the server accepts it.
    const scope = scopeRef.current;
    const result = await patchSettings({
      scope,
      branchId: branchIdRef.current,
      deviceId: deviceIdRef.current,
      settings: settings,
      changeReason: 'Conflict resolved — local configuration applied',
    });
    if (result.ok && result.data && result.data.settingsVersion) {
      versionsRef.current = { ...versionsRef.current, [scope]: result.data.settingsVersion };
      versionRef.current = result.data.settingsVersion;
      setServerVersion(result.data.settingsVersion);
      setConflict(null);
      setLastSynced(new Date().toISOString());
      setSyncStatus('synced');
      setHasServerData(true);
    }
  }, [refresh, settings]);

  const history = useCallback(async (scope: 'restaurant' | 'branch' | 'device' = 'restaurant', hBranchId?: string, hDeviceId?: string) => {
    return fetchSettingsHistory(scope, hBranchId || branchIdRef.current, hDeviceId || deviceIdRef.current);
  }, []);

  const rollback = useCallback(async (toVersion: number, changeReason?: string) => {
    const result = await rollbackSettings({
      scope: scopeRef.current,
      branchId: branchIdRef.current,
      deviceId: deviceIdRef.current,
      toVersion,
      changeReason: changeReason || '',
    });
    if (result && result.settingsVersion) {
      const scope = scopeRef.current;
      versionsRef.current = { ...versionsRef.current, [scope]: result.settingsVersion };
      versionRef.current = result.settingsVersion;
      setServerVersion(result.settingsVersion);
      // Re-merge the restored snapshot over local (server is authoritative).
      if (result.settings) setSettings((prev) => mergeServerOverLocal(prev, result.settings));
      setLastSynced(new Date().toISOString());
      return true;
    }
    return false;
  }, [setSettings]);

  return {
    syncStatus,
    lastSynced,
    serverVersion,
    conflict,
    save,
    resolveConflict,
    refresh,
    history,
    rollback,
    hasServerData,
    publicToken,
  };
}

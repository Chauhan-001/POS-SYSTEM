/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useConfigCatalog — offline-capable menu catalog (Phase 3).
 *
 * Downloads ONE payload (GET /api/menu-config/catalog) containing light
 * product rows, active templates and the resolved configuration of every
 * configured product, cached durably in localStorage under `pos_config_catalog`
 * with a monotonic catalog version. When offline (sync engine says so, or the
 * fetch fails), the modal falls back to the cached catalog — configured
 * products can still be configured, priced and billed with zero network.
 *
 * The version lets the POS detect staleness after reconnect: if the server
 * version differs, the next successful fetch replaces the snapshot atomically.
 * Historical bills are never affected — they keep their own immutable
 * pricing snapshots.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolvedProductConfig } from '../types';
import { fetchMenuConfigCatalog } from '../api/client';
import { syncEngine } from '../lib/syncEngine';

export interface CatalogPayload {
  version: number;
  generatedAt: string;
  products: Array<{
    id: string;
    name: string;
    code?: string;
    category: string;
    price: number;
    gstPercent: number;
    availability: boolean;
    isCombo?: boolean;
    comboPrice?: number;
    comboComponentIds?: string[];
    image?: string;
    hasConfiguration: boolean;
  }>;
  templates: any[];
  resolved: Record<string, ResolvedProductConfig>;
}

const CATALOG_KEY = 'pos_config_catalog';

interface CachedCatalog {
  version: number;
  generatedAt: string;
  payload: CatalogPayload;
}

function loadCache(): CachedCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (!parsed?.payload?.resolved || typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(catalog: CatalogPayload): void {
  try {
    const entry: CachedCatalog = { version: catalog.version, generatedAt: catalog.generatedAt, payload: catalog };
    localStorage.setItem(CATALOG_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded — keep serving memory state; catalog re-fetches next boot.
  }
}

/** Parse the server payload into the local shape (server may be older). */
function normalize(payload: any): CatalogPayload {
  return {
    version: Number(payload?.version) || Date.now(),
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    products: Array.isArray(payload?.products) ? payload.products : [],
    templates: Array.isArray(payload?.templates) ? payload.templates : [],
    resolved: payload?.resolved && typeof payload.resolved === 'object' ? payload.resolved : {},
  };
}

/**
 * Hook exposing the catalog + product resolution. One fetch at mount (and a
 * manual refresh) while online; cached snapshot serves offline use.
 */
export function useConfigCatalog() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(() => loadCache()?.payload ?? null);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(() => loadCache()?.generatedAt ?? null);
  const fetching = useRef(false);

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const payload = await fetchMenuConfigCatalog();
      if (payload) {
        const normalized = normalize(payload);
        saveCache(normalized);
        setCatalog(normalized);
        setServerVersion(normalized.version);
        setLastFetched(normalized.generatedAt);
      }
    } catch {
      // Offline — keep the cached snapshot.
    } finally {
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-sync when the device comes back online (matches the app's sync engine).
    const unsub = syncEngine.subscribe(() => {
      if (syncEngine.getSyncState().online) refresh();
    });
    return unsub;
  }, [refresh]);

  /**
   * Resolve a product's configuration — from the local catalog when available
   * (online or offline), else null. The caller falls back to the per-product
   * resolve API when this returns null and the device is online.
   */
  const resolveFromCatalog = useCallback(
    (productId: string): ResolvedProductConfig | null => {
      return catalog?.resolved?.[productId] ?? null;
    },
    [catalog]
  );

  /** True when the local snapshot is older than what the server has. */
  const isStale = useCallback(
    (): boolean => {
      const local = loadCache();
      if (!local) return false;
      return serverVersion != null && serverVersion !== local.version;
    },
    [serverVersion]
  );

  /**
   * Drop the in-memory + persisted catalog. Called when the logged-in
   * RESTAURANT changes on this device: the previous tenant's product
   * configurations must never resolve (or render) for the new tenant. The
   * next refresh() (mount/reconnect) pulls the new restaurant's catalog.
   */
  const clear = useCallback(() => {
    setCatalog(null);
    setServerVersion(null);
    setLastFetched(null);
    try { localStorage.removeItem(CATALOG_KEY); } catch { /* ignore */ }
  }, []);

  return {
    catalog,
    serverVersion,
    lastFetched,
    refresh,
    resolveFromCatalog,
    isStale,
    clear,
  };
}

/** Non-hook accessor for non-React code (e.g. bill origin checks). */
export function getCatalogSnapshot(): CachedCatalog | null {
  return loadCache();
}

// Back-compat: data.ts style key access used by tests.
export function getDBDataCatalogVersion(): number | null {
  const c = loadCache();
  return c ? c.version : null;
}

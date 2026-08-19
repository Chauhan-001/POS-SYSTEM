/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useAsyncData — the ONE loading pattern for POS data.
 *
 * Unifies the divergent loading idioms that grew across workspaces:
 *   1. local useState + useEffect fetch (QrStudioPage, LegalComplianceTab)
 *   2. fire-and-forget .then chains that never report completion (ExpenseManager)
 *   3. key-bump effects for AI analysis (Dashboard, WasteManagement)
 *   4. bespoke refreshing flags (DashboardWorkspace, MarketingWorkspace)
 *   5. busy/loading props threaded into refresh buttons
 *   6. void "refresh" handlers that lie about when the work finished
 *
 * All of them collapse to one shape:
 *   { data, loading, error, refresh, lastUpdated, setData }
 *
 * Contract:
 *   - `refresh()` always returns a promise (boolean success) so it plugs
 *     straight into RefreshButton's promise contract.
 *   - Stale-response guard: if two refreshes overlap, only the newest may
 *     write state — an old slow response can never clobber a newer one.
 *   - Offline-safe: a fetcher returning null (or throwing) keeps the current
 *     data on screen and resolves `false`.
 *   - `onData` supports multi-collection loads that write into existing state
 *     (return a value to also store it as `data`; return void to side-effect
 *     only).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Direct data write (optimistic updates, completion flows, merges). */
  setData: Dispatch<SetStateAction<T | null>>;
  /** Force a server refetch. Resolves true on success, false on failure/empty/offline. */
  refresh: () => Promise<boolean>;
  /** Epoch ms of the last successful load — null before the first success. */
  lastUpdated: number | null;
}

export interface UseAsyncDataOptions<T> {
  initialData?: T | null;
  /** Skip the automatic load on mount; call refresh() to start. Default true. */
  autoLoad?: boolean;
  /** Apply fetched data. Default: replace `data`. Return a value to also store
   *  it as `data`, or return void to only run side effects (multi-collection). */
  onData?: (fresh: T) => T | void;
  /** Derive an error message from the failure. Default: 'Failed to load'. */
  onError?: (err: unknown) => string | null;
}

export function useAsyncData<T>(
  fetcher: () => Promise<T | null>,
  options: UseAsyncDataOptions<T> = {},
): AsyncDataState<T> {
  const { initialData = null, autoLoad = true, onData, onError } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Stable refs so `refresh` itself never changes identity — polling intervals
  // and effect deps can depend on it safely while fetcher deps still update.
  const seqRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(async (): Promise<boolean> => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      if (seq !== seqRef.current) return false; // superseded by a newer refresh
      if (fresh == null) {
        // Fetcher declined (offline / no-op guard) — keep current data.
        setLoading(false);
        return false;
      }
      const applied = onDataRef.current ? onDataRef.current(fresh) : fresh;
      if (applied !== undefined) setData(applied as T);
      setLastUpdated(Date.now());
      setLoading(false);
      return true;
    } catch (err) {
      if (seq !== seqRef.current) return false;
      const msg = onErrorRef.current ? onErrorRef.current(err) : 'Failed to load';
      if (msg) setError(msg);
      setLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [refresh, autoLoad]);

  return { data, loading, error, refresh, lastUpdated, setData };
}

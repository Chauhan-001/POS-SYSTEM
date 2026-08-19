/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useProductConfigSummary — fetches per-product configuration counts (via the
 * server-side resolver batch endpoint) for the menu-management card badges.
 * The frontend never re-implements resolution — it only displays counts.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ProductConfigSummary } from '../../src/types';
import { fetchProductConfigSummary } from '../../src/api/client';

const MONGO_ID = /^[a-fA-F0-9]{24}$/;
const CHUNK = 200; // server caps at 500 per call

export function useProductConfigSummary(products: Array<{ id: string }>, enabled = true) {
  const [summary, setSummary] = useState<Record<string, ProductConfigSummary>>({});
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);

  const idsKey = useMemo(() => products.map((p) => p.id).join('|'), [products]);

  /** Call after the config editor attaches/removes/customizes a group. */
  const refresh = () => setRevision((r) => r + 1);

  useEffect(() => {
    if (!enabled) return;
    const ids = idsKey.split('|').filter((id) => MONGO_ID.test(id));
    if (!ids.length) {
      setSummary({});
      setLoaded(true);
      return;
    }

    let cancelled = false;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

    Promise.all(chunks.map((c) => fetchProductConfigSummary(c)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, ProductConfigSummary> = {};
        for (const res of results) {
          for (const item of res ?? []) map[item.productId] = item;
        }
        setSummary(map);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [idsKey, enabled, revision]);

  return { summary, loaded, refresh };
}

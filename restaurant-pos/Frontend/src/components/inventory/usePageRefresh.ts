/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-page refresh signal. The InventoryManager header's refresh button
 * force-refreshes the shared catalog/purchases/events AND dispatches
 * `pos:page-refresh` so every page can re-fetch its own data (expiry report,
 * recipes, cost intelligence, analytics, dashboard waste/AI).
 */

import { useEffect } from 'react';

export const PAGE_REFRESH_EVENT = 'pos:page-refresh';

/** Run `handler` whenever the Inventory header's refresh button is pressed. */
export function usePageRefresh(handler: () => void) {
  useEffect(() => {
    const onRefresh = () => { handler(); };
    window.addEventListener(PAGE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PAGE_REFRESH_EVENT, onRefresh);
  }, [handler]);
}

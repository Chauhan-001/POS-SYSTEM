import { usePurchasesCtx } from './InventoryManager';
import type { Purchase } from './types';

/**
 * usePurchases — Access the shared inventory purchase history.
 *
 * The data is loaded once by InventoryManager (single source of truth) so
 * PurchaseEntry, Timeline, Analytics and Dashboard all reflect the same
 * records, and adding/removing a purchase anywhere updates every view.
 *
 * Returns:
 *   purchases — array of normalized Purchase rows, or null when the API is
 *               unreachable (offline). An empty array [] means the fetch
 *               succeeded but the restaurant has no purchases yet.
 *   synced    — true once the backend has answered (success or empty).
 */
export function usePurchases(): { purchases: Purchase[] | null; synced: boolean } {
  return usePurchasesCtx();
}

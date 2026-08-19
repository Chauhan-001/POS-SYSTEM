import type { CartItem } from '../types';

export interface KOTDeltaItem {
  id: string;
  name: string;
  variant?: string;
  /** Quantity to print in this KOT (delta) */
  printQty: number;
  /** Total quantity in current cart */
  cartQty: number;
  /** Total already printed across all KOTs */
  printedQty: number;
  notes?: string;
  price: number;
  product: CartItem['product'];
  selectedVariant?: CartItem['selectedVariant'];
  /** Phase 3/4: configured selections + human-readable summary for the kitchen. */
  configuration?: CartItem['configuration'];
  configSummary?: string;
  /** True if this item already existed and had quantity increased */
  isModified: boolean;
  /** True if this is a brand new item not in any previous KOT */
  isNew: boolean;
}

export interface KOTDeltaResult {
  /** Items to print in this KOT */
  toPrint: KOTDeltaItem[];
  /** Items unchanged (already printed, no changes) */
  unchanged: KOTDeltaItem[];
  /** Items removed from cart that were previously printed */
  removed: KOTDeltaItem[];
}

/**
 * Compute the delta between current cart items and a cumulative snapshot
 * of everything printed so far across all KOTs.
 *
 * @param currentCart - All items currently in the cart
 * @param snapshot - Cumulative items printed so far (lastKotSnapshot from Order)
 * @returns Items to print, unchanged items, and removed items
 */
export function computeKOTDelta(
  currentCart: CartItem[],
  snapshot: CartItem[] | undefined
): KOTDeltaResult {
  const printedMap = new Map<string, number>();
  if (snapshot) {
    for (const item of snapshot) {
      printedMap.set(item.id, (printedMap.get(item.id) || 0) + item.quantity);
    }
  }

  const cartMap = new Map<string, CartItem>();
  for (const item of currentCart) {
    cartMap.set(item.id, item);
  }

  const toPrint: KOTDeltaItem[] = [];
  const unchanged: KOTDeltaItem[] = [];
  const removed: KOTDeltaItem[] = [];

  // Process items in current cart
  for (const item of currentCart) {
    const printed = printedMap.get(item.id) || 0;
    const remaining = item.quantity - printed;
    const isNew = printed === 0;
    const isModified = printed > 0 && remaining > 0;

    const deltaItem: KOTDeltaItem = {
      id: item.id,
      name: item.product.name,
      variant: item.selectedVariant?.name,
      printQty: Math.max(0, remaining),
      cartQty: item.quantity,
      printedQty: printed,
      notes: item.notes,
      price: item.price,
      product: item.product,
      selectedVariant: item.selectedVariant,
      configuration: item.configuration,
      configSummary: item.configSummary,
      isNew,
      isModified,
    };

    if (remaining > 0) {
      toPrint.push(deltaItem);
    } else if (remaining <= 0 && printed > 0) {
      unchanged.push(deltaItem);
    }
  }

  // Process items in snapshot that are no longer in cart (removed)
  if (snapshot) {
    for (const item of snapshot) {
      if (!cartMap.has(item.id)) {
        removed.push({
          id: item.id,
          name: item.product.name,
          variant: item.selectedVariant?.name,
          printQty: 0,
          cartQty: 0,
          printedQty: item.quantity,
          notes: item.notes,
          price: item.price,
          product: item.product,
          selectedVariant: item.selectedVariant,
          configuration: item.configuration,
          configSummary: item.configSummary,
          isNew: false,
          isModified: false,
        });
      }
    }
  }

  return { toPrint, unchanged, removed };
}

/**
 * Merge newly printed items into the cumulative snapshot.
 * For each item printed, update the snapshot to reflect new total printed quantity.
 */
export function mergeIntoSnapshot(
  snapshot: CartItem[] | undefined,
  printedItems: CartItem[]
): CartItem[] {
  const result: CartItem[] = snapshot ? snapshot.map(i => ({ ...i })) : [];

  for (const printed of printedItems) {
    const existing = result.find(i => i.id === printed.id);
    if (existing) {
      existing.quantity += printed.quantity;
    } else {
      result.push({ ...printed });
    }
  }

  return result;
}

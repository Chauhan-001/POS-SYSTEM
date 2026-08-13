/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferProfitabilityStrip — a tiny, plain-language strip on the ORDER SCREEN
 * (CartPanel totals) that appears when a cashier applies an offer or has a
 * combo on the bill.
 *
 * It shows the deterministic backend answer to one question:
 *   "After this offer, how much do we keep, and what does it cost to make?"
 *
 * All money math is server-side (recipeCostEngine + the server-validated
 * offer discount). This component only fetches and displays. It is a display
 * aid — it never blocks a sale and auto-hides when there is nothing useful
 * to say (offline, no recipe data, or no applied offer).
 */

import { useEffect, useRef, useState } from 'react';
import { fetchBillProfitability } from '../src/api/client';

interface AppliedOfferLike {
  offer: any;
  discount: number;
}

interface Props {
  /** Cart line items (must include product.id, quantity, optional variant). */
  cartItems: any[];
  /** The server-validated offer currently applied to this bill, or null. */
  appliedOffer: AppliedOfferLike | null;
  /** Pre-discount bill subtotal, for context. */
  subtotal: number;
  currencySymbol: string;
}

const VERDICT_UI = {
  healthy: { emoji: '😊', label: 'You keep a healthy amount', cls: 'bg-green-50 border-green-300 text-green-800' },
  tight: { emoji: '😕', label: 'Margin is tight', cls: 'bg-amber-50 border-amber-300 text-amber-800' },
  negative: { emoji: '😟', label: 'This offer loses money', cls: 'bg-red-50 border-red-300 text-red-800' },
} as const;

const money = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

export default function OfferProfitabilityStrip({
  cartItems,
  appliedOffer,
  subtotal,
  currencySymbol,
}: Props) {
  const [data, setData] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the item list the backend understands (product.id + quantity).
  const itemsKey = JSON.stringify(
    cartItems.map((i: any) => ({
      id: i.product?.id || i.id,
      q: i.quantity || 1,
      v: i.selectedVariant?.name || i.variantName || '',
    }))
  );
  const offerId = appliedOffer?.offer?.id || appliedOffer?.offer?._id || '';

  useEffect(() => {
    // Nothing applied (or cart empty) → hide.
    if (!appliedOffer || cartItems.length === 0) {
      setVisible(false);
      setData(null);
      return;
    }
    const run = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    // Debounce while the cashier is still tapping (adding/removing items,
    // changing quantities) so we don't spam the backend per tap.
    timer.current = setTimeout(async () => {
      const res = await fetchBillProfitability({
        items: cartItems.map((i: any) => ({
          productId: i.product?.id || i.id,
          quantity: i.quantity || 1,
          // The real line price the bill charges (variant/base/branch) —
          // display-only revenue context; cost stays authoritative server-side.
          price: Number(i.price) || 0,
          variantName: i.selectedVariant?.name || i.variantName || undefined,
        })),
        discount: Number(appliedOffer.discount) || 0,
        subtotal: Number(subtotal) || 0,
      });
      if (run !== seq.current) return; // a newer fetch superseded us
      timer.current = null;
      if (!res || res.verdict === 'no-cost-data') {
        // Nothing costed yet — a silent strip would confuse staff, so hide.
        setVisible(false);
        setData(null);
        return;
      }
      setData(res);
      setVisible(true);
    }, 450);

    return () => {
      seq.current += 1; // invalidate any in-flight fetch after cleanup/unmount
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedOffer, itemsKey, offerId, subtotal]);

  if (!visible || !data) return null;

  const verdict = VERDICT_UI[(data.verdict as keyof typeof VERDICT_UI) || 'healthy'] || VERDICT_UI.healthy;
  const contribution = Number(data.contribution) || 0;
  const estCost = Number(data.estVariableCost) || 0;

  return (
    <div className={`mt-2 rounded-lg border px-2.5 py-2 ${verdict.cls}`} data-tour="offer-profitability">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold flex items-center gap-1.5">
          <span className="text-sm leading-none">{verdict.emoji}</span>
          {verdict.label}
        </span>
        <span className="text-[11px] font-black font-mono">
          keep {currencySymbol}{money(contribution)}
        </span>
      </div>
      <p className="text-[10px] font-semibold opacity-80 mt-1">
        After this offer · Cost to make {currencySymbol}{money(estCost)} · was {currencySymbol}{money(Number(data.subtotal) || 0)}
        {data.discount > 0 && <> · you save {currencySymbol}{money(Number(data.discount) || 0)}</>}
      </p>
    </div>
  );
}

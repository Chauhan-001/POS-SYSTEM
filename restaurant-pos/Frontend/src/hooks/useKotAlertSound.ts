/**
 * useKotAlertSound — app-level "Quick Sound Alerts" watcher.
 *
 * Plays the alert beep whenever a NEW kitchen ticket (KOT) arrives, no matter
 * which workspace is open (kitchen, home, orders, …). The first render is the
 * baseline (existing KOTs never trigger a beep on load); only an INCREASE in
 * the KOT count — i.e. a freshly sent ticket — beeps.
 *
 * Respects both the persisted Settings toggle (`enableQuickSoundAlerts`, ON
 * by default when unset) and the runtime mute flag used by the kitchen
 * display's mute button.
 */
import { useEffect, useMemo, useRef } from 'react';
import { isKotAlertEnabled, playKotAlertSound } from '../lib/alertSound';

type KotRecord = { status?: string; items?: unknown[] };
type OrderLike = { kotRecords?: KotRecord[] };

/** Count kitchen-visible KOT records across all orders (mirrors KitchenDisplay). */
function countKots(orders: OrderLike[]): number {
  let total = 0;
  for (const o of orders) {
    if (!o.kotRecords || o.kotRecords.length === 0) continue;
    for (const kot of o.kotRecords) {
      if (kot.status === 'Served') continue;
      if (!kot.items || kot.items.length === 0) continue;
      total += 1;
    }
  }
  return total;
}

export function useKotAlertSound(orders: OrderLike[], settings?: { moduleSettings?: { enableQuickSoundAlerts?: boolean } }) {
  const kotCount = useMemo(() => countKots(orders), [orders]);
  const prevCount = useRef(0);
  const soundEnabled =
    settings?.moduleSettings?.enableQuickSoundAlerts !== false;

  useEffect(() => {
    if (kotCount > prevCount.current && prevCount.current > 0 && soundEnabled && isKotAlertEnabled()) {
      playKotAlertSound();
    }
    prevCount.current = kotCount;
  }, [kotCount, soundEnabled]);
}

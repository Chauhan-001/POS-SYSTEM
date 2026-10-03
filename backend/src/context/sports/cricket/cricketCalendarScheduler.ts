/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketCalendarScheduler.ts — interval worker that keeps the Context
 * Calendar's cricket events current. Same pattern as the repo's other
 * schedulers (subscriptionScheduler, mlSyncScheduler): a guarded setInterval
 * whose handle is returned for graceful shutdown.
 *
 * Env (all optional):
 *   CRICKET_CALENDAR_SYNC_ENABLED=on      — master switch (default on when
 *                                           the cricket provider is enabled)
 *   CRICKET_CALENDAR_SYNC_INTERVAL_HOURS  — cadence (default 6h)
 *   CRICKET_CALENDAR_SYNC_RUN_ON_STARTUP=on — immediate first run (default off,
 *                                           avoids provider calls at boot)
 */

import { config } from '../../config';
import { syncCricketEventsToCalendar } from './cricketCalendarSync';

const DEFAULT_INTERVAL_HOURS = 6;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // overlap guard — a slow sync must not stack ticks

function intervalHours(): number {
  const n = parseInt(process.env.CRICKET_CALENDAR_SYNC_INTERVAL_HOURS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

export function isCricketCalendarSyncEnabled(): boolean {
  const flag = (process.env.CRICKET_CALENDAR_SYNC_ENABLED || '').trim().toLowerCase();
  if (flag === 'off' || flag === 'false') return false;
  if (flag === 'on' || flag === 'true') return true;
  // Default: follow the cricket provider switch.
  return config.cricket.enabled;
}

async function runTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await syncCricketEventsToCalendar({ daysAhead: 14 });
  } catch (err) {
    console.warn('[cricket-calendar] sync tick failed:', err instanceof Error ? err.message : String(err));
  } finally {
    running = false;
  }
}

/** Starts the interval worker. Returns a stop function (idempotent). */
export function startCricketCalendarScheduler(): () => void {
  if (timer) return () => stopCricketCalendarScheduler();
  if (!isCricketCalendarSyncEnabled()) {
    console.log('[cricket-calendar] scheduler disabled (CRICKET_CALENDAR_SYNC_ENABLED off or cricket provider disabled)');
    return () => stopCricketCalendarScheduler();
  }

  const runOnStartup = (process.env.CRICKET_CALENDAR_SYNC_RUN_ON_STARTUP || '').trim().toLowerCase() === 'on';
  const hours = intervalHours();
  timer = setInterval(() => void runTick(), hours * 3600_000);
  console.log(`[cricket-calendar] scheduler started (interval ${hours}h, runOnStartup=${runOnStartup})`);

  if (runOnStartup) void runTick();

  return () => stopCricketCalendarScheduler();
}

export function stopCricketCalendarScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const cricketCalendarScheduler = { startCricketCalendarScheduler, stopCricketCalendarScheduler };

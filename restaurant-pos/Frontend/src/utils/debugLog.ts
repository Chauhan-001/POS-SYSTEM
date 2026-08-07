/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Debug logger — silences expected offline/API-failure noise in production.
 * Use replace of raw console.warn() calls so logs are only visible during development.
 */

/** Whether the app is running in development mode — used to gate debug logging */
export const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

/**
 * Log a warning message only in development mode.
 * In production, expected network failures (offline, sync retries) are silent.
 */
export function debugWarn(context: string, ...args: unknown[]) {
  if (IS_DEV) {
    console.warn(`[${context}]`, ...args);
  }
}

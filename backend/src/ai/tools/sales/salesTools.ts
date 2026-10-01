/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * salesTools.ts — Registers the 'sales' category tools (spec §6) into the
 * shared registry. The tool definition lives next to its implementation
 * (getSalesTrendsTool.ts); this file is purely the registration entry point.
 */

import { toolRegistry } from '../registry/toolRegistry';
import { getSalesTrendsToolDefinition } from './getSalesTrendsTool';

/** Idempotent per-process: the registry rejects duplicate names. */
export function registerSalesTools(): void {
  if (!toolRegistry.has(getSalesTrendsToolDefinition.name)) {
    toolRegistry.register(getSalesTrendsToolDefinition);
  }
}

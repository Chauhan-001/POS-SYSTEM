/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * toolResolver.ts — Resolves an agent policy's allowed tool names against the
 * shared registry. The policy is the permission boundary (spec §5/§16); the
 * resolver only ever hands out tools the policy explicitly allows.
 */

import { AiError } from '../../shared/aiErrors';
import { toolRegistry } from './toolRegistry';
import type { ToolDefinition } from './toolTypes';

/**
 * Resolve allowed tool names to registry entries. Unknown names throw so a
 * misconfigured policy is caught immediately (fail fast, not silently fewer
 * tools).
 */
export function resolveAllowedTools(allowedToolNames: readonly string[]): ToolDefinition<unknown, unknown>[] {
  const resolved: ToolDefinition<unknown, unknown>[] = [];
  for (const name of allowedToolNames) {
    const tool = toolRegistry.get(name);
    if (!tool) {
      throw new AiError('TOOL_NOT_FOUND', `Policy references unregistered tool '${name}'`);
    }
    resolved.push(tool as ToolDefinition<unknown, unknown>);
  }
  return resolved;
}

/** Read-only tool descriptor list for an allow-list (prompt/catalog building). */
export function describeAllowedTools(allowedToolNames: readonly string[]) {
  return resolveAllowedTools(allowedToolNames).map((t) => ({
    name: t.name,
    description: t.meta.description,
    access: t.access,
    category: t.category,
  }));
}

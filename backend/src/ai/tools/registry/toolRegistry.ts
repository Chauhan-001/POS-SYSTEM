/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * toolRegistry.ts — THE shared tool registry for the whole AI platform
 * (spec §5). One registry; agents never register their own tools — their
 * policy only references names registered here.
 */

import { AiError } from '../../shared/aiErrors';
import type { ToolDefinition } from './toolTypes';

type AnyTool = ToolDefinition<unknown, unknown>;

class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>();

  register(input: unknown): void {
    const tool = input as AnyTool;
    if (!tool?.name || typeof tool.execute !== 'function') {
      throw new AiError('TOOL_INPUT_INVALID', 'Tool registration requires a name and execute()');
    }
    if (this.tools.has(tool.name)) {
      throw new AiError('TOOL_INPUT_INVALID', `Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** All registered tool descriptors — used to build agent tool catalogs. */
  list(): Array<Pick<AnyTool, 'name' | 'category' | 'access'> & { description: string }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      category: t.category,
      access: t.access,
      description: t.meta.description,
    }));
  }
}

export const toolRegistry = new ToolRegistry();

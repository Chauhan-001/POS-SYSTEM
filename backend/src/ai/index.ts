/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ai/index.ts — Public surface of the AI platform (spec §4).
 *
 * Consumers (routes, schedulers, tests) import from 'ai' and never from
 * internal paths, keeping module boundaries clean:
 *
 *   import { ai } from '../ai';
 *   ai.bootstrap();                       // registers all tools
 *   const result = await ai.executeTool('getSalesTrends', {}, toolCtx);
 */

import { registerAllTools } from './tools/registerAllTools';
import { toolRegistry } from './tools/registry/toolRegistry';
import { executeTool } from './tools/registry/toolExecutor';
import { resolveAllowedTools, describeAllowedTools } from './tools/registry/toolResolver';
import { tenantContextFromRequest } from './shared/tenantContext';
import { AiError, isAiError } from './shared/aiErrors';
import type { ToolContext } from './tools/registry/toolTypes';

export const ai = {
  bootstrap: registerAllTools,
  registry: toolRegistry,
  executeTool,
  resolveAllowedTools,
  describeAllowedTools,
  tenantContextFromRequest,
  AiError,
  isAiError,
};

export type { ToolContext };
export type {
  ToolDefinition,
  ToolResult,
  ToolAccess,
} from './tools/registry/toolTypes';
export type { AiTenantContext } from './shared/tenantContext';
export type { AiErrorCode } from './shared/aiErrors';

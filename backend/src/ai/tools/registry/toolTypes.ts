/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * toolTypes.ts — Contracts for the SHARED tool registry (spec §5).
 *
 * Tools are reusable capabilities backed by existing authoritative services.
 * One registry serves all agents; each agent's policy decides which tools it
 * may call. Read tools and write actions are separate concerns (spec §10).
 */

import type { z } from 'zod';
import type { AiTenantContext } from '../../shared/tenantContext';

/** What a tool does with data — drives permission guards. */
export type ToolAccess = 'read' | 'write';

/**
 * Runtime context handed to every tool execution. Tenant identity comes ONLY
 * from here (authenticated request), never from model-provided arguments.
 */
export interface ToolContext {
  tenant: AiTenantContext;
  /** Per-execution budget/limits (policy may lower them). */
  timeoutMs?: number;
  /** Correlates all calls within one agent execution for tracing. */
  executionId?: string;
}

export interface ToolDefinition<TInput, TOutput> {
  /** Stable, verb-first name, e.g. 'getSalesTrends'. */
  name: string;
  /** Category folder under ai/tools — matches the spec tool groups. */
  category:
    | 'sales'
    | 'inventory'
    | 'customers'
    | 'products'
    | 'marketing'
    | 'ml'
    | 'restaurant'
    | 'context';
  access: ToolAccess;
  meta: {
    description: string;
    /** Which authoritative service backs this tool (no duplicated logic). */
    source: string;
  };
  /** Zod schema for model/tool-call arguments — validated before execute. */
  inputSchema: z.ZodType<TInput>;
  /** Zod schema for the output — validated after execute when present. */
  outputSchema?: z.ZodType<TOutput>;
  /** Default timeout for this tool (executor/policy may lower it). */
  timeoutMs?: number;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

/** Structured, explicit failure — callers react by code, never by guessing. */
export type ToolResult<TOutput> =
  | { ok: true; data: TOutput; durationMs: number }
  | { ok: false; code: import('../../shared/aiErrors').AiErrorCode; message: string; durationMs: number };

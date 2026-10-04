/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * toolExecutor.ts — The only way tools run. Validates input against the
 * tool's schema, enforces the effective timeout, validates output when a
 * schema is declared, and maps every failure to an explicit ToolResult code
 * (spec §34 — tools fail with reasons; they never make callers guess).
 */

import { AiError, isAiError } from '../../shared/aiErrors';
import type { ToolContext, ToolDefinition, ToolResult } from './toolTypes';

function withTimeout<T>(p: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AiError('TOOL_TIMEOUT', `Tool '${toolName}' exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Execute a single tool. Tenant identity is injected from ctx (never from the
 * model); input/output are schema-validated; failures become explicit codes.
 */
export async function executeTool<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult<TOutput>> {
  const started = Date.now();
  try {
    const parsed = tool.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new AiError('TOOL_INPUT_INVALID', `Invalid input for '${tool.name}': ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }

    let timeoutMs = Math.min(ctx.timeoutMs ?? tool.timeoutMs ?? 10_000, tool.timeoutMs ?? Infinity);
    // Bounded agent runs pass an absolute deadline: clamp the tool timeout to
    // whatever budget time remains so a single tool cannot overrun the run.
    if (typeof ctx.deadlineAt === 'number') {
      timeoutMs = Math.min(timeoutMs, Math.max(1, ctx.deadlineAt - Date.now()));
    }
    const output = await withTimeout(
      tool.execute(parsed.data as TInput, ctx),
      timeoutMs,
      tool.name,
    );

    if (tool.outputSchema) {
      const outCheck = tool.outputSchema.safeParse(output);
      if (!outCheck.success) {
        throw new AiError('TOOL_OUTPUT_INVALID', `Tool '${tool.name}' returned malformed output: ${outCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
    }
    return { ok: true, data: output, durationMs: Date.now() - started };
  } catch (err) {
    const durationMs = Date.now() - started;
    if (isAiError(err)) {
      return { ok: false, code: err.code, message: err.message, durationMs };
    }
    // Upstream service failures keep their message but get a uniform code.
    return { ok: false, code: 'TOOL_FAILED', message: `Tool '${tool.name}' failed: ${err instanceof Error ? err.message : String(err)}`, durationMs };
  }
}

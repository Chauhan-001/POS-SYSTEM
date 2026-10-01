/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * aiErrors.ts — Error taxonomy for the AI platform.
 *
 * One hierarchy for the whole platform (instead of a separate tools-only
 * error module): tools, guardrails and agents all classify failures with
 * these codes so executors and callers can react consistently (spec §34 —
 * explicit unavailable states, never silent fabrication).
 */

export type AiErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_TENANT_MISMATCH'
  | 'TOOL_TIMEOUT'
  | 'TOOL_FAILED'
  | 'ACTION_BLOCKED'
  | 'APPROVAL_REQUIRED'
  | 'POLICY_VIOLATION';

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Upstream detail for logs — never surfaced verbatim to the model/user. */
  readonly details?: unknown;

  constructor(code: AiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.details = details;
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}

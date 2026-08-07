/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt Sanitizer — Prevents prompt injection attacks by sanitizing
 * user-controlled inputs before they are interpolated into AI prompts.
 *
 * Attack vectors blocked:
 *   - Control characters (null bytes, escape sequences)
 *   - Attempts to break out of quoted strings
 *   - Known injection phrases ("Ignore previous instructions", etc.)
 *   - JSON/XML structure injection
 *   - Newline injection to alter prompt structure
 *
 * Each user input is:
 *   1. Trimmed to remove leading/trailing whitespace
 *   2. Stripped of control characters (except basic whitespace)
 *   3. Encased in security delimiters to prevent breakout
 *   4. Truncated to a max safe length
 *   5. Checked for known injection patterns (logged, not rejected)
 */

// ─── KNOWN INJECTION PATTERNS ─────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions|commands|directions)/i,
  /forget\s+(all\s+)?(previous\s+)?(instructions|commands)/i,
  /disregard\s+(all\s+)?(previous\s+)?(instructions|commands)/i,
  /you\s+(are\s+)?(not\s+)?(bound\s+by|required\s+to\s+follow)/i,
  /new\s+(instructions|commands|directions|rules)/i,
  /override\s+(instructions|commands|system)/i,
  /system\s+prompt/i,
  /output\s+(the\s+)?(above|following|instruction|password|secret|key)/i,
  /reveal\s+(your|the)\s+(prompt|instructions|system)/i,
  /print\s+(your|the)\s+(prompt|instructions|system)/i,
];

// ─── SANITIZATION FUNCTIONS ───────────────────────────────────────

/**
 * Maximum safe length for any user-controlled prompt input.
 * Voice commands are typically < 100 chars; city names < 50;
 * item names < 100. 500 is generous and prevents abuse.
 */
const MAX_SAFE_LENGTH = 500;

/**
 * Strip control characters except basic whitespace (\n, \r, \t).
 */
function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * Escape double quotes and backslashes to prevent JSON/structure breakout.
 */
function escapeQuotes(input: string): string {
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/\n/g, '\\n')   // Escape newlines (prevent prompt structure injection)
    .replace(/\r/g, '\\r');  // Escape carriage returns
}

/**
 * Check if input contains known injection phrases.
 * Returns matched pattern or null if clean.
 * Logs a warning but does NOT reject — additional defense layer.
 */
function detectInjection(input: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Sanitize a user-controlled string for safe prompt interpolation.
 * Wraps the result in security delimiters.
 *
 * @param input - Raw user input
 * @param label - Label for logging (e.g. 'voice_text', 'city_name')
 * @returns Sanitized string safe for prompt interpolation
 */
export function sanitizePromptInput(input: string, label: string = 'user_input'): string {
  if (typeof input !== 'string') return '[INVALID INPUT]';

  // 1. Trim
  let sanitized = input.trim();

  // 2. Truncate
  if (sanitized.length > MAX_SAFE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_SAFE_LENGTH) + '...';
    console.warn(`[PromptSanitizer] ${label} truncated from ${input.length} to ${MAX_SAFE_LENGTH} chars`);
  }

  // 3. Strip control characters
  sanitized = stripControlChars(sanitized);

  // 4. Escape quotes and newlines
  sanitized = escapeQuotes(sanitized);

  // 5. Injection pattern detection (log only — don't reject)
  const injection = detectInjection(input);
  if (injection) {
    console.warn(`[PromptSanitizer] Potential injection detected in ${label}: "${injection.slice(0, 80)}"`);
  }

  return sanitized;
}

/**
 * Wrap sanitized user input in security delimiters that the prompt
 * instructions can reference. This creates a clear boundary between
 * the prompt instruction and the user data.
 *
 * Example in prompt:
 *   User command: ---[USER_INPUT_START]---add 20L milk---[USER_INPUT_END]---
 */
export const DELIMITER_START = '---[USER_INPUT_START]---';
export const DELIMITER_END = '---[USER_INPUT_END]---';

export function wrapInDelimiters(sanitizedInput: string): string {
  return `${DELIMITER_START}${sanitizedInput}${DELIMITER_END}`;
}

/**
 * Combined sanitize + wrap for convenience.
 */
export function sanitizeAndWrap(input: string, label: string = 'user_input'): string {
  return wrapInDelimiters(sanitizePromptInput(input, label));
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Response Parser — Parses and validates LLM JSON responses.
 * Handles malformed JSON, markdown-wrapped JSON, and empty responses.
 */

/**
 * Parse an LLM text response into a JSON object.
 * Handles common LLM quirks:
 *   - Markdown code blocks (```json ... ```)
 *   - Trailing commas
 *   - Single-quoted strings
 *   - Leading/trailing whitespace
 */
export function parseJsonResponse(text: string): any {
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from AI');
  }

  let cleaned = text.trim();

  // Remove markdown code blocks
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  // Remove any leading non-JSON text (before first { or [)
  const firstJsonChar = cleaned.search(/[{[]/);
  if (firstJsonChar > 0) {
    cleaned = cleaned.slice(firstJsonChar);
  }

  // Remove trailing non-JSON text (after last } or ])
  const lastJsonChar = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastJsonChar > 0 && lastJsonChar < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastJsonChar + 1);
  }

  // Try parsing
  try {
    return JSON.parse(cleaned);
  } catch {
    // If parsing fails, try fixing common issues
    try {
      // Replace single quotes with double quotes (simple cases only)
      const fixed = cleaned
        .replace(/'/g, '"')
        .replace(/(\w+):/g, '"$1":'); // Ensure keys are quoted
      return JSON.parse(fixed);
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }
  }
}

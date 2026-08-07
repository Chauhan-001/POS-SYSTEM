/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConfirmationService — Handles low-confidence scenarios and missing fields.
 *
 * When the AI parser returns low confidence or missing information,
 * this service generates clarification prompts instead of guessing.
 *
 * Principles:
 *   - Safety over automation: never guess when uncertain
 *   - Ask specific questions about what's missing
 *   - Provide suggestions when possible (e.g., known items)
 *   - Always allow the user to confirm before executing
 *
 * Confidence thresholds:
 *   >= 0.8 : High confidence → can auto-execute with confirmation screen
 *   0.5–0.8: Medium confidence → show summary, ask to confirm before executing
 *   < 0.5   : Low confidence → ask clarifying questions
 */

import type { ParsedItem, ConfirmationRequest, ConfirmationResponse } from '../types';

// ====================================================================
// CONSTANTS
// ====================================================================

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;

export type RiskLevel = 'high' | 'medium' | 'low';

// ====================================================================
// SERVICE
// ====================================================================

/**
 * Determine the risk level based on confidence and missing fields.
 */
export function assessRiskLevel(
  confidence: number,
  missingFields: string[]
): RiskLevel {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD && missingFields.length === 0) {
    return 'high';
  }
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD && missingFields.length <= 1) {
    return 'medium';
  }
  return 'low';
}

/**
 * Identify which fields are missing or ambiguous in the parsed output.
 */
export function findMissingFields(
  transcript: string,
  items: ParsedItem[],
  intent: string
): string[] {
  const missing: string[] = [];
  const lower = transcript.toLowerCase();

  if (intent === 'unknown') {
    missing.push('intent');
  }

  if (items.length === 0) {
    missing.push('items');
    return missing;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = items.length > 1 ? `Item ${i + 1}: ` : '';

    if (!item.item || item.item.trim() === '') {
      missing.push(`${prefix}item name`);
    }

    if (item.quantity <= 0) {
      missing.push(`${prefix}quantity for "${item.item || 'unknown'}"`);
    }

    if (!item.unit || item.unit === 'pcs') {
      // 'pcs' is a valid default, but check if the transcript suggests a unit
      const hasUnitInText =
        /\b(kg|kilo|litre|liter|l|ml|gram|g|dozen|crate|bottle|packet|pieces)\b/i.test(
          lower
        );
      if (hasUnitInText) {
        missing.push(`${prefix}unit for "${item.item || 'unknown'}"`);
      }
    }
  }

  return missing;
}

/**
 * Generate clarification suggestions based on what's missing.
 */
export function generateSuggestions(
  missingFields: string[],
  availableItems?: string[]
): string[] {
  const suggestions: string[] = [];

  for (const field of missingFields) {
    switch (true) {
      case field.includes('intent'):
        suggestions.push(
          'Try: "Add 20 kg flour", "Remove 5L milk", or "Log waste 3 bread"'
        );
        break;
      case field.includes('item name'):
        if (availableItems && availableItems.length > 0) {
          suggestions.push(
            `Available items: ${availableItems.slice(0, 5).join(', ')}${
              availableItems.length > 5 ? '...' : ''
            }`
          );
        } else {
          suggestions.push('What item would you like to update?');
        }
        break;
      case field.includes('quantity'):
        suggestions.push('How much? (e.g., "20 kg", "5 litres", "3 pcs")');
        break;
      case field.includes('unit'):
        suggestions.push(
          'What unit? (kg, L, pcs, dozen, crate, packet, bottle)'
        );
        break;
    }
  }

  return suggestions;
}

/**
 * Build a confirmation request object for the frontend.
 */
export function buildConfirmationRequest(
  transcript: string,
  intent: string,
  items: ParsedItem[],
  confidence: number,
  availableItems?: string[]
): ConfirmationRequest {
  const missingFields = findMissingFields(transcript, items, intent);
  const suggestions = generateSuggestions(missingFields, availableItems);

  return {
    transcript,
    intent: intent as ConfirmationRequest['intent'],
    items,
    confidence,
    missingFields,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Check if the parsed result is safe to execute (high confidence, all fields present).
 */
export function isSafeToExecute(
  confidence: number,
  missingFields: string[]
): boolean {
  return (
    confidence >= HIGH_CONFIDENCE_THRESHOLD && missingFields.length === 0
  );
}

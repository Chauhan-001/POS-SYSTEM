/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fallback data for AI LLM provider when circuit breaker is open or AI is unavailable.
 * Returns safe, generic responses that won't break downstream consumers.
 */

export function getFallbackAiData(): string {
  return JSON.stringify({
    keyInsight: 'AI service temporarily unavailable. Using default data.',
    topPriority: 'Continue normal operations.',
    revenuePrediction: 'Check sales dashboard for projections.',
    itemSuggestions: ['Monitor inventory levels.', 'Prepare for peak hours.'],
    alerts: [{ message: 'AI unavailable — circuit breaker active', severity: 'info' }],
    recommendation: 'AI-powered recommendations paused. Using seasonal defaults.',
    condition: 'pleasant',
    temperature: 24,
    icon: '🌤️',
    suggestedItems: [],
  });
}

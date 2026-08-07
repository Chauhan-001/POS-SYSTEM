/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Copy Prompts — LLM-based generation of attractive offer titles,
 * descriptions, and marketing messages (WhatsApp, SMS, email, app notification).
 * This is the ONLY place where LLM is called for offers.
 * All recommendation logic is deterministic (see offerEngine.ts).
 */

export interface OfferCopyInput {
  type: string;
  value: number;
  discountValue?: string;
  applicableCategories: string[];
  targetAudience: string;
  reason: string;
  minOrderValue?: number;
  durationDays: number;
  language?: 'en' | 'hi';
}

export function buildTitlePrompt(input: OfferCopyInput): string {
  return `Generate an attractive, short promotional offer title (max 5 words) for a restaurant promotion.

Details:
- Offer type: ${input.type}${input.value ? ` (${input.type === 'percentage' ? input.value + '%' : input.type === 'flat' ? 'Rs.' + input.value : input.value} ${input.type === 'reward_points' ? 'points' : ''})` : ''}
${input.applicableCategories.length > 0 ? `- Applicable on: ${input.applicableCategories.join(', ')}` : ''}
${input.minOrderValue ? `- Minimum order: Rs.${input.minOrderValue}` : ''}
- Duration: ${input.durationDays} day(s)

Rules:
- Max 5 words
- Catchy and appealing to Indian restaurant customers
- Use English${input.language === 'hi' ? ' or Hindi' : ''}
- Do NOT use quotes
- Just return the title, nothing else`;
}

export function buildDescriptionPrompt(input: OfferCopyInput): string {
  return `Generate a short, appealing offer description (1-2 sentences) for a restaurant promotion.

Details:
- Offer type: ${input.type}${input.value ? ` (${input.type === 'percentage' ? input.value + '%' : input.type === 'flat' ? 'Rs.' + input.value : input.value} ${input.type === 'reward_points' ? 'points' : ''})` : ''}
${input.applicableCategories.length > 0 ? `- Applicable on: ${input.applicableCategories.join(', ')}` : ''}
${input.minOrderValue ? `- Minimum order: Rs.${input.minOrderValue}` : ''}
- Target audience: ${input.targetAudience}
- Reason: ${input.reason}

Rules:
- 1-2 sentences max
- Make it sound exciting and urgent
- Include a call to action
- Use English${input.language === 'hi' ? ' or Hindi' : ''}
- Just return the description, nothing else`;
}

export function buildWhatsAppPrompt(input: OfferCopyInput): string {
  return `Generate a WhatsApp promotional message (max 200 characters) for a restaurant offer.

Details:
- Offer: ${input.type === 'percentage' ? input.value + '% OFF' : input.type === 'flat' ? 'Rs.' + input.value + ' OFF' : input.type}${input.discountValue ? ' (' + input.discountValue + ')' : ''}
${input.applicableCategories.length > 0 ? `- On: ${input.applicableCategories.join(', ')}` : ''}
${input.minOrderValue ? `- Min order: Rs.${input.minOrderValue}` : ''}

Rules:
- Max 200 characters
- Warm and friendly tone
- Include an emoji
- Use English
- Just return the message, nothing else`;
}

export function buildSmsPrompt(input: OfferCopyInput): string {
  return `Generate an SMS promotional message (max 120 characters) for a restaurant offer.

Details:
- Offer: ${input.type === 'percentage' ? input.value + '% OFF' : input.type === 'flat' ? 'Rs.' + input.value + ' OFF' : input.type}
${input.applicableCategories.length > 0 ? `- On: ${input.applicableCategories.join(', ')}` : ''}
${input.minOrderValue ? `- Min order: Rs.${input.minOrderValue}` : ''}

Rules:
- Max 120 characters (SMS limit)
- Include the offer details clearly
- Include a call to action
- Use English
- Just return the SMS text, nothing else`;
}

export function buildAppNotificationPrompt(input: OfferCopyInput): string {
  return `Generate a mobile app push notification (max 100 characters) for a restaurant offer.

Details:
- Offer: ${input.type === 'percentage' ? input.value + '% OFF' : input.type === 'flat' ? 'Rs.' + input.value + ' OFF' : input.type}
${input.applicableCategories.length > 0 ? `- On: ${input.applicableCategories.join(', ')}` : ''}

Rules:
- Max 100 characters
- Eye-catching and urgent tone
- Include an emoji
- Use English
- Just return the notification text, nothing else`;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Copy Prompts — LLM-based generation of attractive offer titles,
 * descriptions, and marketing messages (WhatsApp, SMS, push, email).
 *
 * Phase 2: the FIVE separate copy calls (title/description/whatsapp/sms/push)
 * are consolidated into ONE structured LLM request so a single provider call
 * yields all copy fields, validated against offerCopyOutputSchema.
 *
 * Phase 4: the owner picks a TONE (funky / professional / Zomato-style / …)
 * and a LANGUAGE (English / Hindi / Hinglish) at the point of generation —
 * the Studio, the Create wizard and the Promote flow all ask for it. The
 * tone/language are real instructions to the model, but they never change the
 * offer facts: the discount, value and terms stay exactly as supplied.
 *
 * This is the ONLY place where LLM is called for offer copy. All
 * recommendation logic remains deterministic (see offerEngine.ts). Financial
 * values are supplied as facts — the model never computes them.
 */

export type CopyTone =
  | 'friendly'
  | 'funky'
  | 'zomato'
  | 'professional'
  | 'premium'
  | 'festive'
  | 'genz'
  | 'minimal';

export type CopyLanguage = 'en' | 'hi' | 'hinglish';

export interface OfferCopyInput {
  type: string;
  value: number;
  discountValue?: string;
  applicableCategories: string[];
  targetAudience: string;
  reason: string;
  minOrderValue?: number;
  durationDays: number;
  language?: CopyLanguage;
  /** The copy style the owner picked. Defaults to a warm, friendly tone. */
  tone?: CopyTone;
}

/** Render the discount so every channel states the SAME value. */
function renderOffer(input: OfferCopyInput): string {
  const { type, value } = input;
  if (type === 'percentage') return `${value}% OFF`;
  if (type === 'flat') return `Rs.${value} OFF`;
  if (type === 'bogo') return 'Buy One Get One';
  if (type === 'reward_points') return `${value} reward points`;
  if (type === 'combo') return `Combo at Rs.${value}`;
  return input.discountValue || `${value}`;
}

/** Short, concrete style guides the model follows for each tone. */
const TONE_GUIDES: Record<CopyTone, string> = {
  friendly: 'warm, casual and welcoming, like a neighbourhood restaurant talking to a regular customer',
  funky: 'bold, playful and full of energy — punchy words, mild slang, exclamation and personality, like a young street-food brand',
  zomato: 'Zomato/Swiggy style — short, quirky, witty and appetite-driven; foodie humour, playful emoji, lines like "craving khatam" or "treat yourself, you earned it"',
  professional: 'polished, clear and trustworthy — professional restaurant marketing copy, no slang, no over-promise',
  premium: 'elegant and exclusive — refined wording that makes the offer feel like a privilege, not a discount',
  festive: 'celebration energy — festival/occasion framing, joyful words, light festive emoji',
  genz: 'modern Gen-Z voice — casual, meme-adjacent, punchy one-liners, current slang used naturally, not forced',
  minimal: 'very short and clean — fewest words possible while staying clear and friendly',
};

/** Language instruction shown to the model. */
function languageInstruction(language: CopyLanguage): string {
  switch (language) {
    case 'hi':
      return 'Write the copy in HINDI (Devanagari script is fine, or clear Roman Hindi). Keep brand words like OFF, Combo and the discount value in English where it reads naturally.';
    case 'hinglish':
      return 'Write the copy in HINGLISH — a natural mix of Hindi and English the way young Indian food brands write on WhatsApp and Zomato (e.g. "Craving hai? 20% OFF mil raha hai!"). Hindi can be Roman script. Keep it fun, readable and authentic — never stiff or translated word-for-word.';
    default:
      return 'Write the copy in clear, natural English.';
  }
}

/**
 * ONE prompt that returns ALL copy fields as a single JSON object.
 * Every channel must describe the same offer with the supplied values —
 * the model must never invent prices, dates, availability or terms.
 */
export function buildOfferCopyPrompt(input: OfferCopyInput): string {
  const offer = renderOffer(input);
  const on = input.applicableCategories.length > 0 ? ` on ${input.applicableCategories.join(', ')}` : '';
  const min = input.minOrderValue ? ` above Rs.${input.minOrderValue}` : '';
  const tone = input.tone || 'friendly';
  const language = input.language || 'en';

  return `You are a restaurant marketing copywriter. Generate ALL promotional copy for ONE offer in a SINGLE JSON response.

OFFER FACTS (authoritative — never change or invent these):
- Offer: ${offer}${on}${min}
- Duration: ${input.durationDays} day(s)
- Target audience: ${input.targetAudience || 'all customers'}
- Why this offer runs: ${input.reason || 'promotion'}

STYLE (what the owner chose — follow it strictly):
- Tone: ${tone} — ${TONE_GUIDES[tone]}
- Language: ${languageInstruction(language)}

RULES:
- All five fields must describe THIS SAME offer and must reuse the exact values above.
- Do NOT invent prices, discount amounts, dates, availability, or terms and conditions.
- Do NOT use placeholders like <name> or [name] — write complete copy.
- Keep each channel within its length limit (see below).
- Match the chosen tone and language across ALL fields — title, description and every message.
- Respond with valid JSON ONLY — no markdown, no code fences, no commentary.

Required JSON shape:
{
  "title": "short catchy title in the chosen tone and language, max 6 words",
  "description": "1-2 sentence description of the offer with a call to action, max 200 chars",
  "whatsapp": "warm message in the chosen tone and language, include one emoji, max 200 chars",
  "sms": "clear SMS with the offer details and a call to action, max 120 chars",
  "push": "short urgent app notification in the chosen tone and language, include one emoji, max 100 chars"
}`;
}

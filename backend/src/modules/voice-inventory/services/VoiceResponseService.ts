 /**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoiceResponseService — Generates natural-language merchant-facing responses
 * from conversation state and product resolution results.
 *
 * This service transforms structured data into human-readable messages in
 * English, Hindi, and Hinglish, matching the merchant's language.
 *
 * Principles:
 *   - Never show "Voice failed" — always provide useful recovery
 *   - Use the merchant's detected language for responses
 *   - Keep messages concise (merchants are busy)
 *   - Offer one-click corrections where possible
 */

import type {
  ProductResolutionResult,
  ConversationState,
  MissingField,
  AmbiguityInfo,
  NewProductSuggestion,
  ConversationTurn,
  VoiceParseOutput,
} from '../types';

// ====================================================================
// MESSAGE GENERATORS
// ====================================================================

/**
 * Generate the assistant's response for a conversational turn.
 */
export function generateResponse(
  state: ConversationState,
  parsed: VoiceParseOutput | null,
  resolution: ProductResolutionResult | null
): {
  message: string;
  responseType: 'question' | 'confirmation' | 'result' | 'error';
  suggestedAction?: 'confirm' | 'edit' | 'cancel' | 'provide_info' | 'select_variant';
} {
  const language = parsed?.language || state.turnHistory.find(t => t.parsed?.language)?.parsed?.language || 'hi-en';

  // Case 1: Empty transcript / no intent detected
  if (!parsed || parsed.intent === 'unknown' || (parsed.items.length === 0 && !state.pendingAmbiguity)) {
    return {
      message: getMessage('could_not_understand', language),
      responseType: 'question',
      suggestedAction: 'provide_info',
    };
  }

  // Case 2: Product ambiguity — multiple variants found
  if (state.pendingAmbiguity) {
    return generateAmbiguityMessage(state.pendingAmbiguity, language);
  }

  // Case 3: Missing fields
  if (state.missingFields.length > 0) {
    return generateMissingFieldMessage(state.missingFields, language);
  }

  // Case 4: New product suggestion
  if (resolution?.decision === 'new_product_suggestion' && resolution.newProductSuggestion) {
    return generateNewProductMessage(resolution.newProductSuggestion, language);
  }

  // Case 5: Confidence needs confirmation
  if (resolution && resolution.decision === 'confirm') {
    return {
      message: getConfirmMessage(resolution, language),
      responseType: 'confirmation',
      suggestedAction: 'confirm',
    };
  }

  // Case 6: Product picker needed
  if (resolution && resolution.decision === 'product_picker') {
    return generatePickerMessage(resolution, language);
  }

  // Case 7: Auto-select with high confidence
  if (resolution && resolution.decision === 'auto_select' && resolution.product) {
    const qty = state.pendingQuantity || parsed?.items[0]?.quantity || 0;
    const unit = state.pendingUnit || parsed?.items[0]?.unit || resolution.product.unit;
    return {
      message: getAutoSelectMessage(resolution.product.name, qty, unit, parsed.intent, language),
      responseType: 'result',
      suggestedAction: 'confirm',
    };
  }

  // Case 8: Fully resolved and ready to execute
  if (resolution && resolution.product && state.missingFields.length === 0) {
    const qty = state.pendingQuantity || parsed?.items[0]?.quantity || 0;
    const unit = state.pendingUnit || parsed?.items[0]?.unit || resolution.product.unit;
    return {
      message: getCompleteMessage(parsed.intent, resolution.product.name, qty, unit, language),
      responseType: 'confirmation',
      suggestedAction: 'confirm',
    };
  }

  // Case 9: Fallback — partially resolved
  if (resolution?.product) {
    return {
      message: getMessage('partial_resolution', language, resolution.product.name),
      responseType: 'question',
      suggestedAction: 'provide_info',
    };
  }

  // Case 10: Unresolved
  return {
    message: getMessage('unresolved', language),
    responseType: 'question',
    suggestedAction: 'provide_info',
  };
}

/**
 * Generate the assistant's message when product ambiguity exists.
 */
function generateAmbiguityMessage(
  ambiguity: AmbiguityInfo,
  language: string
): { message: string; responseType: 'question'; suggestedAction: 'select_variant' } {
  const variantLines = ambiguity.variants
    .map((v, i) => `${i + 1}. ${v.productName} (${v.unit}${v.currentStock !== undefined ? `, stock: ${v.currentStock}` : ''})`)
    .join('\n');

  const message = language === 'hi'
    ? `मिले: \n${variantLines}\nकौन सा लेना है?`
    : language === 'hi-en'
    ? `I found:\n${variantLines}\nWhich one?`
    : `I found:\n${variantLines}\nWhich one would you like?`;

  return { message, responseType: 'question', suggestedAction: 'select_variant' };
}

/**
 * Generate a message asking the merchant to fill missing fields.
 */
function generateMissingFieldMessage(
  missingFields: MissingField[],
  language: string
): { message: string; responseType: 'question'; suggestedAction: 'provide_info' } {
  // Only ask about the first missing field to avoid overwhelming.
  const first = missingFields[0];

  if (missingFields.length === 1) {
    return { message: first.question, responseType: 'question', suggestedAction: 'provide_info' };
  }

  // Multiple missing fields — ask the most critical one first.
  const priority: Record<string, number> = {
    product_variant: 1,
    quantity: 2,
    unit: 3,
    product_name: 4,
    intent: 5,
    purchase_price: 6,
    confirmation: 7,
  };

  missingFields.sort((a, b) => (priority[a.type] || 99) - (priority[b.type] || 99));

  return {
    message: missingFields[0].question,
    responseType: 'question',
    suggestedAction: 'provide_info',
  };
}

/**
 * Generate a message for new product suggestions.
 */
function generateNewProductMessage(
  suggestion: NewProductSuggestion,
  language: string
): { message: string; responseType: 'confirmation'; suggestedAction: 'confirm' } {
  const intro = language === 'hi'
    ? `"${suggestion.productName}" मौजूदा सूची में नहीं मिला। नया उत्पाद जोड़ें?`
    : language === 'hi-en'
    ? `"${suggestion.productName}" not found in your inventory. Create new product?`
    : `"${suggestion.productName}" was not found in your inventory. Would you like to create it?`;

  const details = `\nCategory: ${suggestion.primaryCategory || 'Auto-detect'} | Unit: ${suggestion.inventoryUnit || 'pcs'}`;

  return {
    message: intro + details,
    responseType: 'confirmation',
    suggestedAction: 'confirm',
  };
}

/**
 * Generate a product picker message.
 */
function generatePickerMessage(
  resolution: ProductResolutionResult,
  language: string
): { message: string; responseType: 'question'; suggestedAction: 'select_variant' | 'provide_info' } {
  const candidates = (resolution.stages
    .filter(s => s.alternatives && s.alternatives.length > 0)
    .flatMap(s => s.alternatives!)
    .slice(0, 5));

  if (candidates.length === 0) {
    return {
      message: getMessage('could_not_identify_product', language),
      responseType: 'question',
      suggestedAction: 'provide_info',
    };
  }

  const lines = candidates
    .map((c, i) => `${i + 1}. ${c.productName} (${Math.round(c.confidence * 100)}% match)`)
    .join('\n');

  const message = language === 'hi'
    ? `ये उत्पाद मिले:\n${lines}\nकौन सा सही है?`
    : `I found these products:\n${lines}\nWhich one is correct?`;

  return { message, responseType: 'question', suggestedAction: 'select_variant' };
}

/**
 * Generate auto-select message for high confidence matches.
 */
function getAutoSelectMessage(
  productName: string,
  quantity: number,
  unit: string,
  intent: string,
  language: string
): string {
  const action = getIntentActionPastTense(intent, language);

  if (language === 'hi') {
    return `${productName} के ${quantity} ${unit} ${action}`;
  }
  if (language === 'hi-en') {
    return `${action} ${quantity} ${unit} ${productName}`;
  }
  return `${action} ${quantity} ${unit} ${productName}`;
}

/**
 * Generate complete confirmation message.
 */
function getCompleteMessage(
  intent: string,
  productName: string,
  quantity: number,
  unit: string,
  language: string
): string {
  const action = getIntentActionPastTense(intent, language);

  if (language === 'hi') {
    return `${productName} के ${quantity} ${unit} ${action}. सही है?`;
  }
  return `${action} ${quantity} ${unit} ${productName}. Is that correct?`;
}

/**
 * Generate confirmation message for medium confidence.
 */
function getConfirmMessage(
  resolution: ProductResolutionResult,
  language: string
): string {
  if (!resolution.product) return getMessage('could_not_identify_product', language);

  const pct = Math.round(resolution.confidence * 100);
  const matchType = resolution.matchedStage ? resolution.matchedStage.replace('_', ' ') : '';

  return language === 'hi'
    ? `${resolution.product.name} (${pct}% मैच, ${matchType})। क्या सही है?`
    : `${resolution.product.name} (${pct}% match via ${matchType}). Is this correct?`;
}

// ====================================================================
// MESSAGE DICTIONARY
// ====================================================================

const MESSAGES: Record<string, Record<string, string>> = {
  could_not_understand: {
    en: "I couldn't understand that. Please try again with a product name and quantity.",
    hi: 'समझ नहीं आया। कृपया उत्पाद का नाम और मात्रा बताएं।',
    'hi-en': "I couldn't understand. Please say the product name and quantity.",
  },
  could_not_identify_product: {
    en: "I couldn't identify the product. Could you try a different name?",
    hi: 'उत्पाद की पहचान नहीं हो सकी। कोई दूसरा नाम बताएं।',
    'hi-en': "I couldn't identify the product. Try a different name?",
  },
  unresolved: {
    en: "I'm not sure what to do. Please say what you want to add, remove, or adjust.",
    hi: 'समझ नहीं आया। कृपया बताएं क्या जोड़ना, हटाना या बदलना है।',
    'hi-en': "Not sure what to do. Please say what to add, remove, or adjust.",
  },
  partial_resolution: {
    en: "I found {product}. What would you like to do with it?",
    hi: '{product} मिला। इसके साथ क्या करना है?',
    'hi-en': 'Found {product}. What to do with it?',
  },
  need_quantity: {
    en: 'How many? Please tell me the quantity.',
    hi: 'कितनी मात्रा? कृपया मात्रा बताएं।',
    'hi-en': 'How many? Please tell the quantity.',
  },
  need_unit: {
    en: 'What unit? (kg, L, pcs, bottle, crate, packet)',
    hi: 'किस इकाई में? (kg, L, pcs, bottle, crate, packet)',
    'hi-en': 'What unit? (kg, L, pcs, bottle, crate, packet)',
  },
};

function getMessage(key: string, language: string, ...args: string[]): string {
  const lang = language === 'hi' ? 'hi' : language === 'en' ? 'en' : 'hi-en';
  let msg = MESSAGES[key]?.[lang] || MESSAGES[key]?.['en'] || '';
  args.forEach((arg, i) => {
    msg = msg.replace(`{${['product', 'quantity', 'unit', 'action'][i] || ''}}`, arg);
  });
  return msg;
}

// ====================================================================
// HELPERS
// ====================================================================

function getIntentActionPastTense(intent: string, _language: string): string {
  switch (intent) {
    case 'inventory_add':
      return 'Added';
    case 'inventory_remove':
      return 'Removed';
    case 'inventory_adjust':
      return 'Set';
    case 'inventory_waste':
      return 'Logged waste';
    case 'purchase_reminder':
      return 'Noted to order';
    default:
      return 'Updated';
  }
}

export function getQuantityQuestion(productName: string, unit: string, language: string): MissingField {
  return {
    type: 'quantity',
    question:
      language === 'hi'
        ? `${productName} के कितने ${unit}?`
        : language === 'hi-en'
        ? `How many ${unit} of ${productName}?`
        : `How many ${unit} of ${productName}?`,
    suggestions: ['1', '5', '10', '20', '50'],
  };
}

export function getVariantQuestion(variants: string[], language: string): MissingField {
  return {
    type: 'product_variant',
    question:
      language === 'hi'
        ? `कौन सा? ${variants.join(', ')}`
        : `Which one? ${variants.join(', ')}`,
    suggestions: variants,
  };
}


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConversationManager — Orchestrates the multi-turn conversational flow for
 * voice inventory actions.
 *
 * This is the central orchestrator that sits between the controller and the
 * existing single-turn services (AIParser, ProductResolutionEngine, etc.),
 * adding context persistence, disambiguation, missing-field tracking, and
 * natural-language response generation.
 *
 * Flow per turn:
 *   1. Receive transcript + conversationId (new or existing)
 *   2. Load/create conversation context from ContextManager
 *   3. Parse transcript via AIParser (intent + items extraction)
 *   4. Run Product Resolution Engine for each item
 *   5. Check for variant ambiguity (multiple products match)
 *   6. Check for missing fields (quantity, unit, intent)
 *   7. Generate natural language response via VoiceResponseService
 *   8. Save updated context, add turn history
 *   9. Return ConversationResponse
 *
 * On confirmation (final turn):
 *   - Execute inventory update via InventoryService
 *   - Record audit log
 *   - Feed self-learning if correction was made
 */

import crypto from 'crypto';
import { parseTranscript } from './AIParser';
import { resolveProduct } from './ProductResolutionEngine';
import { updateInventory } from './InventoryService';
import {
  recordVoiceAction,
  updateConfirmationStatus,
} from './AuditLogger';
import { generateResponse, getQuantityQuestion } from './VoiceResponseService';
import {
  createContext,
  getContextById,
  addTurn,
  updateContext,
  completeContext,
} from './ContextManager';
import Product from '../../../models/Product';
import type {
  ConversationState,
  ConversationResponse,
  ConversationTurn,
  ProductResolutionResult,
  VoiceParseOutput,
  VoiceIntent,
  AmbiguityInfo,
  MissingField,
  NewProductSuggestion,
} from '../types';

// ====================================================================
// CONSTANTS
// ====================================================================

/** Max turns before auto-completing (safety limit). */
const MAX_TURNS = 30;

// ====================================================================
// MAIN ENTRYPOINT
// ====================================================================

export interface ConverseOptions {
  restaurantId: string;
  employeeId?: string;
  employeeName?: string;
  transcript: string;
  language?: string;
  conversationId?: string;
  /** When true, skip the LLM and use keyword fallback only. */
  skipLLM?: boolean;
}

/**
 * Process a single conversational turn and return the assistant's response.
 *
 * @returns ConversationResponse for the frontend
 */
export async function converse(
  options: ConverseOptions
): Promise<ConversationResponse> {
  const overallStart = Date.now();
  const {
    restaurantId,
    employeeId,
    employeeName,
    transcript,
    language = 'hi-en',
    conversationId,
    skipLLM = false,
  } = options;

  // ─── Step 1: Load or create conversation context ────────────────
  let state: ConversationState;
  if (conversationId) {
    const existing = getContextById(conversationId);
    if (existing && !existing.completed) {
      state = existing;
    } else {
      // Create a new context if the requested one expired or was completed
      state = createContext(restaurantId, employeeId, employeeName);
    }
  } else {
    state = createContext(restaurantId, employeeId, employeeName);
  }

  // Safety: if conversation exceeded max turns, start fresh
  if (state.turnHistory.length >= MAX_TURNS) {
    completeContext(restaurantId, employeeId, 'expired');
    state = createContext(restaurantId, employeeId, employeeName);
  }

  // ─── Step 2: Parse the transcript ───────────────────────────────
  let parsed: VoiceParseOutput;
  try {
    parsed = await parseTranscript(transcript, {
      language,
      inventoryContext: [], // The engine fetches its own context
    });
  } catch (error: any) {
    return buildErrorResponse(state.conversationId, 'Failed to parse voice input', overallStart);
  }

  // ─── Step 3: Add merchant turn to history ───────────────────────
  const merchantTurn: ConversationTurn = {
    role: 'merchant',
    message: transcript,
    timestamp: new Date(),
    parsed,
  };
  addTurn(restaurantId, employeeId, merchantTurn);

  // Capture a spoken supplier/date/brand into the conversation state so a
  // voice "add" can record who supplied the stock and when (defaults to
  // today) and which brand it was. Kept across turns — the merchant can name
  // the supplier/brand on a follow-up turn ("... from Verka Dairy") after
  // stating the item.
  if (parsed.supplier || parsed.date || parsed.brand) {
    updateContext(restaurantId, employeeId, {
      pendingSupplier: parsed.supplier || state.pendingSupplier,
      pendingDate: parsed.date || state.pendingDate,
      pendingBrand: parsed.brand || state.pendingBrand,
      pendingExpiryDate: parsed.expiryDate || state.pendingExpiryDate,
    });
    state = getContextById(state.conversationId)!;
  }

  // ─── Step 4: Check for "yes/no" responses (answer to previous question) ──
  const isAffirmative = /^(yes|haan|ha|hmm|ok|ठीक|हाँ|confirm|confirm karo|done|karo|kar do|theek)\b/i.test(transcript.trim());
  const isNegative = /^(no|nahi|nhi|नहीं|cancel|cancel karo|cancel kar do|hatao|wrong|galat)\b/i.test(transcript.trim());
  const isNumberResponse = /^\d+$/.test(transcript.trim()) && state.missingFields.length > 0;

  if (isAffirmative && state.missingFields.length === 0 && state.pendingAmbiguity) {
    // Merchant confirmed a variant selection they already made
    // proceed to execute
    return await executeFinalAction(state, restaurantId, employeeId, employeeName, overallStart);
  }

  if (isAffirmative && state.pendingAmbiguity && state.activeProduct?.chosenVariant) {
    return await executeFinalAction(state, restaurantId, employeeId, employeeName, overallStart);
  }

  if (isNegative) {
    completeContext(restaurantId, employeeId, 'cancelled');
    const cancelTurn: ConversationTurn = {
      role: 'assistant',
      message: 'Cancelled. Say something new when you\'re ready.',
      timestamp: new Date(),
    };
    addTurn(restaurantId, employeeId, cancelTurn);

    return {
      success: true,
      conversationId: state.conversationId,
      message: 'Cancelled. Say something new when you\'re ready.',
      responseType: 'result',
      suggestedAction: 'cancel',
      turns: state.turnHistory.slice(-5),
      latencyMs: Date.now() - overallStart,
    };
  }

  // ─── Step 5: Handle variant selection ───────────────────────────
  if (state.pendingAmbiguity) {
    const chosenIndex = isNumberResponse ? parseInt(transcript.trim(), 10) - 1 : findVariantIndex(transcript, state.pendingAmbiguity);

    if (chosenIndex >= 0 && chosenIndex < state.pendingAmbiguity.variants.length) {
      const chosen = state.pendingAmbiguity.variants[chosenIndex];
      updateContext(restaurantId, employeeId, {
        pendingAmbiguity: undefined,
        activeProduct: {
          ...state.activeProduct!,
          chosenVariant: {
            productId: chosen.productId,
            productName: chosen.productName,
            unit: chosen.unit,
          },
        },
      });

      // Add system turn confirming variant selection
      const variantTurn: ConversationTurn = {
        role: 'system',
        message: `Selected: ${chosen.productName}`,
        timestamp: new Date(),
      };
      addTurn(restaurantId, employeeId, variantTurn);

      // Reload state
      state = getContextById(state.conversationId)!;

      // Now check for quantity
      if (state.pendingQuantity === undefined || state.pendingQuantity === 0) {
        const qtyField: MissingField = {
          type: 'quantity',
          question: `How many ${chosen.unit} of ${chosen.productName}?`,
          suggestions: ['1', '5', '10', '20', '50'],
        };
        updateContext(restaurantId, employeeId, { missingFields: [qtyField] });
        state = getContextById(state.conversationId)!;
      }

      const response = generateResponse(state, parsed, null);
      const assistantTurn: ConversationTurn = {
        role: 'assistant',
        message: response.message,
        timestamp: new Date(),
      };
      addTurn(restaurantId, employeeId, assistantTurn);

      return {
        success: true,
        conversationId: state.conversationId,
        message: response.message,
        responseType: 'question',
        missingFields: state.missingFields,
        suggestedAction: response.suggestedAction,
        turns: state.turnHistory.slice(-5),
        latencyMs: Date.now() - overallStart,
      };
    }
  }

  // ─── Step 6: Run Product Resolution Engine ──────────────────────
  const resolutions: ProductResolutionResult[] = [];
  for (const item of parsed.items) {
    if (item.item) {
      try {
        const resolution = await resolveProduct(item.item, restaurantId, {
          skipSemantic: skipLLM,
          inventoryOnly: true,
        });
        resolutions.push(resolution);
      } catch (error: any) {
        console.warn(`[ConversationManager] Resolution failed for "${item.item}":`, error.message);
      }
    }
  }

  const primaryResolution = resolutions[0] || null;

  // ─── Step 7: Detect quantity from transcript if not in parsed items ──
  let needsQuantity = false;
  if ((!parsed.items[0]?.quantity || parsed.items[0]?.quantity === 0) && !state.pendingQuantity) {
    // Extract fallback quantity from keyword parser
    const qtyMatch = transcript.match(/\b(\d+)\b/);
    if (qtyMatch) {
      updateContext(restaurantId, employeeId, { pendingQuantity: parseFloat(qtyMatch[1]) });
    } else {
      needsQuantity = true;
    }
  }

  // ─── Step 8: Check for product variant ambiguity ────────────────
  if (primaryResolution?.decision === 'product_picker' || primaryResolution?.decision === 'confirm' && primaryResolution.outcome === 'EXISTING_PRODUCT') {
    // Check if there are alternatives — if yes, present them
    const alternatives = primaryResolution.stages
      .filter(s => s.alternatives && s.alternatives.length > 0)
      .flatMap(s => s.alternatives!)
      .slice(0, 5);

    if (alternatives.length > 1 && state.missingFields.length === 0) {
      const ambiguity: AmbiguityInfo = {
        spokenName: parsed.items[0]?.item || '',
        variants: alternatives.map(a => ({
          productId: a.productId,
          productName: a.productName,
          unit: 'pcs',
          category: '',
          confidence: a.confidence,
        })),
      };

      updateContext(restaurantId, employeeId, { pendingAmbiguity: ambiguity });

      const response = generateResponse({
        ...state,
        pendingAmbiguity: ambiguity,
      } as ConversationState, parsed, primaryResolution);

      const assistantTurn: ConversationTurn = {
        role: 'assistant',
        message: response.message,
        timestamp: new Date(),
      };
      addTurn(restaurantId, employeeId, assistantTurn);

      return {
        success: true,
        conversationId: state.conversationId,
        message: response.message,
        responseType: 'question',
        ambiguityInfo: ambiguity,
        resolution: primaryResolution,
        suggestedAction: 'select_variant',
        turns: state.turnHistory.slice(-5),
        latencyMs: Date.now() - overallStart,
      };
    }
  }

  // ─── Step 9: Check for new product suggestion ───────────────────
  if (primaryResolution?.decision === 'new_product_suggestion' && primaryResolution.newProductSuggestion) {
    const response = generateResponse(state, parsed, primaryResolution);

    const assistantTurn: ConversationTurn = {
      role: 'assistant',
      message: response.message,
      timestamp: new Date(),
    };
    addTurn(restaurantId, employeeId, assistantTurn);

    return {
      success: true,
      conversationId: state.conversationId,
      message: response.message,
      responseType: 'confirmation',
      newProductSuggestion: primaryResolution.newProductSuggestion,
      resolution: primaryResolution,
      suggestedAction: 'confirm',
      turns: state.turnHistory.slice(-5),
      latencyMs: Date.now() - overallStart,
    };
  }

  // ─── Step 10: Check for missing quantity ────────────────────────
  if (needsQuantity) {
    const productName = primaryResolution?.product?.name || parsed.items[0]?.item || 'item';
    const unit = primaryResolution?.product?.unit || parsed.items[0]?.unit || 'pcs';
    const qtyField = getQuantityQuestion(productName, unit, parsed.language || 'hi-en');
    updateContext(restaurantId, employeeId, { missingFields: [qtyField] });
    state = getContextById(state.conversationId)!;
  }

  // ─── Step 11: Check if we have FULL resolution (product + quantity + intent) ──
  const hasProduct = !!primaryResolution?.product;
  const hasQuantity = !!(state.pendingQuantity || parsed.items[0]?.quantity);
  const hasIntent = parsed.intent !== 'unknown' && parsed.intent !== undefined;

  if (hasProduct && hasQuantity && hasIntent && state.missingFields.length === 0) {
    // Everything resolved — ask for confirmation
    const response = generateResponse(state, parsed, primaryResolution);
    const assistantTurn: ConversationTurn = {
      role: 'assistant',
      message: response.message,
      timestamp: new Date(),
    };
    addTurn(restaurantId, employeeId, assistantTurn);

    // Update state with final details
    updateContext(restaurantId, employeeId, {
      intent: parsed.intent,
      activeProduct: {
        spokenName: parsed.items[0]?.item || '',
        resolution: primaryResolution,
        chosenVariant: primaryResolution.product
          ? {
              productId: primaryResolution.product.id,
              productName: primaryResolution.product.name,
              unit: primaryResolution.product.unit,
            }
          : undefined,
      },
      missingFields: [{
        type: 'confirmation',
        question: response.message,
      }],
      // Keep the spoken supplier/date/brand/expiry alongside the confirmed action.
      ...(parsed.supplier ? { pendingSupplier: parsed.supplier } : {}),
      ...(parsed.date ? { pendingDate: parsed.date } : {}),
      ...(parsed.brand ? { pendingBrand: parsed.brand } : {}),
      ...(parsed.expiryDate ? { pendingExpiryDate: parsed.expiryDate } : {}),
    });

    return {
      success: true,
      conversationId: state.conversationId,
      message: response.message,
      responseType: 'confirmation',
      resolution: primaryResolution,
      suggestedAction: 'confirm',
      turns: state.turnHistory.slice(-5),
      latencyMs: Date.now() - overallStart,
    };
  }

  // ─── Step 12: Generate the conversational response ──────────────
  const response = generateResponse(state, parsed, primaryResolution);

  const assistantTurn: ConversationTurn = {
    role: 'assistant',
    message: response.message,
    timestamp: new Date(),
  };
  addTurn(restaurantId, employeeId, assistantTurn);

  return {
    success: true,
    conversationId: state.conversationId,
    message: response.message,
    responseType: response.responseType,
    missingFields: state.missingFields.length > 0 ? state.missingFields : undefined,
    resolution: primaryResolution || undefined,
    newProductSuggestion: primaryResolution?.newProductSuggestion || undefined,
    suggestedAction: response.suggestedAction,
    turns: state.turnHistory.slice(-5),
    latencyMs: Date.now() - overallStart,
  };
}

// ====================================================================
// FINALIZE & EXECUTE
// ====================================================================

/**
 * Executes the inventory action after merchant confirmation.
 */
async function executeFinalAction(
  state: ConversationState,
  restaurantId: string,
  employeeId: string | undefined,
  employeeName: string | undefined,
  overallStart: number
): Promise<ConversationResponse> {
  const variant = state.activeProduct?.chosenVariant;
  const resolutionProduct = state.activeProduct?.resolution?.product;
  const intent = state.intent || 'inventory_add';
  const quantity = state.pendingQuantity || 0;
  const unit = variant?.unit || resolutionProduct?.unit || 'pcs';
  const productName = variant?.productName || resolutionProduct?.name || state.activeProduct?.spokenName || 'item';

  try {
    // Execute inventory update
    const updateResult = await updateInventory({
      restaurantId,
      operation: intent as any,
      items: [{
        itemName: productName,
        quantity,
        unit,
        // Carry the spoken purchase price into averageCost on add.
        purchaseRate: state.pendingPurchasePrice || undefined,
      }],
      performedBy: employeeId || 'system',
      performedByName: employeeName || 'System',
      source: 'voice',
      // Voice adds record the named supplier + brand + expiry + spoken date
      // (today when absent) into the purchases feed + item history.
      supplier: state.pendingSupplier,
      date: state.pendingDate,
      brand: state.pendingBrand,
      expiryDate: state.pendingExpiryDate,
    });

    // Log audit
    const auditResult = await recordVoiceAction({
      restaurantId,
      employeeId,
      employeeName: employeeName || 'Unknown',
      intent: intent as any,
      transcript: state.turnHistory.find(t => t.role === 'merchant')?.message || '',
      parsedJson: {
        conversationId: state.conversationId,
        resolvedProduct: productName,
        quantity,
        unit,
      },
      confidence: state.activeProduct?.resolution?.confidence || 0.95,
      source: 'voice',
      items: [{ item: productName, quantity, unit }],
      latencyMs: Date.now() - overallStart,
    });

    completeContext(restaurantId, employeeId, 'confirmed');

    const extra =
      (state.pendingSupplier ? ` from ${state.pendingSupplier}` : '') +
      (state.pendingDate ? ` on ${state.pendingDate}` : '');
    const doneTurn: ConversationTurn = {
      role: 'assistant',
      message: `${productName} — done! ${quantity} ${unit} updated${extra}.`,
      timestamp: new Date(),
    };
    addTurn(restaurantId, employeeId, doneTurn);

    return {
      success: true,
      conversationId: state.conversationId,
      message: `${productName} — done! ${quantity} ${unit} updated${extra}.`,
      responseType: 'result',
      resolution: state.activeProduct?.resolution,
      auditLogId: auditResult.logId,
      turns: state.turnHistory.slice(-5),
      latencyMs: Date.now() - overallStart,
    };
  } catch (error: any) {
    console.error('[ConversationManager] Execution failed:', error.message);
    return {
      success: false,
      conversationId: state.conversationId,
      message: `Sorry, couldn't update: ${error.message}`,
      responseType: 'error',
      latencyMs: Date.now() - overallStart,
    };
  }
}

// ====================================================================
// HELPERS
// ====================================================================

function buildErrorResponse(
  conversationId: string,
  message: string,
  start: number
): ConversationResponse {
  return {
    success: false,
    conversationId,
    message,
    responseType: 'error',
    latencyMs: Date.now() - start,
  };
}

/**
 * Try to match the merchant's reply to a variant by name.
 */
function findVariantIndex(transcript: string, ambiguity: AmbiguityInfo): number {
  const lower = transcript.toLowerCase().trim();
  for (let i = 0; i < ambiguity.variants.length; i++) {
    const v = ambiguity.variants[i];
    if (v.productName.toLowerCase().includes(lower) || lower.includes(v.productName.toLowerCase())) {
      return i;
    }
  }
  return -1;
}


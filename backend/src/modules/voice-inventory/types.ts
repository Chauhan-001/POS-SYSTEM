 /**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Inventory Types — Shared type definitions for the Voice Inventory module.
 * These are the clean data shapes used between services, never raw MongoDB documents.
 */

// ====================================================================
// SPEECH-TO-TEXT PROVIDER INTERFACE
// ====================================================================

/** Result from a Speech-to-Text provider */
export interface STTResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  durationMs: number;
  language: string;
  /** Provider that actually produced the transcript (when chained) */
  provider?: string;
  /** Estimated cost in USD for this call (when cost tracking is on) */
  costUsd?: number;
  /** Provider chain attempt trace (chained/managed calls) */
  attemptHistory?: Array<{ key: string; status: 'ok' | 'skipped' | 'failed'; error?: string; latencyMs?: number }>;
  /** Diagnostic details captured on failure (never shown in normal flow) */
  error?: {
    message: string;
    status?: number;
    stack?: string;
    requestUrl?: string;
    model?: string;
    endpointMethod?: string;
    responseBody?: string;
  };
}

/** Interface that all STT providers must implement */
export interface ISTTProvider {
  readonly name: string;
  transcribe(audioBlob: Blob, options?: STTOptions): Promise<STTResult>;
}

export interface STTOptions {
  language?: string;
  timeoutMs?: number;
  enableInterim?: boolean;
}

// ====================================================================
// LLM PARSED RESULT
// ====================================================================

export type VoiceIntent =
  | 'inventory_add'
  | 'inventory_remove'
  | 'inventory_adjust'
  | 'inventory_waste'
  | 'purchase_reminder'
  | 'supplier_update'
  | 'unknown';

export interface ParsedItem {
  item: string | null;
  quantity: number;
  unit?: string;
  /**
   * Purchase rate (₹ per unit) for this item:
   *   - the rate spoken in the command ("5 kg aloo 40 rupaye ke rate par" → 40), or
   *   - the catalog product's averageCost when no rate was spoken (rateSource 'average'),
   *   - undefined when neither exists.
   */
  rate?: number;
  /** Where the rate came from — 'spoken' (command) vs 'average' (catalog averageCost). */
  rateSource?: 'spoken' | 'average';
  /** Resolved canonical inventory item name (after alias resolution) */
  canonicalName?: string;
  /** Resolved product ID after running the Product Resolution Engine */
  productId?: string;
  /**
   * Confidence that the spoken item resolved to a REAL inventory product
   * (0..1). Low values mean the item may be a new product or ambiguous.
   */
  resolutionConfidence?: number;
  /**
   * True when the spoken item could NOT be confidently matched to a known
   * inventory item. The frontend MUST surface this and let the merchant pick
   * rather than silently resolving it.
   */
  ambiguous?: boolean;
  /** Candidate inventory items the merchant could mean (disambiguation picker). */
  candidates?: Array<{
    name: string;
    unit?: string;
    currentStock?: number;
  }>;
  /**
   * True when no product matched AND no partial candidates exist.
   * The frontend should offer a "Create Product" button with pre-filled data.
   */
  productNotFound?: boolean;
}

export interface VoiceParseOutput {
  intent: VoiceIntent;
  items: ParsedItem[];
  confidence: number;
  originalText: string;
  language?: string;
  error?: string;
  /**
   * Supplier/vendor name spoken in the command ("... from Verka Dairy").
   * Optional — only present when the merchant actually named a supplier.
   */
  supplier?: string;
  /**
   * Purchase date as YYYY-MM-DD. Relative words ("kal" / "aaj" / "parso")
   * are resolved to actual dates at parse time. When absent, execution
   * defaults the date to today.
   */
  date?: string;
  /**
   * Brand/variant spoken in the command ("Amul brand butter"). The same
   * product can come from different brands — only present when the merchant
   * actually named one.
   */
  brand?: string;
  /**
   * Expiry date of the incoming batch (YYYY-MM-DD). Only present when the
   * merchant explicitly mentioned an expiry ("expiry 31 Dec 2026").
   */
  expiryDate?: string;
}

// ====================================================================
// SERVICE INTERFACES
// ====================================================================

export interface AliasEntry {
  canonicalName: string;
  unit: string;
}

export interface AliasMatch {
  canonicalName: string;
  unit: string;
  confidence: number;
}

export interface InventoryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedItems: Array<{
    itemName: string;
    quantity: number;
    unit: string;
    currentStock: number;
    newStock: number;
    productId?: string;
    /** Spoken purchase rate (₹/unit) — applied to averageCost on confirm. */
    purchaseRate?: number;
    /** The product's canonical unit, when resolved. */
    configuredUnit?: string;
  }>;
}

export interface ConfirmationRequest {
  transcript: string;
  intent: VoiceIntent;
  items: ParsedItem[];
  confidence: number;
  missingFields: string[];
  suggestions?: string[];
}

export interface ConfirmationResponse {
  action: 'confirm' | 'edit' | 'cancel' | 'clarify';
  editedItems?: ParsedItem[];
  clarification?: string;
}

// ====================================================================
// API REQUEST / RESPONSE
// ====================================================================

export interface VoiceInventoryRequest {
  /** Raw audio as base64 (optional — can send transcript directly) */
  audio?: string;
  /** Direct text transcript (use when audio is not provided) */
  transcript?: string;
  /** MIME type of audio (e.g., audio/webm) */
  audioMimeType?: string;
  /** Language hint */
  language?: string;
}

export interface VoiceInventoryResponse {
  success: boolean;
  auditLogId?: string;
  /** Server-side pending action issued for mandatory confirmation */
  pendingActionId?: string;
  /** One-time confirmation token (frontend holds; only hash is stored) */
  confirmationToken?: string;
  confirmationExpiresAt?: string;
  transcript?: string;
  parsed?: VoiceParseOutput;
  missingFields?: string[];
  suggestions?: string[];
  confirmation?: ConfirmationRequest;
  error?: string;
  latencyMs: number;
}

export interface VoiceConfirmRequest {
  logId: string;
  action: 'confirm' | 'edit' | 'cancel' | 'clarify';
  editedItems?: ParsedItem[];
  clarification?: string;
}

export interface ItemAliasRequest {
  canonicalName: string;
  aliases: string[];
  unit: string;
}

export interface ItemAliasBulkRequest {
  aliases: ItemAliasRequest[];
}

// ====================================================================
// PRODUCT RESOLUTION ENGINE TYPES
// ====================================================================

/** The 7-stage resolution pipeline order. */
export type ResolutionStage =
  | 'exact_name'
  | 'voice_alias'
  | 'search_alias'
  | 'learned_alias'
  | 'sku'
  | 'barcode'
  | 'fuzzy'
  | 'semantic';

/** Every stage returns a confidence score (0..1). */
export interface StageResult {
  stage: ResolutionStage;
  confidence: number;
  productId?: string;
  productName?: string;
  /** The alias string that matched (if any). */
  matchedOn?: string;
  /** How long this stage took, in ms. */
  latencyMs: number;
  /** Candidate products that did NOT win (semantic/fuzzy only). */
  alternatives?: Array<{ productId: string; productName: string; confidence: number }>;
}

/** Classification when a spoken item cannot be resolved confidently. */
export type ResolutionOutcome =
  | 'EXISTING_PRODUCT'
  | 'NEW_PRODUCT_SUGGESTION'
  | 'UNKNOWN_OR_AMBIGUOUS';

/** Result of resolving a single spoken item through the pipeline. */
export interface ProductResolutionResult {
  /** The canonical spoken name that was resolved. */
  spokenName: string;
  outcome: ResolutionOutcome;
  /** The winning product, if any. */
  product?: {
    id: string;
    name: string;
    unit: string;
    category: string;
    code: string;
  };
  /** Final confidence in the winning product (0..1). */
  confidence: number;
  /** The stage that produced the winner. */
  matchedStage?: ResolutionStage;
  /** Full ordered pipeline trace. */
  stages: StageResult[];
  /** Auto/confirm/picker decision from the ConfidenceEngine. */
  decision: 'auto_select' | 'confirm' | 'product_picker' | 'new_product_suggestion' | 'unresolved';
  /** For NEW_PRODUCT_SUGGESTION — the suggested new product payload. */
  newProductSuggestion?: NewProductSuggestion;
  /** True when this result should feed the self-learning system. */
  shouldLearn: boolean;
}

// ====================================================================
// AI ALIAS GENERATION
// ====================================================================

/** An alias candidate generated by the LLM, pending merchant approval. */
export interface AliasSuggestion {
  alias: string;
  type:
    | 'english_name'
    | 'hindi_name'
    | 'hinglish_name'
    | 'brand_abbreviation'
    | 'spoken_variation'
    | 'restaurant_term'
    | 'singular'
    | 'plural';
  language: 'en' | 'hi' | 'hi-en';
  confidence: number;
}

export interface AliasGenerationInput {
  productName: string;
  category?: string;
  brand?: string;
  existingAliases?: string[];
}

export interface AliasGenerationResult {
  productName: string;
  voiceAliases: AliasSuggestion[];
  searchAliases: AliasSuggestion[];
  /** Suggested aliases in both buckets merged + de-duplicated. */
  allAliases: string[];
}

// ====================================================================
// SELF-LEARNING
// ====================================================================

/** A manual correction captured from the confirmation flow. */
export interface LearnRequest {
  restaurantId: string;
  /** What the merchant/employee actually said. */
  spokenName: string;
  /** The product the merchant chose instead. */
  productId: string;
  /** Where the correction came from. */
  source: 'confirmation_override' | 'product_picker' | 'admin_edit';
}

export interface LearnedAlias {
  alias: string;
  source: 'transcript' | 'correction' | 'ai_generated';
  usageCount: number;
  lastUsed: Date;
}

// ====================================================================
// CONFIDENCE ENGINE
// ====================================================================

/** Confidence band → action mapping. */
export type ConfidenceLevel = 'auto_select' | 'confirm' | 'product_picker' | 'new_product_suggestion' | 'unresolved';

export interface ConfidenceDecision {
  level: ConfidenceLevel;
  /** 0..1 combined score. */
  score: number;
  thresholdApplied: ConfidenceLevel;
}

// ====================================================================
// SEMANTIC MATCHER
// ====================================================================

export interface SemanticMatchRequest {
  transcript: string;
  spokenName: string;
  restaurantId: string;
  candidates: Array<{ id: string; name: string; category: string; unit: string }>;
}

export interface SemanticMatchCandidate {
  productId: string;
  productName: string;
  confidence: number;
  reason?: string;
}

// ====================================================================
// NEW PRODUCT DETECTION
// ====================================================================

/** AI-validated suggestion for a brand-new product. */
export interface NewProductSuggestion {
  type: 'NEW_PRODUCT_SUGGESTION';
  productName: string;
  confidence: number;
  isLikelyRealProduct: boolean;
  /** Reasons the AI classified this as a valid product. */
  validationReason: string;
  primaryCategory?: string;
  subcategory?: string;
  inventoryUnit?: string;
  purchaseUnit?: string;
  salesUnit?: string;
  gstCategory?: string;
  storageType?: string;
  /** Suggested aliases to seed the new product with. */
  suggestedVoiceAliases: string[];
  suggestedSearchAliases: string[];
  /** True when the predicted category does not yet exist in this restaurant. */
  categoryNeedsCreation: boolean;
  /** Existing categories in the restaurant (so the UI can show a picker). */
  existingCategories: string[];
}

// ====================================================================
// CONVERSATIONAL ASSISTANT TYPES — Multi-turn voice conversation
// ====================================================================

/** What the merchant still needs to provide to complete the action. */
export type MissingFieldType =
  | 'product_variant'
  | 'quantity'
  | 'unit'
  | 'intent'
  | 'product_name'
  | 'purchase_price'
  | 'confirmation';

export interface MissingField {
  type: MissingFieldType;
  /** Human-readable prompt for the missing field. */
  question: string;
  /** Optional suggestions for quick replies. */
  suggestions?: string[];
}

/** A product variant ambiguity — multiple sizes/packagings exist. */
export interface AmbiguityInfo {
  /** The spoken name that was ambiguous. */
  spokenName: string;
  /** Candidate products the merchant could mean. */
  variants: Array<{
    productId: string;
    productName: string;
    unit: string;
    category: string;
    currentStock?: number;
    /** Confidence that this variant matches the intent. */
    confidence: number;
  }>;
}

/** A single turn in the conversation history. */
export interface ConversationTurn {
  role: 'merchant' | 'assistant' | 'system';
  message: string;
  timestamp: Date;
  /** Structured data extracted from this turn (if merchant). */
  parsed?: VoiceParseOutput;
  /** Product resolution result from this turn (if merchant). */
  resolution?: ProductResolutionResult;
}

/** The ongoing multi-turn conversation state. */
export interface ConversationState {
  /** Unique conversation ID. */
  conversationId: string;
  restaurantId: string;
  employeeId?: string;
  employeeName?: string;
  /** Current active intent being resolved. */
  intent?: VoiceIntent;
  /** The partially-resolved product (may have variants pending). */
  activeProduct?: {
    spokenName: string;
    resolution?: ProductResolutionResult;
    chosenVariant?: { productId: string; productName: string; unit: string };
  };
  /** Fields the merchant still needs to provide. */
  missingFields: MissingField[];
  /** Product ambiguity waiting for disambiguation. */
  pendingAmbiguity?: AmbiguityInfo;
  /** Partially collected quantity (may be filled across turns). */
  pendingQuantity?: number;
  pendingUnit?: string;
  /** Purchase price tracking (for "bought X for Y rupees"). */
  pendingPurchasePrice?: number;
  /** Supplier/vendor named during the conversation (for inventory_add). */
  pendingSupplier?: string;
  /** Purchase date captured during the conversation (YYYY-MM-DD). */
  pendingDate?: string;
  /** Brand named during the conversation (for inventory_add, e.g. "Amul"). */
  pendingBrand?: string;
  /** Expiry date captured during the conversation (YYYY-MM-DD). */
  pendingExpiryDate?: string;
  /** Turn history (last 20 turns max). */
  turnHistory: ConversationTurn[];
  /** When the conversation started. */
  startedAt: Date;
  /** When the conversation was last active. */
  lastActiveAt: Date;
  /** Whether the conversation has been completed/executed. */
  completed: boolean;
  /** The final action taken, if completed. */
  finalAction?: 'confirmed' | 'cancelled' | 'expired';
  /** Latency tracking. */
  totalLatencyMs: number;
}

/** The response sent to the frontend for conversational flows. */
export interface ConversationResponse {
  success: boolean;
  conversationId: string;
  /** The assistant's natural language message. */
  message: string;
  /** Type of response: 'question' | 'confirmation' | 'result' | 'error'. */
  responseType: 'question' | 'confirmation' | 'result' | 'error';
  /** Structured missing fields (if responseType = 'question'). */
  missingFields?: MissingField[];
  /** Product ambiguity choices (if responseType = 'question'). */
  ambiguityInfo?: AmbiguityInfo;
  /** Action recommended to the merchant. */
  suggestedAction?: 'confirm' | 'edit' | 'cancel' | 'provide_info' | 'select_variant';
  /** The product resolution result, if available. */
  resolution?: ProductResolutionResult;
  /** The new product suggestion, if applicable. */
  newProductSuggestion?: NewProductSuggestion;
  /** Audit log ID for the conversation (when action taken). */
  auditLogId?: string;
  /** Full turn history for the frontend to render. */
  turns?: ConversationTurn[];
  latencyMs: number;
}

// ====================================================================
// VOICE ANALYTICS TYPES
// ====================================================================

export interface VoiceAnalyticsSummary {
  /** Total voice interactions. */
  totalInteractions: number;
  /** Interactions in the current period. */
  periodInteractions: number;
  /** Average confidence across all resolutions. */
  averageConfidence: number;
  /** Resolution method distribution. */
  resolutionMethods: Record<string, number>;
  /** Most-spoken products (top 20). */
  topProducts: Array<{ productName: string; count: number; productId?: string }>;
  /** Most-used aliases (top 20). */
  topAliases: Array<{ alias: string; count: number }>;
  /** Frequently corrected products (top 20). */
  frequentlyCorrected: Array<{ productName: string; correctionCount: number }>;
  /** Failed recognitions count. */
  failedRecognitions: number;
  /** Average voice processing time. */
  averageLatencyMs: number;
  /** Intent distribution. */
  intentDistribution: Record<string, number>;
  /** Language distribution. */
  languageDistribution: Record<string, number>;
  /** Period being reported. */
  period: { from?: Date; to?: Date };
}


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Inventory Controller — Handles all voice inventory API requests.
 *
 * Pipeline per request:
 *   1. Validate input (Zod)
 *   2. Parse transcript via AI (AIParser)
 *   3. Resolve aliases (AliasResolver)
 *   4. Validate business rules (InventoryValidator)
 *   5. Build confirmation request (ConfirmationService)
 *   6. Log to audit trail (AuditLogger)
 *   7. Return confirmation to frontend
 *
 * Confirmed actions:
 *   8. Update inventory (InventoryService)
 *   9. Update audit log status
 *
 * The LLM NEVER directly modifies the database.
 * All writes go through the validated InventoryService.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { parseTranscript } from '../services/AIParser';
import { resolveAlias, resolveProductViaEngine } from '../services/AliasResolver';
import { validateInventoryAction } from '../services/InventoryValidator';
import {
  assessRiskLevel,
  findMissingFields,
  isSafeToExecute,
  buildConfirmationRequest,
} from '../services/ConfirmationService';
import {
  recordVoiceAction,
  updateConfirmationStatus,
  buildParsedJson,
} from '../services/AuditLogger';
import { updateInventory } from '../services/InventoryService';
import { transcribeAudio, getSTTConfig } from '../services/SpeechService';
import { aiConfig } from '../../ai/config';
import ItemAlias from '../models/ItemAlias';
import VoiceAuditLog from '../models/VoiceAuditLog';
import Product from '../../../models/Product';
import { generateAndApplyAliases } from '../services/AliasGeneratorService';
import { learnFromCorrection } from '../services/SelfLearningService';
import { detectNewProduct } from '../services/NewProductDetectionService';
import type { ParsedItem, VoiceInventoryResponse, ConfirmationRequest } from '../types';

// ====================================================================
// POST /api/voice-inventory/transcribe
// ====================================================================

/**
 * Transcribe a base64 audio clip to text using the configured STT provider
 * (Groq Whisper by default when AI_PROVIDER=custom + AI_BASE_URL points at Groq).
 *
 * Request body:
 *   { audio: string (base64), audioMimeType?: string, language?: 'en' | 'hi' | 'hi-en' }
 *
 * Response:
 *   { success, transcript, confidence, latencyMs }
 */
export async function transcribeVoiceAudio(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { audio, audioMimeType = 'audio/webm', language = 'hi-en' } = req.body;

  try {
    if (!audio || typeof audio !== 'string' || audio.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Audio (base64) is required',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    // Decode base64 → Buffer → Blob for the STT provider
    const buffer = Buffer.from(audio, 'base64');
    const audioBlob = new Blob([new Uint8Array(buffer)], { type: audioMimeType });

    console.log(
      `[VoiceInventory] Audio file received: ${Math.round(buffer.length / 1024)} KB, ` +
      `mime=${audioMimeType}, language=${language}, sttProvider=${getSTTConfig().provider}`
    );

    const result = await transcribeAudio(audioBlob, { language });
    const totalLatency = Date.now() - startTime;

    if (!result.transcript) {
      console.warn('[VoiceInventory] Transcribe returned empty transcript', result.error);
      res.json({
        success: false,
        error: result.error?.message || 'No speech detected in audio',
        transcript: '',
        confidence: 0,
        latencyMs: totalLatency,
        // Diagnostic details — the real Groq error, not the generic message
        diagnostics: result.error || null,
      });
      return;
    }

    console.log(
      `[VoiceInventory] Transcribed in ${totalLatency}ms: "${result.transcript.slice(0, 60)}" (conf=${result.confidence})`
    );

    res.json({
      success: true,
      transcript: result.transcript,
      confidence: result.confidence,
      language,
      latencyMs: totalLatency,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Transcribe error:', error.message, error?.stack || '');
    res.status(500).json({
      success: false,
      error: error?.message || 'Audio transcription failed',
      latencyMs: Date.now() - startTime,
      diagnostics: error
        ? {
            message: error.message,
            status: error.status,
            stack: error.stack,
            requestUrl: error.requestUrl,
            model: error.model,
            endpointMethod: error.endpointMethod,
            responseBody: error.responseBody,
          }
        : null,
    });
  }
}

// ====================================================================
// POST /api/voice-inventory/parse
// ====================================================================

/**
 * Parse a voice transcript into a structured inventory action.
 *
 * Request body:
 *   { transcript: string, language?: string, items?: Array }
 *
 * Response:
 *   { success, transcript, parsed, confirmation, suggestions, latencyMs }
 */
export async function parseVoiceCommand(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { transcript, language = 'hi-en', items: inventoryContext } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const employeeName = authReq.user?.name || 'Unknown';
  const employeeId = authReq.user?.userId || '';
  const ipAddress = req.ip;

  try {
    // Step 1: Parse via AI
    const parsed = await parseTranscript(transcript, {
      language,
      inventoryContext: inventoryContext || [],
    });

    const llmLantency = Date.now() - startTime;

    // Step 2: Resolve aliases for each item
    const resolvedItems: ParsedItem[] = [];
    for (const item of parsed.items) {
      const aliasMatch = await resolveAlias(restaurantId, item.item);
      // LOG: alias match for each spoken item
      console.log(
        `[VoiceInventory] Alias match: "${item.item}" → "${aliasMatch.canonicalName}" (unit=${aliasMatch.unit}, conf=${aliasMatch.confidence})`
      );
      resolvedItems.push({
        ...item,
        canonicalName: aliasMatch.canonicalName,
        unit: aliasMatch.unit || item.unit,
      });
    }
    parsed.items = resolvedItems;

    // Step 3: Validate against business rules
    const validation = await validateInventoryAction(
      { restaurantId, employeeId },
      parsed.items
    );

    // Step 4: Find missing fields
    const missingFields = findMissingFields(transcript, parsed.items, parsed.intent);

    // Step 5: Assess risk and build confirmation
    const riskLevel = assessRiskLevel(parsed.confidence, missingFields);
    const safeToExecute = isSafeToExecute(parsed.confidence, missingFields);

    // Step 6: Build confirmation request for the frontend
    const availableItems = inventoryContext?.map((i: any) => i.name) || [];
    const confirmation: ConfirmationRequest | undefined = safeToExecute
      ? undefined
      : buildConfirmationRequest(
          transcript,
          parsed.intent,
          parsed.items,
          parsed.confidence,
          availableItems
        );

    // Step 7: Log to audit trail
    const auditResult = await recordVoiceAction({
      restaurantId,
      employeeId,
      employeeName,
      intent: parsed.intent,
      transcript,
      parsedJson: buildParsedJson(parsed),
      confidence: parsed.confidence,
      source: 'voice',
      items: parsed.items,
      latencyMs: Date.now() - startTime,
      ipAddress,
    });

    const totalLatency = Date.now() - startTime;

    // Build response
    const response: VoiceInventoryResponse = {
      success: true,
      auditLogId: auditResult.logId || undefined,
      transcript,
      parsed: {
        ...parsed,
        items: resolvedItems,
      },
      missingFields: missingFields.length > 0 ? missingFields : undefined,
      suggestions: confirmation?.suggestions,
      confirmation: !safeToExecute ? confirmation : undefined,
      latencyMs: totalLatency,
    };

    console.log(
      `[VoiceInventory] Parsed "${transcript.slice(0, 60)}" → ` +
        `${parsed.intent} (${parsed.items.length} items, ` +
        `confidence=${parsed.confidence}, ` +
        `latency=${totalLatency}ms, ` +
        `audit=${auditResult.logId.slice(-8)})`
    );

    res.json(response);
  } catch (error: any) {
    console.error('[VoiceInventory] Parse error:', error.message);

    const totalLatency = Date.now() - startTime;
    res.status(500).json({
      success: false,
      error: 'Voice command parsing failed',
      latencyMs: totalLatency,
    } as VoiceInventoryResponse);
  }
}

// ====================================================================
// POST /api/voice-inventory/confirm
// ====================================================================

/**
 * Confirm (or edit/cancel) a previously parsed voice action.
 * Only on "confirm" does the inventory actually get updated.
 */
export async function confirmVoiceAction(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { logId, action, editedItems, clarification } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const employeeName = authReq.user?.name || 'Unknown';
  const employeeId = authReq.user?.userId || '';

  try {
    // Find the audit log entry
    const log = await VoiceAuditLog.findById(logId);
    if (!log) {
      res.status(404).json({
        success: false,
        error: 'Voice action log not found',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    switch (action) {
      case 'confirm': {
        // Update inventory
        const updateResult = await updateInventory({
          restaurantId,
          operation: log.intent as any,
          items: (editedItems || log.items || []).map((item: any) => ({
            itemName: item.name || item.canonicalName || item.item,
            quantity: item.quantity,
            unit: item.unit || 'pcs',
          })),
          performedBy: employeeId,
          performedByName: employeeName,
          source: 'voice',
          auditLogId: logId,
        });

        // Update audit log status
        await updateConfirmationStatus(logId, 'confirmed', editedItems);

        const totalLatency = Date.now() - startTime;
        console.log(
          `[VoiceInventory] Confirmed: ${log.intent} (${updateResult.totalChanges} items, ${totalLatency}ms)`
        );

        res.json({
          success: updateResult.success,
          data: {
            operation: log.intent,
            updatedItems: updateResult.updatedItems,
            totalChanges: updateResult.totalChanges,
          },
          errors: updateResult.errors.length > 0 ? updateResult.errors : undefined,
          latencyMs: totalLatency,
        });
        break;
      }

      case 'edit': {
        // Log the edit and return a new confirmation
        await updateConfirmationStatus(logId, 'clarified', editedItems, clarification);

        // Re-parse with edited items
        const newParsed = await parseTranscript(
          clarification || log.transcript,
          {
            language: 'hi-en',
            inventoryContext: editedItems?.map((i: any) => ({
              name: i.name || i.item,
              unit: i.unit,
            })),
          }
        );

        res.json({
          success: true,
          data: {
            message: 'Voice command edited — please confirm again',
            parsed: newParsed,
          },
          latencyMs: Date.now() - startTime,
        });
        break;
      }

      case 'cancel': {
        await updateConfirmationStatus(logId, 'rejected');
        console.log(`[VoiceInventory] Cancelled: ${log.intent}`);

        res.json({
          success: true,
          data: { message: 'Voice action cancelled' },
          latencyMs: Date.now() - startTime,
        });
        break;
      }

      case 'clarify': {
        await updateConfirmationStatus(logId, 'clarified', undefined, clarification);

        // Re-parse with clarification context
        const clarifiedText = `${log.transcript}. ${clarification || ''}`;
        const reParsed = await parseTranscript(clarifiedText);

        res.json({
          success: true,
          data: {
            message: 'Clarification received — please review updated parse',
            parsed: reParsed,
          },
          latencyMs: Date.now() - startTime,
        });
        break;
      }

      default:
        res.status(400).json({
          success: false,
          error: `Unknown action: ${action}`,
          latencyMs: Date.now() - startTime,
        });
    }
  } catch (error: any) {
    console.error('[VoiceInventory] Confirm error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Voice action confirmation failed',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// CRUD: Item Aliases
// ====================================================================

/**
 * GET /api/voice-inventory/aliases
 * List all alias entries for the current restaurant.
 */
export async function listAliases(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';

  try {
    const aliases = await ItemAlias.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isActive: true,
    })
      .select('canonicalName aliases unit')
      .sort({ canonicalName: 1 })
      .lean();

    res.json({ success: true, data: aliases, count: aliases.length });
  } catch (error: any) {
    console.error('[VoiceInventory] List aliases error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list aliases' });
  }
}

/**
 * POST /api/voice-inventory/aliases
 * Create a new alias entry.
 */
export async function createAlias(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { canonicalName, aliases, unit } = req.body;

  try {
    const existing = await ItemAlias.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      canonicalName,
    });

    if (existing) {
      // Update existing
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      existing.unit = unit || existing.unit;
      existing.updatedBy = authReq.user?.name;
      await existing.save();

      res.json({ success: true, data: existing, message: 'Aliases updated' });
    } else {
      const newAlias = new ItemAlias({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        canonicalName,
        aliases,
        unit: unit || 'pcs',
        createdBy: authReq.user?.name || 'Unknown',
      });
      await newAlias.save();

      res
        .status(201)
        .json({ success: true, data: newAlias, message: 'Alias created' });
    }
  } catch (error: any) {
    console.error('[VoiceInventory] Create alias error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create alias' });
  }
}

/**
 * PUT /api/voice-inventory/aliases/:id
 * Update an alias entry.
 */
export async function updateAlias(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  const { aliases, unit, isActive } = req.body;

  try {
    const update: any = { updatedBy: (req as AuthenticatedRequest).user?.name };
    if (aliases) update.aliases = aliases;
    if (unit) update.unit = unit;
    if (isActive !== undefined) update.isActive = isActive;

    const updated = await ItemAlias.findByIdAndUpdate(id, { $set: update }, { new: true });

    if (!updated) {
      res.status(404).json({ success: false, error: 'Alias not found' });
      return;
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[VoiceInventory] Update alias error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update alias' });
  }
}

/**
 * DELETE /api/voice-inventory/aliases/:id
 * Soft-delete an alias entry.
 */
export async function deleteAlias(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;

  try {
    const deleted = await ItemAlias.findByIdAndUpdate(
      id,
      { $set: { isActive: false, updatedBy: (req as AuthenticatedRequest).user?.name } },
      { new: true }
    );

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Alias not found' });
      return;
    }

    res.json({ success: true, message: 'Alias deleted' });
  } catch (error: any) {
    console.error('[VoiceInventory] Delete alias error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete alias' });
  }
}

// ====================================================================
// POST /api/voice-inventory/aliases/bulk
// ====================================================================

/**
 * Bulk create/update aliases.
 */
export async function bulkCreateAliases(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { aliases } = req.body;

  try {
    // 1. Fetch existing aliases in a single query
    const canonicalNames = aliases.map((a: any) => a.canonicalName);
    const existingDocs = await ItemAlias.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      canonicalName: { $in: canonicalNames },
    }).lean();
    const existingMap = new Map(existingDocs.map((d: any) => [d.canonicalName, d]));

    // 2. Build bulkWrite operations — one round-trip for all creates/updates
    const bulkOps: any[] = [];
    const results: { canonicalName: string; status: string }[] = [];
    const now = new Date();
    const rId = new mongoose.Types.ObjectId(restaurantId);
    const updatedBy = authReq.user?.name || 'Unknown';

    for (const alias of aliases) {
      const existing = existingMap.get(alias.canonicalName);
      if (existing) {
        const mergedAliases = [...new Set([...(existing.aliases || []), ...(alias.aliases || [])])];
        bulkOps.push({
          updateOne: {
            filter: { _id: existing._id },
            update: {
              $set: {
                aliases: mergedAliases,
                unit: alias.unit || existing.unit || 'pcs',
                updatedBy,
                updatedAt: now,
              },
            },
          },
        });
        results.push({ canonicalName: alias.canonicalName, status: 'updated' });
      } else {
        bulkOps.push({
          insertOne: {
            document: {
              restaurantId: rId,
              canonicalName: alias.canonicalName,
              aliases: alias.aliases || [],
              unit: alias.unit || 'pcs',
              createdBy: updatedBy,
              updatedBy,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
        results.push({ canonicalName: alias.canonicalName, status: 'created' });
      }
    }

    // 3. Execute all operations in a single bulkWrite
    if (bulkOps.length > 0) {
      await ItemAlias.bulkWrite(bulkOps);
    }

    res.json({
      success: true,
      data: results,
      message: `Processed ${results.length} aliases in 1 batch (${bulkOps.length} operations)`,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Bulk alias error:', error.message);
    res
      .status(500)
      .json({ success: false, error: 'Failed to process bulk aliases' });
  }
}

// ====================================================================
// GET /api/voice-inventory/history
// ====================================================================

/**
 * Query voice action history.
 */
export async function getVoiceHistory(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { limit = 20, offset = 0, intent, status, from, to } = req.query;

  try {
    const filter: any = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
    };
    if (intent) filter.intent = intent;
    if (status) filter.confirmationStatus = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from as string);
      if (to) filter.createdAt.$lte = new Date(to as string);
    }

    const [logs, total] = await Promise.all([
      VoiceAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(offset))
        .limit(Number(limit))
        .select(
          'transcript intent confidence confirmationStatus items latencyMs createdAt'
        )
        .lean(),
      VoiceAuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: logs,
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error: any) {
    console.error('[VoiceInventory] History error:', error.message);
    res
      .status(500)
      .json({ success: false, error: 'Failed to fetch voice history' });
  }
}

// ====================================================================
// POST /api/voice-inventory/resolve
// ====================================================================

/**
 * Resolve a spoken item name through the full Product Resolution Engine.
 * Returns the 8-stage pipeline trace with confidence tiers per stage.
 */
export async function resolveSpokenProduct(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { transcript } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';

  try {
    const result = await resolveProductViaEngine(transcript, restaurantId);

    // Log to audit
    await recordVoiceAction({
      restaurantId,
      employeeId: authReq.user?.userId || '',
      employeeName: authReq.user?.name || 'Unknown',
      intent: 'inventory_add',
      transcript,
      parsedJson: { resolution: result } as any,
      confidence: result.confidence,
      source: 'voice',
      items: result.product
        ? [{ item: result.product.name, quantity: 0, unit: result.product.unit }]
        : [],
      latencyMs: Date.now() - startTime,
    });

    res.json({
      success: true,
      data: result,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Resolve error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Product resolution failed',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// POST /api/voice-inventory/learn
// ====================================================================

/**
 * Record a manual correction for self-learning.
 * Call this when the merchant selects a different product than the one
 * the system auto-selected.
 */
export async function learnCorrection(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { spokenName, productId, source } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';

  try {
    const success = await learnFromCorrection({
      restaurantId,
      spokenName,
      productId,
      source: source || 'confirmation_override',
    });

    res.json({
      success,
      message: success ? 'Learned from correction' : 'Learning failed',
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Learn error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Learning failed',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// POST /api/voice-inventory/generate-aliases
// ====================================================================

/**
 * On-demand AI alias generation for a product.
 * Used from the Admin UI "Regenerate aliases" button.
 */
export async function generateProductAliases(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { productId, productName, category, brand, existingAliases } = req.body;

  try {
    const result = await generateAndApplyAliases(productId, {
      productName,
      category,
      brand,
      existingAliases,
    });

    res.json({
      success: !!result,
      data: result,
      message: result
        ? `Generated ${result.allAliases.length} aliases`
        : 'Alias generation failed',
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Generate aliases error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Alias generation failed',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// POST /api/voice-inventory/suggest-product
// ====================================================================

/**
 * AI-powered new product suggestion.
 * Called when the resolution engine cannot match a spoken item.
 * Returns enriched product data for the merchant to approve.
 */
export async function suggestNewProduct(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { spokenName, transcript, existingCategories } = req.body;

  try {
    const suggestion = await detectNewProduct(
      spokenName,
      transcript,
      existingCategories
    );

    res.json({
      success: true,
      data: suggestion,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Suggest product error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Product suggestion failed',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// GET /api/voice-inventory/product-aliases
// ====================================================================

/**
 * List voice/search aliases for products (used by Admin UI).
 * Returns products with their voiceAliases, searchAliases, and learnedAliases.
 */
export async function listProductAliases(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { search, page = 1, limit = 50 } = req.query;

  try {
    const filter: any = { isDeleted: { $ne: true } };
    if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
      filter.$or = [
        { restaurantId: new mongoose.Types.ObjectId(restaurantId) },
        { restaurantId: null },
      ];
    }
    if (search) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { name: { $regex: search, $options: 'i' } },
        { voiceAliases: { $regex: search, $options: 'i' } },
        { searchAliases: { $regex: search, $options: 'i' } }
      );
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('name code category unit voiceAliases searchAliases learnedAliases aliasUsageCount lastUsedAlias')
        .sort({ name: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: products,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error: any) {
    console.error('[VoiceInventory] List product aliases error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list product aliases' });
  }
}

// ====================================================================
// PUT /api/voice-inventory/product-aliases/:id
// ====================================================================

/**
 * Update a product's aliases (used by Admin UI).
 * Lets merchants edit, approve, or delete aliases.
 */
export async function updateProductAliases(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  const { voiceAliases, searchAliases, learnedAliases } = req.body;

  try {
    const update: any = {};
    if (voiceAliases !== undefined) update.voiceAliases = voiceAliases;
    if (searchAliases !== undefined) update.searchAliases = searchAliases;

    // Allow merchants to approve a learned alias (move it to voiceAliases)
    if (learnedAliases !== undefined) {
      const product = await Product.findById(id);
      if (product) {
        const approved = learnedAliases.filter((l: any) => l.approved);
        const toPromote = approved.map((l: any) => l.alias).filter(Boolean);
        update.$push = { voiceAliases: { $each: toPromote } };
        update.learnedAliases = learnedAliases.filter((l: any) => !l.approved).map((l: any) => ({
          alias: l.alias,
          source: l.source || 'ai_generated',
          usageCount: l.usageCount || 0,
          lastUsed: l.lastUsed ? new Date(l.lastUsed) : new Date(),
        }));
      }
    }

    const product = await Product.findByIdAndUpdate(id, update, { new: true })
      .select('name code category unit voiceAliases searchAliases learnedAliases')
      .lean();

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    res.json({ success: true, data: product });
  } catch (error: any) {
    console.error('[VoiceInventory] Update product aliases error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update product aliases' });
  }
}

// ====================================================================
// POST /api/voice-inventory/converse — Conversational multi-turn voice command
// ====================================================================

/**
 * Process a conversational voice turn.
 * Maintains context across multiple turns (conversationId).
 * Supports multi-turn flow: parse → resolve → disambiguate → confirm → execute.
 */
import { converse } from '../services/ConversationManager';
import { getAnalytics } from '../services/AnalyticsService';

export async function handleConverse(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { transcript, conversationId, language = 'hi-en', skipLLM = false } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const employeeId = authReq.user?.userId;
  const employeeName = authReq.user?.name;

  try {
    const response = await converse({
      restaurantId,
      employeeId,
      employeeName,
      transcript,
      language,
      conversationId,
      skipLLM,
    });

    response.latencyMs = Date.now() - startTime;

    if (!response.success) {
      res.status(400).json(response);
      return;
    }

    res.json(response);
  } catch (error: any) {
    console.error('[VoiceInventory] Converse error:', error.message);
    res.status(500).json({
      success: false,
      conversationId: conversationId || '',
      message: 'Voice conversation processing failed',
      responseType: 'error',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// GET /api/voice-inventory/analytics — Voice analytics & monitoring
// ====================================================================

/**
 * Get voice analytics for the restaurant.
 * Returns resolution method distribution, confidence trends, top products, etc.
 */
export async function handleAnalytics(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { from, to } = req.query;

  try {
    const period: any = {};
    if (from) period.from = new Date(from as string);
    if (to) period.to = new Date(to as string);

    const analytics = await getAnalytics(restaurantId, Object.keys(period).length > 0 ? period : undefined);

    res.json({
      success: true,
      data: analytics,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Analytics error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// POST /api/voice-inventory/products/new — Create a product from voice suggestion
// ====================================================================

/**
 * Approve a new product suggestion from voice.
 * Creates the product, generates aliases, and optionally creates a new category.
 */
export async function createProductFromVoice(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const { productName, category, unit, price, code, voiceAliases, searchAliases } = req.body;

  try {
    if (!productName || !category) {
      res.status(400).json({
        success: false,
        error: 'productName and category are required',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    // Generate SKU
    const sku = code || `${category.substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    // Create product
    const product = new Product({
      name: productName,
      code: sku,
      price: price || 0,
      category,
      unit: unit || 'pcs',
      gstPercent: 5,
      currentStock: 0,
      minStock: 0,
      maxStock: 1000,
      availability: true,
      restaurantId: restaurantId ? new mongoose.Types.ObjectId(restaurantId) : undefined,
      voiceAliases: voiceAliases || [],
      searchAliases: searchAliases || [],
    });

    await product.save();

    // Generate aliases asynchronously (don't wait)
    if (voiceAliases === undefined || voiceAliases.length === 0) {
      generateAndApplyAliases(product._id.toString(), {
        productName,
        category,
      }).catch((err) => console.warn('[VoiceInventory] Alias generation after create failed:', err.message));
    }

    console.log(`[VoiceInventory] Created product from voice: "${productName}" (${sku})`);

    res.status(201).json({
      success: true,
      data: product,
      message: `Product "${productName}" created successfully`,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Create product from voice error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      latencyMs: Date.now() - startTime,
    });
  }
}

// ====================================================================
// GET /api/voice-inventory/status
// ====================================================================

/**
 * Get voice inventory module status.
 */
export async function getStatus(
  _req: Request,
  res: Response
): Promise<void> {
  const stt = getSTTConfig();
  res.json({
    enabled: true,
    version: '1.0.0',
    sttProvider: stt.provider,
    sttModel: stt.model || 'default',
    llmProvider: process.env.AI_PROVIDER || 'not configured',
    llmModel: aiConfig.model || 'default',
    languages: ['en', 'hi', 'hi-en'],
    intents: [
      'inventory_add',
      'inventory_remove',
      'inventory_adjust',
      'inventory_waste',
      'purchase_reminder',
      'supplier_update',
      'unknown',
    ],
    features: [
      'multilingual_parse',
      'alias_resolution',
      'confidence_scoring',
      'confirmation_flow',
      'audit_logging',
      'item_alias_management',
      'product_resolution_engine',
      'ai_alias_generation',
      'self_learning',
      'new_product_detection',
    ],
  });
}

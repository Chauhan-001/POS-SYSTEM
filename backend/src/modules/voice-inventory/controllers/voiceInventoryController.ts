/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Inventory Controller — Handles all voice inventory API requests.
 *
 * Pipeline per request:
 *   1. Validate input (Zod)
 *   2. Parse transcript via the deterministic keyword/rule parser (VoiceParser)
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
 * AI execution was removed in Phase 3 — parsing is fully deterministic.
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
import { updateInventory, undoInventory } from '../services/InventoryService';
import { issuePendingAction, consumePendingAction, rejectPendingAction, verifyPendingAction } from '../services/PendingActionService';
import ItemAlias from '../models/ItemAlias';
import VoiceAuditLog from '../models/VoiceAuditLog';
import Product from '../../../models/Product';
import { learnFromCorrection } from '../services/SelfLearningService';
import type { ParsedItem, VoiceInventoryResponse, ConfirmationRequest } from '../types';

/**
 * Sanitize a spoken purchase rate: finite, positive, capped at ₹1,000,000.
 * Returns undefined when no usable rate was spoken.
 */
function safeRate(rate: unknown): number | undefined {
  const n = Number(rate);
  if (!isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.round(n * 100) / 100, 1_000_000);
}

/**
 * Deterministic alias seeding for a product (Phase 3 — replaces the LLM
 * AliasGeneratorService). Derives simple multilingual aliases from the name:
 * trimmed name, singular/plural variants, and Hinglish/Devanagari names for
 * well-known kitchen items. Same alias-shape the LLM path produced, fully
 * offline, so the deterministic voice resolution stages keep working.
 */
function buildDeterministicAliases(productName: string, category?: string): string[] {
  const name = String(productName || '').trim();
  if (!name) return [];

  const aliases = new Set<string>();
  const lower = name.toLowerCase();

  // Name itself + simple singular/plural variants.
  aliases.add(name);
  if (lower.endsWith('s') && lower.length > 3) aliases.add(name.slice(0, -1));
  else aliases.add(`${name}s`);

  // Category as a search helper ("Dairy — Fresh Milk").
  if (category && category.trim() && category.trim().toLowerCase() !== lower) {
    aliases.add(category.trim());
  }

  // Well-known Hinglish/Devanagari kitchen-item mappings (same spirit as the
  // old LLM fallback — deterministic, offline, conservative).
  const HINGLISH_MAP: Record<string, string[]> = {
    'milk': ['doodh', 'dudh', 'दूध'],
    'flour': ['atta', 'aata', 'आटा'],
    'rice': ['chawal', 'चावल'],
    'oil': ['tel', 'तेल'],
    'paneer': ['पनीर'],
    'butter': ['makkhan', 'मक्खन'],
    'ghee': ['घी'],
    'yogurt': ['dahi', 'दही'],
    'curd': ['dahi', 'दही'],
    'potato': ['aloo', 'आलू'],
    'onion': ['pyaaz', 'प्याज'],
    'tomato': ['tamatar', 'टमाटर'],
    'sugar': ['chini', 'cheeni', 'चीनी'],
    'salt': ['namak', 'नमक'],
    'egg': ['anda', 'अंडा'],
    'chicken': ['murghi', 'चिकन'],
    'lentils': ['daal', 'दाल'],
    'chickpeas': ['chana', 'चना'],
    'spices': ['masala', 'मसाला'],
  };

  // Direct mapping on the full name...
  for (const mapped of HINGLISH_MAP[lower] || []) aliases.add(mapped);
  // ...and on any individual word ("Fresh Milk" → "doodh").
  for (const word of lower.split(/[\s-]+/)) {
    for (const mapped of HINGLISH_MAP[word] || []) aliases.add(mapped);
  }

  return [...aliases].filter((a) => a.length >= 2).slice(0, 20);
}

// PHASE 3: the LLM semantic (stage-8) registration was removed together with
// the AI module. The deterministic resolution pipeline simply skips stage 8.

// ====================================================================
// POST /api/voice-inventory/transcribe — REMOVED (Phase 3)
// ====================================================================
// Server-side STT (Groq Whisper et al.) was AI-only execution and has been
// removed together with SpeechService/SttUsageService. Voice input continues
// via the browser's SpeechRecognition API, which posts plain transcripts to
// /parse (deterministic keyword/rule parser).


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
    // Names of items without a spoken rate — resolved in ONE batched query so
    // the product's average rate per unit can be filled in afterwards.
    const avgLookupNames: string[] = [];

    for (const item of parsed.items) {
      const aliasMatch = await resolveAlias(restaurantId, item.item, { inventoryOnly: true });
      // LOG: alias match for each spoken item
      console.log(
        `[VoiceInventory] Alias match: "${item.item}" → "${aliasMatch.canonicalName}" (unit=${aliasMatch.unit}, conf=${aliasMatch.confidence})`
      );

      // Ambiguity surfacing — never silently resolve a spoken item the engine
      // could not confidently map to a real inventory product.
      const ambiguous = aliasMatch.confidence < 0.6;
      const candidates = (inventoryContext || []).filter((inv: any) => {
        const spoken = (item.item || '').toLowerCase();
        const invName = String(inv?.name || '').toLowerCase();
        return (
          spoken &&
          (invName.includes(spoken) || spoken.includes(invName) || invName.includes((aliasMatch.canonicalName || '').toLowerCase()))
        );
      });

      // Product not found: confidence is low AND no partial candidates exist.
      // The frontend should offer a "Create Product" button with pre-filled data.
      const productNotFound = ambiguous && candidates.length === 0;

      // Unit precedence: what the speaker actually said is authoritative —
      // "5 kg aloo" stays kg even when the catalog stores Potato in pcs (the
      // spoken unit is the ground truth for a purchase). Only when NO unit was
      // spoken do we fall back to the resolved product's configured unit, so
      // "2 aloo" still books kg for a kg-catalog item.
      const spokeUnit = item.unit || 'pcs';
      const resolvedUnit =
        spokeUnit !== 'pcs'
          ? spokeUnit
          : aliasMatch.confidence >= 0.6 && aliasMatch.unit
            ? aliasMatch.unit
            : 'pcs';

      // When no rate was spoken, remember the resolved name so we can fill the
      // product's average rate per unit afterwards (batched, one query only).
      if (
        item.rate == null &&
        aliasMatch.confidence >= 0.6 &&
        aliasMatch.canonicalName
      ) {
        avgLookupNames.push(aliasMatch.canonicalName);
      }

      resolvedItems.push({
        ...item,
        canonicalName: ambiguous ? undefined : aliasMatch.canonicalName,
        unit: resolvedUnit,
        resolutionConfidence: aliasMatch.confidence,
        ambiguous: ambiguous || undefined,
        candidates: ambiguous && candidates.length > 1 ? candidates.slice(0, 5) : undefined,
        productNotFound: productNotFound || undefined,
      });
    }

    // Batch average-rate-per-unit lookup: when the speaker did not state a
    // rate, the product's averageCost is the practical default — always from
    // the restaurant's OWN catalog (tenant-scoped), never from the client.
    const avgCostByCanonical = new Map<string, number>();
    if (avgLookupNames.length > 0 && restaurantId) {
      try {
        const products = await Product.find({
          name: { $in: avgLookupNames },
          type: 'inventory',
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          isDeleted: { $ne: true },
        })
          .select('name averageCost')
          .lean();
        for (const p of products as any[]) {
          const avg = Number((p as any).averageCost);
          if (isFinite(avg) && avg > 0) {
            avgCostByCanonical.set(
              String(p.name || '').toLowerCase(),
              Math.round(avg * 100) / 100
            );
          }
        }
      } catch (avgErr: any) {
        console.warn('[VoiceInventory] Average-cost lookup failed:', avgErr.message);
      }
    }

    // Final item shaping: a spoken rate always wins and is flagged as such;
    // otherwise the catalog average (if any) is surfaced as the default rate.
    parsed.items = resolvedItems.map((it) => {
      if (it.rate != null && it.rate > 0) {
        return { ...it, rateSource: 'spoken' as const };
      }
      const canonical = (it.canonicalName || it.item || '').toLowerCase();
      const avg = avgCostByCanonical.get(canonical);
      if (avg != null) {
        return { ...it, rate: avg, rateSource: 'average' as const };
      }
      return it;
    });

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

    // Step 7b: Issue a server-side pending action (mandatory confirmation).
    // Every inventory-mutating intent is staged here — the LLM/transcript NEVER
    // writes directly. Non-mutating intents (purchase_reminder, supplier_update,
    // unknown) do not need a confirm token.
    const MUTATING_INTENTS = new Set(['inventory_add', 'inventory_remove', 'inventory_adjust', 'inventory_waste']);
    let pending: Awaited<ReturnType<typeof issuePendingAction>> | undefined;
    if (auditResult.success && MUTATING_INTENTS.has(parsed.intent) && parsed.items.length > 0) {
      try {
        pending = await issuePendingAction({
          restaurantId,
          branchId: authReq.user?.branchIds?.[0],
          employeeId,
          employeeName,
          auditLogId: auditResult.logId,
          intent: parsed.intent,
          items: parsed.items.map((it) => ({
            name: it.canonicalName || it.item || 'unnamed',
            quantity: it.quantity,
            unit: it.unit || 'pcs',
            productId: it.productId,
            rate: safeRate(it.rate),
          })),
          transcript,
        });
      } catch (pendingErr: any) {
        console.warn('[VoiceInventory] Failed to issue pending action:', pendingErr.message);
      }
    }

    const totalLatency = Date.now() - startTime;

    // Build response
    const response: VoiceInventoryResponse = {
      success: true,
      auditLogId: auditResult.logId || undefined,
      pendingActionId: pending?.pendingActionId,
      confirmationToken: pending?.confirmationToken,
      confirmationExpiresAt: pending?.expiresAt.toISOString(),
      transcript,
      parsed: {
        ...parsed,
        // `parsed.items` is the FINAL array (spoken-unit precedence + rate
        // backstop + average-cost fallback + rateSource) — never the raw
        // pre-mapping `resolvedItems`.
        items: parsed.items,
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
 *
 * SECURITY: when a pending action + confirmation token is supplied (the
 * production flow), the action is verified server-side — tenant-scoped,
 * single-use, un-expired, token-hash matched — BEFORE any write. The legacy
 * logId path remains for backwards compatibility with older clients.
 */
export async function confirmVoiceAction(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { logId, pendingActionId, confirmationToken, action, editedItems, clarification, date, supplier, brand, expiryDate } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const employeeName = authReq.user?.name || 'Unknown';
  const employeeId = authReq.user?.userId || '';

  try {
    let log: any = null;

    // ─── Authoritative path: pending action + one-time token ───────────
    if (pendingActionId && confirmationToken) {
      // Only the 'confirm' action consumes (flips) the token. Edit/cancel/
      // clarify verify it without consuming so the merchant can still
      // complete the confirmation afterwards.
      const verdict = action === 'confirm'
        ? await consumePendingAction(pendingActionId, confirmationToken, restaurantId)
        : await verifyPendingAction(pendingActionId, confirmationToken, restaurantId);

      if (!verdict.ok) {
        res.status(verdict.code === 'MISMATCHED_RESTAURANT' ? 403 : 410).json({
          success: false,
          error: verdict.message,
          code: verdict.code,
          latencyMs: Date.now() - startTime,
        });
        return;
      }
      log = verdict.action;
    } else {
      // ── Legacy path: audit-log id only ────────────────────────────────
      if (!logId) {
        res.status(400).json({
          success: false,
          error: 'Pending action (pendingActionId + confirmationToken) or logId is required',
          latencyMs: Date.now() - startTime,
        });
        return;
      }
      // Enforce tenant scoping even on the legacy path.
      // Only the pending-action flow uses status 'pending' — legacy records
      // from earlier parses are still matched by id + restaurant.
      const legacyLog = await VoiceAuditLog.findOne({
        _id: logId,
        restaurantId,
      });
      if (!legacyLog) {
        res.status(404).json({
          success: false,
          error: 'Voice action log not found',
          latencyMs: Date.now() - startTime,
        });
        return;
      }
      log = legacyLog;
    }

    const auditLogId = String(log.auditLogId || log._id);

    // Supplier/date captured at parse time live on the VoiceAuditLog's
    // parsedJson. The pending-action doc itself only links to that log, so
    // resolve them from whichever source the confirm path produced.
    let spokenSupplier: string | undefined;
    let spokenDate: string | undefined;
    let spokenBrand: string | undefined;
    let spokenExpiry: string | undefined;
    try {
      const meta: any = log?.parsedJson || null;
      const srcMeta: any =
        meta && (typeof meta.supplier === 'string' || typeof meta.date === 'string' || typeof meta.brand === 'string' || typeof meta.expiryDate === 'string')
          ? meta
          : log?.auditLogId
            ? (await VoiceAuditLog.findById(log.auditLogId).lean().catch(() => null))?.parsedJson || null
            : null;
      if (srcMeta) {
        if (typeof srcMeta.supplier === 'string' && srcMeta.supplier.trim()) spokenSupplier = srcMeta.supplier.trim().slice(0, 200);
        if (typeof srcMeta.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(srcMeta.date)) spokenDate = srcMeta.date;
        if (typeof srcMeta.brand === 'string' && srcMeta.brand.trim()) spokenBrand = srcMeta.brand.trim().slice(0, 200);
        if (typeof srcMeta.expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(srcMeta.expiryDate)) spokenExpiry = srcMeta.expiryDate;
      }
    } catch (metaErr) {
      console.warn('[VoiceInventory] Supplier/date/brand/expiry metadata read failed:', (metaErr as Error)?.message);
    }

    // The confirm panel lets the merchant correct a misheard spoken date — a
    // client-supplied date (strictly validated by the Zod schema) overrides
    // the parse-time one. An absent/invalid value keeps the spoken date.
    let confirmDate = spokenDate;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      confirmDate = date;
    }

    // Same for the supplier: an edited name wins over the parse-time one.
    // Empty string means the merchant cleared it → no supplier is recorded.
    let confirmSupplier = spokenSupplier;
    if (typeof supplier === 'string') {
      const s = supplier.trim().slice(0, 200);
      confirmSupplier = s || undefined;
    }

    // And the brand: an edited value wins over the parse-time one. Empty
    // string means no brand was mentioned → nothing is recorded.
    let confirmBrand = spokenBrand;
    if (typeof brand === 'string') {
      const b = brand.trim().slice(0, 200);
      confirmBrand = b || undefined;
    }

    // And the expiry date: a corrected value wins over the parse-time one.
    // Only a strictly valid YYYY-MM-DD is accepted; anything else keeps the
    // spoken value (or stays unset when none was mentioned).
    let confirmExpiry = spokenExpiry;
    if (typeof expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      confirmExpiry = expiryDate;
    }

    switch (action) {
      case 'confirm': {
        // Update inventory — only after token verification above.
        // Extract branchId from the pending action so new products are created
        // in the correct branch scope (not orphaned as branchless).
        const logBranchId = log?.branchId ? String(log.branchId) : undefined;
        const updateResult = await updateInventory({
          restaurantId,
          operation: log.intent as any,
          items: (editedItems || log.items || []).map((item: any) => ({
            itemName: item.name || item.canonicalName || item.item,
            quantity: item.quantity,
            unit: item.unit || 'pcs',
            purchaseRate: safeRate(item.rate ?? item.purchaseRate),
          })),
          performedBy: employeeId,
          performedByName: employeeName,
          branchId: logBranchId,
          source: 'voice',
          auditLogId,
          supplier: confirmSupplier,
          date: confirmDate,
          brand: confirmBrand,
          expiryDate: confirmExpiry,
        });

        // Update audit log status — store the AUTHORITATIVE applied stock
        // deltas (previousStock → newStock) so the voice undo flow can later
        // reverse this exact action.
        await updateConfirmationStatus(auditLogId, 'confirmed', editedItems, undefined, updateResult.updatedItems);

        // Persist corrected purchase date/supplier/brand/expiry back onto the
        // audit log's parsedJson so history/audit reads stay consistent with
        // what was actually recorded.
        if (
          (confirmDate && confirmDate !== spokenDate) ||
          (confirmSupplier !== spokenSupplier) ||
          (confirmBrand !== spokenBrand) ||
          (confirmExpiry !== spokenExpiry)
        ) {
          VoiceAuditLog.updateOne(
            { _id: auditLogId },
            {
              $set: {
                ...(confirmDate && confirmDate !== spokenDate ? { 'parsedJson.date': confirmDate } : {}),
                ...(confirmSupplier !== spokenSupplier ? { 'parsedJson.supplier': confirmSupplier || '' } : {}),
                ...(confirmBrand !== spokenBrand ? { 'parsedJson.brand': confirmBrand || '' } : {}),
                ...(confirmExpiry !== spokenExpiry ? { 'parsedJson.expiryDate': confirmExpiry || '' } : {}),
              },
            }
          ).catch((err) =>
            console.warn('[VoiceInventory] Confirm correction persist failed:', (err as Error)?.message)
          );
        }

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
        await updateConfirmationStatus(auditLogId, 'clarified', editedItems, clarification);

        // Re-parse with edited items
        const newParsed = await parseTranscript(
          clarification || log.transcript || log.transcriptPreview || '',
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
        await updateConfirmationStatus(auditLogId, 'rejected');
        // Mark the pending token consumed as rejected (best-effort).
        if (pendingActionId) {
          await rejectPendingAction(pendingActionId, restaurantId).catch(() => {});
        }
        console.log(`[VoiceInventory] Cancelled: ${log.intent}`);

        res.json({
          success: true,
          data: { message: 'Voice action cancelled' },
          latencyMs: Date.now() - startTime,
        });
        break;
      }

      case 'clarify': {
        await updateConfirmationStatus(auditLogId, 'clarified', undefined, clarification);

        // Re-parse with clarification context
        const clarifiedText = `${log.transcript || log.transcriptPreview || ''}. ${clarification || ''}`;
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
// POST /api/voice-inventory/undo
// ====================================================================

/**
 * Undo a previously CONFIRMED voice action.
 *
 * Reverses the inventory change recorded on the VoiceAuditLog (add → remove,
 * remove/waste → add back, adjust → restore previous stock). Safe guards:
 *   - tenant-scoped (log must belong to the authenticated restaurant)
 *   - only a 'confirmed' action can be undone
 *   - each action can be undone at most ONCE (undoStatus)
 *   - items whose stock has drifted since the action are skipped with a
 *     human-readable warning instead of corrupting the count
 */
export async function undoVoiceAction(
  req: Request,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const { logId } = req.body;
  const authReq = req as AuthenticatedRequest;
  const restaurantId = authReq.user?.restaurantId || '';
  const employeeName = authReq.user?.name || 'Unknown';
  const employeeId = authReq.user?.userId || '';

  try {
    if (!logId || !mongoose.Types.ObjectId.isValid(logId)) {
      res.status(400).json({
        success: false,
        error: 'A valid logId is required',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    const log = await VoiceAuditLog.findOne({
      _id: logId,
      restaurantId: restaurantId ? new mongoose.Types.ObjectId(restaurantId) : undefined,
    });

    if (!log) {
      res.status(404).json({
        success: false,
        error: 'Voice action not found',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    if (log.confirmationStatus !== 'confirmed') {
      res.status(400).json({
        success: false,
        error: 'Only confirmed voice actions can be undone',
        code: 'NOT_CONFIRMED',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    if ((log as any).undoStatus === 'undone') {
      res.status(400).json({
        success: false,
        error: 'This action has already been undone',
        code: 'ALREADY_UNDONE',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    if (!['inventory_add', 'inventory_remove', 'inventory_adjust', 'inventory_waste'].includes(log.intent)) {
      res.status(400).json({
        success: false,
        error: `"${log.intent}" actions cannot be undone`,
        code: 'NOT_UNDOABLE',
        latencyMs: Date.now() - startTime,
      });
      return;
    }

    const result = await undoInventory(
      log,
      restaurantId,
      employeeId,
      employeeName
    );

    // Mark the original log as undone (single-use guarantee) — regardless of
    // partial per-item errors, so a retry cannot double-reverse an item that
    // already reverted. undoLogId points at the append-only 'inventory_undo'
    // AuditLog record that documents the reversal.
    await VoiceAuditLog.updateOne(
      { _id: log._id },
      { $set: { undoStatus: 'undone', undoLogId: result.undoAuditLogId || '' } }
    );

    const totalLatency = Date.now() - startTime;
    console.log(
      `[VoiceInventory] Undo: ${log.intent} (${result.totalChanges} items reverted, ${totalLatency}ms)`
    );

    res.json({
      success: result.success,
      data: {
        operation: log.intent,
        updatedItems: result.updatedItems,
        totalChanges: result.totalChanges,
      },
      errors: result.errors.length > 0 ? result.errors : undefined,
      latencyMs: totalLatency,
    });
  } catch (error: any) {
    console.error('[VoiceInventory] Undo error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Voice action undo failed',
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
    const result = await resolveProductViaEngine(transcript, restaurantId, { inventoryOnly: true });

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
// POST /api/voice-inventory/generate-aliases — REMOVED (Phase 3)
// ====================================================================
// On-demand LLM alias generation was AI-only execution. Deterministic alias
// seeding (name + Hinglish mappings) runs automatically at product creation.

// ====================================================================
// POST /api/voice-inventory/suggest-product — REMOVED (Phase 3)
// ====================================================================
// LLM new-product suggestion was AI-only execution. Unmatched spoken names
// surface as UNKNOWN_OR_AMBIGUOUS from the deterministic resolution engine;
// the merchant creates products via POST /products/new.

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
    const filter: any = { isDeleted: { $ne: true }, type: 'inventory' };
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

    // Seed deterministic aliases when none were supplied (Phase 3: the LLM
    // alias generator was removed — deterministic mappings only).
    if (voiceAliases === undefined || voiceAliases.length === 0) {
      const seedAliases = buildDeterministicAliases(productName, category);
      const existing = new Set((product.voiceAliases || []).map((a: string) => a.toLowerCase()));
      const additions = seedAliases.filter((a) => !existing.has(a.toLowerCase()));
      if (additions.length > 0) {
        await Product.updateOne(
          { _id: product._id },
          { $push: { voiceAliases: { $each: additions }, searchAliases: { $each: additions } } }
        );
      }
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
 * Phase 3: STT/LLM provider reporting removed with the AI execution layer.
 */
export async function getStatus(
  _req: Request,
  res: Response
): Promise<void> {
  res.json({
    enabled: true,
    version: '1.2.0',
    parser: 'deterministic-keyword',
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
      'self_learning',
    ],
  });
}

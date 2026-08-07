/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuditLogger — Tracks all voice inventory actions.
 * Append-only audit trail — logs are never modified or deleted.
 *
 * Records:
 *   - Original transcript from the user
 *   - Parsed JSON from the LLM
 *   - Confidence score
 *   - Whether the action was confirmed, rejected, or needed clarification
 *   - Who performed the action
 *   - Which restaurant/branch
 *   - Latency for each pipeline stage
 *   - Error messages if any stage failed
 */

import mongoose from 'mongoose';
import VoiceAuditLog, { IVoiceAuditLog } from '../models/VoiceAuditLog';
import type {
  VoiceIntent,
  ParsedItem,
  VoiceParseOutput,
} from '../types';

// ====================================================================
// LOG ENTRY BUILDER
// ====================================================================

export interface AuditLogEntry {
  restaurantId: string;
  branchId?: string;
  employeeId?: string;
  employeeName: string;
  intent: VoiceIntent;
  transcript: string;
  parsedJson?: Record<string, unknown>;
  confidence: number;
  source: 'voice' | 'manual' | 'ai_suggested';
  items?: ParsedItem[];
  error?: string;
  latencyMs: number;
  ipAddress?: string;
  /** Enhanced: pipeline stage that produced the match */
  matchingMethod?: string;
  /** Enhanced: all candidates considered during resolution */
  pipelineCandidates?: Array<{
    productId: string;
    productName: string;
    stage: string;
    confidence: number;
  }>;
}

export interface AuditLogResult {
  logId: string;
  success: boolean;
  error?: string;
}

// ====================================================================
// SERVICE
// ====================================================================

/**
 * Record a voice inventory action in the audit log.
 *
 * @param entry - The audit log entry to record
 * @returns The log ID for reference in confirmation flow
 */
export async function recordVoiceAction(
  entry: AuditLogEntry
): Promise<AuditLogResult> {
  try {
    const log = new VoiceAuditLog({
      restaurantId: new mongoose.Types.ObjectId(entry.restaurantId),
      branchId: entry.branchId
        ? new mongoose.Types.ObjectId(entry.branchId)
        : undefined,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      intent: entry.intent,
      transcript: entry.transcript,
      parsedJson: (entry.parsedJson || {}) as Record<string, unknown>,
      confidence: entry.confidence,
      source: entry.source,
      confirmationStatus: 'pending',
      items: (entry.items || []).map((item) => ({
        name: item.item,
        quantity: item.quantity,
        unit: item.unit,
      })),
      matchingMethod: entry.matchingMethod,
      pipelineCandidates: entry.pipelineCandidates,
      error: entry.error,
      latencyMs: entry.latencyMs,
      ipAddress: entry.ipAddress,
    });

    const saved = await log.save();

    return {
      logId: saved._id.toString(),
      success: true,
    };
  } catch (error: any) {
    console.error('[VoiceAuditLogger] Failed to record action:', error.message);
    return {
      logId: '',
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update the confirmation status of a previously logged voice action.
 */
export async function updateConfirmationStatus(
  logId: string,
  status: 'confirmed' | 'rejected' | 'clarified',
  editedItems?: ParsedItem[],
  clarification?: string
): Promise<boolean> {
  try {
    const update: any = {
      confirmationStatus: status,
    };

    if (editedItems) {
      update.items = editedItems.map((item) => ({
        name: item.item,
        quantity: item.quantity,
        unit: item.unit,
      }));
    }

    await VoiceAuditLog.findByIdAndUpdate(logId, { $set: update });
    return true;
  } catch (error: any) {
    console.error(
      '[VoiceAuditLogger] Failed to update confirmation status:',
      error.message
    );
    return false;
  }
}

/**
 * Build a parsed JSON record from the voice parse output for audit logging.
 */
export function buildParsedJson(parsed: VoiceParseOutput): Record<string, unknown> {
  return {
    intent: parsed.intent,
    items: parsed.items.map((item) => ({
      item: item.item,
      quantity: item.quantity,
      unit: item.unit,
      canonicalName: item.canonicalName,
    })),
    confidence: parsed.confidence,
    language: parsed.language,
    error: parsed.error,
  } as Record<string, unknown>;
}

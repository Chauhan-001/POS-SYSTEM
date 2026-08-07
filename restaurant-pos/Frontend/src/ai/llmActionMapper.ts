/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LLM Action Mapper — Maps the backend /api/voice-inventory/parse response
 * (structured JSON from Groq Llama) into a frontend inventory action.
 *
 * Pipeline (production):
 *   Microphone → Groq Whisper → Transcript → /api/voice-inventory/parse
 *   → Groq Llama structured JSON → Alias Dictionary (backend resolveAlias)
 *   → canonicalName → Inventory mutation (exec)
 *
 * This module replaces the old rule-based parseCommand() for production
 * parsing. It NEVER guesses: if the LLM returned a null field or an
 * unknown intent, no action is produced and the caller is told why.
 */

import type { InventoryItem } from '../../components/inventory/types';

export type LlmIntent =
  | 'inventory_add'
  | 'inventory_remove'
  | 'inventory_adjust'
  | 'inventory_waste'
  | 'purchase_reminder'
  | 'supplier_update'
  | 'unknown';

export interface LlmParsedItem {
  item: string | null;
  quantity: number;
  unit?: string;
  canonicalName?: string;
}

export interface LlmParseResponse {
  success: boolean;
  auditLogId?: string;
  transcript?: string;
  parsed?: {
    intent: LlmIntent;
    items: LlmParsedItem[];
    confidence: number;
    language?: string;
    originalText: string;
  };
  missingFields?: string[];
  suggestions?: string[];
  error?: string;
  latencyMs: number;
}

export type ActionType =
  | 'add_stock'
  | 'log_waste'
  | 'remove_stock'
  | 'adjust_stock'
  | 'purchase_reminder'
  | 'supplier_update';

export interface ParsedAction {
  type: ActionType;
  summary: string;
  details: string;
  item?: string;
  qty?: number;
  unit?: string;
}

export interface LlmActionResult {
  action: ParsedAction;
  exec: (inv: {
    addStock: (name: string, qty: number) => void;
    removeStock: (name: string, qty: number) => void;
    addItem: (item: InventoryItem) => void;
    removeItem: (id: string) => void;
  }, notify?: (msg: string, type?: 'success' | 'warning' | 'info') => void) => void;
}

export interface LlmMappingLog {
  transcript: string;
  intent: LlmIntent;
  confidence: number;
  llmItems: LlmParsedItem[];
  aliasMatches: Array<{ spoken: string | null; canonical: string; unit?: string }>;
  finalAction: string;
}

/** Log the full mapping chain for auditability (requirement: log transcript → LLM JSON → alias → final action). */
export function logLlmMapping(log: LlmMappingLog): void {
  console.log('[LlmMapper] Transcript:', JSON.stringify(log.transcript));
  console.log('[LlmMapper] Intent:', log.intent, '| confidence:', log.confidence);
  console.log('[LlmMapper] LLM JSON items:', JSON.stringify(log.llmItems));
  console.log('[LlmMapper] Alias matches:', JSON.stringify(log.aliasMatches));
  console.log('[LlmMapper] Final action:', log.finalAction);
}

function findItemByName(items: InventoryItem[], name: string | null | undefined): InventoryItem | undefined {
  if (!name) return undefined;
  return items.find(i => i.name.toLowerCase() === name.toLowerCase());
}

/**
 * Map a backend /api/voice-inventory/parse response to an inventory action.
 *
 * Returns null when the intent is unknown, items are missing, or an essential
 * field is null — never guesses.
 */
export function mapLlmAction(
  response: LlmParseResponse,
  inventoryItems: InventoryItem[]
): LlmActionResult | null {
  if (!response.success || !response.parsed) {
    console.warn('[LlmMapper] Parse failed:', response.error);
    return null;
  }

  const { intent, items, confidence, originalText } = response.parsed;
  const transcript = originalText || response.transcript || '';

  // Intent unknown → cannot act.
  if (intent === 'unknown' || items.length === 0) {
    logLlmMapping({
      transcript,
      intent,
      confidence,
      llmItems: items,
      aliasMatches: [],
      finalAction: 'none (unknown intent / no items)',
    });
    return null;
  }

  const aliasMatches: LlmMappingLog['aliasMatches'] = [];

  const first = items[0];
  const canonical = first.canonicalName || first.item;

  if (!canonical) {
    logLlmMapping({
      transcript,
      intent,
      confidence,
      llmItems: items,
      aliasMatches,
      finalAction: 'none (item field is null)',
    });
    return null;
  }

  const existing = findItemByName(inventoryItems, canonical);
  aliasMatches.push({ spoken: first.item, canonical, unit: first.unit || existing?.unit });

  const qty = first.quantity ?? 0;
  const unit = first.unit || existing?.unit || 'pcs';

  switch (intent) {
    case 'inventory_add': {
      if (qty <= 0) return null;
      if (existing) {
        const result: LlmActionResult = {
          action: {
            type: 'add_stock',
            summary: `Add ${qty}${unit} ${existing.name}`,
            details: `${qty} ${unit} of ${existing.name} (via LLM, conf ${Math.round(confidence * 100)}%)`,
            item: existing.name,
            qty,
            unit,
          },
          exec: (inv, notify) => {
            console.log('[LlmMapper] EXEC addStock', { item: existing.name, qty, unit, alias: canonical });
            inv.addStock(existing.name, qty);
            if (notify) notify(`Added ${qty} ${unit} ${existing.name}`, 'success');
          },
        };
        logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: result.action.summary });
        return result;
      }
      // New item suggestion (alias returned as-is with no inventory match)
      const newItem: InventoryItem = {
        id: `inv_llm_${Date.now()}`,
        name: canonical,
        category: 'Voice Added',
        image: '',
        unit: unit,
        currentStock: qty,
        minStock: 0,
        maxStock: qty * 2,
        averageCost: 0,
        supplier: 'Local Vendor',
        status: qty <= 0 ? 'critical' : 'low',
        lastUpdated: new Date().toISOString().slice(0, 10),
      };
      const resultNew: LlmActionResult = {
        action: {
          type: 'add_stock',
          summary: `Add ${qty}${unit} ${canonical} (new item)`,
          details: `New item "${canonical}" added with ${qty}${unit} stock`,
          item: canonical,
          qty,
          unit,
        },
        exec: (inv, notify) => {
          console.log('[LlmMapper] EXEC addItem', { item: canonical, qty, unit });
          inv.addItem(newItem);
          if (notify) notify(`Added new item ${canonical} with ${qty}${unit}`, 'success');
        },
      };
      logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: resultNew.action.summary });
      return resultNew;
    }

    case 'inventory_waste':
    case 'inventory_remove': {
      if (qty <= 0) return null;
      if (!existing) {
        logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: `none (item "${canonical}" not in inventory)` });
        return null;
      }
      const isWaste = intent === 'inventory_waste';
      const type: ActionType = isWaste ? 'log_waste' : 'remove_stock';
      const result: LlmActionResult = {
        action: {
          type,
          summary: isWaste
            ? `Log ${qty}${unit} ${existing.name} as waste`
            : `Remove ${qty}${unit} ${existing.name}`,
          details: `${qty} ${unit} ${existing.name} (via LLM, conf ${Math.round(confidence * 100)}%)`,
          item: existing.name,
          qty,
          unit,
        },
        exec: (inv, notify) => {
          console.log('[LlmMapper] EXEC removeStock', { item: existing.name, qty, unit, intent });
          inv.removeStock(existing.name, qty);
          if (notify) notify(isWaste ? `${qty} ${unit} ${existing.name} logged as waste` : `Removed ${qty} ${unit} ${existing.name}`, 'warning');
        },
      };
      logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: result.action.summary });
      return result;
    }

    case 'inventory_adjust': {
      if (qty < 0) return null;
      if (!existing) {
        logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: `none (item "${canonical}" not in inventory)` });
        return null;
      }
      const delta = qty - existing.currentStock;
      const result: LlmActionResult = {
        action: {
          type: 'adjust_stock',
          summary: `Set ${existing.name} to ${qty}${unit}`,
          details: `From ${existing.currentStock}${unit} to ${qty}${unit} (delta ${delta >= 0 ? '+' : ''}${delta}${unit})`,
          item: existing.name,
          qty,
          unit,
        },
        exec: (inv, notify) => {
          console.log('[LlmMapper] EXEC adjustStock', { item: existing.name, target: qty, current: existing.currentStock, delta });
          if (delta > 0) inv.addStock(existing.name, delta);
          else if (delta < 0) inv.removeStock(existing.name, -delta);
          if (notify) notify(`Adjusted ${existing.name} to ${qty}${unit}`, 'info');
        },
      };
      logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: result.action.summary });
      return result;
    }

    case 'purchase_reminder':
    case 'supplier_update': {
      const isReminder = intent === 'purchase_reminder';
      const actionType: ActionType = isReminder ? 'purchase_reminder' : 'supplier_update';
      const result: LlmActionResult = {
        action: {
          type: actionType,
          summary: isReminder ? `Order reminder: ${canonical}` : `Supplier update: ${canonical}`,
          details: `${transcript} (conf ${Math.round(confidence * 100)}%)`,
          item: canonical,
          qty,
          unit,
        },
        exec: (_inv, notify) => {
          console.log('[LlmMapper] EXEC noteOnly', { intent, item: canonical });
          if (notify) notify(isReminder ? `Reminder noted: order ${canonical}` : `Supplier update noted for ${canonical}`, 'info');
        },
      };
      logLlmMapping({ transcript, intent, confidence, llmItems: items, aliasMatches, finalAction: result.action.summary });
      return result;
    }

    default:
      return null;
  }
}

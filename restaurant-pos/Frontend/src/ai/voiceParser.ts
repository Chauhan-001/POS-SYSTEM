/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Parser — Parses natural language commands into inventory actions.
 * Supports: add_stock, log_waste, add_item, remove_item.
 * Extracted from VoicePage.tsx for testability.
 */

import type { InventoryItem } from '../../components/inventory/types';

export type ActionType = 'add_stock' | 'log_waste' | 'add_item' | 'remove_item';

export interface ParsedAction {
  type: ActionType;
  summary: string;
  details: string;
}

export interface ParseResult {
  action: ParsedAction & { item?: string; qty?: number; unit?: string };
  exec: (inv: {
    addStock: (name: string, qty: number) => void;
    removeStock: (name: string, qty: number) => void;
    addItem: (item: InventoryItem) => void;
    removeItem: (id: string) => void;
  }, notify?: (msg: string, type?: 'success' | 'warning' | 'info') => void) => void;
}

/**
 * Parse a natural language voice command into a structured inventory action.
 *
 * Supported formats:
 *   - "add 20L milk" / "add 20L milk at ₹56 from Amul Dairy"
 *   - "log 3 bread as expired" / "waste 2L milk spoiled"
 *   - "add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320, supplier Amul"
 *   - "remove Milk" / "delete Bread"
 *
 * Returns null if the command cannot be understood.
 */
export function parseCommand(text: string, items: InventoryItem[]): ParseResult | null {
  const lower = text.toLowerCase().trim();
  const itemByName = (name: string) => items.find(i => i.name.toLowerCase() === name.toLowerCase());

  // Add stock: "add 20L milk at ₹56 from Amul Dairy"
  let m = lower.match(/^add\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle)?\s+(.+?)(?:\s+at\s+₹?([\d.]+))?(?:\s+from\s+(.+))?$/i);
  if (m) {
    const qty = parseFloat(m[1]);
    const name = m[3].trim();
    const existing = itemByName(name);
    if (existing) {
      return {
        action: {
          type: 'add_stock',
          summary: `Add ${qty}${m[2] || existing.unit} ${existing.name}`,
          details: `${qty} ${existing.unit} of ${existing.name}${m[4] ? ` at ₹${m[4]}/${existing.unit}` : ''}${m[5] ? ` from ${m[5].trim()}` : ''}`,
          item: existing.name,
          qty,
          unit: existing.unit,
        },
        exec: (inv) => { inv.addStock(existing.name, qty); }
      };
    }
  }

  // Log waste: "log 2L milk as spoiled" or "waste 3 bread expired"
  m = lower.match(/(?:log|waste)\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle)?\s+(.+?)(?:\s+as\s+(spoiled|burnt|expired|dropped|other))?$/i);
  if (m) {
    const qty = parseFloat(m[1]);
    const name = m[3].trim();
    const reason = m[4] || 'spoiled';
    const existing = itemByName(name);
    if (existing) {
      return {
        action: {
          type: 'log_waste',
          summary: `Log ${qty}${m[2] || existing.unit} ${existing.name} as ${reason}`,
          details: `${qty} ${existing.unit} ${existing.name} — ${reason} (₹${Math.round(qty * existing.averageCost)} loss)`,
          item: existing.name,
          qty,
          unit: existing.unit,
        },
        exec: (inv, notify) => { inv.removeStock(existing.name, qty); if (notify) notify(`${qty} ${existing.unit} ${existing.name} logged as waste`, 'warning'); }
      };
    }
  }

  // Add item: "add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320, supplier Amul Dairy"
  m = lower.match(/^add\s+item\s+(.+?)(?:\s+in\s+(.+?))?(?:\s*,\s*stock\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle))?(?:\s*,\s*min\s+([\d.]+))?(?:\s*,\s*max\s+([\d.]+))?(?:\s*,\s*₹?([\d.]+))?(?:\s*,\s*supplier\s+(.+))?$/i);
  if (m) {
    const name = m[1].trim();
    if (itemByName(name)) return null;
    const category = m[2]?.trim() || 'Other';
    const stock = m[3] ? parseFloat(m[3]) : 0;
    const unit = m[4] || 'kg';
    const minStock = m[5] ? parseFloat(m[5]) : 5;
    const maxStock = m[6] ? parseFloat(m[6]) : 50;
    const cost = m[7] ? parseFloat(m[7]) : 0;
    const supplier = m[8]?.trim() || 'Local Vendor';
    const status: InventoryItem['status'] = stock <= 0 ? 'critical' : stock <= minStock ? 'low' : 'healthy';
    return {
      action: {
        type: 'add_item',
        summary: `Add new item: ${name}`,
        details: `${name} in ${category} · Stock: ${stock}${unit} · Min: ${minStock} · Max: ${maxStock} · ₹${cost}/${unit} · ${supplier}`,
        item: name,
        qty: stock,
        unit,
      },
      exec: (inv) => {
        inv.addItem({
          id: `inv_voice_${Date.now()}`,
          name,
          category,
          unit,
          image: '',
          currentStock: stock,
          minStock,
          maxStock,
          averageCost: cost,
          supplier,
          status,
          lastUpdated: new Date().toISOString().slice(0, 10),
        } as InventoryItem);
      }
    };
  }

  // Remove item: "remove Milk" or "delete Bread"
  m = lower.match(/(?:remove|delete)\s+(.+?)(?:\s+from\s+inventory)?$/i);
  if (m) {
    const name = m[1].trim();
    const existing = itemByName(name);
    if (existing) {
      return {
        action: {
          type: 'remove_item',
          summary: `Remove ${existing.name}`,
          details: `Delete "${existing.name}" (${existing.category}) — ${existing.currentStock} ${existing.unit} in stock`,
          item: existing.name,
          qty: existing.currentStock,
          unit: existing.unit,
        },
        exec: (inv) => { inv.removeItem(existing.id); }
      };
    }
  }

  return null;
}

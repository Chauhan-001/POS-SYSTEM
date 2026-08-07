/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for voiceParser — the natural language command parser
 * used by the VoicePage inventory component.
 *
 * Covers all 4 action types:
 *   - add_stock
 *   - log_waste
 *   - add_item
 *   - remove_item
 *
 * Also covers edge cases: unknown commands, empty input, case insensitivity,
 * duplicate name prevention for add_item, and item-not-found scenarios.
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from '../voiceParser';
import type { InventoryItem } from '../../../components/inventory/types';

// ─── Test Fixtures ──────────────────────────────────────────────────

const milk: InventoryItem = {
  id: 'item_milk',
  name: 'Milk',
  category: 'Dairy',
  unit: 'L',
  image: '',
  currentStock: 18,
  minStock: 20,
  maxStock: 50,
  averageCost: 56,
  supplier: 'Amul Dairy',
  status: 'low',
  lastUpdated: '2026-07-26',
};

const bread: InventoryItem = {
  id: 'item_bread',
  name: 'Bread',
  category: 'Bakery',
  unit: 'pcs',
  image: '',
  currentStock: 10,
  minStock: 5,
  maxStock: 40,
  averageCost: 35,
  supplier: 'Local Bakery',
  status: 'normal',
  lastUpdated: '2026-07-26',
};

const chicken: InventoryItem = {
  id: 'item_chicken',
  name: 'Chicken Breast',
  category: 'Meat',
  unit: 'kg',
  image: '',
  currentStock: 8,
  minStock: 5,
  maxStock: 20,
  averageCost: 220,
  supplier: 'Meat Wholesale',
  status: 'healthy',
  lastUpdated: '2026-07-26',
};

const items: InventoryItem[] = [milk, bread, chicken];

// ─── Helpers ────────────────────────────────────────────────────────

function createMockInventory() {
  let stock: Record<string, number> = { Milk: 18, Bread: 10, 'Chicken Breast': 8 };
  let removed: string[] = [];
  let added: InventoryItem[] = [];

  return {
    addStock: (name: string, qty: number) => { stock[name] = (stock[name] || 0) + qty; },
    removeStock: (name: string, qty: number) => { stock[name] = Math.max(0, (stock[name] || 0) - qty); },
    addItem: (item: InventoryItem) => { added.push(item); },
    removeItem: (id: string) => { removed.push(id); },
    _getStock: () => ({ ...stock }),
    _getAdded: () => [...added],
    _getRemoved: () => [...removed],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('voiceParser — parseCommand', () => {

  // ── add_stock ─────────────────────────────────────────────────────

  describe('add_stock', () => {
    it('parses "add 20L milk"', () => {
      const result = parseCommand('add 20L milk', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
      expect(result!.action.summary).toContain('20');
      expect(result!.action.summary).toContain('Milk');
    });

    it('parses "add 5kg chicken breast"', () => {
      const result = parseCommand('add 5kg chicken breast', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
      expect(result!.action.summary).toContain('Chicken Breast');
    });

    it('parses "add 3 pcs bread at ₹35"', () => {
      const result = parseCommand('add 3 pcs bread at ₹35', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
      expect(result!.action.details).toContain('at ₹35');
    });

    it('parses with supplier: "add 20L milk from Amul Dairy"', () => {
      const result = parseCommand('add 20L milk from Amul Dairy', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
      expect(result!.action.details).toMatch(/amul dairy/i);
    });

    it('executes addStock correctly', () => {
      const mock = createMockInventory();
      const result = parseCommand('add 5L milk', items);
      expect(result).not.toBeNull();
      result!.exec(mock);
      expect(mock._getStock().Milk).toBe(23); // 18 + 5
    });

    it('returns null for unknown item', () => {
      const result = parseCommand('add 10L orange juice', items);
      expect(result).toBeNull();
    });

    it('is case insensitive', () => {
      const result = parseCommand('ADD 10L MILK', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
      expect(result!.action.summary).toContain('Milk');
    });
  });

  // ── log_waste ─────────────────────────────────────────────────────

  describe('log_waste', () => {
    it('parses "log 2L milk as spoiled"', () => {
      const result = parseCommand('log 2L milk as spoiled', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('log_waste');
      expect(result!.action.summary).toContain('spoiled');
    });

    it('parses "waste 3 bread as expired"', () => {
      const result = parseCommand('waste 3 bread as expired', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('log_waste');
      expect(result!.action.summary).toContain('expired');
    });

    it('defaults reason to "spoiled" when not specified', () => {
      const result = parseCommand('log 1L milk', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('log_waste');
      expect(result!.action.summary).toContain('spoiled');
    });

    it('shows cost in details', () => {
      const result = parseCommand('log 2L milk as spoiled', items);
      expect(result).not.toBeNull();
      expect(result!.action.details).toMatch(/₹\d+/);
    });

    it('executes removeStock and calls notify', () => {
      const mock = createMockInventory();
      let notified = '';
      const result = parseCommand('log 2L milk as spoiled', items);
      expect(result).not.toBeNull();
      result!.exec(mock, (msg) => { notified = msg; });
      expect(mock._getStock().Milk).toBe(16); // 18 - 2
      expect(notified).toContain('logged as waste');
    });

    it('returns null for unknown item in waste', () => {
      const result = parseCommand('log 10L orange juice as spoiled', items);
      expect(result).toBeNull();
    });
  });

  // ── add_item ──────────────────────────────────────────────────────

  describe('add_item', () => {
    it('parses "add item Paneer in Dairy"', () => {
      const result = parseCommand('add item Paneer in Dairy', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_item');
      expect(result!.action.summary).toMatch(/Paneer/i);
    });

    it('parses full specification: "add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320, supplier Amul"', () => {
      const result = parseCommand('add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320, supplier Amul', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_item');
      expect(result!.action.details).toContain('5kg');
      expect(result!.action.details).toContain('Min: 2');
      expect(result!.action.details).toContain('Max: 10');
      expect(result!.action.details).toContain('₹320');
      expect(result!.action.details).toMatch(/amul/i);
    });

    it('returns null if item already exists', () => {
      const result = parseCommand('add item Milk in Dairy', items);
      expect(result).toBeNull();
    });

    it('executes addItem correctly', () => {
      const mock = createMockInventory();
      const result = parseCommand('add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320', items);
      expect(result).not.toBeNull();
      result!.exec(mock);
      expect(mock._getAdded().length).toBe(1);
      expect(mock._getAdded()[0].name).toMatch(/Paneer/i);
      expect(mock._getAdded()[0].currentStock).toBe(5);
    });
  });

  // ── remove_item ───────────────────────────────────────────────────

  describe('remove_item', () => {
    it('parses "remove Milk"', () => {
      const result = parseCommand('remove Milk', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('remove_item');
      expect(result!.action.summary).toContain('Milk');
    });

    it('parses "delete Bread"', () => {
      const result = parseCommand('delete Bread', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('remove_item');
      expect(result!.action.summary).toContain('Bread');
    });

    it('parses "remove Milk from inventory"', () => {
      const result = parseCommand('remove Milk from inventory', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('remove_item');
    });

    it('executes removeItem correctly', () => {
      const mock = createMockInventory();
      const result = parseCommand('remove Milk', items);
      expect(result).not.toBeNull();
      result!.exec(mock);
      expect(mock._getRemoved()).toContain('item_milk');
    });

    it('returns null for unknown item', () => {
      const result = parseCommand('remove Orange Juice', items);
      expect(result).toBeNull();
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns null for empty input', () => {
      expect(parseCommand('', items)).toBeNull();
      expect(parseCommand('   ', items)).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(parseCommand('asdfghjkl', items)).toBeNull();
      expect(parseCommand('!!!@@@###', items)).toBeNull();
    });

    it('returns null for unrecognized action prefix', () => {
      expect(parseCommand('fly 20L milk', items)).toBeNull();
      expect(parseCommand('cook 3 bread', items)).toBeNull();
    });

    it('handles extra whitespace', () => {
      const result = parseCommand('  add   10L   milk  ', items);
      expect(result).not.toBeNull();
      expect(result!.action.type).toBe('add_stock');
    });
  });
});

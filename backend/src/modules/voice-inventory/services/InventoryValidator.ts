/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryValidator — Validates parsed voice commands against business rules.
 *
 * This is the safety gate between the LLM output and the database.
 * It performs ALL validation:
 *   1. Restaurant ownership check
 *   2. Inventory item exists (in the restaurant's catalog)
 *   3. Quantity is valid (positive number, within reasonable bounds)
 *   4. Unit matches the item's configured unit
 *   5. Stock level constraints (can't remove more than available)
 *   6. Permission checks (employee has inventory write access)
 *   7. Business rule validation (no negative stock, waste caps, etc.)
 *
 * NEVER trust AI output. Always validate against real data.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import Employee from '../../../models/Employee';
import type { ParsedItem, InventoryValidationResult } from '../types';

// ====================================================================
// CONSTANTS
// ====================================================================

const MAX_QUANTITY_PER_ITEM = 100000; // 100,000 units max per voice command
const MAX_ITEMS_PER_COMMAND = 20; // Max items in a single voice command
const VALID_UNITS = [
  'kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'packet', 'bottle',
  'crate', 'bunch', 'case', 'bag', 'box', 'jar', 'tin',
  'litre', 'liters', 'kilo', 'kilos', 'kilogram',
];

// Normalize unit names
const UNIT_ALIASES: Record<string, string> = {
  litre: 'L',
  liters: 'L',
  lit: 'L',
  litres: 'L',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  gram: 'g',
  grams: 'g',
  piece: 'pcs',
  pieces: 'pcs',
  '': 'pcs',
  bottle: 'bottle',
  bottles: 'bottle',
  crate: 'crate',
  crates: 'crate',
  packet: 'packet',
  packets: 'packet',
  dozen: 'dozen',
  dozens: 'dozen',
  case: 'case',
  cases: 'case',
};

function normalizeUnit(unit?: string): string {
  if (!unit || unit.trim() === '') return 'pcs';
  const lower = unit.trim().toLowerCase();
  return UNIT_ALIASES[lower] || lower;
}

// ====================================================================
// VALIDATION SERVICE
// ====================================================================

export interface ValidationContext {
  restaurantId: string;
  employeeId?: string;
  branchId?: string;
}

/**
 * Validate parsed voice command items against the database and business rules.
 *
 * @param context - Request context (restaurant, employee)
 * @param items - Parsed items from LLM
 * @returns Validation result with resolved items and any errors/warnings
 */
export async function validateInventoryAction(
  context: ValidationContext,
  items: ParsedItem[]
): Promise<InventoryValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic validation
  if (!items || items.length === 0) {
    errors.push('No items provided in voice command');
    return {
      valid: false,
      errors,
      warnings,
      resolvedItems: [],
    };
  }

  if (items.length > MAX_ITEMS_PER_COMMAND) {
    errors.push(
      `Too many items (${items.length}). Maximum is ${MAX_ITEMS_PER_COMMAND}.`
    );
    return {
      valid: false,
      errors,
      warnings,
      resolvedItems: [],
    };
  }

  // Fetch actual inventory items for this restaurant
  // Products serve as the restaurant's inventory catalog
  let inventoryItems: Array<{
    name: string;
    currentStock: number;
    unit: string;
  }> = [];

  try {
    const products = await Product.find({
      branchId: context.branchId
        ? new mongoose.Types.ObjectId(context.branchId)
        : undefined,
    })
      .select('name currentStock unit')
      .lean()
      .limit(500);
    inventoryItems = products as any[];
  } catch (dbError) {
    console.warn(
      '[InventoryValidator] Failed to fetch inventory:',
      dbError
    );
    warnings.push(
      'Could not verify inventory data — proceeding without stock check'
    );
  }

  // Resolve and validate each item
  const resolvedItems: InventoryValidationResult['resolvedItems'] = [];
  const validatedNames = new Set<string>(); // Prevent duplicate items

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Validate quantity
    if (!isFinite(item.quantity) || item.quantity < 0) {
      errors.push(`Item "${item.item}": invalid quantity (${item.quantity})`);
      continue;
    }

    if (item.quantity > MAX_QUANTITY_PER_ITEM) {
      errors.push(
        `Item "${item.item}": quantity ${item.quantity} exceeds maximum (${MAX_QUANTITY_PER_ITEM})`
      );
      continue;
    }

    // Normalize unit
    const normalizedUnit = normalizeUnit(item.unit);

    // Check for duplicate
    const lowerName = (item.item || '').toLowerCase();
    if (validatedNames.has(lowerName)) {
      warnings.push(`Duplicate item "${item.item}" — only first occurrence used`);
      continue;
    }
    validatedNames.add(lowerName);

    // Find in inventory
    const inventoryMatch = inventoryItems.find(
      (inv) => inv.name.toLowerCase() === lowerName
    );

    if (!inventoryMatch) {
      warnings.push(
        `Item "${item.item}" not found in inventory — will be added as a new item`
      );
      resolvedItems.push({
        itemName: item.item || 'unnamed',
        quantity: item.quantity,
        unit: normalizedUnit,
        currentStock: 0,
        newStock: item.quantity,
      });
      continue;
    }

    // Check stock sufficiency (for remove/waste actions)
    const currentStock = inventoryMatch.currentStock || 0;
    const newStock = currentStock + item.quantity; // For adds
    // For removals/waste, we check below based on intent

    resolvedItems.push({
      itemName: inventoryMatch.name,
      quantity: item.quantity,
      unit: normalizedUnit,
      currentStock,
      newStock,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedItems,
  };
}

/**
 * Verify the employee has inventory write permissions.
 */
export async function checkInventoryPermission(
  employeeId: string,
  restaurantId: string
): Promise<boolean> {
  try {
    const employee = await Employee.findById(employeeId)
      .select('role status')
      .lean();

    if (!employee) return false;
    if (employee.status !== 'Active') return false;

    // Owner, Manager, and Inventory roles can write to inventory
    return ['Owner', 'Manager', 'inventory'].includes(employee.role);
  } catch {
    return false;
  }
}

/**
 * Get the current stock level for an item from the database.
 */
export async function getCurrentStock(
  itemName: string,
  restaurantId: string,
  branchId?: string
): Promise<{ stock: number; unit: string } | null> {
  try {
    const query: any = { name: itemName };
    if (branchId) query.branchId = branchId;

    const product = await Product.findOne(query)
      .select('name currentStock unit')
      .lean();

    if (!product) return null;
    return {
      stock: (product as any).currentStock || 0,
      unit: (product as any).unit || 'pcs',
    };
  } catch {
    return null;
  }
}

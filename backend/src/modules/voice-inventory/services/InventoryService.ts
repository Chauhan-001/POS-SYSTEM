/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryService — Performs inventory database operations.
 *
 * This is the ONLY service that writes to MongoDB.
 * It is called AFTER validation, confirmation, and audit logging.
 *
 * SECURITY:
 *   - NEVER accepts raw AI output — only validated, confirmed data
 *   - Uses MongoDB transactions when available
 *   - Always logs every inventory change
 *   - Never allows negative stock
 *   - Validates restaurant ownership for every operation
 *
 * The LLM NEVER has direct or indirect database access.
 * All LLM output must go through: Validator → Confirmation → Audit → InventoryService.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import Purchase from '../../../models/Purchase';
import InventoryEvent from '../../../models/InventoryEvent';
import AuditLog from '../../../models/AuditLog';
import { inventoryEventRepo } from '../../../repositories';
import type { ParsedItem } from '../types';

// ====================================================================
// INVENTORY OPERATION TYPES
// ====================================================================

export type InventoryOperation =
  | 'inventory_add'
  | 'inventory_remove'
  | 'inventory_adjust'
  | 'inventory_waste';

export interface InventoryUpdateRequest {
  restaurantId: string;
  operation: InventoryOperation;
  items: Array<{
    itemName: string;
    quantity: number;
    unit: string;
    /** Spoken purchase rate (₹/unit). Applied to averageCost on add. */
    purchaseRate?: number;
  }>;
  performedBy: string;
  performedByName: string;
  branchId?: string;
  source: 'voice' | 'manual' | 'ai_suggested';
  auditLogId?: string;
  /**
   * Supplier/vendor named in the spoken command ("... from Verka Dairy").
   * Only present when the merchant actually named one — recorded on the
   * purchase history so item history shows who supplied the stock.
   */
  supplier?: string;
  /**
   * Purchase date as YYYY-MM-DD (spoken or resolved). When absent, the
   * purchase record defaults to today's date.
   */
  date?: string;
  /**
   * Brand/variant named in the spoken command ("Amul brand butter"). Only
   * present when the merchant actually named one — recorded on the purchase
   * history so item history shows which brand came in.
   */
  brand?: string;
  /**
   * Expiry date of the incoming batch (YYYY-MM-DD). Only present when the
   * merchant explicitly mentioned an expiry — set on the product's current
   * batch and recorded on the purchase history.
   */
  expiryDate?: string;
}

export interface InventoryUpdateResult {
  success: boolean;
  updatedItems: Array<{
    itemName: string;
    previousStock: number;
    newStock: number;
    unit: string;
  }>;
  errors: string[];
  totalChanges: number;
  /** Audit-log id of the undo record (set only by undoInventory). */
  undoAuditLogId?: string;
}

// ====================================================================
// SERVICE IMPLEMENTATION
// ====================================================================

/**
 * Apply inventory updates to the database.
 * Uses MongoDB transaction if the replica set is available.
 *
 * @param request - Validated inventory update request
 * @returns Update result with stock changes
 */
export async function updateInventory(
  request: InventoryUpdateRequest
): Promise<InventoryUpdateResult> {
  const updatedItems: InventoryUpdateResult['updatedItems'] = [];
  const errors: string[] = [];
  const startTime = Date.now();

  // Determine if we can use a transaction.
  // MongoDB only allows transactions on a replica set or sharded cluster — a
  // standalone mongod rejects any command carrying a transaction number, but
  // the rejection surfaces at QUERY time (not at startTransaction()), so we
  // proactively check the server topology before using a session.
  let session: mongoose.ClientSession | null = null;
  let useTransaction = false;

  try {
    if (mongoose.connection.readyState === 1) {
      const topologyType = (
        mongoose.connection.getClient() as any
      )?.topology?.description?.type as string | undefined;
      const supportsTransactions =
        topologyType === 'Sharded' ||
        (typeof topologyType === 'string' &&
          topologyType.startsWith('ReplicaSet'));

      if (supportsTransactions) {
        session = await mongoose.startSession();
        session.startTransaction();
        useTransaction = true;
      } else {
        console.warn(
          '[InventoryService] Transactions not supported on this server — using atomic updates'
        );
      }
    }
  } catch {
    // Unexpected error while setting up the transaction. Discard the session
    // (it may be in a broken state) so the atomic-update fallback runs clean.
    useTransaction = false;
    if (session) {
      session
        .endSession()
        .catch(() => {});
      session = null;
    }
    console.warn(
      '[InventoryService] Transactions unavailable — using atomic updates'
    );
  }

  try {
    for (const item of request.items) {
      // Update the stock — always scoped to the authenticated restaurant so a
      // voice command can never touch another tenant's product with the same
      // name.
      const product = await Product.findOne({
        name: item.itemName,
        restaurantId: new mongoose.Types.ObjectId(request.restaurantId),
        isDeleted: { $ne: true },
        ...(request.branchId
          ? { branchId: new mongoose.Types.ObjectId(request.branchId) }
          : {}),
      }).session(session || null);

      if (!product) {
        // "Add stock for an item that doesn't exist yet" is a first-class
        // flow: the parse response surfaces it as a NEW-PRODUCT suggestion
        // (new_product_detection). Auto-create the catalog entry so the
        // confirm succeeds and the stock lands — matching what the frontend
        // mapper already proposes locally. Other operations (remove/waste/
        // adjust) genuinely cannot run against a missing item.
        if (request.operation === 'inventory_add') {
          const created = await Product.create([
            {
              name: item.itemName,
              code: `V${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
              category: 'Voice Added',
              // Raw materials added by voice are INVENTORY items (hidden from
              // the billing menu), not sellable menu items.
              availability: false,
              price: 0,
              currentStock: Math.max(0, item.quantity || 0),
              unit: item.unit || 'pcs',
              minStock: 0,
              maxStock: Math.max(item.quantity * 2 || 2, 2),
              restaurantId: new mongoose.Types.ObjectId(request.restaurantId),
              // A spoken rate on a brand-new item seeds its cost basis.
              ...(item.purchaseRate != null && item.purchaseRate > 0
                ? { averageCost: Math.round(item.purchaseRate * 100) / 100 }
                : {}),
              // A spoken expiry seeds the new item's batch expiry.
              ...(request.expiryDate ? { expiryDate: request.expiryDate } : {}),
              ...(request.branchId
                ? { branchId: new mongoose.Types.ObjectId(request.branchId) }
                : {}),
            },
          ], { session: session || null });
          console.log(
            `[InventoryService] Auto-created product "${item.itemName}" (stock ${item.quantity}${item.unit || 'pcs'}) via ${request.source}` +
            (item.purchaseRate != null ? ` @ ₹${item.purchaseRate}/${item.unit || 'pcs'}` : '')
          );
          // A voice "add" is a real stock-in — record it in the purchases feed
          // (when a rate or supplier was named) and the activity feed.
          await recordVoicePurchase({
            restaurantId: request.restaurantId,
            branchId: request.branchId,
            itemName: item.itemName,
            quantity: item.quantity,
            unit: item.unit || 'pcs',          rate: item.purchaseRate,
          supplier: request.supplier,
          date: request.date,
          brand: request.brand,
          expiryDate: request.expiryDate,
          source: request.source,
          auditLogId: request.auditLogId,
        });
          updatedItems.push({
            itemName: item.itemName,
            previousStock: 0,
            newStock: item.quantity,
            unit: item.unit || 'pcs',
          });
          continue;
        }
        // Item doesn't exist as a Product — cannot remove/waste/adjust it.
        errors.push(
          `Item "${item.itemName}" not found in catalog — could not ${request.operation === 'inventory_remove' ? 'remove stock' : request.operation === 'inventory_waste' ? 'log waste' : 'adjust stock'}. Add it first, or speak an "add" command.`
        );
        continue;
      }

      const previousStock = (product as any).currentStock || 0;
      let newStock = previousStock;

      switch (request.operation) {
        case 'inventory_add':
          newStock = previousStock + item.quantity;
          break;
        case 'inventory_remove':
        case 'inventory_waste':
          newStock = Math.max(0, previousStock - item.quantity);
          if (newStock === 0 && previousStock > 0) {
            console.warn(
              `[InventoryService] Stock depleted for "${item.itemName}"`
            );
          }
          break;
        case 'inventory_adjust':
          newStock = Math.max(0, item.quantity); // Set to exact quantity
          break;
      }

      // Apply the update. When a purchase rate is spoken on an ADD, blend it
      // into the weighted average cost (existing stock at old avg + new qty at
      // the spoken rate) so per-purchase rates stay accurate over time.
      const setFields: Record<string, unknown> = {
        ...((product as any).currentStock !== undefined
          ? { currentStock: newStock }
          : {}),
      };

      if (
        request.operation === 'inventory_add' &&
        item.purchaseRate != null &&
        item.purchaseRate > 0
      ) {
        const oldAvg = Number((product as any).averageCost) || 0;
        const oldQty = Math.max(0, previousStock);
        const incoming = Math.max(0, item.quantity);
        const newAvg =
          oldQty + incoming > 0
            ? (oldAvg * oldQty + item.purchaseRate * incoming) /
              (oldQty + incoming)
            : item.purchaseRate;
        setFields.averageCost = Math.round(newAvg * 100) / 100;
      }

      // An incoming batch with a stated expiry updates the product's current
      // batch expiry (the newest stock in sets the batch that's on the shelf).
      if (request.operation === 'inventory_add' && request.expiryDate) {
        setFields.expiryDate = request.expiryDate;
      }

      await Product.updateOne(
        { _id: product._id },
        { $set: setFields }
      ).session(session || null);

      // Voice adds become purchase-history rows (with the named supplier and
      // date) + activity-feed events so the item history is complete.
      if (request.operation === 'inventory_add') {
        await recordVoicePurchase({
          restaurantId: request.restaurantId,
          branchId: request.branchId,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit || 'pcs',
          rate: item.purchaseRate,
          supplier: request.supplier,
          date: request.date,
          brand: request.brand,
          expiryDate: request.expiryDate,
          source: request.source,
          auditLogId: request.auditLogId,
        });
      }

      updatedItems.push({
        itemName: item.itemName,
        previousStock,
        newStock,
        unit: item.unit,
      });
    }

    // Commit transaction if active
    if (useTransaction && session) {
      await session.commitTransaction();
    }

    // Log the audit trail (outside transaction for resilience)
    try {
      await logInventoryAction(request, updatedItems, errors);
    } catch (auditError) {
      console.error('[InventoryService] Audit logging failed:', auditError);
      // Non-fatal — don't roll back the inventory change
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[InventoryService] ${request.operation}: ${updatedItems.length} items updated in ${elapsed}ms`
    );

    return {
      success: errors.length === 0,
      updatedItems,
      errors,
      totalChanges: updatedItems.length,
    };
  } catch (error: any) {
    // Rollback transaction if active
    if (useTransaction && session) {
      try {
        await session.abortTransaction();
      } catch (rollbackError) {
        console.error(
          '[InventoryService] Transaction rollback failed:',
          rollbackError
        );
      }
    }

    console.error('[InventoryService] Update failed:', error.message);
    return {
      success: false,
      updatedItems: [],
      errors: [`Inventory update failed: ${error.message}`],
      totalChanges: 0,
    };
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // Silently ignore session cleanup errors
      }
    }
  }
}

/**
 * Log the inventory action to the audit trail.
 * Records who did what, when, and from which source.
 */async function logInventoryAction(
  request: InventoryUpdateRequest,
  updatedItems: InventoryUpdateResult['updatedItems'],
  errors: string[]
): Promise<void> {
  const auditEntry = new AuditLog({
    action: `inventory_${request.operation}`,
    entityType: 'Inventory',
    performedBy: request.performedByName,
    performedById: request.performedBy,
    branchId: request.branchId
      ? new mongoose.Types.ObjectId(request.branchId)
      : undefined,
    details: {
      operation: request.operation,
      source: request.source,
      items: updatedItems.map((i) => ({
        item: i.itemName,
        previousStock: i.previousStock,
        newStock: i.newStock,
        unit: i.unit,
      })),
      errors: errors.length > 0 ? errors : undefined,
      auditLogId: request.auditLogId,
    },
    ipAddress: undefined, // Set by controller if available
  });

  await auditEntry.save();
}

// ====================================================================
// VOICE PURCHASE RECORDING
// ====================================================================

/**
 * Record a voice "add stock" as a purchase-history row + activity event.
 *
 * The stock change itself is applied by updateInventory above — this ONLY
 * persists the accompanying history (never re-applies a stock movement, so
 * there is no double-count). Two rules:
 *   - A Purchase document is created when a rate OR a supplier was named
 *     (a purchase with no price and no vendor adds no information).
 *   - An InventoryEvent of type 'purchase' is always created so the item
 *     history + Activity feed reflect the add; the timeline dedupes these
 *     against the purchases feed.
 * Date defaults to today when the merchant didn't name one.
 */
async function recordVoicePurchase(opts: {
  restaurantId: string;
  branchId?: string;
  itemName: string;
  quantity: number;
  unit: string;
  rate?: number;
  supplier?: string;
  date?: string;
  brand?: string;
  expiryDate?: string;
  source: string;
  /** VoiceAuditLog id that produced this add — lets the voice undo remove
   *  exactly the purchase/event rows this action created. */
  auditLogId?: string;
}): Promise<void> {
  const supplier =
    typeof opts.supplier === 'string' && opts.supplier.trim()
      ? opts.supplier.trim().slice(0, 200)
      : '';
  const brand =
    typeof opts.brand === 'string' && opts.brand.trim()
      ? opts.brand.trim().slice(0, 200)
      : '';
  const expiryDate =
    typeof opts.expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.expiryDate)
      ? opts.expiryDate
      : '';
  const hasRate = opts.rate != null && opts.rate > 0;
  const date =
    typeof opts.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
      ? opts.date
      : new Date().toISOString().slice(0, 10);
  const rId = new mongoose.Types.ObjectId(opts.restaurantId);
  const bId =
    opts.branchId && mongoose.Types.ObjectId.isValid(opts.branchId)
      ? new mongoose.Types.ObjectId(opts.branchId)
      : undefined;
  // Tag rows with the owning voice action so an undo can remove exactly them.
  const tag = opts.auditLogId ? `Voice:${opts.auditLogId}` : 'Added via voice';

  // Activity event — every voice add lands in the feed/item history. A
  // supplier/brand that was never mentioned is simply omitted (never "Voice").
  try {
    await inventoryEventRepo.create({
      restaurantId: rId,
      branchId: bId,
      type: 'purchase',
      item: opts.itemName,
      quantity: Math.max(0, opts.quantity),
      unit: opts.unit || 'pcs',
      operator: opts.source === 'voice' ? 'Voice' : 'System',
      details: `Stock in on ${date}${supplier ? ` from ${supplier}` : ''}${brand ? ` (${brand})` : ''}${expiryDate ? `, expires ${expiryDate}` : ''}`,
      eventDate: date,
      refId: opts.auditLogId,
    } as any);
  } catch (eventErr: any) {
    console.warn('[InventoryService] Voice purchase event failed (non-fatal):', eventErr.message);
  }

  // Purchase row — only when a rate, supplier, brand, OR expiry was named.
  // The supplier stays EMPTY when none was mentioned (no fabricated "Voice").
  if (!hasRate && !supplier && !brand && !expiryDate) return;
  try {
    const price = hasRate ? Math.round(opts.rate! * 100) / 100 : 0;
    const qty = Math.max(0, opts.quantity);
    const created = await Purchase.create([{
      restaurantId: rId,
      branchId: bId,
      supplier,
      brand,
      expiryDate,
      item: opts.itemName,
      quantity: qty,
      unit: opts.unit || 'pcs',
      price,
      total: Math.round(qty * price * 100) / 100,
      date,
      status: 'completed',
      notes: tag,
    }]);
    console.log(
      `[InventoryService] Voice add recorded as purchase: ${opts.itemName} x${qty}${opts.unit || 'pcs'}` +
      `${supplier ? ` from ${supplier}` : ''}${brand ? ` (${brand})` : ''}${expiryDate ? ` (exp ${expiryDate})` : ''} on ${date} (id=${(created[0] as any)?._id})`
    );
  } catch (purchaseErr: any) {
    console.warn('[InventoryService] Voice purchase record failed (non-fatal):', purchaseErr.message);
  }
}

// ====================================================================
// UNDO (REVERSE A CONFIRMED VOICE ACTION)
// ====================================================================

/**
 * Reverse a previously CONFIRMED voice inventory action.
 *
 * Undo semantics (driven by the authoritative previousStock captured at
 * confirm time):
 *   - inventory_add     → restore previousStock (subtract the added qty)
 *   - inventory_remove  → add the removed qty back
 *   - inventory_waste   → add the wasted qty back
 *   - inventory_adjust  → restore the exact previousStock
 *
 * Safety:
 *   - Tenant-scoped: the log must belong to the calling restaurant.
 *   - Only a CONFIRMED action can be undone, and only ONCE (undoStatus).
 *   - Before reversing an item we verify the product's CURRENT stock matches
 *     the stock the confirmed action produced — if someone changed the stock
 *     since, we skip that item with a human-readable warning instead of
 *     corrupting the count.
 *   - The undo itself is audit-logged (append-only) and linked to the original
 *     log via undoLogId.
 */
export async function undoInventory(
  log: any,
  restaurantId: string,
  performedBy: string,
  performedByName: string,
  source: 'voice' = 'voice'
): Promise<InventoryUpdateResult> {
  const updatedItems: InventoryUpdateResult['updatedItems'] = [];
  const errors: string[] = [];
  const startTime = Date.now();
  const items: Array<{
    name: string;
    quantity: number;
    unit?: string;
    previousStock?: number;
    newStock?: number;
  }> = log?.items || [];

  if (items.length === 0) {
    return {
      success: false,
      updatedItems: [],
      errors: ['Nothing to undo — no items were recorded for this action.'],
      totalChanges: 0,
    };
  }

  try {
    const operation = log.intent;
    for (const item of items) {
      const name = item.name;
      const qty = Math.max(0, Number(item.quantity) || 0);
      const unit = item.unit || 'pcs';
      const prevStock = item.previousStock != null ? Number(item.previousStock) : null;

      if (!name) continue;

      const product = await Product.findOne({
        name,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isDeleted: { $ne: true },
      }).lean();

      if (!product) {
        errors.push(
          `Item "${name}" is no longer in your catalog — could not undo this part.`
        );
        continue;
      }

      const currentStock = Number((product as any).currentStock) || 0;

      // For add/remove/waste/adjust we know exactly what the confirmed action
      // produced — verify the stock hasn't drifted since before reversing it.
      // (A sale or manual edit in between would make the reverse wrong.)
      if (prevStock != null) {
        let expectedNow: number | null = null;
        if (operation === 'inventory_add') {
          expectedNow = prevStock + qty;
        } else if (operation === 'inventory_remove' || operation === 'inventory_waste') {
          expectedNow = Math.max(0, prevStock - qty);
        } else if (operation === 'inventory_adjust') {
          expectedNow = prevStock + (item.newStock != null ? Number(item.newStock) - prevStock : qty);
        }
        if (expectedNow != null && Math.abs(currentStock - expectedNow) > 0.0001) {
          errors.push(
            `"${name}" stock has changed since this action (${currentStock}${unit} now) — skipped to avoid corrupting your count.`
          );
          continue;
        }
      }

      // Compute the target stock after undo.
      let targetStock = currentStock;
      if (operation === 'inventory_add') {
        // Subtract exactly the qty that was added (or restore recorded prev).
        targetStock = prevStock != null
          ? Math.max(0, prevStock)
          : Math.max(0, currentStock - qty);
      } else if (operation === 'inventory_remove' || operation === 'inventory_waste') {
        // Add the removed qty back (or restore recorded prev).
        targetStock = prevStock != null
          ? Math.max(0, prevStock)
          : currentStock + qty;
      } else if (operation === 'inventory_adjust') {
        // Restore the exact pre-adjust stock.
        targetStock = prevStock != null
          ? Math.max(0, prevStock)
          : Math.max(0, currentStock - qty);
      } else {
        errors.push(`Action type "${operation}" cannot be undone.`);
        continue;
      }

      if (Math.abs(targetStock - currentStock) < 0.0001) {
        // No actual change — nothing to undo for this item.
        updatedItems.push({
          itemName: name,
          previousStock: currentStock,
          newStock: currentStock,
          unit,
        });
        continue;
      }

      await Product.updateOne(
        { _id: product._id },
        { $set: { currentStock: Math.round(targetStock * 100) / 100 } }
      );

      updatedItems.push({
        itemName: name,
        previousStock: currentStock,
        newStock: Math.round(targetStock * 100) / 100,
        unit,
      });
    }

    // Audit the undo itself (append-only) and link it to the original log.
    let undoAuditLogId: string | undefined;
    try {
      const undoAudit = new AuditLog({
        action: 'inventory_undo',
        entityType: 'Inventory',
        performedBy: performedByName,
        performedById: performedBy,
        details: {
          operation,
          source,
          reversedLogId: String(log._id || log.auditLogId || ''),
          items: updatedItems.map((i) => ({
            item: i.itemName,
            previousStock: i.previousStock,
            newStock: i.newStock,
            unit: i.unit,
          })),
          errors: errors.length > 0 ? errors : undefined,
        },
      });
      const saved = await undoAudit.save();
      undoAuditLogId = String((saved as any)._id || '');
    } catch (auditError) {
      console.error('[InventoryService] Undo audit logging failed:', auditError);
      // Non-fatal — the stock reversal itself already succeeded.
    }

    // Remove the purchase/event rows this voice add created (they are tagged
    // with the owning VoiceAuditLog id), so the history stays consistent with
    // the reversed stock instead of showing a stock-in that no longer exists.
    const logRef = String(log._id || log.auditLogId || '');
    if (logRef) {
      try {
        const tag = `Voice:${logRef}`;
        const [purchaseDel] = await Promise.all([
          Purchase.deleteMany({ restaurantId: new mongoose.Types.ObjectId(restaurantId), notes: tag }),
          InventoryEvent.deleteMany({ restaurantId: new mongoose.Types.ObjectId(restaurantId), refId: logRef, type: 'purchase' }),
        ]);
        if (purchaseDel?.deletedCount) {
          console.log(`[InventoryService] Undo cleaned ${purchaseDel.deletedCount} purchase row(s) + events for ${logRef}`);
        }
      } catch (cleanupErr) {
        console.warn('[InventoryService] Undo history cleanup failed (non-fatal):', (cleanupErr as Error)?.message);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[InventoryService] undo ${operation}: ${updatedItems.length} items reverted in ${elapsed}ms`
    );

    return {
      success: errors.length === 0,
      updatedItems,
      errors,
      totalChanges: updatedItems.length,
      undoAuditLogId,
    };
  } catch (error: any) {
    console.error('[InventoryService] Undo failed:', error.message);
    return {
      success: false,
      updatedItems: [],
      errors: [`Undo failed: ${error.message}`],
      totalChanges: 0,
    };
  }
}

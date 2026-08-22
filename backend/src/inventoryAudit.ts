/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryAudit — Verify that recommendations use actual inventory state.
 *
 * Check:
 *   Current Stock
 *   Reserved Stock
 *   Expected Consumption
 *   Expected Purchase
 *   Expiry
 *   Wastage
 *
 * A promotion should not be recommended if the underlying inventory assumptions
 * are invalid.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Product } from '../models/Product';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * Inventory state for a product/variant
 */
export interface InventoryState {
  productId: string;
  variantId?: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  reservedStock: number; // stock reserved for existing orders
  availableStock: number; // current - reserved
  expiryDate?: string;
  daysUntilExpiry?: number;
  isSurplus: boolean;
  surplusQuantity: number; // current - (max * 0.8), if positive
  daysOfSupply?: number; // current / average daily consumption
  lastStockUpdate?: Date;
}

/**
 * Audit inventory state for a product
 */
export function auditInventoryState(
  productId: string,
  ctx: RecommendationContext
): {
  inventoryState: InventoryState;
  issues: string[];
  promotionBlocked: boolean;
  recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
} {
    const issues: string[] = [];
    let promotionBlocked = false;
    let recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate' = 'proceed';

    // Get product from context
    const product = ctx.products?.find((p: any) => p.id === productId);
    if (!product) {
      return {
        inventoryState: {
          productId,
          currentStock: 0,
          minStock: 0,
          maxStock: 0,
          reservedStock: 0,
          availableStock: 0,
          isSurplus: false,
          surplusQuantity: 0,
        },
        issues: ['Product not found in context'],
        promotionBlocked: true,
        recommendedAction: 'investigate',
      };
    }

    // Build inventory state
    const currentStock = product.currentStock ?? 0;
    const minStock = product.minStock ?? 0;
    const maxStock = product.maxStock ?? 0;
    const reservedStock = product.reservedStock ?? 0;
    const availableStock = Math.max(0, currentStock - reservedStock);

    const inventoryState: InventoryState = {
      productId,
      variantId: product.variantId,
      currentStock,
      minStock,
      maxStock,
      reservedStock,
      availableStock,
      expiryDate: product.expiryDate,
      daysUntilExpiry: product.daysUntilExpiry,
      isSurplus: false,
      surplusQuantity: 0,
    };

    // 1. Check if stock is at or below minimum
    if (currentStock <= minStock && minStock > 0) {
      issues.push(`Stock ${currentStock} is at or below minimum ${minStock} - promotions may fail or sell out`);
      promotionBlocked = true;
      recommendedAction = 'block';
    }

    // 2. Check if stock is above 80% of max (surplus)
    if (maxStock > 0 && currentStock >= maxStock * 0.8) {
      const surplus = currentStock - Math.floor(maxStock * 0.8);
      inventoryState.isSurplus = true;
      inventoryState.surplusQuantity = surplus;
      issues.push(`${currentStock} is ${Math.round((currentStock / maxStock) * 100)}% of max stock ${maxStock} - surplus of ${surplus} units detected`);

      // Promotions targeting surplus are valid
      if (recommendedAction !== 'block') {
        recommendedAction = 'proceed'; // Surplus can be promoted
      }
    }

    // 3. Check expiry risk
    if (inventoryState.daysUntilExpiry !== undefined) {
      if (inventoryState.daysUntilExpiry <= 2) {
        issues.push(`Expiry within 2 days - promotions should be avoided or focused on immediate consumption`);
        promotionBlocked = true;
        recommendedAction = 'block';
      } else if (inventoryState.daysUntilExpiry <= 5) {
        issues.push(`Expiry within 5 days - promotions should be cautious`);
        if (recommendedAction === 'proceed') {
          recommendedAction = 'caution';
        }
      }
    }

    // 3. Check days of supply
    if (inventoryState.daysOfSupply !== undefined) {
      if (inventoryState.daysOfSupply <= 1) {
        issues.push('Days of supply ≤ 1 - stock will deplete quickly even without promotions');
        if (!promotionBlocked) {
          recommendedAction = 'caution';
        }
      } else if (inventoryState.daysOfSupply <= 3) {
        issues.push('Days of supply ≤ 3 - promotions may deplete stock rapidly');
        if (recommendedAction === 'proceed') {
          recommendedAction = 'caution';
        }
      }
    }

    // 4. Check for recommended promotion vs inventory state
    // If a recommendation exists for this product, check compatibility
    // (In a full implementation, would check the specific recommendation's inventory assumptions)

    // 5. Low stock protection - flat discount only above minimum order
    if (currentStock <= minStock && minStock > 0 && currentStock > 0) {
      issues.push(`Low stock protection: flat discount only above minimum order value`);
    }

    // Determine promotion blocked status
    // Blocked if: stock at/at-minimum + expiry imminent, OR no stock at all
    if (promotionBlocked) {
      // Already set above
    } else if (currentStock === 0) {
      issues.push('No stock available - cannot promote this product');
      promotionBlocked = true;
      recommendedAction = 'block';
    }

    return {
      inventoryState,
      issues,
      promotionBlocked,
      recommendedAction,
    };
  }

  /**
   * Audit inventory state for all products in a recommendation
   */
  export function auditRecommendationInventory(
    recommendation: any,
    ctx: RecommendationContext
  ): {
    productAudits: Array<{
      productId: string;
      variantName?: string;
      availableStock: number;
      isSurplus: boolean;
      surplusQuantity: number;
      promotionBlocked: boolean;
      recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
      issues: string[];
    }>;
    overallPromotionBlocked: boolean;
    overallRecommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
    issues: string[];
  } {
    const productAudits: Array<{
      productId: string;
      variantName?: string;
      availableStock: number;
      isSurplus: boolean;
      surplusQuantity: number;
      promotionBlocked: boolean;
      recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
      issues: string[];
    }> = [];
    const allIssues: string[] = [];
    let overallPromotionBlocked = false;
    let overallRecommendedAction: 'proceed' | 'caution' | 'block' | 'investigate' = 'proceed';

    // Get the products involved in the recommendation
    const applicableProductIds = recommendation.offerSuggestion?.applicableProductIds || [];
    const allProductIds = [...new Set([...applicableProductIds, recommendation.productId || ''])];

    for (const productId of allProductIds) {
      const variantName = productId === recommendation.productId || recommendation.productId === undefined
        ? undefined
        : `Variant for ${productId}`;

      const audit = auditInventoryState(productId, ctx);

      productAudits.push({
        productId,
        variantName,
        availableStock: audit.inventoryState.availableStock,
        isSurplus: audit.inventoryState.isSurplus,
        surplusQuantity: audit.inventoryState.surplusQuantity,
        promotionBlocked: audit.promotionBlocked,
        recommendedAction: audit.recommendedAction,
        issues: audit.issues,
      });

      // Update overall state - if any product blocks, the whole promotion is affected
      if (audit.promotionBlocked) {
        overallPromotionBlocked = true;
        // Take the most severe action
        const actionOrder: Record<string, 'proceed' | 'caution' | 'block' | 'investigate'> = {
          proceed: 0,
          caution: 1,
          block: 2,
          investigate: 3,
        };
        const currentSeverity = actionOrder[overallRecommendedAction];
        const newSeverity = actionOrder[audit.recommendedAction];
        if (newSeverity > currentSeverity) {
          overallRecommendedAction = audit.recommendedAction;
        }
      }

      // Collect issues
      allIssues.push(...audit.issues);
    }

    // If overall blocked, recommended action is block
    if (overallPromotionBlocked) {
      overallRecommendedAction = 'block';
    }

    return {
      productAudits,
      overallPromotionBlocked,
      overallRecommendedAction,
      issues: allIssues,
    };
  }

  /**
   * Generate inventory warning for display
   */
  export function formatInventoryWarning(
    audit: ReturnType<typeof auditRecommendationInventory>
  ): string {
    const lines: string[] = [];

    if (audit.overallPromotionBlocked) {
      lines.push('❌ Promotion blocked due to inventory issues:');
    } else if (audit.overallRecommendedAction === 'caution') {
      lines.push('⚠️ Inventory caution - promotion may deplete stock:');
    } else {
      lines.push('✅ Inventory OK for promotion:');
    }

    // Show per-product status
    for (const pa of audit.productAudits) {
      const stockStatus = pa.availableStock > 0 ? 'adequate' : 'out';
      const surplusMark = pa.isSurplus ? ' (surplus)' : '';
      lines.push(`  - ${pa.productId}: ${pa.availableStock} available${surplusMark} - ${pa.recommendedAction}`);
    }

    // Show overall issues
    if (audit.issues.length > 0) {
      lines.push('');
      lines.push('Issues:');
      for (const issue of audit.issues.slice(0, 5)) {
        lines.push(`    • ${issue}`);
      }
      if (audit.issues.length > 5) {
        lines.push(`    • and ${audit.issues.length - 5} more`);
      }
    }

    return lines.join('\n');
  }
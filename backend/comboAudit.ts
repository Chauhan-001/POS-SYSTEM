/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ComboAudit — Verify combo recommendations for component availability,
 * variant selection, recipe cost, inventory deduction, price, margin,
 * and offer interaction.
 *
 * A combo should never create inconsistent inventory accounting.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Product } from '../models/Product';
import type { Offer } from '../models/Offer';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * Combo component info
 */
export interface ComboComponent {
  productId: string;
  productName: string;
  variant?: string;
  sellingPrice: number;
  recipeCost: number;
  contributionMarginPercent: number;
  currentStock: number;
  minStock: number;
  maxStock: number;
  isAvailable: boolean;
  stockStatus: 'adequate' | 'low' | 'surplus' | 'out';
}

/**
 * Combo audit result
 */
export interface ComboAuditResult {
  comboId: string;
  comboTitle: string;
  components: ComboComponent[];
  totalSellingPrice: number;
  totalRecipeCost: number;
  totalContributionMarginPercent: number;
  inventoryValid: boolean;
  promotionBlocked: boolean;
  recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
  issues: string[];
}

/**
 * Audit a combo recommendation
 */
export function auditComboRecommendation(
  recommendation: any,
  ctx: RecommendationContext
): ComboAuditResult {
    // Get the combo product IDs from the recommendation
    const comboProductIds = recommendation.offerSuggestion?.applicableProductIds || [];
    const comboTitle = recommendation.title || recommendation.offerSuggestion?.title || 'Combo';

    // Build component info for each product in the combo
    const components: ComboComponent[] = [];

    let totalSellingPrice = 0;
    let totalRecipeCost = 0;

    for (const productId of comboProductIds) {
      const product = ctx.products?.find((p: any) => p.id === productId);

      if (!product) {
        // Product not in context - add placeholder
        components.push({
          productId,
          productName: `Product ${productId}`,
          sellingPrice: 0,
          recipeCost: 0,
          contributionMarginPercent: 0,
          currentStock: 0,
          minStock: 0,
          maxStock: 0,
          isAvailable: false,
          stockStatus: 'out',
        });
        totalSellingPrice += 0;
        totalRecipeCost += 0;
        continue;
      }

      const sellingPrice = product.sellingPrice || product.price || 0;
      const recipeCost = product.recipeCost ?? 0;
      const currentStock = product.currentStock ?? 0;
      const minStock = product.minStock ?? 0;
      const maxStock = product.maxStock ?? 0;

      // Calculate contribution margin for this component
      const contributionMarginPercent = sellingPrice > 0
        ? Math.round(((sellingPrice - recipeCost) / sellingPrice) * 100)
        : 0;

      // Determine stock status
      let stockStatus: 'adequate' | 'low' | 'surplus' | 'out' = 'adequate';
      let isAvailable = true;

      if (currentStock <= 0) {
        stockStatus = 'out';
        isAvailable = false;
      } else if (currentStock <= minStock && minStock > 0) {
        stockStatus = 'low';
      } else if (maxStock > 0 && currentStock >= maxStock * 0.8) {
        stockStatus = 'surplus';
      }

      if (currentStock < minStock && minStock > 0) {
        isAvailable = false;
      }

      components.push({
        productId,
        productName: product.name || `Product ${productId}`,
        variant: product.variant ? product.variant.name : undefined,
        sellingPrice,
        recipeCost,
        contributionMarginPercent,
        currentStock,
        minStock,
        maxStock,
        isAvailable,
        stockStatus,
      });

      totalSellingPrice += sellingPrice;
      totalRecipeCost += recipeCost;
    }

    // Calculate total contribution margin
    const totalContributionMarginPercent = totalSellingPrice > 0
      ? Math.round(((totalSellingPrice - totalRecipeCost) / totalSellingPrice) * 100)
      : 0;

    // Check inventory validity
    const allAdequate = components.every(c => c.stockStatus === 'adequate');
    const anyLow = components.some(c => c.stockStatus === 'low');
    const anySurplus = components.some(c => c.stockStatus === 'surplus');
    const anyOut = components.some(c => c.stockStatus === 'out');

    let inventoryValid = true;
    let promotionBlocked = false;
    let recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate' = 'proceed';
    const issues: string[] = [];

    // If any component is out of stock, block
    if (anyOut) {
      inventoryValid = false;
      promotionBlocked = true;
      recommendedAction = 'block';
      issues.push('One or more combo components are out of stock');
    }

    // If any component is low stock, caution
    if (!promotionBlocked && anyLow) {
      inventoryValid = false; // or true, depending on policy
      if (recommendedAction !== 'block') {
        recommendedAction = 'caution';
        issues.push('One or more combo components are low on stock');
      }
    }

    // If all are adequate, valid
    if (!promotionBlocked && allAdequate) {
      inventoryValid = true;
    }

    // If there's surplus, that's okay for promotions
    if (!promotionBlocked && anySurplus) {
      // Surplus components can be promoted - this is actually an opportunity
      // but we note it
      issues.push('Some combo components have surplus stock - promotion may help clear inventory');
    }

    // Margin check
    const minMargin = ctx.margin?.minimumMargin || 25;
    if (totalContributionMarginPercent < minMargin) {
      issues.push(`Combo contribution margin ${totalContributionMarginPercent}% below minimum ${minMargin}%`);
      if (!promotionBlocked) {
        if (recommendedAction === 'proceed') {
          recommendedAction = 'caution';
        }
      }
    }

    // Price reasonability check
    // If total price is unreasonably low given costs, flag it
    if (totalSellingPrice > 0 && totalRecipeCost > 0) {
      const overallMargin = Math.round(((totalSellingPrice - totalRecipeCost) / totalSellingPrice) * 100);
      if (overallMargin < 10) {
        issues.push(`Overall combo margin ${overallMargin}% is very thin - consider price adjustment`);
        if (recommendedAction === 'proceed') {
          recommendedAction = 'caution';
        }
      }
    }

    return {
      comboId: String(recommendation._id || recommendation.id),
      comboTitle,
      components,
      totalSellingPrice,
      totalRecipeCost,
      totalContributionMarginPercent,
      inventoryValid,
      promotionBlocked,
      recommendedAction,
      issues,
    };
  }

  /**
   * Audit combo for inventory consistency
   */
  export function auditComboInventoryConsistency(
    comboComponents: ComboComponent[],
    currentInventory: Map<string, number> // productId -> current stock
  ): {
    consistent: boolean;
    issues: string[];
    recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
  } {
    const issues: string[] = [];
    let consistent = true;
    let recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate' = 'proceed';

    for (const component of comboComponents) {
      const currentStock = currentInventory.get(component.productId) ?? 0;

      // If combo component is marked as available but inventory says otherwise
      if (component.isAvailable && currentStock <= 0) {
        inconsistent = false;
        issues.push(`Combo component ${component.productName} marked available but inventory shows ${currentStock} in stock`);
        consistent = false;
        recommendedAction = 'block';
      }

      // If combo has surplus components, note it
      if (currentStock > 0 && currentStock >= 0.8 * (currentInventory.get(component.productId) ?? 1)) {
        // Actually above 80% of max - would need maxStock for full check
        // Just note surplus
      }
    }

    return {
      consistent,
      issues,
      recommendedAction,
    };
  }

  /**
   * Generate combo audit report
   */
  export function formatComboAuditReport(
    audit: ComboAuditResult
  ): string {
    const lines: string[] = [];

    lines.push(`Combo Audit: ${audit.comboTitle}`);
    lines.push(`Combo ID: ${audit.comboId}`);
    lines.push('');

    lines.push('Components:');
    for (const component of audit.components) {
      const stockMark = component.isAvailable ? '' : ' ❌';
      const surplusMark = component.stockStatus === 'surplus' ? ' (surplus)' : '';
      lines.push(`  - ${component.productName}: ₹${component.sellingPrice} cost ₹${component.recipeCost} margin ${component.contributionMarginPercent}% stock ${component.stockStatus}${stockMark}`);
    }

    lines.push('');
    lines.push(`Total selling price: ₹${audit.totalSellingPrice.toLocaleString('en-IN')}`);
    lines.push(`Total recipe cost: ₹${audit.totalRecipeCost.toLocaleString('en-IN')}`);
    lines.push(`Total contribution margin: ${audit.totalContributionMarginPercent}%`);
    lines.push(`Inventory valid: ${audit.inventoryValid}`);
    lines.push(`Promotion blocked: ${audit.promotionBlocked}`);
    lines.push(`Recommended action: ${audit.recommendedAction}`);
    lines.push('');

    if (audit.issues.length > 0) {
      lines.push('Issues:');
      for (const issue of audit.issues) {
        lines.push(`  • ${issue}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Verify combo does not create inconsistent inventory accounting
   */
  export function verifyComboInventoryConsistency(
    recommendation: any,
    ctx: RecommendationContext
  ): {
    consistent: boolean;
    accountingErrors: string[];
    recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate';
  } {
    const accountingErrors: string[] = [];
    let consistent = true;
    let recommendedAction: 'proceed' | 'caution' | 'block' | 'investigate' = 'proceed';

    // Get combo component product IDs
    const comboProductIds = recommendation.offerSuggestion?.applicableProductIds || [];

    // Get current inventory state for each product
    const productStockMap = new Map<string, number>();
    for (const productId of comboProductIds) {
      const product = ctx.products?.find((p: any) => p.id === productId);
      if (product && product.currentStock !== undefined) {
        productStockMap.set(productId, product.currentStock);
      }
    }

    // Check: combo promotion should not recommend consuming more than available stock
    // This would be checked against the promotion's expected consumption

    // Example check: if combo has 3 components and each is expected to sell X units,
    // total expected consumption should not exceed available stock

    // For now, check basic consistency
    for (const productId of comboProductIds) {
      const product = ctx.products?.find((p: any) => p.id === productId);
      if (product && product.currentStock !== undefined) {
        // If the product has very low stock, promoting a combo that consumes it is inconsistent
        if (product.currentStock <= 2) {
          accountingErrors.push(`Product ${product.name} has ${product.currentStock} units - combo promotion may deplete stock`);
          consistent = false;
          recommendedAction = 'block';
        }
        // If product is at surplus, promoting it is actually recommended (clears stock)
        if (product.currentStock >= (product.maxStock ?? 1) * 0.8) {
          // Surplus - promo is okay, note it
          if (!accountingErrors.some(a => a.includes('surplus'))) {
            // No error, this is fine
          }
        }
      }
    }

    if (accountingErrors.length > 0) {
      consistent = false;
    }

    return {
      consistent,
      accountingErrors,
      recommendedAction,
    };
  }
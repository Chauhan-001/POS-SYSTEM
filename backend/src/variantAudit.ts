/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VariantAudit — Explicit audit of every intelligence feature for variant awareness.
 *
 * Example:
 *   Pizza
 *    ├── Small
 *    ├── Medium
 *    └── Large
 *
 * Each variant must have independent:
 *   - Cost
 *   - Recipe
 *   - Inventory
 *   - Price
 *   - Margin
 *   - Offer
 *   - Combo
 *   - Forecast
 *   - Recommendation
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Product } from '../models/Product';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * Variant representation
 */
export interface VariantInfo {
  variantId: string;
  variantName: string; // e.g., "Small", "Medium", "Large"
  productId: string;
  sellingPrice: number;
  recipeCost: number;
  foodCostPercent: number;
  contributionMarginPercent: number;
  currentStock: number;
  minStock: number;
  maxStock: number;
  unit: string;
  hasRecipe: boolean;
  isSurplus: boolean;
  expiryRisk: boolean;
}

/**
 * Audit a product's variants for intelligence correctness
 */
export function auditProductVariants(
  productId: string,
  variants: VariantInfo[],
  ctx: RecommendationContext
): {
  variantAuditResults: VariantAuditResult[];
  overallStatus: 'pass' | 'warning' | 'fail';
  issues: string[];
} {
    const variantAuditResults: VariantAuditResult[] = [];
    const issues: string[] = [];

    // If no variants provided, check the product from context
    if (variants.length === 0) {
      const product = ctx.products?.find((p: any) => p.id === productId);
      if (!product) {
        return {
          variantAuditResults: [],
          overallStatus: 'fail',
          issues: ['Product not found in context'],
        };
      }
      // Build variant info from product - this is simplified
      // In production, would query variant models
      variants = [{
        variantId: product._id.toString(),
        variantName: product.name || 'Default',
        productId: product._id.toString(),
        sellingPrice: product.price || 0,
        recipeCost: product.averageCost || 0,
        foodCostPercent: 0,
        contributionMarginPercent: 0,
        currentStock: product.currentStock ?? 0,
        minStock: product.minStock ?? 0,
        maxStock: product.maxStock ?? 0,
        unit: product.unit || 'unit',
        hasRecipe: !!(product.recipeCost && product.recipeCost > 0),
        isSurplus: false,
        expiryRisk: !!(product.expiryDate),
      }];
    }

    // Audit each variant
    for (const variant of variants) const variantIssues: string[] = [];

    // 1. Check recipe completeness
    if (!variant.hasRecipe) {
      variantIssues.push('No complete recipe - contribution-based recommendations limited');
      issues.push(`Product ${variant.variantName}: no complete recipe`);
    }

    // 2. Check price vs cost margin
    if (variant.sellingPrice > 0 && variant.recipeCost >= 0) {
      const margin = Math.round(((variant.sellingPrice - variant.recipeCost) / variant.sellingPrice) * 100);
      if (margin < 20) {
        variantIssues.push(`Thin margin: ${margin}% - contribution recommendations may be limited`);
        issues.push(`Variant ${variant.variantName}: thin margin ${margin}%`);
      }
    }

    // 3. Check inventory state
    if (variant.currentStock <= 0 && variant.minStock > 0) {
      variantIssues.push('Stock at or below minimum - promotions may fail');
      issues.push(`Variant ${variant.variantName}: stock at minimum ${variant.currentStock}`);
    }

    // 4. Check surplus status
    if (variant.maxStock > 0 && variant.currentStock >= variant.maxStock * 0.8) {
      variantIssues.push('Above 80% stock ceiling - inventory opportunity detected');
      issues.push(`Variant ${variant.variantName}: surplus ${variant.currentStock - variant.maxStock * 0.8} above ceiling`);
    }

    // 5. Check expiry risk
    if (variant.expiryRisk) {
      variantIssues.push('Expiry risk - promotions should avoid this variant until stock clears');
      issues.push(`Variant ${variant.variantName}: expiry risk`);
    }

    // 6. Check if variant is being recommended without proper recipe
    if (!variant.hasRecipe && variant.contributionMarginPercent < 25) {
      variantIssues.push('No recipe + thin margin = do not recommend contribution-based promotions');
      issues.push(`Variant ${variant.variantName}: no recipe + thin margin`);
    }

    variantAuditResults.push({
      variantId: variant.variantId,
      variantName: variant.variantName,
      status: variantIssues.length === 0 ? 'pass' : 'warning',
      issues: variantIssues,
      hasRecipe: variant.hasRecipe,
      marginPercent: variant.sellingPrice > 0 ? Math.round(((variant.sellingPrice - variant.recipeCost) / variant.sellingPrice) * 100) : 0,
      stockStatus: variant.currentStock > 0 ? 'adequate' : variant.minStock > 0 && variant.currentStock <= variant.minStock ? 'at_minimum' : 'below_minimum',
    });

    const overallStatus =
      issues.length === 0 && variantAuditResults.every(r => r.status === 'pass') ? 'pass'
        : issues.length <= variants.length * 0.3 ? 'warning'
        : 'fail';

    return {
      variantAuditResults,
      overallStatus,
      issues,
    };
  }

  /**
   * Variant audit result for a single variant
   */
  export interface VariantAuditResult {
    variantId: string;
    variantName: string;
    status: 'pass' | 'warning' | 'fail';
    issues: string[];
    hasRecipe: boolean;
    marginPercent: number;
    stockStatus: 'adequate' | 'at_minimum' | 'below_minimum';
  }

  /**
   * Check if recommendation uses correct variant
   */
  export function verifyVariantInRecommendation(
    recommendation: any,
    productId: string,
    variantName: string,
    ctx: RecommendationContext
  ): {
    valid: boolean;
    error?: string;
    variantUsed?: VariantInfo;
  } {
    // In production, would look up the variant from the product's variant data
    // and verify the recommendation references the correct variant
    // For now, check if the recommendation's product ID matches and if variant awareness was applied

    const product = ctx.products?.find((p: any) => p.id === productId);
    if (!product) {
      return { valid: false, error: 'Product not in context' };
    }

    // Check if recommendation mentions or uses variant-specific data
    const recommendationTitle = recommendation.title || recommendation.offerSuggestion?.title || '';
    const recommendationWhy = recommendation.why || '';

    // If the recommendation is about a specific variant and the product has variants,
    // we need to verify the variant was correctly resolved
    const productHasVariants = product.variants && product.variants.length > 0;

    if (productHasVariants && !recommendationWhy.toLowerCase().includes(variantName.toLowerCase())) {
      // Product has variants but recommendation doesn't mention which variant
      // This could be a gap - recommendations should use exact variant
      return {
        valid: false,
        error: `Product has variants (${product.variants.map(v => v.name).join(', ')}) but recommendation "${recommendationTitle}" does not specify the variant. Recommendations must use the exact variant.`,
      };
    }

    // Check if recommendation economics use variant-specific recipe cost
    // In a full implementation, would verify the economics use the correct variant's recipeCost
    // For now, just check that the product has recipe data
    const hasRecipeData = product.recipeCost !== undefined && product.recipeCost > 0;

    if (!hasRecipeData && recommendation.economics) {
      return {
        valid: false,
        error: `Product "${product.name}" has no complete recipe, so contribution-based promotion recommendations are currently limited.`,
      };
    }

    return { valid: true };
  }

  /**
   * Generate variant-aware recommendation disclaimer
   */
  export function generateVariantDisclaimer(
    productId: string,
    ctx: RecommendationContext
  ): string {
    const product = ctx.products?.find((p: any) => p.id === productId);
    if (!product) return '';

    const hasVariants = product.variants && product.variants.length > 1;
    const hasRecipe = product.recipeCost !== undefined && product.recipeCost > 0;

    if (!hasVariants && hasRecipe) {
      return '';
    }

    let disclaimer = '';

    if (!hasRecipe) {
      disclaimer = 'This product has no complete recipe, so contribution-based promotion recommendations are currently limited. ';
    }

    if (hasVariants) {
      const variantNames = product.variants.map((v: any) => v.name).join(', ');
      disclaimer += `This product has variants (${variantNames}). Recommendations must use the exact variant — never aggregate them incorrectly when economics differ. `;
    }

    return disclaimer;
  }
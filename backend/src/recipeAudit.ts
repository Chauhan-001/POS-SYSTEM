/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeAudit — Find products with missing recipes, incomplete recipes, invalid ingredients,
 * missing quantities, missing units, variant mismatch, unreasonable quantities.
 *
 * Mark affected recommendations as LOW_DATA_CONFIDENCE rather than generating
 * inaccurate margin advice.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Product } from '../models/Product';
import type { VariantAuditResult } from './variantAudit';

/**
 * Recipe completeness issue types
 */
export type RecipeIssue =
  | 'missing_recipe'
  | 'incomplete_recipe'
  | 'invalid_ingredient'
  | 'missing_quantity'
  | 'missing_unit'
  | 'variant_mismatch'
  | 'unreasonable_quantity';

/**
 * Recipe issue description
 */
export interface RecipeIssueDescription {
  issue: RecipeIssue;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedField: string;
  suggestion: string;
}

/**
 * Recipe audit result for a single product
 */
export interface RecipeAuditResult {
  productId: string;
  productName: string;
  hasCompleteRecipe: boolean;
  recipeIssueCount: number;
  issues: RecipeIssueDescription[];
  confidenceReduction: 'None' | 'Reduced' | 'Blocked';
  recommendations: string[];
}

/**
 * Audit a product's recipe completeness
 */
export function auditProductRecipe(
  productId: string,
  product: Product,
  ctx: RecommendationContext
): RecipeAuditResult {
    const issues: RecipeIssueDescription[] = [];
    let issueCount = 0;
    let confidenceReduction: 'None' | 'Reduced' | 'Blocked' = 'None';
    const recommendations: string[] = [];

    // 1. Check if recipe exists at all
    if (!product.recipeCost || product.recipeCost <= 0) {
      issues.push({
        issue: 'missing_recipe',
        severity: 'high',
        description: 'Product has no recipe cost - all contribution estimates impossible',
        affectedField: 'recipeCost',
        suggestion: 'Add recipe cost or disable contribution-based recommendations',
      });
      issueCount++;
      confidenceReduction = 'Blocked';
      recommendations.push('Disable contribution-based promotions for this product');
    }

    // 2. Check for incomplete recipe data
    if (product.recipeCost > 0 && !product.ingredients) {
      issues.push({
        issue: 'incomplete_recipe',
        severity: 'medium',
        description: 'Recipe cost exists but ingredient list is missing',
        affectedField: 'ingredients',
        suggestion: 'Add ingredient list for complete recipe tracking',
      });
      issueCount++;
      if (confidenceReduction !== 'Blocked') {
        confidenceReduction = 'Reduced';
      }
      recommendations.push('Add ingredient list to complete recipe');
    }

    // 3. Check for variant mismatch
    // If product has variants and this is the aggregate product, check mismatch
    if (product.variants && product.variants.length > 0) {
      // Check if the main product's recipe cost is representative or if we should use per-variant costs
      const hasVariantSpecificRecipes = product.variants.some((v: any) => v.recipeCost && v.recipeCost > 0);
      if (!hasVariantSpecificRecipes) {
        issues.push({
          issue: 'variant_mismatch',
          severity: 'medium',
          description: 'Product has variants but no per-variant recipe costs - aggregating may give incorrect margins',
          affectedField: 'recipeCost',
          suggestion: 'Add per-variant recipe costs or use aggregate product without variant-specific recommendations',
        });
        issueCount++;
        if (confidenceReduction !== 'Blocked') {
          confidenceReduction = 'Reduced';
        }
        recommendations.push('Use per-variant costs or restrict recommendations to aggregate product only');
      }
    }

    // 4. Check for missing unit
    if (!product.unit) {
      issues.push({
        issue: 'missing_unit',
        severity: 'low',
        description: 'Product missing unit of measure (kg, piece, liter, etc.)',
        affectedField: 'unit',
        suggestion: 'Add unit of measure for consistent inventory and recipe tracking',
      });
      issueCount++;
      if (confidenceReduction !== 'Blocked') {
        confidenceReduction = 'Reduced';
      }
      recommendations.push('Add unit of measure');
    }

    // 5. Check for unreasonable quantities
    if (product.recipeCost && product.sellingPrice) {
      const foodCostPercent = Math.round((product.recipeCost / product.sellingPrice) * 100);
      if (foodCostPercent > 80) {
        issues.push({
          issue: 'unreasonable_quantity',
          severity: 'high',
          description: `Food cost ${foodCostPercent}% of price is unreasonably high - may indicate data error`,
          affectedField: 'recipeCost',
          suggestion: 'Verify recipe cost and selling price are correct',
        });
        issueCount++;
        confidenceReduction = 'Blocked';
        recommendations.push('Verify and correct recipe cost and price data');
      } else if (foodCostPercent > 60) {
        issues.push({
          issue: 'unreasonable_quantity',
          severity: 'medium',
          description: `Food cost ${foodCostPercent}% of price is high - may affect margin recommendations`,
          affectedField: 'recipeCost',
          suggestion: 'Review portion sizes or supplier costs',
        });
        issueCount++;
        if (confidenceReduction !== 'Blocked') {
          confidenceReduction = 'Reduced';
        }
        recommendations.push('Review portion sizes or supplier costs');
      }
    }

    // 6. Check ingredients for invalid data
    if (product.ingredients) {
      for (const ingredient of product.ingredients) {
        if (!ingredient.quantity || ingredient.quantity <= 0) {
          issues.push({
            issue: 'invalid_ingredient',
            severity: 'medium',
            description: `Ingredient "${ingredient.name}" has invalid or missing quantity`,
            affectedField: `ingredients[${ingredient.name}].quantity`,
            suggestion: 'Fix ingredient quantity in recipe',
          });
          issueCount++;
          if (confidenceReduction !== 'Blocked') {
            confidenceReduction = 'Reduced';
          }
          recommendations.push('Fix ingredient quantities in recipe');
        }
        if (!ingredient.unit) {
          issues.push({
            issue: 'missing_unit',
            severity: 'low',
            description: `Ingredient "${ingredient.name}" missing unit of measure`,
            affectedField: `ingredients[${ingredient.name}].unit`,
            suggestion: 'Add unit of measure for ingredient',
          });
          issueCount++;
          if (confidenceReduction !== 'Blocked') {
            confidenceReduction = 'Reduced';
          }
          recommendations.push('Add ingredient unit of measure');
        }
      }
    }

    // Determine overall confidence reduction
    if (issueCount === 0) {
      confidenceReduction = 'None';
    } else if (issueCount === 1 && !confidenceReduction) {
      confidenceReduction = 'Reduced';
    } else if (issueCount >= 2 || confidenceReduction === 'Blocked') {
      confidenceReduction = 'Blocked';
    }

    // Generate recommendations summary
    const uniqueRecs = [...new Set(recommendations)];

    return {
      productId: product._id.toString(),
      productName: product.name || 'Unknown Product',
      hasCompleteRecipe: issueCount === 0,
      recipeIssueCount: issueCount,
      issues,
      confidenceReduction,
      recommendations: uniqueRecs,
    };
  }

  /**
   * Audit all products in context for recipe completeness
   */
  export function auditAllProductRecipes(
    ctx: RecommendationContext
  ): RecipeAuditResult[] {
    const results: RecipeAuditResult[] = [];

    for (const product of ctx.products || []) {
      const result = auditProductRecipe(product._id.toString(), product, ctx);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate data quality gate message based on recipe audit
   */
  export function formatRecipeAuditMessage(
    results: RecipeAuditResult[]
  ): string {
    if (results.length === 0) return '';

    const blockedCount = results.filter(r => r.confidenceReduction === 'Blocked').length;
    const reducedCount = results.filter(r => r.confidenceReduction === 'Reduced').length;
    const noneCount = results.filter(r => r.confidenceReduction === 'None').length;

    const lines: string[] = [];

    const blockedSuffix = blockedCount !== 1 ? 's' : '';
    const reducedSuffix = reducedCount !== 1 ? 's' : '';
    const noneSuffix = noneCount !== 1 ? 's' : '';

    if (blockedCount > 0) {
      lines.push(`⚠️ ${blockedCount} product${blockedSuffix} have blocked confidence - no contribution-based recommendations`);
    }
    if (reducedCount > 0) {
      lines.push(`⚡ ${reducedCount} product${reducedSuffix} have reduced confidence - use with caution`);
    }
    if (noneCount > 0) {
      lines.push(`✅ ${noneCount} product${noneSuffix} have complete recipes - full recommendations available`);
    }

    // Show examples of issues
    const blockedProducts = results.filter(r => r.confidenceReduction === 'Blocked');
    if (blockedProducts.length > 0) {
      lines.push('');
      lines.push('Affected products:');
      for (const r of blockedProducts.slice(0, 3)) {
        const issue = r.issues.find(i => i.issue === 'missing_recipe');
        if (issue) {
          lines.push(`  - ${r.productName}: ${issue.description}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format recipe issues for display in recommendation why field
   */
  export function formatRecipeIssuesForWhy(
    issues: RecipeIssueDescription[]
  ): string {
    if (issues.length === 0) return '';

    return `⚠️ Recipe data quality issue${issues.length > 1 ? 's' : ''}: ${issues
      .map((i) => i.description)
      .join('. ')}.`;
  }
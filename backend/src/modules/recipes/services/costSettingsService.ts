/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostSettingsService — restaurant-level cost assumptions (layered cost model).
 *
 * - get(restaurantId) → current settings, creating document defaults lazily.
 * - update(restaurantId, patch) → persist + trigger dependency-aware
 *   recalculation of ALL active recipes (a settings change affects every
 *   recipe — minor/cooking/wastage/packaging allowances are restaurant-wide).
 * - calibrate(restaurantId) → analyze recent OPERATING expenses vs sold items
 *   and suggest an allowance. Suggestion is advisory only — the merchant
 *   explicitly applies or keeps. AI never silently changes financial
 *   assumptions.
 *
 * Fixed overhead (rent/salaries) is deliberately excluded: calibration only
 * considers categories that plausibly vary per sold item (gas, electricity,
 * water, minor consumables, packaging, kitchen supplies).
 */

import mongoose from 'mongoose';
import { CostSettings, Expense, Bill, BillItem } from '../../../models';
import { AppError } from '../../../utils/AppError';
import { recalculateService } from './recalculateService';

export interface CostSettingsPatch {
  minorIngredientAllowance?: number;
  cookingAllowance?: number;
  wastagePercent?: number;
  conservativeMarkupPercent?: number;
  packaging?: { dineIn?: number; takeaway?: number; delivery?: number };
}

const DEFAULT_CALIBRATION_DAYS = 60;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// Expense categories considered variable per sold item (matching Expense.category labels).
const VARIABLE_EXPENSE_LABELS = /gas|lpg|electric|water|packaging|kitchen supply|consumable|fuel|utility/i;

export class CostSettingsService {
  async get(restaurantId: string) {
    const existing = await CostSettings.findOne({ restaurantId }).lean().exec();
    if (existing) return existing;
    // Lazy-create defaults so every restaurant has a doc (unique index).
    const created = await CostSettings.create({ restaurantId });
    return created.toObject();
  }

  async update(restaurantId: string, patch: CostSettingsPatch, ctx: { operator?: string } = {}) {
    let current = await CostSettings.findOne({ restaurantId }).exec();
    if (!current) {
      // Lazy-create so the first update also works on a fresh restaurant.
      current = await CostSettings.create({ restaurantId });
    }

    if (patch.minorIngredientAllowance !== undefined) {
      current.minorIngredientAllowance = clamp(Number(patch.minorIngredientAllowance) || 0, 0, 1000);
    }
    if (patch.cookingAllowance !== undefined) {
      current.cookingAllowance = clamp(Number(patch.cookingAllowance) || 0, 0, 1000);
    }
    if (patch.wastagePercent !== undefined) {
      current.wastagePercent = clamp(Number(patch.wastagePercent) || 0, 0, 100);
    }
    if (patch.conservativeMarkupPercent !== undefined) {
      current.conservativeMarkupPercent = clamp(Number(patch.conservativeMarkupPercent) || 0, 0, 100);
    }
    if (patch.packaging) {
      const p = patch.packaging;
      if (p.dineIn !== undefined) current.packaging.dineIn = clamp(Number(p.dineIn) || 0, 0, 1000);
      if (p.takeaway !== undefined) current.packaging.takeaway = clamp(Number(p.takeaway) || 0, 0, 1000);
      if (p.delivery !== undefined) current.packaging.delivery = clamp(Number(p.delivery) || 0, 0, 1000);
    }
    current.updatedBy = ctx.operator;
    await current.save();

    // A settings change affects every active recipe — recalc dependency-aware
    // (only this restaurant, only active recipes; historical versions frozen).
    await recalculateService.recalcAll(restaurantId, ctx.operator);

    await this.audit(restaurantId, 'COST_SETTINGS_UPDATED', ctx.operator, { patch });
    return this.get(restaurantId);
  }

  /**
   * Suggest allowances from recent data.
   *
   * operational cost per item =
   *   (variable operating expenses over window) / (sold items over window)
   *
   * Minor-ingredient suggestion: small consumables are hard to classify; we
   * suggest a floor derived from items sold × a modest per-item share of
   * "kitchen consumable"-type expenses when present, else 0 with a note.
   */
  async calibrate(restaurantId: string, opts: { days?: number } = {}) {
    const days = Math.min(90, Math.max(7, Number(opts.days) || DEFAULT_CALIBRATION_DAYS));
    const since = new Date(Date.now() - days * 86400000);
    const oid = new mongoose.Types.ObjectId(restaurantId);

    // Bills carry their line items in the separate BillItem collection;
    // voided bills are flagged with isVoided=true (voidedAt defaults to null
    // on every document, so it cannot be used for existence matching).
    const [expenses, billAgg, billIds] = await Promise.all([
      Expense.aggregate([
        { $match: { restaurantId: oid, date: { $gte: since }, isDeleted: { $ne: true } } },
        { $group: { _id: '$category', total: { $sum: '$amount' } } },
      ]).exec(),
      Bill.aggregate([
        { $match: { restaurantId: oid, createdAt: { $gte: since }, isVoided: { $ne: true }, isRefunded: { $ne: true } } },
        { $group: { _id: null, bills: { $sum: 1 } } },
      ]).exec(),
      Bill.find({
        restaurantId: oid,
        createdAt: { $gte: since },
        isVoided: { $ne: true },
        isRefunded: { $ne: true },
      }).select('_id').lean().exec(),
    ]);

    const billsCount = billAgg[0]?.bills || 0;
    // Sum quantities of all line items across those bills.
    const itemAgg = billIds.length > 0
      ? await BillItem.aggregate([
        { $match: { billId: { $in: billIds.map((b: any) => b._id) } } },
        { $group: { _id: null, items: { $sum: '$quantity' } } },
      ]).exec()
      : [];
    const itemsSold = itemAgg[0]?.items || 0;

    // Map category id → total, then bucket into operating vs consumable.
    let operating = 0;
    let consumables = 0;
    for (const e of expenses) {
      const label = String(e._id || '');
      if (VARIABLE_EXPENSE_LABELS.test(label)) operating += Number(e.total) || 0;
      if (/consumable|packaging|supply|masala|spice|garnish/i.test(label)) consumables += Number(e.total) || 0;
    }

    const cookingSuggestion = itemsSold > 0 ? Math.round((operating / itemsSold) * 100) / 100 : 0;
    const minorSuggestion = itemsSold > 0 ? Math.round((consumables / itemsSold) * 100) / 100 : 0;

    const current = await this.get(restaurantId);

    return {
      windowDays: days,
      itemsSold,
      billsCount,
      operatingExpenses: Math.round(operating * 100) / 100,
      consumableExpenses: Math.round(consumables * 100) / 100,
      suggestions: {
        cookingAllowance: { suggested: cookingSuggestion, current: current.cookingAllowance },
        minorIngredientAllowance: { suggested: minorSuggestion, current: current.minorIngredientAllowance },
      },
      // Advisory copy — shown verbatim, never auto-applied.
      summary:
        itemsSold > 0
          ? `Over the last ${days} days you sold ${itemsSold.toLocaleString('en-IN')} items. Variable operating costs were about ₹${Math.round(operating).toLocaleString('en-IN')} — roughly ₹${cookingSuggestion} per sold item (your current cooking allowance is ₹${current.cookingAllowance}).`
          : `No completed bills found in the last ${days} days — cannot calibrate from data yet. Keep your manual allowances.`,
    };
  }

  private async audit(restaurantId: string, action: string, operator: string | undefined, details: any) {
    try {
      const { auditLogRepo } = await import('../../../repositories');
      await auditLogRepo.create({
        action,
        entityType: 'cost-settings',
        entityId: restaurantId,
        performedBy: operator || 'System',
        restaurantId,
        details,
      } as any);
    } catch (err: any) {
      console.warn('[CostSettingsService] audit failed (non-fatal):', err.message);
    }
  }
}

export const costSettingsService = new CostSettingsService();

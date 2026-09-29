/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finance Service — Backend-generated financial engine (Phase 1.7).
 *
 * LAYER: CORE
 *
 * AUTHORITATIVE BUSINESS RULE: every financial report below is computed
 * server-side from the real ledger. Do not replace these calculations with
 * client-side or LLM-generated values.
 *
 * Everything is computed SERVER-side from the real ledger:
 *   - Revenue        : non-voided, non-refunded Bills (grandTotal)
 *   - Discounts/Tax  : Bill aggregates
 *   - COGS           : Ingredients & Raw Materials category (cogsMode 'auto')
 *                      or per-expense isCogs flags (cogsMode 'category'), plus
 *                      per-unit averageCost × quantity for sold items when
 *                      inventory data is present
 *   - Operating exp  : all other expense categories
 *   - Gross / Operating / Net profit
 *   - Cash flow      : CashLedger daily totals
 *   - GST            : input (expense GST) vs output (bill GST) ledger
 *
 * All reports are tenant-scoped and support branch isolation + date ranges.
 */

import mongoose from 'mongoose';
import { billRepo, financeSettingsRepo } from '../repositories';
import Bill from '../models/Bill';
import Expense from '../models/Expense';
import Product from '../models/Product';
import BillItem from '../models/BillItem';
import FinanceSettings from '../models/FinanceSettings';
import InventoryEvent from '../models/InventoryEvent';
import { cashLedgerService } from './index';
import { SYSTEM_CATEGORIES } from './expenseCategoryService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/** Clamp a date range to [start, end], both inclusive. */
function dateRange(startDate?: string, endDate?: string): { start: string; end: string } {
  const now = new Date().toISOString().slice(0, 10);
  return {
    start: startDate || now,
    end: endDate || now,
  };
}

export class FinanceService {
  /**
   * Ensure per-restaurant finance settings exist (upsert defaults).
   *
   * Atomic upsert (not find-then-create) so concurrent callers — e.g. the
   * admin finance overview which resolves getSettings inside Promise.all —
   * never race into a duplicate-key error on the unique restaurantId index.
   */
  async getSettings(restaurantId: string) {
    const settings = await financeSettingsRepo.forTenant(restaurantId).findOne({} as any);
    if (settings) return settings.toObject();
    return this.ensureSettings(restaurantId);
  }

  async ensureSettings(restaurantId: string) {
    const rid = objectId(restaurantId);
    const settings = await FinanceSettings.findOneAndUpdate(
      { restaurantId: rid },
      { $setOnInsert: { restaurantId: rid } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean().exec();
    return settings;
  }

  async updateSettings(restaurantId: string, patch: Record<string, any>, ctx: { operator?: string } = {}) {
    const settings = await financeSettingsRepo.forTenant(restaurantId).findOneAndUpdate(
      {} as any,
      { ...patch, updatedBy: ctx.operator } as any,
      { upsert: true }
    );
    return settings?.toObject();
  }

  /**
   * COGS estimate for a bill from inventory: Σ (averageCost × quantity) per
   * line item, matched by menuItemId (or itemName fallback). Best-effort —
   * items without product cost data contribute 0.
   */
  private async billCogsFromInventory(items: any[], restaurantId?: string): Promise<number> {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const ids = items
      .map((i: any) => i.menuItemId)
      .filter((id: any) => id && /^[a-fA-F0-9]{24}$/.test(String(id)));
    const names = items
      .map((i: any) => i.itemName)
      .filter(Boolean) as string[];
    // TENANT SCOPING: the id lookup is inherently safe, but the name fallback
    // MUST be scoped to this restaurant — different tenants can legally share
    // item names and an unscoped match would cost one tenant another tenant's
    // ingredient price.
    const tenantMatch: Record<string, any> = restaurantId
      ? { restaurantId: objectId(restaurantId) }
      : {};
    const [byId, byName] = await Promise.all([
      ids.length > 0 ? Product.find({ _id: { $in: ids.map(objectId) }, ...tenantMatch, isDeleted: { $ne: true } }).select('_id averageCost').lean().exec() : [],
      names.length > 0 ? Product.find({ name: { $in: names }, ...tenantMatch, isDeleted: { $ne: true } }).select('_id name averageCost').lean().exec() : [],
    ]);
    const costById = new Map(byId.map((p: any) => [p._id.toString(), p.averageCost || 0]));
    const costByName = new Map(byName.map((p: any) => [(p.name || '').toLowerCase(), p.averageCost || 0]));
    return Math.round(
      items.reduce((sum, i: any) => {
        let cost = costById.get(String(i.menuItemId));
        if (cost === undefined) cost = costByName.get(String(i.itemName || '').toLowerCase()) || 0;
        return sum + (cost || 0) * (Number(i.quantity) || 0);
      }, 0) * 100
    ) / 100;
  }

  /**
   * Profit & Loss for a period. Periods: 'today' | 'week' | 'month' | 'year' |
   * custom (startDate/endDate).
   */
  async pnl(
    restaurantId: string,
    params: { period?: 'today' | 'week' | 'month' | 'year' | 'custom'; startDate?: string; endDate?: string; branchId?: string } = {}
  ) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let start = todayStr;
    let end = todayStr;

    const period = params.period || 'today';
    if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      start = d.toISOString().slice(0, 10);
    } else if (period === 'month') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (period === 'year') {
      start = `${now.getFullYear()}-01-01`;
    } else if (period === 'custom') {
      ({ start, end } = dateRange(params.startDate, params.endDate));
    }

    // Tenant-scoped: this restaurant's bills ONLY. Without this filter the
    // P&L silently merged every other tenant's bills (same database) into
    // revenue/GST/orders — a cross-tenant data leak.
    const billMatch: any = {
      restaurantId: objectId(restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
    };
    if (params.branchId) billMatch.branchId = objectId(params.branchId);

    const [billAgg, billIds, expenseAgg, settings] = await Promise.all([
      Bill.aggregate([
        { $match: billMatch },
        {
          $group: {
            _id: null,
            revenue: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, { $subtract: ['$grandTotal', '$refundAmount'] }, '$grandTotal'] } },
            refunds: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, '$refundAmount', 0] } },
            discounts: { $sum: '$discount' },
            gstCollected: { $sum: '$gst' },
            orders: { $sum: 1 },
          },
        },
      ]).exec(),
      // Only this period's bill ids — the old BillItem.find({}) pulled EVERY
      // tenant's line items into memory before filtering.
      Bill.find(billMatch).select('_id').lean().exec(),
      Expense.aggregate([
        {
          $match: {
            restaurantId: objectId(restaurantId),
            date: { $gte: start, $lte: end },
            isDeleted: { $ne: true },
            ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
          },
        },
        {
          $group: {
            // Group by category AND the per-expense COGS flag so both modes
            // ('auto' by category name, 'category' by explicit isCogs) work.
            // isSystemGenerated separates purchase-generated expenses (cash
            // view) from manual entries (period expense view).
            _id: {
              category: '$category',
              isCogs: { $ifNull: ['$isCogs', false] },
              isSystemGenerated: { $ifNull: ['$isSystemGenerated', false] },
            },
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]).exec(),
      this.getSettings(restaurantId),
    ]);

    const totals = billAgg[0] || { revenue: 0, refunds: 0, discounts: 0, gstCollected: 0, orders: 0 };
    const revenue = Math.round(totals.revenue * 100) / 100;

    // Line items for THIS period's bills only (recipe/inventory COGS input).
    const idSet = new Set(billIds.map((b: any) => b._id.toString()));
    const periodItems = idSet.size > 0
      ? await BillItem.find({ billId: { $in: [...idSet].map(objectId) } })
          .select('billId menuItemId itemName quantity priceAtSale').lean().exec()
      : [];

    // COGS strategy:
    //   'auto'    → the Ingredients & Raw Materials category is COGS (legacy)
    //   'category'→ every expense explicitly flagged isCogs is COGS
    // Inventory-based COGS (recipe cost) is always added when available.
    const cogsMode = settings?.cogsMode || 'auto';
    const cogsCategoryName = SYSTEM_CATEGORIES.find((c) => c.isCogs)?.name;

    const expenseByCategory: Record<string, { amount: number; count: number }> = {};
    let cogs = 0;
    /** COGS that lives IN the expense ledger (flags/category + Wastage). */
    let expenseLedgerCogs = 0;
    /** Cash view: total of purchase-generated expenses (what was bought & paid). */
    let ingredientPurchases = 0;
    let ingredientPurchaseCount = 0;
    for (const row of expenseAgg) {
      const category = String(row._id?.category || 'Miscellaneous');
      if (row._id?.isSystemGenerated === true) {
        // Purchase-generated expenses are the CASH view of ingredient buying.
        // They are NOT period P&L expenses: the stock they buy is priced into
        // COGS when actually consumed (FIFO batch costs), so including them
        // here as well would double count. Reported separately below.
        ingredientPurchases = Math.round((ingredientPurchases + row.amount) * 100) / 100;
        ingredientPurchaseCount += row.count;
        continue;
      }
      expenseByCategory[category] = {
        amount: Math.round((expenseByCategory[category]?.amount || 0) + row.amount * 100) / 100,
        count: (expenseByCategory[category]?.count || 0) + row.count,
      };
      const isCogsRow = cogsMode === 'auto'
        ? category === cogsCategoryName
        : row._id?.isCogs === true;
      if (isCogsRow) {
        cogs += row.amount;
        expenseLedgerCogs += row.amount;
      }
    }

    // Usage COGS — prefer the REAL FIFO cost recorded on 'sold' inventory
    // events at consumption time (each consumed unit is priced from the
    // purchase-price-pinned batch it came out of). Fall back to the
    // bill-item × averageCost estimate only when a tenant has no recorded
    // consumption costs (legacy events / no recipe or stock tracking).
    let cogsSource: 'recorded' | 'estimate' = 'estimate';
    const soldEvents: any[] = await InventoryEvent.find({
      restaurantId: objectId(restaurantId),
      type: 'sold',
      eventDate: { $gte: start, $lte: end },
      ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
    }).select('item quantity totalCost').lean().exec();
    const soldWithCost = soldEvents.filter((e) => e.totalCost != null);
    if (soldEvents.length > 0) {
      let usageCost = soldWithCost.reduce((s, e) => s + (Number(e.totalCost) || 0), 0);
      if (soldWithCost.length < soldEvents.length) {
        // Some events predate cost tracking — value those at averageCost.
        const fallbackProducts: any[] = await Product.find({
          restaurantId: objectId(restaurantId),
          isDeleted: { $ne: true },
        }).select('name averageCost').limit(1000).lean().exec();
        const fallbackCostByName = new Map(fallbackProducts.map((p: any) => [String(p.name || '').toLowerCase(), Number(p.averageCost) || 0]));
        for (const e of soldEvents) {
          if (e.totalCost != null) continue;
          usageCost += Math.abs(Number(e.quantity) || 0) * (fallbackCostByName.get(String(e.item || '').toLowerCase()) || 0);
        }
      }
      cogs += Math.round(usageCost * 100) / 100;
      cogsSource = soldWithCost.length > 0 ? 'recorded' : 'estimate';
    } else {
      cogs += await this.billCogsFromInventory(periodItems, restaurantId);
    }

    // Wastage cost — recorded InventoryEvent 'waste' rows × the item's real
    // averageCost (rolling purchase average maintained by the stock engine).
    // Wasted stock is consumed but never sold; it belongs in COGS, not in an
    // operating-expense bucket, so gross profit reflects true ingredient loss.
    const wasteEvents: any[] = await InventoryEvent.find({
      restaurantId: objectId(restaurantId),
      type: 'waste',
      eventDate: { $gte: start, $lte: end },
      ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
    }).select('item quantity unit branchId totalCost').lean().exec();
    if (wasteEvents.length > 0) {
      // Prefer the REAL FIFO cost recorded at waste time; fall back to the
      // item's averageCost only for legacy events without a recorded cost.
      const wasteWithCost = wasteEvents.filter((w) => w.totalCost != null);
      let wastageCost = wasteWithCost.reduce((s, w) => s + (Number(w.totalCost) || 0), 0);
      if (wasteWithCost.length < wasteEvents.length) {
        // Case-insensitive name match against the tenant's real catalog —
        // events store display names, the catalog is the cost source.
        const wasteProducts: any[] = await Product.find({
          restaurantId: objectId(restaurantId),
          isDeleted: { $ne: true },
        }).select('name averageCost').limit(1000).lean().exec();
        const costByName = new Map(wasteProducts.map((p: any) => [String(p.name || '').toLowerCase(), Number(p.averageCost) || 0]));
        for (const w of wasteEvents) {
          if (w.totalCost != null) continue;
          const cost = costByName.get(String(w.item || '').toLowerCase()) || 0;
          wastageCost += Math.abs(Number(w.quantity) || 0) * cost;
        }
      }
      wastageCost = Math.round(wastageCost * 100) / 100;
      cogs += wastageCost;
      expenseLedgerCogs += wastageCost;
      expenseByCategory['Wastage'] = {
        amount: wastageCost,
        count: wasteEvents.length,
      };
    }
    cogs = Math.round(cogs * 100) / 100;
    expenseLedgerCogs = Math.round(expenseLedgerCogs * 100) / 100;

    const totalExpenses = Math.round(Object.values(expenseByCategory).reduce((s, c) => s + c.amount, 0) * 100) / 100;
    // Operating expenses = ledger expenses minus the COGS portion that lives
    // in the ledger. Usage cost recorded on stock events (sold consumption)
    // has no expense-ledger counterpart, so subtracting it here as well would
    // double count it out of profit.
    const operatingExpenses = Math.round((totalExpenses - expenseLedgerCogs) * 100) / 100;
    const grossProfit = Math.round((revenue - cogs) * 100) / 100;
    const operatingProfit = Math.round((grossProfit - operatingExpenses) * 100) / 100;
    const netProfit = operatingProfit;

    return {
      period,
      startDate: start,
      endDate: end,
      revenue,
      refunds: Math.round(totals.refunds * 100) / 100,
      discounts: Math.round(totals.discounts * 100) / 100,
      gstCollected: Math.round(totals.gstCollected * 100) / 100,
      orders: totals.orders,
      cogs,
      grossProfit,
      operatingExpenses,
      netProfit,
      totalExpenses,
      expenseByCategory,
      ingredientPurchases,
      ingredientPurchaseCount,
      cogsSource,
      margin: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
    };
  }

  /**
   * Dashboard financial summary for a period ('today' | 'week' | 'month' |
   * 'year'). Bundles revenue, expenses, profit, cash, GST and vendor dues.
   */
  async summary(
    restaurantId: string,
    params: { period?: 'today' | 'week' | 'month' | 'year'; branchId?: string } = {}
  ) {
    const period = params.period || 'today';
    const pnl = await this.pnl(restaurantId, { period, branchId: params.branchId });
    const [cash, cashFlow, gst, vendorDues, drawer] = await Promise.all([
      cashLedgerService.getBalance(restaurantId, params.branchId),
      cashLedgerService.dailyTotals(restaurantId, params.branchId, pnl.startDate, pnl.endDate),
      this.gstReport(restaurantId, { startDate: pnl.startDate, endDate: pnl.endDate, branchId: params.branchId }),
      this.vendorDues(restaurantId),
      this.drawerBalance(restaurantId, params.branchId),
    ]);

    return {
      period,
      startDate: pnl.startDate,
      endDate: pnl.endDate,
      pnl: {
        revenue: pnl.revenue,
        expenses: pnl.totalExpenses,
        cogs: pnl.cogs,
        grossProfit: pnl.grossProfit,
        netProfit: pnl.netProfit,
        margin: pnl.margin,
        orders: pnl.orders,
      },
      cash: {
        balance: cash,
        inflows: Math.round((cashFlow as any[]).reduce((s: number, d: any) => s + (d.cashIn || 0), 0) * 100) / 100,
        outflows: Math.round((cashFlow as any[]).reduce((s: number, d: any) => s + (d.cashOut || 0), 0) * 100) / 100,
        overShort: Math.round((cashFlow as any[]).reduce((s: number, d: any) => s + (d.overShort || 0), 0) * 100) / 100,
      },
      gst: {
        outputGst: gst.outputGst,
        inputGst: gst.inputGst,
        payable: gst.netPayable,
      },
      vendorDues,
      drawerBalance: drawer,
    };
  }

  /** Cash flow report — daily in/out/expense/adjustment totals + closing. */
  async cashFlow(restaurantId: string, params: { startDate?: string; endDate?: string; branchId?: string } = {}) {
    const { start, end } = dateRange(params.startDate, params.endDate);
    const rows = await cashLedgerService.dailyTotals(restaurantId, params.branchId, start, end);
    let running = 0;
    return rows.map((r: any) => {
      const opening = r.opening || 0;
      const net = (r.cashIn || 0) - (r.cashOut || 0) + (r.adjustments || 0) + (r.overShort || 0);
      // Opening cash is real money added to the drawer at start of day.
      running = Math.round((running + opening + net) * 100) / 100;
      return {
        date: r._id,
        opening,
        cashIn: r.cashIn || 0,
        cashOut: r.cashOut || 0,
        expenses: r.expenses || 0,
        adjustments: r.adjustments || 0,
        overShort: r.overShort || 0,
        net,
        closing: running,
      };
    });
  }

  /**
   * GST report — output GST from bills, input GST from expenses, net payable.
   */
  async gstReport(restaurantId: string, params: { startDate?: string; endDate?: string; branchId?: string } = {}) {
    const { start, end } = dateRange(params.startDate, params.endDate);
    const [billAgg, expenseAgg] = await Promise.all([
      Bill.aggregate([
        {
          $match: {
            restaurantId: objectId(restaurantId),
            date: { $gte: start, $lte: end },
            isVoided: { $ne: true },
            isRefunded: { $ne: true },
            ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
          },
        },
        {
          $group: {
            _id: null,
            outputGst: { $sum: '$gst' },
            taxableValue: { $sum: { $subtract: ['$grandTotal', '$gst'] } },
            bills: { $sum: 1 },
          },
        },
      ]).exec(),
      Expense.aggregate([
        {
          $match: {
            restaurantId: objectId(restaurantId),
            date: { $gte: start, $lte: end },
            isDeleted: { $ne: true },
            ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
          },
        },
        {
          $group: {
            _id: null,
            inputCgst: { $sum: { $ifNull: ['$gst.cgst', 0] } },
            inputSgst: { $sum: { $ifNull: ['$gst.sgst', 0] } },
            inputIgst: { $sum: { $ifNull: ['$gst.igst', 0] } },
            inputCess: { $sum: { $ifNull: ['$gst.cess', 0] } },
            expenses: { $sum: 1 },
          },
        },
      ]).exec(),
    ]);

    const out = billAgg[0] || { outputGst: 0, taxableValue: 0, bills: 0 };
    const inp = expenseAgg[0] || { inputCgst: 0, inputSgst: 0, inputIgst: 0, inputCess: 0, expenses: 0 };
    const inputGst = Math.round((inp.inputCgst + inp.inputSgst + inp.inputIgst + inp.inputCess) * 100) / 100;
    return {
      startDate: start,
      endDate: end,
      outputGst: Math.round(out.outputGst * 100) / 100,
      outputTaxableValue: Math.round(out.taxableValue * 100) / 100,
      inputGst,
      inputCgst: inp.inputCgst, inputSgst: inp.inputSgst,
      inputIgst: inp.inputIgst, inputCess: inp.inputCess,
      netPayable: Math.round((out.outputGst - inputGst) * 100) / 100,
      outputBills: out.bills,
      inputExpenses: inp.expenses,
    };
  }

  /** Vendor dues — total outstanding across all vendors (from expenses). */
  async vendorDues(restaurantId: string): Promise<{ total: number; count: number }> {
    // Outstanding = credit-term expenses (Bank Transfer / Other). Cash, UPI,
    // Card and Wallet are settled immediately. Consistent with vendorService.
    const agg = await Expense.aggregate([
      { $match: { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $in: ['$paymentMethod', ['Bank Transfer', 'Other']] }, '$amount', 0],
            },
          },
          count: {
            $sum: {
              $cond: [{ $in: ['$paymentMethod', ['Bank Transfer', 'Other']] }, 1, 0],
            },
          },
        },
      },
    ]).exec();
    const row = agg[0] || { total: 0, count: 0 };
    return { total: Math.round(row.total * 100) / 100, count: row.count };
  }

  /** Drawer balance (cash on hand now). */
  async drawerBalance(restaurantId: string, branchId?: string) {
    return cashLedgerService.getBalance(restaurantId, branchId);
  }

  /**
   * Expense register / category report / branch summary — shared aggregation.
   */
  async expenseRegister(
    restaurantId: string,
    params: { startDate?: string; endDate?: string; branchId?: string; groupBy?: 'category' | 'branch' | 'vendor' | 'paymentMethod' } = {}
  ) {
    const { start, end } = dateRange(params.startDate, params.endDate);
    const groupBy = params.groupBy || 'category';
    const rows = await Expense.aggregate([
      {
        $match: {
          restaurantId: objectId(restaurantId),
          date: { $gte: start, $lte: end },
          isDeleted: { $ne: true },
          ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
        },
      },
      {
        $group: {
          _id: `$${groupBy === 'paymentMethod' ? 'paymentMethod' : groupBy === 'branch' ? 'branchId' : groupBy === 'vendor' ? 'vendorId' : 'category'}`,
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]).exec();

    return {
      startDate: start,
      endDate: end,
      groupBy,
      rows: rows.map((r: any) => ({
        key: r._id ? r._id.toString() : 'Unassigned',
        label: r._id ? r._id.toString() : 'Unassigned',
        amount: Math.round(r.amount * 100) / 100,
        count: r.count,
      })),
      total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    };
  }

  /** Monthly statement — P&L grouped by month for the year. */
  async monthlyStatement(restaurantId: string, year?: number) {
    const y = year || new Date().getFullYear();
    const start = `${y}-01-01`;
    const end = `${y}-12-31`;

    const [billAgg, expenseAgg] = await Promise.all([
      // Tenant-scoped — same rule as pnl(): never mix tenants' bills.
      Bill.aggregate([
        { $match: { restaurantId: objectId(restaurantId), date: { $gte: start, $lte: end }, isVoided: { $ne: true } } },
        {
          $group: {
            _id: { $substr: ['$date', 0, 7] },
            revenue: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, { $subtract: ['$grandTotal', '$refundAmount'] }, '$grandTotal'] } },
            discounts: { $sum: '$discount' },
            gst: { $sum: '$gst' },
            orders: { $sum: 1 },
          },
        },
      ]).exec(),
      Expense.aggregate([
        {
          $match: {
            restaurantId: objectId(restaurantId),
            date: { $gte: start, $lte: end },
            isDeleted: { $ne: true },
            // Purchase-generated expenses are excluded from the usage P&L —
            // bought stock is priced into COGS when consumed (same rule as pnl()).
            isSystemGenerated: { $ne: true },
          },
        },
        {
          $group: {
            _id: { month: { $substr: ['$date', 0, 7] }, isCogs: '$isCogs', category: '$category' },
            amount: { $sum: '$amount' },
          },
        },
      ]).exec(),
    ]);

    const billsByMonth = new Map(billAgg.map((r: any) => [r._id, r]));
    // Same COGS rule as pnl(): 'auto' uses the system COGS category name,
    // 'category' uses the per-expense isCogs flag. Grouping by BOTH category
    // and isCogs lets either mode resolve per row.
    const settings = await this.getSettings(restaurantId);
    const cogsMode = settings?.cogsMode || 'auto';
    const cogsCategoryName = SYSTEM_CATEGORIES.find((c) => c.isCogs)?.name;
    const expenseByMonth = new Map<string, { cogs: number; ops: number }>();
    for (const r of expenseAgg) {
      const entry = expenseByMonth.get(r._id.month) || { cogs: 0, ops: 0 };
      const isCogsRow = cogsMode === 'auto'
        ? r._id.category === cogsCategoryName
        : r._id.isCogs === true;
      if (isCogsRow) entry.cogs += r.amount; else entry.ops += r.amount;
      expenseByMonth.set(r._id.month, entry);
    }

    // Wastage cost per month — prefer the REAL FIFO cost recorded at waste
    // time (totalCost); fall back to averageCost for legacy events (same rule
    // as pnl()).
    const wasteEvents: any[] = await InventoryEvent.find({
      restaurantId: objectId(restaurantId),
      type: 'waste',
      eventDate: { $gte: start, $lte: end },
    }).select('item quantity eventDate totalCost').lean().exec();
    const costByName = new Map<string, number>();
    if (wasteEvents.some((w) => w.totalCost == null)) {
      const catalog: any[] = await Product.find({ restaurantId: objectId(restaurantId), isDeleted: { $ne: true } })
        .select('name averageCost').limit(1000).lean().exec();
      for (const p of catalog) costByName.set(String(p.name || '').toLowerCase(), Number(p.averageCost) || 0);
    }
    const wasteByMonth = new Map<string, number>();
    for (const w of wasteEvents) {
      const month = String(w.eventDate || '').slice(0, 7);
      const cost = w.totalCost != null
        ? Math.round((Number(w.totalCost) || 0) * 100) / 100
        : Math.round(Math.abs(Number(w.quantity) || 0) * (costByName.get(String(w.item || '').toLowerCase()) || 0) * 100) / 100;
      wasteByMonth.set(month, Math.round(((wasteByMonth.get(month) || 0) + cost) * 100) / 100);
    }

    // Usage COGS per month — prefer recorded FIFO costs from 'sold' events;
    // only fall back to the bill-item × averageCost estimate when the tenant
    // has no recorded consumption costs at all (same rule as pnl()).
    const soldEventsYear: any[] = await InventoryEvent.find({
      restaurantId: objectId(restaurantId),
      type: 'sold',
      eventDate: { $gte: start, $lte: end },
    }).select('item quantity eventDate totalCost').lean().exec();
    const soldWithCostYear = soldEventsYear.filter((e) => e.totalCost != null);
    if (soldEventsYear.length > 0) {
      for (const e of soldEventsYear) {
        const month = String(e.eventDate || '').slice(0, 7);
        let cost = e.totalCost != null ? Number(e.totalCost) || 0 : 0;
        if (e.totalCost == null) {
          cost = Math.abs(Number(e.quantity) || 0) * (costByName.get(String(e.item || '').toLowerCase()) || 0);
        }
        wasteByMonth.set(month, Math.round(((wasteByMonth.get(month) || 0) + cost) * 100) / 100);
      }
    }

    // Estimate fallback only when there are no sold events to derive from.
    const yearBills: any[] = soldEventsYear.length > 0
      ? []
      : await Bill.find({ restaurantId: objectId(restaurantId), date: { $gte: start, $lte: end }, isVoided: { $ne: true } })
          .select('_id date').lean().exec();
    const billMonth = new Map<string, string>();
    for (const b of yearBills) billMonth.set(b._id.toString(), String(b.date).slice(0, 7));
    const yearItems = yearBills.length > 0
      ? await BillItem.find({ billId: { $in: yearBills.map((b: any) => b._id) } })
          .select('billId menuItemId itemName quantity').lean().exec()
      : [];
    if (yearItems.length > 0) {
      const ids = [...new Set(yearItems.map((i: any) => String(i.menuItemId)).filter((id: any) => /^[a-fA-F0-9]{24}$/.test(String(id))))];
      const names = [...new Set(yearItems.map((i: any) => String(i.itemName || '')).filter(Boolean))];
      // Tenant-scoped (same rule as billCogsFromInventory).
      const [byId, byName] = await Promise.all([
        ids.length > 0 ? Product.find({ _id: { $in: ids.map(objectId) }, restaurantId: objectId(restaurantId), isDeleted: { $ne: true } }).select('_id averageCost').lean().exec() : [],
        names.length > 0 ? Product.find({ name: { $in: names }, restaurantId: objectId(restaurantId), isDeleted: { $ne: true } }).select('_id name averageCost').lean().exec() : [],
      ]);
      const itemCostById = new Map(byId.map((p: any) => [p._id.toString(), Number(p.averageCost) || 0]));
      const itemCostByName = new Map(byName.map((p: any) => [String(p.name || '').toLowerCase(), Number(p.averageCost) || 0]));
      for (const it of yearItems) {
        const month = billMonth.get(String(it.billId));
        if (!month) continue;
        let cost = itemCostById.get(String(it.menuItemId));
        if (cost === undefined) cost = itemCostByName.get(String(it.itemName || '').toLowerCase()) || 0;
        if (cost > 0) {
          const lineCost = Math.round(cost * (Number(it.quantity) || 0) * 100) / 100;
          wasteByMonth.set(month, Math.round(((wasteByMonth.get(month) || 0) + lineCost) * 100) / 100);
        }
      }
    }

    const months: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const b = billsByMonth.get(key) || { revenue: 0, discounts: 0, gst: 0, orders: 0 };
      const e = expenseByMonth.get(key) || { cogs: 0, ops: 0 };
      const revenue = Math.round(b.revenue * 100) / 100;
      // Expense COGS + wastage cost + recipe/inventory COGS (same rule as pnl()).
      const cogs = Math.round((e.cogs + (wasteByMonth.get(key) || 0)) * 100) / 100;
      const ops = Math.round(e.ops * 100) / 100;
      months.push({
        month: key,
        revenue,
        discounts: Math.round(b.discounts * 100) / 100,
        gst: Math.round(b.gst * 100) / 100,
        orders: b.orders,
        cogs,
        operatingExpenses: ops,
        grossProfit: Math.round((revenue - cogs) * 100) / 100,
        netProfit: Math.round((revenue - cogs - ops) * 100) / 100,
      });
    }
    return { year: y, months };
  }

  /** Branch comparison — revenue, expenses and profit per branch. */
  async branchComparison(restaurantId: string, params: { startDate?: string; endDate?: string } = {}) {
    const { start, end } = dateRange(params.startDate, params.endDate);
    const [bills, expenses] = await Promise.all([
      Bill.aggregate([
        { $match: { restaurantId: objectId(restaurantId), date: { $gte: start, $lte: end }, isVoided: { $ne: true } } },
        {
          $group: {
            _id: '$branchId',
            revenue: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, { $subtract: ['$grandTotal', '$refundAmount'] }, '$grandTotal'] } },
            discounts: { $sum: '$discount' },
            orders: { $sum: 1 },
          },
        },
      ]).exec(),
      Expense.aggregate([
        {
          $match: {
            restaurantId: objectId(restaurantId),
            date: { $gte: start, $lte: end },
            isDeleted: { $ne: true },
            // Usage view: purchase-generated expenses excluded (same rule as pnl()).
            isSystemGenerated: { $ne: true },
          },
        },
        { $group: { _id: '$branchId', amount: { $sum: '$amount' }, cogs: { $sum: { $cond: ['$isCogs', '$amount', 0] } } } },
      ]).exec(),
    ]);

    const expMap = new Map(expenses.map((r: any) => [String(r._id), r]));
    return {
      startDate: start,
      endDate: end,
      branches: bills.map((b: any) => {
        const e = expMap.get(String(b._id)) || { amount: 0, cogs: 0 };
        const revenue = Math.round(b.revenue * 100) / 100;
        const ops = Math.round((e.amount - e.cogs) * 100) / 100;
        return {
          branchId: b._id ? b._id.toString() : 'HQ',
          revenue,
          discounts: Math.round(b.discounts * 100) / 100,
          orders: b.orders,
          expenses: Math.round(e.amount * 100) / 100,
          cogs: Math.round(e.cogs * 100) / 100,
          operatingExpenses: ops,
          netProfit: Math.round((revenue - e.cogs - ops) * 100) / 100,
        };
      }),
    };
  }

  /** Export a finance report to CSV (pnl / cashflow / gst / register). */
  async exportCsv(
    restaurantId: string,
    report: 'pnl' | 'cashflow' | 'gst' | 'register' | 'monthly',
    params: any = {}
  ): Promise<string> {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];

    if (report === 'pnl') {
      const p = await this.pnl(restaurantId, { period: 'custom', startDate: params.startDate, endDate: params.endDate, branchId: params.branchId });
      lines.push(['Metric', 'Value'].map(esc).join(','));
      for (const [k, v] of Object.entries(p)) {
        if (k === 'expenseByCategory') continue;
        lines.push([k, typeof v === 'object' ? JSON.stringify(v) : v].map(esc).join(','));
      }
      lines.push('', 'Category', 'Amount', 'Count');
      for (const [cat, row] of Object.entries(p.expenseByCategory || {})) {
        lines.push([cat, (row as any).amount, (row as any).count].map(esc).join(','));
      }
    } else if (report === 'cashflow') {
      const rows = await this.cashFlow(restaurantId, params);
      lines.push(['Date', 'Opening', 'Cash In', 'Cash Out', 'Expenses', 'Adjustments', 'Over/Short', 'Net', 'Closing'].join(','));
      rows.forEach((r: any) => lines.push([r.date, r.opening, r.cashIn, r.cashOut, r.expenses, r.adjustments, r.overShort, r.net, r.closing].map(esc).join(',')));
    } else if (report === 'gst') {
      const g = await this.gstReport(restaurantId, params);
      lines.push(['Metric', 'Value'].map(esc).join(','));
      Object.entries(g).forEach(([k, v]) => lines.push([k, v].map(esc).join(',')));
    } else if (report === 'register') {
      const r = await this.expenseRegister(restaurantId, params);
      lines.push(['Group', 'Amount', 'Count'].map(esc).join(','));
      r.rows.forEach((row: any) => lines.push([row.label, row.amount, row.count].map(esc).join(',')));
      lines.push(['TOTAL', r.total, r.rows.reduce((s: number, x: any) => s + x.count, 0)].map(esc).join(','));
    } else if (report === 'monthly') {
      const m = await this.monthlyStatement(restaurantId, params.year ? Number(params.year) : undefined);
      lines.push(['Month', 'Revenue', 'Discounts', 'GST', 'Orders', 'COGS', 'Operating Expenses', 'Gross Profit', 'Net Profit'].map(esc).join(','));
      m.months.forEach((row: any) => lines.push([row.month, row.revenue, row.discounts, row.gst, row.orders, row.cogs, row.operatingExpenses, row.grossProfit, row.netProfit].map(esc).join(',')));
    }

    return lines.join('\n');
  }
}

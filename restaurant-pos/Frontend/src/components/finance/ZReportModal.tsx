/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { FileText, Sparkles, X } from 'lucide-react';
import type { Product, SystemSettings } from '../../types';
import DailySummaryIntelligence from './DailySummaryIntelligence';
// PHASE 3: the AI Closing Assistant component was removed with the AI layer.
// The Z-report remains fully deterministic. The Daily Summary button below is
// a SEPARATE, additive surface: it opens the AI intelligence modal and changes
// nothing in this deterministic report.

interface ZReportData {
  totalSales: number;
  totalDiscounts: number;
  totalTax: number;
  orderCount: number;
  itemCount: number;
  avgOrderValue: number;
  paymentMethods: Record<string, { count: number; amount: number }>;
  cashiers: Record<string, { orders: number; revenue: number }>;
}

interface ZReportModalProps {
  isOpen: boolean;
  zReportData: ZReportData;
  settings: SystemSettings;
  moduleSettings?: Record<string, boolean>;
  products?: Product[];
  onClose: () => void;
}

export default function ZReportModal({ isOpen, zReportData, settings, moduleSettings = {} as Record<string, boolean>, products = [], onClose }: ZReportModalProps) {
  // PHASE 3: the low-stock / waste-cost fetches only fed the AI Closing
  // Assistant, which was removed with the AI layer. The Z-report itself is
  // fully deterministic and unaffected.
  void products;
  // Separate modal state: the deterministic report never depends on the AI run.
  const [showDailySummary, setShowDailySummary] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[var(--color-border-default)] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-1.5"><FileText className="w-4 h-4 text-purple-600" /> End-of-Day Z-Report</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><p className="text-[10px] text-purple-700 font-bold uppercase">Total Sales</p><p className="text-lg font-bold font-mono text-purple-800">{settings.currencySymbol}{zReportData.totalSales.toFixed(2)}</p></div>
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><p className="text-[10px] text-blue-700 font-bold uppercase">Orders</p><p className="text-lg font-bold font-mono text-blue-800">{zReportData.orderCount}</p></div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><p className="text-[10px] text-amber-700 font-bold uppercase">Discounts</p><p className="text-lg font-bold font-mono text-amber-800">{settings.currencySymbol}{zReportData.totalDiscounts.toFixed(2)}</p></div>
            <div className="bg-green-50 rounded-lg p-3 border border-green-200"><p className="text-[10px] text-green-700 font-bold uppercase">Avg Order</p><p className="text-lg font-bold font-mono text-green-800">{settings.currencySymbol}{zReportData.avgOrderValue.toFixed(2)}</p></div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-700 mb-2">Payment Methods</h4>
            <div className="space-y-1">
              {Object.entries(zReportData.paymentMethods).map(([method, data]) => (
                <div key={method} className="flex justify-between text-xs"><span className="font-semibold">{method}</span><span className="font-mono">{data.count} orders - {settings.currencySymbol}{data.amount.toFixed(2)}</span></div>
              ))}
            </div>
          </div>
          {moduleSettings.showCashierPerformance !== false && (
            <div>
              <h4 className="text-xs font-bold text-gray-700 mb-2">Cashier Performance</h4>
              <div className="space-y-1">
                {Object.entries(zReportData.cashiers).map(([name, data]) => (
                  <div key={name} className="flex justify-between text-xs"><span className="font-semibold">{name}</span><span className="font-mono">{data.orders} orders - {settings.currencySymbol}{data.revenue.toFixed(2)}</span></div>
                ))}
              </div>
            </div>
          )}

          {/* AI Closing Assistant — removed (Phase 3, AI-only).
              The Daily Summary below is the separate, server-grounded
              intelligence path (POST /ai/z-report/generate). */}
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-purple-200 bg-purple-50/60 px-3.5 py-3">
            <div>
              <p className="text-[11px] font-black text-purple-700 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Daily Summary
              </p>
              <p className="text-[11px] text-gray-600 mt-0.5">
                What happened today, what mattered, what needs attention and what to focus on next.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDailySummary(true)}
              className="shrink-0 flex items-center gap-1.5 border border-purple-300 bg-white text-purple-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-purple-100 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Generate Daily Summary
            </button>
          </div>
        </div>
      </div>

      <DailySummaryIntelligence isOpen={showDailySummary} onClose={() => setShowDailySummary(false)} />
    </div>
  );
}

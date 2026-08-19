/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Product, SystemSettings } from '../../types';
import { fetchInventoryEvents } from '../../api/client';
import ClosingAssistant from '../../ai/ClosingAssistant';

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
  // REAL low-stock count — products at/below their minimum threshold, same
  // calculation the inventory dashboard uses. Previously the AI closing
  // assistant was hardcoded lowStockItems={0} so it always said stock was fine.
  const lowStockItems = products.filter((p: any) =>
    Number(p.currentStock) <= Number(p.minStock) && Number(p.minStock) > 0
  ).length;

  // REAL waste cost today — fetch waste events from the backend. Previously
  // hardcoded wasteCost={0}, so the assistant always reported "waste under
  // control" even when the restaurant logged waste.
  const [wasteCost, setWasteCost] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    fetchInventoryEvents({ type: 'waste', limit: 200 })
      .then((events) => {
        if (cancelled || !events) return;
        setWasteCost(events
          .filter((e: any) => String(e.timestamp || '').slice(0, 10) === todayStr)
          .reduce((s: number, e: any) => s + Math.abs(Number(e.quantity) || 0) * (Number((products as any[]).find((p: any) => p.name === e.item)?.averageCost) || 0), 0));
      })
      .catch(() => { /* offline — keep 0 */ });
    return () => { cancelled = true; };
  }, [products, isOpen]);

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

          {/* AI Closing Assistant */}
          {moduleSettings.enableAIClosingAssistant !== false && (
          <div className="pt-4 border-t border-[var(--color-border-default)]">
            <ClosingAssistant
              totalRevenue={zReportData.totalSales}
              orderCount={zReportData.orderCount}
              lowStockItems={lowStockItems}
              wasteCost={wasteCost}
            />
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

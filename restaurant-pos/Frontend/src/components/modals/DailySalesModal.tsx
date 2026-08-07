/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DollarSign, X } from 'lucide-react';
import type { DailySales, SystemSettings } from '../../types';

interface DailySalesModalProps {
  isOpen: boolean;
  dailySales: DailySales;
  settings: SystemSettings;
  onClose: () => void;
}

export default function DailySalesModal({ isOpen, dailySales, settings, onClose }: DailySalesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-sticky">
          <h3 className="font-bold text-sm flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-green-600" /> Daily Sales Summary</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-green-50 rounded-lg p-3 border border-green-200"><p className="text-[10px] text-green-700 font-bold uppercase">Revenue</p><p className="text-lg font-bold font-mono text-green-800">{settings.currencySymbol}{dailySales.totalRevenue.toFixed(2)}</p></div>
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><p className="text-[10px] text-blue-700 font-bold uppercase">Orders</p><p className="text-lg font-bold font-mono text-blue-800">{dailySales.totalOrders}</p></div>
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><p className="text-[10px] text-purple-700 font-bold uppercase">Items Sold</p><p className="text-lg font-bold font-mono text-purple-800">{dailySales.totalItemsSold}</p></div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><p className="text-[10px] text-amber-700 font-bold uppercase">Avg Order</p><p className="text-lg font-bold font-mono text-amber-800">{settings.currencySymbol}{dailySales.averageOrderValue.toFixed(2)}</p></div>
          </div>
          {dailySales.totalDiscount > 0 && (<p className="text-xs text-gray-500">Total Discounts Given: {settings.currencySymbol}{dailySales.totalDiscount.toFixed(2)}</p>)}
        </div>
      </div>
    </div>
  );
}

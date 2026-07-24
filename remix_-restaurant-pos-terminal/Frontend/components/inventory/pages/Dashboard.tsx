import { Package, ShoppingCart, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { PURCHASE_RECOMMENDATIONS, INVENTORY_ALERTS } from '../data';
import type { InventoryPage } from '../types';
import { useInventory } from '../InventoryManager';

export default function Dashboard({ onNavigate }: { onNavigate: (page: InventoryPage) => void }) {
  const { items } = useInventory();
  const totalValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);
  const lowItems = items.filter(i => i.status === 'low' || i.status === 'critical');
  const healthyItems = items.filter(i => i.status === 'healthy' || i.status === 'normal');
  const healthPct = Math.round((healthyItems.length / items.length) * 100);

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-emerald-500';
      case 'normal': return 'bg-blue-500';
      case 'low': return 'bg-amber-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-emerald-50 border-emerald-200';
      case 'normal': return 'bg-blue-50 border-blue-200';
      case 'low': return 'bg-amber-50 border-amber-200';
      case 'critical': return 'bg-red-50 border-red-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto">
      {/* Top row: Health + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Health ring */}
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
          className="lg:col-span-2 bg-white rounded-2xl border border-[#e1e2ed] p-6 flex flex-col items-center justify-center shadow-sm"
        >
          <div className="relative w-32 h-32 mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#f0f0f0" strokeWidth="8" />
              <circle cx="60" cy="60" r="50" fill="none" stroke={healthPct >= 80 ? '#10b981' : healthPct >= 50 ? '#f59e0b' : '#ef4444'} strokeWidth="8"
                strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - healthPct / 100)} strokeLinecap="round"
                className="transition-all duration-700" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold font-mono">{healthPct}%</span>
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Healthy</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 text-center">
            {healthyItems.length} of {items.length} items are in good shape
          </p>
        </motion.div>

        {/* Quick stats + actions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
          className="lg:col-span-3 space-y-4"
        >
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Stock Value</p>
              <p className="text-2xl font-bold font-mono">₹{totalValue.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <span className="text-[10px] text-emerald-600 font-semibold">+2.4%</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Low Items</p>
              <p className="text-2xl font-bold font-mono">{lowItems.length}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <AlertTriangle className={`w-3 h-3 ${lowItems.length > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
                <span className={`text-[10px] font-semibold ${lowItems.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {lowItems.length > 0 ? 'Need attention' : 'All good'}
                </span>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Items</p>
              <p className="text-2xl font-bold font-mono">{items.length}</p>
              <p className="text-[10px] text-gray-400 mt-1.5">{new Set(items.map(i => i.category)).size} categories</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => onNavigate('purchase')}
              className="flex-1 py-3.5 bg-[#004ac6] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-5 h-5" />
              Add Stock
            </button>
            <button onClick={() => onNavigate('items')}
              className="flex-1 py-3.5 bg-white border border-[#e1e2ed] text-gray-700 rounded-2xl text-sm font-bold hover:border-[#004ac6]/30 hover:shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Package className="w-5 h-5" />
              View Items
            </button>
          </div>
        </motion.div>
      </div>

      {/* Bottom grid: Purchase suggestions + Alerts + Item status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Purchase suggestions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">Buy Today</h2>
            <ShoppingCart className="w-4 h-4 text-[#004ac6]" />
          </div>
          <div className="space-y-3">
            {PURCHASE_RECOMMENDATIONS.slice(0, 4).map(rec => (
              <div key={rec.item} className="flex items-center justify-between py-2 border-b border-[#e1e2ed] last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
                    rec.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {rec.item[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{rec.item}</p>
                    <p className="text-[10px] text-gray-400">{rec.quantity}</p>
                  </div>
                </div>
                <button onClick={() => onNavigate('purchase')}
                  className="px-3 py-1.5 bg-[#004ac6] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] transition-all cursor-pointer"
                >
                  Order
                </button>
              </div>
            ))}
            <button onClick={() => onNavigate('purchase')} className="w-full py-2 text-center text-[10px] text-[#004ac6] font-semibold hover:underline cursor-pointer">
              View all recommendations
            </button>
          </div>
        </motion.div>

        {/* Alerts */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">Alerts</h2>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="space-y-3">
            {INVENTORY_ALERTS.slice(0, 4).map(alert => {
              const severityColor = alert.severity === 'critical' ? 'border-red-200 bg-red-50' : alert.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50';
              const dotColor = alert.severity === 'critical' ? 'bg-red-500' : alert.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
              return (
                <div key={alert.id} className={`rounded-xl border ${severityColor} p-3`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${dotColor}`} />
                    <div>
                      <p className="text-xs font-bold">{alert.item}</p>
                      <p className="text-[10px] mt-0.5 opacity-75">{alert.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Item health checklist */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">Item Status</h2>
            <Package className="w-4 h-4 text-gray-400" />
          </div>
          <div className="space-y-2">
            {items.slice(0, 6).map(item => (
              <div key={item.id} className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border ${statusBg(item.status)}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full ${statusColor(item.status)}`} />
                  <span className="text-sm font-semibold">{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono font-bold">{item.currentStock} <span className="text-[10px] text-gray-400 font-normal">{item.unit}</span></span>
                  <span className={`text-[10px] font-semibold capitalize ${
                    item.status === 'critical' ? 'text-red-600' : item.status === 'low' ? 'text-amber-600' : item.status === 'normal' ? 'text-blue-600' : 'text-emerald-600'
                  }`}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => onNavigate('items')} className="w-full py-2.5 mt-3 text-center text-xs text-[#004ac6] font-semibold hover:bg-blue-50 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1">
            View all items <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
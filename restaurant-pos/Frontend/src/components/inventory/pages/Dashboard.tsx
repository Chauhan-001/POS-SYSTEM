import { useState, useEffect, useMemo } from 'react';
import { Package, ShoppingCart, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { daysUntilExpiry } from '../expiryUtils';
import type { InventoryPage, InventoryAlert } from '../types';
import { useInventory } from '../InventoryManager';
import { usePurchases } from '../usePurchases';

export default function Dashboard({ onNavigate }: { onNavigate: (page: InventoryPage) => void; moduleSettings?: Record<string, boolean> }) {
  const { items, synced: itemsSynced } = useInventory();
  const { purchases, synced } = usePurchases();
  // Stock VALUE = Σ(batch qty × batch purchase cost) — never currentStock ×
  // the rolling average. This keeps the Overview stable even when a purchase
  // price changes the average.
  const totalValue = items.reduce((s, i) => s + (Number(i.stockValue) || 0), 0);
  const lowItems = items.filter(i => i.status === 'low' || i.status === 'critical');

  // Real alerts computed from the MongoDB product catalog (stock thresholds +
  // expiry dates) — no hardcoded/demo alerts. Critical first, capped at 4.
  const realAlerts = useMemo<InventoryAlert[]>(() => {
    const alerts: InventoryAlert[] = [];
    for (const i of items) {
      if (i.status === 'critical') {
        alerts.push({ id: `al_low_${i.id}`, type: 'low_stock', item: i.name, severity: 'critical', message: `${i.name} is out of stock (${i.currentStock} ${i.unit} left, minimum ${i.minStock} ${i.unit}).`, timestamp: new Date().toLocaleTimeString() });
      } else if (i.status === 'low') {
        alerts.push({ id: `al_low_${i.id}`, type: 'low_stock', item: i.name, severity: 'warning', message: `${i.name} is low on stock (${i.currentStock} ${i.unit} left, minimum ${i.minStock} ${i.unit}).`, timestamp: new Date().toLocaleTimeString() });
      }
      if (i.expiryDate) {
        const d = daysUntilExpiry(i.expiryDate);
        if (d < 0) {
          alerts.push({ id: `al_exp_${i.id}`, type: 'expiry', item: i.name, severity: 'critical', message: `${i.name} expired ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago (${i.expiryDate}).`, timestamp: new Date().toLocaleTimeString() });
        } else if (d <= 7) {
          alerts.push({ id: `al_exp_${i.id}`, type: 'expiry', item: i.name, severity: 'warning', message: `${i.name} expires in ${d} day${d === 1 ? '' : 's'} (${i.expiryDate}).`, timestamp: new Date().toLocaleTimeString() });
        }
      }
    }
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 4);
  }, [items]);

  // Real week-over-week purchase spend change for the Stock Value card.
  const purchaseTrend = useMemo(() => {
    if (!purchases || purchases.length === 0) return null;
    const now = new Date();
    const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const thisWeekStart = dayStr(new Date(now.getTime() - 6 * 86_400_000));
    const prevWeekStart = dayStr(new Date(now.getTime() - 13 * 86_400_000));
    let thisWeek = 0;
    let prevWeek = 0;
    purchases.forEach((p) => {
      if (p.date >= thisWeekStart) thisWeek += p.total || 0;
      else if (p.date >= prevWeekStart) prevWeek += p.total || 0;
    });
    if (prevWeek <= 0) return thisWeek > 0 ? 100 : 0;
    return Math.round(((thisWeek - prevWeek) / prevWeek) * 100);
  }, [purchases]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-[var(--color-emerald-500-solid)]';
      case 'normal': return 'bg-[var(--color-blue-500-solid)]';
      case 'low': return 'bg-[var(--color-amber-500-solid)]';
      case 'critical': return 'bg-[var(--color-red-500-solid)]';
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
      {/* Quick stats + actions */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Stock Value</p>
            <p className="text-2xl font-bold font-mono">₹{totalValue.toLocaleString('en-IN')}</p>
            <div className="flex items-center gap-1 mt-1.5">
              {synced && purchaseTrend !== null ? (
                <>
                  <TrendingUp className={`w-3 h-3 ${purchaseTrend >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
                  <span className={`text-[10px] font-semibold ${purchaseTrend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {purchaseTrend >= 0 ? '+' : ''}{purchaseTrend}% this week
                  </span>
                </>
              ) : synced ? (
                // Online but no purchase history — honest label, not a fake %.
                <span className="text-[10px] text-gray-400 font-semibold" title="No purchase history on this device yet">
                  No trend data yet
                </span>
              ) : (
                // No live purchase data (offline) — honest placeholder instead
                // of a fake trend percentage.
                <span className="text-[10px] text-gray-400 font-semibold" title="Live purchase data unavailable — showing local values">
                  Offline — no live trend
                </span>
              )}
            </div>
          </div>
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Low Items</p>
            <p className="text-2xl font-bold font-mono">{lowItems.length}</p>
            <div className="flex items-center gap-1 mt-1.5">
              <AlertTriangle className={`w-3 h-3 ${lowItems.length > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
              <span className={`text-[10px] font-semibold ${lowItems.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {lowItems.length > 0 ? 'Need attention' : 'All good'}
              </span>
            </div>
          </div>
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Items</p>
            <p className="text-2xl font-bold font-mono">{items.length}</p>
            <p className="text-[10px] text-gray-400 mt-1.5">{new Set(items.map(i => i.category)).size} categories</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => onNavigate('items')}
            className="flex-1 py-3.5 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-5 h-5" />
            Add Stock
          </button>
          <button onClick={() => onNavigate('items')}
            className="flex-1 py-3.5 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-700 rounded-2xl text-sm font-bold hover:border-[var(--brand-color)]/30 hover:shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Package className="w-5 h-5" />
            View Items
          </button>
        </div>
      </motion.div>

      {/* Alerts */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
        className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">Alerts</h2>
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        </div>
        <div className="space-y-3">
          {realAlerts.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium">No alerts — all stock is healthy</p>
            </div>
          ) : (
            realAlerts.map(alert => {
              const severityColor = alert.severity === 'critical' ? 'border-red-200 bg-red-50' : alert.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50';
              const dotColor = alert.severity === 'critical' ? 'bg-[var(--color-red-500-solid)]' : alert.severity === 'warning' ? 'bg-[var(--color-amber-500-solid)]' : 'bg-[var(--color-blue-500-solid)]';
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
            })
          )}
        </div>
      </motion.div>

      {/* Item health checklist — full width row */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}
        className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">Item Status</h2>
          <Package className="w-4 h-4 text-gray-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.slice(0, 9).map(item => (
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
        <button onClick={() => onNavigate('items')} className="w-full py-2.5 mt-3 text-center text-xs text-[var(--brand-color)] font-semibold hover:bg-blue-50 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1">
          View all items <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </div>
  );
}

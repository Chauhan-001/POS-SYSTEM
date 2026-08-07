import { useMemo } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'motion/react';
import {
  INVENTORY_VALUE_DATA, CONSUMPTION_TREND_DATA,
  CATEGORY_DISTRIBUTION_DATA, FAST_MOVING_ITEMS,
} from '../data';
import { useInventory } from '../InventoryManager';
import { usePurchases } from '../usePurchases';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const DAY_MS = 86_400_000;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localDayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Aggregate last-N-day spend per day, and last-30d totals, from purchases. */
function buildAnalytics(purchases: { date: string; item: string; category?: string; supplier: string; quantity: number; total: number }[]) {
  const today = new Date();

  // ── Shared last-7-days grid so spend + consumption charts use the SAME dates ──
  const days: { date: string; name: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const date = localDayStr(d);
    days.push({ date, name: WEEK_DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1] });
  }
  const weekStart = days[0].date;
  const weekPurchases = purchases.filter((p) => p.date >= weekStart);

  // ── Last 7 days spend trend (real purchase totals per day) ──
  const spendByDate = new Map<string, number>(days.map((d) => [d.date, 0]));
  weekPurchases.forEach((p) => {
    if (spendByDate.has(p.date)) {
      spendByDate.set(p.date, (spendByDate.get(p.date) || 0) + (p.total || 0));
    }
  });
  const spendData = days.map((d) => ({ name: d.name, value: Math.round(spendByDate.get(d.date) || 0) }));

  // ── Top 3 purchased items (by quantity) over the last 7 days ──
  const qtyByItem = new Map<string, number>();
  weekPurchases.forEach((p) => qtyByItem.set(p.item, (qtyByItem.get(p.item) || 0) + (p.quantity || 0)));
  const topItems = [...qtyByItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([item]) => item);
  const consumptionData = days.map((d) => {
    const row: Record<string, string | number> = { name: d.name };
    topItems.forEach((item) => {
      row[item] = Math.round(weekPurchases.filter((p) => p.item === item && p.date === d.date).reduce((s, p) => s + (p.quantity || 0), 0));
    });
    return row;
  });
  const CONSUMPTION_KEYS = topItems;

  // ── Category split by spend (real) ──
  const spendByCategory = new Map<string, number>();
  purchases.forEach((p) => {
    const cat = p.category || 'Other';
    spendByCategory.set(cat, (spendByCategory.get(cat) || 0) + (p.total || 0));
  });
  const categoryData = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value: Math.round(value) }));

  // ── Top suppliers by total spend ──
  const spendBySupplier = new Map<string, number>();
  purchases.forEach((p) => spendBySupplier.set(p.supplier, (spendBySupplier.get(p.supplier) || 0) + (p.total || 0)));
  const fastMovingItems = [...spendBySupplier.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, sold: Math.round(total) }));

  // ── KPIs: last 30 days ──
  const monthStart = localDayStr(new Date(today.getTime() - 29 * DAY_MS));
  const monthPurchases = purchases.filter((p) => p.date >= monthStart);
  const monthlyUse = Math.round(monthPurchases.reduce((s, p) => s + (p.total || 0), 0));
  const monthlyOrders = monthPurchases.length;

  return { spendData, consumptionData, CONSUMPTION_KEYS, categoryData, fastMovingItems, monthlyUse, monthlyOrders };
}

export default function InventoryAnalytics() {
  const { items } = useInventory();
  const { purchases, synced } = usePurchases();
  const totalValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);

  const real = useMemo(
    () => (purchases ? buildAnalytics(purchases) : null),
    [purchases]
  );

  const spendData = real?.spendData || INVENTORY_VALUE_DATA;
  const consumptionData = real?.consumptionData || CONSUMPTION_TREND_DATA;
  const consumptionKeys = real?.CONSUMPTION_KEYS || ['milk', 'tea', 'oil'];
  const categoryData = real?.categoryData || CATEGORY_DISTRIBUTION_DATA;
  const fastMovingItems = real?.fastMovingItems || FAST_MOVING_ITEMS;
  const monthlyUse = real ? `₹${real.monthlyUse.toLocaleString()}` : '₹98,500';
  const monthlyOrders = real ? `${real.monthlyOrders} orders` : '₹1,12,000';

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Reports</h1>
        {synced && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">Synced</span>
        )}
        <p className="text-xs text-gray-400 mt-0.5">Inventory insights at a glance</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Stock Value', value: `₹${totalValue.toLocaleString()}`, change: '+2.4%', up: true },
          { label: 'Monthly Use', value: monthlyUse, change: '-1.8%', up: false },
          { label: 'Monthly Orders', value: monthlyOrders, change: '+5.2%', up: true },
          { label: 'Waste Rate', value: '3.2%', change: '-0.3%', up: true },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.05 }}
            className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
          >
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{kpi.label}</p>
            <p className="text-2xl font-bold font-mono mt-1">{kpi.value}</p>
            <p className={`text-xs font-semibold mt-1 ${kpi.up ? 'text-emerald-600' : 'text-red-500'}`}>{kpi.change}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Purchase Spend — Last 7 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={spendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Top Items — Quantity Bought (7 days)</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={consumptionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              {consumptionKeys.map((key, i) => (
                <Line key={key} type="monotone" dataKey={key} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Category Spend Split</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.15 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Top Suppliers by Spend</p>
          <div className="space-y-3">
            {fastMovingItems.map((item, i) => {
              const maxSold = fastMovingItems[0]?.sold || 1;
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-xs text-gray-500">₹{item.sold.toLocaleString()}</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(item.sold / maxSold) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

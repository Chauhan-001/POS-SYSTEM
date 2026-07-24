import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'motion/react';
import {
  INVENTORY_VALUE_DATA, CONSUMPTION_TREND_DATA,
  CATEGORY_DISTRIBUTION_DATA, FAST_MOVING_ITEMS,
} from '../data';
import { useInventory } from '../InventoryManager';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function InventoryAnalytics() {
  const { items } = useInventory();
  const totalValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Reports</h1>
        <p className="text-xs text-gray-400 mt-0.5">Inventory insights at a glance</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Stock Value', value: `₹${totalValue.toLocaleString()}`, change: '+2.4%', up: true },
          { label: 'Monthly Use', value: '₹98,500', change: '-1.8%', up: false },
          { label: 'Monthly Orders', value: '₹1,12,000', change: '+5.2%', up: true },
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
          <p className="text-sm font-bold mb-4">Stock Value — Last 7 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={INVENTORY_VALUE_DATA}>
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
          <p className="text-sm font-bold mb-4">Consumption — Milk, Tea, Oil</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={CONSUMPTION_TREND_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="milk" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="tea" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="oil" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Category Split</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={CATEGORY_DISTRIBUTION_DATA} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {CATEGORY_DISTRIBUTION_DATA.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.15 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Fast Moving Items</p>
          <div className="space-y-3">
            {FAST_MOVING_ITEMS.map((item, i) => {
              const maxSold = FAST_MOVING_ITEMS[0].sold;
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-xs text-gray-500">{item.sold} units</span>
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
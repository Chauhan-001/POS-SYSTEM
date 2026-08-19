import { useEffect, useMemo, useState } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';
import { motion } from 'motion/react';
import { useInventory, useInventoryEventsCtx } from '../InventoryManager';
import { usePurchases } from '../usePurchases';
import {
  fetchInventoryValuation, fetchInventoryMovement, fetchInventoryWaste,
  fetchInventorySuppliers, fetchInventoryLowStock, fetchInventoryExpiry,
} from '../../../src/api/client';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const DAY_MS = 86_400_000;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localDayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Signed % change between this and previous value. Null when no baseline. */
function pctChange(now: number, prev: number): number | null {
  if (prev <= 0) return now > 0 ? 100 : null;
  return Math.round(((now - prev) / prev) * 100);
}

/** Server-computed report bundle from /api/reports/inventory/*. */
interface InventoryReportBundle {
  valuation: { totalValue: number; itemCount: number; categories: { category: string; value: number; units: number }[] } | null;
  movement: { item: string; purchasedQty: number; purchaseCost: number; consumedQty: number; netMovement: number }[] | null;
  wasteCur: { item: string; quantity: number; events: number }[] | null;
  wastePrev: { item: string; quantity: number; events: number }[] | null;
  suppliers: { supplier: string; total: number; quantity: number; purchases: number }[] | null;
  lowStock: { name: string; category: string; currentStock: number; unit: string; reorderLevel: number; status: string }[] | null;
  expiry: { name: string; category: string; currentStock: number; unit: string; expiryDate: string; batchNumber: string | null; daysLeft: number; status: string }[] | null;
}

const EMPTY_BUNDLE: InventoryReportBundle = {
  valuation: null, movement: null, wasteCur: null, wastePrev: null, suppliers: null, lowStock: null, expiry: null,
};

/** Aggregates a purchase list into the exact window buckets the charts need.
 *  Categories come from the inventory catalog when a purchase row has none. */
function buildAnalytics(
  purchases: { date: string; item: string; category?: string; supplier: string; quantity: number; total: number }[],
  categoryOf?: (item: string) => string | undefined,
) {
  const today = new Date();

  // ── Shared last-7-days grid so spend + consumption charts use the SAME dates ──
  const days: { date: string; name: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    days.push({ date: localDayStr(d), name: WEEK_DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1] });
  }
  const weekStart = days[0].date;
  const prevWeekStart = localDayStr(new Date(today.getTime() - 13 * DAY_MS));
  const weekPurchases = purchases.filter((p) => p.date >= weekStart);
  const prevWeekPurchases = purchases.filter((p) => p.date >= prevWeekStart && p.date < weekStart);

  // ── Last 7 days spend trend (real purchase totals per day) ──
  const spendByDate = new Map<string, number>(days.map((d) => [d.date, 0]));
  weekPurchases.forEach((p) => {
    if (spendByDate.has(p.date)) spendByDate.set(p.date, (spendByDate.get(p.date) || 0) + (p.total || 0));
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

  // ── Category split by spend (real) — falls back to the catalog category ──
  const spendByCategory = new Map<string, number>();
  purchases.forEach((p) => {
    const cat = p.category || categoryOf?.(p.item) || 'Other';
    spendByCategory.set(cat, (spendByCategory.get(cat) || 0) + (p.total || 0));
  });
  const categoryData = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value: Math.round(value) }));

  // ── Top suppliers by total spend (local fallback — server report wins) ──
  const spendBySupplier = new Map<string, number>();
  purchases.forEach((p) => spendBySupplier.set(p.supplier, (spendBySupplier.get(p.supplier) || 0) + (p.total || 0)));
  const fastMovingItems = [...spendBySupplier.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, sold: Math.round(total) }));

  // ── KPIs: last 30 days + the previous 30-day window for real change % ──
  const monthStart = localDayStr(new Date(today.getTime() - 29 * DAY_MS));
  const prevMonthStart = localDayStr(new Date(today.getTime() - 59 * DAY_MS));
  const monthPurchases = purchases.filter((p) => p.date >= monthStart);
  const prevMonthPurchases = purchases.filter((p) => p.date >= prevMonthStart && p.date < monthStart);
  const monthlyUse = Math.round(monthPurchases.reduce((s, p) => s + (p.total || 0), 0));
  const prevMonthlyUse = Math.round(prevMonthPurchases.reduce((s, p) => s + (p.total || 0), 0));
  const monthlyOrders = monthPurchases.length;
  const prevMonthlyOrders = prevMonthPurchases.length;
  const monthlyQty = Math.round(monthPurchases.reduce((s, p) => s + Math.abs(p.quantity || 0), 0));

  const weekSpend = Math.round(weekPurchases.reduce((s, p) => s + (p.total || 0), 0));
  const prevWeekSpend = Math.round(prevWeekPurchases.reduce((s, p) => s + (p.total || 0), 0));

  return {
    spendData, consumptionData, CONSUMPTION_KEYS, categoryData, fastMovingItems,
    monthlyUse, prevMonthlyUse, monthlyOrders, prevMonthlyOrders, monthlyQty,
    weekSpend, prevWeekSpend,
  };
}

export default function InventoryAnalytics() {
  const { items } = useInventory();
  const { purchases, synced } = usePurchases();
  const { events: activityEntries } = useInventoryEventsCtx();
  const totalValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);

  // ── Dedicated backend reports (server-computed, cached for offline) ──
  // Each getCached fetch returns { data, fromCache }: `data` is null only when
  // BOTH the network failed AND no cached snapshot exists — that's the only
  // case where we fall back to local calculation (or an honest empty state).
  const [report, setReport] = useState<InventoryReportBundle>(EMPTY_BUNDLE);
  const [reportsLoaded, setReportsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startDate = localDayStr(new Date(Date.now() - 29 * DAY_MS));
    const prevEnd = localDayStr(new Date(Date.now() - 30 * DAY_MS));
    const prevStart = localDayStr(new Date(Date.now() - 59 * DAY_MS));
    (async () => {
      const [valuation, movement, wasteCur, wastePrev, suppliers, lowStock, expiry] = await Promise.all([
        fetchInventoryValuation(),
        fetchInventoryMovement(startDate, localDayStr(new Date())),
        fetchInventoryWaste(startDate, localDayStr(new Date())),
        fetchInventoryWaste(prevStart, prevEnd),
        fetchInventorySuppliers(startDate, localDayStr(new Date())),
        fetchInventoryLowStock(),
        fetchInventoryExpiry(30),
      ]);
      if (cancelled) return;
      setReport({
        valuation: valuation?.data ?? null,
        movement: movement?.data ?? null,
        wasteCur: wasteCur?.data ?? null,
        wastePrev: wastePrev?.data ?? null,
        suppliers: suppliers?.data ?? null,
        lowStock: lowStock?.data ?? null,
        expiry: expiry?.data ?? null,
      });
      setReportsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Real purchase analytics — only null when the API is unreachable (offline).
  // Online-but-empty means ZERO charts (honest empty state), never demo data.
  const categoryOf = useMemo(() => {
    const map = new Map(items.map((i) => [i.name.toLowerCase(), i.category]));
    return (item: string) => map.get((item || '').toLowerCase());
  }, [items]);
  const real = useMemo(
    () => (purchases ? buildAnalytics(purchases, categoryOf) : null),
    [purchases, categoryOf]
  );

  const isOffline = purchases === null;
  const isOnline = purchases !== null;

  // ── Waste: server report wins (authoritative), events feed is the offline fallback ──
  const waste = useMemo(() => {
    if (report.wasteCur) {
      const sumQty = (rows: { quantity: number }[]) =>
        rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
      const thisQty = sumQty(report.wasteCur);
      const prevQty = sumQty(report.wastePrev || []);
      const count = (report.wasteCur || []).reduce((s, r) => s + (r.events || 0), 0);
      return { thisQty, prevQty, count, totalCount: count + (report.wastePrev || []).reduce((s, r) => s + (r.events || 0), 0), server: true };
    }
    if (!activityEntries) return null; // offline — unknown
    const monthStart = localDayStr(new Date(Date.now() - 29 * DAY_MS));
    const prevMonthStart = localDayStr(new Date(Date.now() - 59 * DAY_MS));
    const sumQty = (list: any[]) => list.reduce((s, e) => s + Math.abs(Number(e.quantity) || 0), 0);
    const thisMonth = activityEntries.filter((e: any) => e.type === 'waste' && (e.timestamp || '').slice(0, 10) >= monthStart);
    const prevMonth = activityEntries.filter((e: any) => e.type === 'waste' && (e.timestamp || '').slice(0, 10) >= prevMonthStart && (e.timestamp || '').slice(0, 10) < monthStart);
    const thisQty = sumQty(thisMonth);
    const prevQty = sumQty(prevMonth);
    return { thisQty, prevQty, count: thisMonth.length, totalCount: thisMonth.length + prevMonth.length, server: false };
  }, [report.wasteCur, report.wastePrev, activityEntries]);

  // ── KPIs with REAL values and REAL change %, or an honest placeholder ──
  const kpis = useMemo(() => {
    // Stock value ← server valuation (authoritative, includes ALL products);
    // local catalog computation only when the report is unavailable offline.
    const stockValue = report.valuation?.totalValue ?? totalValue;
    // Stock value change ← week-over-week purchase spend (same source as Dashboard).
    const stockChange = real ? pctChange(real.weekSpend, real.prevWeekSpend) : null;
    // Monthly use change ← month-over-month purchase spend.
    const useChange = real ? pctChange(real.monthlyUse, real.prevMonthlyUse) : null;
    // Monthly purchases change ← month-over-month purchase record count.
    const ordersChange = real ? pctChange(real.monthlyOrders, real.prevMonthlyOrders) : null;
    // Waste rate change ← month-over-month waste quantity.
    const wasteChange = waste ? pctChange(waste.thisQty, waste.prevQty) : null;

    return [
      {
        label: 'Stock Value',
        value: `₹${Math.round(stockValue).toLocaleString('en-IN')}`,
        change: stockChange == null ? null : `${stockChange >= 0 ? '+' : ''}${stockChange}%`,
        up: (stockChange ?? 0) >= 0,
        // Stock value is always computable from the catalog — no empty state needed.
        empty: false,
        server: !!report.valuation,
      },
      {
        label: 'Monthly Spend',
        value: real ? `₹${real.monthlyUse.toLocaleString('en-IN')}` : '—',
        change: useChange == null ? null : `${useChange >= 0 ? '+' : ''}${useChange}%`,
        up: (useChange ?? 0) >= 0,
        empty: isOnline && real && real.monthlyUse === 0,
        server: false,
      },
      {
        label: 'Monthly Purchases',
        value: real ? `${real.monthlyOrders} orders` : '—',
        change: ordersChange == null ? null : `${ordersChange >= 0 ? '+' : ''}${ordersChange}%`,
        up: (ordersChange ?? 0) >= 0,
        empty: isOnline && real && real.monthlyOrders === 0,
        server: false,
      },
      {
        label: 'Waste Rate',
        // Waste quantity ÷ purchase quantity over the last 30 days (%), with
        // the raw unit count alongside. When purchases exist but nothing was
        // wasted, show a real 0%.
        value: waste && real && real.monthlyQty > 0
          ? `${Math.round((waste.thisQty / real.monthlyQty) * 100)}% (${waste.thisQty} units)`
          : waste
            ? `${waste.thisQty} units`
            : (isOffline ? '—' : 'No data yet'),
        change: wasteChange == null ? null : `${wasteChange >= 0 ? '+' : ''}${wasteChange}%`,
        up: (wasteChange ?? 0) <= 0, // lower waste = good
        empty: waste ? waste.thisQty === 0 : (isOnline && !waste),
        server: !!report.wasteCur,
      },
    ];
  }, [real, waste, totalValue, isOnline, isOffline, report.valuation, report.wasteCur]);

  // Chart data — real only. No demo series: when offline or empty, the charts
  // render the honest empty state instead of fabricated numbers.
  const spendData = real?.spendData || [];
  const consumptionData = real?.consumptionData || [];
  const consumptionKeys = real?.CONSUMPTION_KEYS || [];
  const categoryData = real?.categoryData || [];

  // Top suppliers — server report wins (excludes cancelled purchases) EVEN
  // when it's empty (honest empty state, no silent local swap). Local
  // computation is only the fallback when the report itself is unavailable
  // (offline, no cache).
  const supplierRows = report.suppliers !== null
    ? report.suppliers.map((s) => ({ name: s.supplier || 'Unknown', sold: Math.round(s.total || 0) }))
    : (real?.fastMovingItems || []);

  // Stock movement (purchased vs consumed) — server report, top 6 by volume.
  const movementData = useMemo(() => {
    if (!report.movement) return null;
    return [...report.movement]
      .sort((a, b) => Math.abs(b.netMovement) - Math.abs(a.netMovement))
      .slice(0, 6)
      .map((m) => ({
        name: m.item.length > 14 ? `${m.item.slice(0, 13)}…` : m.item,
        Purchased: Math.round(m.purchasedQty || 0),
        Consumed: Math.round(m.consumedQty || 0),
      }));
  }, [report.movement]);

  const lowStockRows = report.lowStock || [];
  const expiryRows = report.expiry || [];
  // Split expiry rows: already expired vs still-usable-but-expiring-soon.
  const expiredRows = expiryRows.filter((r) => r.status === 'Expired');
  const expiringRows = expiryRows.filter((r) => r.status !== 'Expired');
  const noData = isOnline && purchases.length === 0 && lowStockRows.length === 0;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Reports</h1>
        {synced && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">Synced</span>
        )}
        {isOffline && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold" title="Live data unavailable — values shown are from the last known sync">
            Offline
          </span>
        )}
        <p className="text-xs text-gray-400 mt-0.5">Inventory insights at a glance</p>
      </div>

      {noData && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-700 flex items-center gap-2">
          <span>ℹ️</span>
          <span>
            No purchase or waste records yet — charts and figures will appear here as you add stock and log waste.
          </span>
        </div>
      )}

      {/* KPI row — every value comes from real data (server-computed when available), or an honest placeholder */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.05 }}
            className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
          >
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
              {kpi.label}
              {kpi.server && (
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold" title="Computed server-side from /api/reports/inventory/*">SERVER</span>
              )}
            </p>
            <p className="text-2xl font-bold font-mono mt-1">{kpi.value}</p>
            {kpi.change ? (
              <p className={`text-xs font-semibold mt-1 ${kpi.up ? 'text-emerald-600' : 'text-red-500'}`}>{kpi.change}</p>
            ) : (
              <p className="text-[10px] text-gray-400 font-semibold mt-1.5">No trend data yet</p>
            )}
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Purchase Spend — Last 7 Days</p>
          {spendData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No purchase data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Top Items — Quantity Bought (7 days)</p>
          {consumptionKeys.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No purchase data yet</div>
          ) : (
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
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4 flex items-center gap-2">
            Stock Movement — Purchased vs Consumed (30 days)
            {report.movement !== null && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold" title="Server-computed from /api/reports/inventory/movement">SERVER</span>
            )}
          </p>
          {movementData === null ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Movement report unavailable</div>
          ) : movementData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No movement data in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={movementData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="Purchased" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Consumed" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.15 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4">Category Spend Split</p>
          {categoryData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No purchase data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.2 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4 flex items-center gap-2">
            Top Suppliers by Spend
            {report.suppliers !== null && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold" title="Server-computed from /api/reports/inventory/suppliers">SERVER</span>
            )}
          </p>
          {supplierRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No purchase data yet</div>
          ) : (
            <div className="space-y-3">
              {supplierRows.map((item, i) => {
                const maxSold = supplierRows[0]?.sold || 1;
                return (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-semibold">{item.name}</span>
                        <span className="text-xs text-gray-500">₹{item.sold.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--color-emerald-500-solid)] rounded-full transition-all" style={{ width: `${(item.sold / maxSold) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.25 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <p className="text-sm font-bold mb-4 flex items-center gap-2">
            Low Stock Alerts
            {report.lowStock !== null && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold" title="Server-computed from /api/reports/inventory/low-stock">SERVER</span>
            )}
          </p>
          {reportsLoaded && report.lowStock === null ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Low-stock report unavailable</div>
          ) : reportsLoaded && lowStockRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No low-stock items 🎉</div>
          ) : lowStockRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {lowStockRows.slice(0, 8).map((r) => (
                <div key={r.name} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-400">{r.category}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      r.status === 'Out of Stock' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {r.status}
                    </span>
                    <p className="text-[10px] text-gray-400 mt-1">{r.currentStock} {r.unit} left</p>
                  </div>
                </div>
              ))}
              {lowStockRows.length > 8 && (
                <p className="text-[10px] text-gray-400 text-center pt-1">+{lowStockRows.length - 8} more items</p>
              )}
            </div>
          )}
        </motion.div>

        {/* Expiry Alerts — items expired or expiring within the lookahead window (server-computed from product expiryDate) */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.3 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold flex items-center gap-2">
              Expiry Alerts
              {report.expiry !== null && (
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold" title="Server-computed from /api/reports/inventory/expiry">SERVER</span>
              )}
            </p>
            {expiryRows.length > 0 && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${expiredRows.length > 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                {expiredRows.length} expired · {expiringRows.length} soon
              </span>
            )}
          </div>
          {reportsLoaded && report.expiry === null ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Expiry report unavailable</div>
          ) : reportsLoaded && expiryRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">No items expiring in the next 30 days 🎉</div>
          ) : expiryRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {expiryRows.slice(0, 8).map((r, i) => (
                <div key={`${r.name}-${r.batchNumber || r.expiryDate}-${i}`} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                  r.status === 'Expired' ? 'border-red-100 bg-red-50/60' : r.daysLeft <= 7 ? 'border-amber-100 bg-amber-50/60' : 'border-blue-100 bg-blue-50/40'
                }`}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">
                      {r.category}
                      {r.batchNumber ? ` · ${r.batchNumber}` : ''}
                      {r.expiryDate ? ` · ${r.expiryDate}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      r.status === 'Expired' ? 'bg-red-100 text-red-700' : r.daysLeft <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {r.status === 'Expired' ? 'EXPIRED' : `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left`}
                    </span>
                    <p className="text-[10px] text-gray-400 mt-1">{r.currentStock} {r.unit ?? 'units'} in stock</p>
                  </div>
                </div>
              ))}
              {expiryRows.length > 8 && (
                <p className="text-[10px] text-gray-400 text-center pt-1">+{expiryRows.length - 8} more items</p>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

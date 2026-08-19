import { useState, useEffect, useMemo, useRef } from 'react';
import { Package, ShoppingCart, AlertTriangle, TrendingUp, ArrowRight, Sparkles, Brain, AlertCircle, Loader2 } from 'lucide-react';
import RefreshButton from '../../common/RefreshButton';
import { motion } from 'motion/react';
import { daysUntilExpiry } from '../expiryUtils';
import type { InventoryPage, InventoryAlert } from '../types';
import type { InventoryHealthScore, PurchaseRecommendation, LowStockPrediction, AiSource } from '../../../src/ai/aiData';
import { useInventory } from '../InventoryManager';
import { usePurchases } from '../usePurchases';
import AICard from '../../../src/ai/AICard';
import { computeHealthScore, generatePurchaseRecs, predictLowStock, computeInventoryCardsLocal } from '../../../src/ai/aiData';
import { fetchInventoryWaste } from '../../../src/api/client';
import WeatherWidget from '../../../src/ai/WeatherWidget';

export default function Dashboard({ onNavigate, moduleSettings }: { onNavigate: (page: InventoryPage) => void; moduleSettings?: Record<string, boolean> }) {
  const { items, synced: itemsSynced } = useInventory();
  const { purchases, synced } = usePurchases();
  const totalValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);
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

  // Null until computed — no fake starting number, just a brief loading state.
  const [healthScore, setHealthScore] = useState<InventoryHealthScore | null>(null);
  const [purchaseRecs, setPurchaseRecs] = useState<PurchaseRecommendation[]>([]);
  const [lowStockPreds, setLowStockPreds] = useState<LowStockPrediction[]>([]);
  // Provenance of each AI card — 'live' (backend AI) vs 'local' (offline
  // fallback computation). Null until the fetch resolves so the badge never
  // flashes "Offline estimate" on load while the backend is still answering.
  const [healthSource, setHealthSource] = useState<AiSource | null>(null);
  const [recsSource, setRecsSource] = useState<AiSource | null>(null);
  const [lowStockSource, setLowStockSource] = useState<AiSource | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  // True once the health score has been computed (even if the result is null
  // because there are no inventory items or no waste data). Used to
  // differentiate "still loading" from "no data to show".
  const [healthComputed, setHealthComputed] = useState(false);

  // Waste cost for the health engine — real data from the backend waste
  // report (last 30 days), never a fabricated proxy. Hoisted so both the
  // card fetch and the local delta reuse it.
  const [wasteCost, setWasteCost] = useState(0);
  useEffect(() => {
    if (!itemsSynced) return;
    let cancelled = false;
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const end = new Date();
    const start = new Date(Date.now() - 30 * 86_400_000);
    fetchInventoryWaste(day(start), day(end))
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        const byName = new Map(items.map(i => [i.name.toLowerCase(), i]));
        const cost = (data as Array<{ item?: string; quantity?: number }>).reduce((sum, row) => {
          const item = row?.item ? byName.get(String(row.item).toLowerCase()) : undefined;
          return sum + (Number(row?.quantity) || 0) * (item?.averageCost || 0);
        }, 0);
        setWasteCost(cost);
      })
      .catch(() => { if (!cancelled) setWasteCost(0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSynced]);

  // AI cards fetch ONCE when the catalog is ready (fresh login / page open)
  // and on the explicit refresh button — never on every `items` change.
  // Stock edits elsewhere re-render this page with new items, which used to
  // re-fire 3 LLM calls each time; the backend cache (5 min, tenant-scoped)
  // absorbs repeats, but an idle page must not burn tokens. The refresh
  // button below bumps aiRefreshKey. Catalog changes instead recompute the
  // cards with the deterministic local engine (see the delta effect below).
  const [aiRefreshKey, setAiRefreshKey] = useState(0);

  // Signature of the catalog this render is showing. `catalogSigRef` tracks
  // the CURRENT catalog (updated every render) so an in-flight live fetch can
  // detect (and discard) a result computed against a catalog that has since
  // changed — a stale LLM answer must never overwrite a fresher local
  // recompute. `lastComputedSigRef` records the signature we last rendered
  // card values for, so the delta effect ignores no-op re-fetches (same
  // content, new array identity — e.g. StrictMode double-mount).
  const catalogSigRef = useRef('');
  const lastComputedSigRef = useRef('');
  const catalogSig = items.map(i => `${i.id}:${i.currentStock}:${i.status}:${i.expiryDate || ''}`).join('|');
  catalogSigRef.current = catalogSig;

  useEffect(() => {
    // Wait for the real catalog: the mount-time fetch is still in flight, and
    // computing against the pre-load empty array returned a fake "100 — Add
    // inventory items" score even when 40+ items were present. Run only once
    // the backend answered (or immediately for a confirmed-empty catalog).
    if (!itemsSynced && items.length === 0) {
      setAiLoading(false); // not loading — waiting on the catalog / offline
      return;
    }
    const sigAtStart = catalogSigRef.current;
    setAiLoading(true);
    Promise.all([
      computeHealthScore(items, wasteCost),
      generatePurchaseRecs(items),
      predictLowStock(items, purchases ?? undefined),
    ]).then(([h, p, l]) => {
      // Catalog changed while the LLM was answering — drop the stale result;
      // the delta effect already recomputed (or will recompute) locally.
      if (catalogSigRef.current !== sigAtStart) return;
      lastComputedSigRef.current = sigAtStart;
      setHealthScore(h.data);
      setHealthSource(h.source);
      setHealthComputed(true);
      setPurchaseRecs(p.data);
      setRecsSource(p.source);
      setLowStockPreds(l.data);
      setLowStockSource(l.source);
      setAiLoading(false);
    }).catch(() => { if (catalogSigRef.current === sigAtStart) setAiLoading(false); });
  }, [aiRefreshKey, itemsSynced, wasteCost, purchases]); // catalog-ready + data-ready only

  // Deterministic delta: whenever the catalog CONTENT changes while this
  // page is open (stock edit, purchase, waste logged elsewhere), recompute
  // the three cards with the local engines — zero LLM calls, instant refresh.
  // The initial population is skipped (the live fetch above owns it), and
  // no-op re-fetches (same signature) are ignored. 'delta' provenance tells
  // the user the numbers are fresh but locally derived until they hit Refresh
  // for a live re-analysis.
  useEffect(() => {
    if (!itemsSynced && items.length === 0) return;
    if (catalogSig === lastComputedSigRef.current) return; // no real change
    if (lastComputedSigRef.current === '') return; // initial population — live effect owns it
    lastComputedSigRef.current = catalogSig;
    const cards = computeInventoryCardsLocal(items, wasteCost, purchases);
    setHealthScore(cards.health);
    setHealthSource('delta');
    setHealthComputed(true);
    setPurchaseRecs(cards.purchaseRecs);
    setRecsSource('delta');
    setLowStockPreds(cards.lowStock);
    setLowStockSource('delta');
    setAiLoading(false);
  }, [items, itemsSynced, catalogSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Small pill that tells the user whether an AI card is powered by the live
  // AI backend, an auto-refreshed local recompute, or an offline estimation.
  // Rendered only after the fetch resolves (source is non-null) to avoid a
  // misleading flash on load.
  const AiSourceBadge = ({ source }: { source: AiSource }) => source === 'live' ? (
    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">AI live</span>
  ) : source === 'data' ? (
    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200" title="Calculated from your live inventory data — always matches the item list">Live data</span>
  ) : source === 'delta' ? (
    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200" title="Catalog changed — updated instantly with local calculations (no AI call). Refresh for a live analysis.">Auto-refresh</span>
  ) : (
    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200" title="AI unavailable — estimated locally on this device">Offline estimate</span>
  );

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

  const healthColor = !healthScore ? '#f59e0b' : healthScore.overall >= 80 ? '#10b981' : healthScore.overall >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto">
      {/* Top row: AI Health Score + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {moduleSettings?.enableAIInventoryHealth !== false && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
          className="lg:col-span-2 bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 flex flex-col shadow-sm"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-[var(--color-purple-500-solid)] flex items-center justify-center">
              <Brain className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">AI Inventory Health</span>
            <RefreshButton
              onRefresh={() => { setAiRefreshKey(k => k + 1); return Promise.resolve(); }}
              busy={aiLoading}
              title="Refresh AI analysis (calls the AI once)"
              className="gap-1 text-[9px] font-semibold text-purple-600 hover:text-purple-800 hover:bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 transition-colors"
              iconClassName="w-2.5 h-2.5"
            >
              Refresh
            </RefreshButton>
            {healthSource && <AiSourceBadge source={healthSource} />}
            {healthScore && (
              <span className={`ml-auto text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                healthScore.trend === 'improving' ? 'bg-emerald-50 text-emerald-700' :
                healthScore.trend === 'declining' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
              }`}>
                {healthScore.trend}
              </span>
            )}
          </div>
          {!healthComputed && aiLoading ? (
          <div className="flex-1 flex items-center justify-center">
            {itemsSynced && <Loader2 className="w-6 h-6 animate-spin text-purple-500" />}
            <span className="text-xs text-gray-400 ml-2">
              {itemsSynced ? 'Calculating…' : 'Offline — connect to calculate health'}
            </span>
          </div>
          ) : healthScore ? (
          <div className="flex items-center gap-6 flex-1">
            <div className="relative w-28 h-28 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#f0f0f0" strokeWidth="8" />
                <circle cx="60" cy="60" r="50" fill="none" stroke={healthColor} strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - healthScore.overall / 100)} strokeLinecap="round"
                  className="transition-all duration-700" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono">{healthScore.overall}</span>
                <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">Score</span>
              </div>
            </div>
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Stock Health</span>
                <span className="text-[10px] font-bold font-mono">{healthScore.stockHealth}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${healthScore.stockHealth}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Waste Control</span>
                <span className="text-[10px] font-bold font-mono">{healthScore.wasteRate}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${healthScore.wasteRate}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Expiry Risk</span>
                <span className="text-[10px] font-bold font-mono">{healthScore.expiryRisk}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500" style={{ width: `${healthScore.expiryRisk}%` }} />
              </div>
            </div>
          </div>
          ) : (
          <div className="flex-1 flex items-center justify-center py-6">
            <div className="text-center">
              <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-xs font-semibold text-gray-400">No inventory data to assess</p>
              <p className="text-[10px] text-gray-300 mt-1">Add inventory items to see health score</p>
            </div>
          </div>
          )}
          {healthScore && healthScore.recommendations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border-default)]">
              <p className="text-[10px] text-gray-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-purple-500" />
                {healthScore.recommendations[0]}
              </p>
            </div>
          )}
        </motion.div>
        )}

        {/* Quick stats + actions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
          className="lg:col-span-3 space-y-4"
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
            <button onClick={() => onNavigate('purchase')}
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
      </div>

      {/* Bottom grid: AI Purchase Recommendations + Low Stock Predictions + Weather+Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {moduleSettings?.enableAIPurchaseRecs !== false && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm flex flex-col"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-lg bg-[var(--color-amber-500-solid)] flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
              <h2 className="text-sm font-bold">AI Recommendations</h2>
              {recsSource && <AiSourceBadge source={recsSource} />}
            </div>
            <ShoppingCart className="w-4 h-4 text-[var(--brand-color)]" />
          </div>
          <div className="space-y-3 flex-1 flex flex-col">
            {purchaseRecs.slice(0, 5).map((rec, i) => (
              <div key={`${rec.item}-${i}`} className="flex items-center justify-between py-2 border-b border-[var(--color-border-default)] last:border-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                    rec.urgency === 'high' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {rec.item[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{rec.item}</p>
                    <p className="text-[9px] text-gray-400">{rec.suggestedQty} · ₹{Number(rec.estimatedCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-[9px] text-gray-400 truncate">{rec.reason}</p>
                  </div>
                </div>
                <button onClick={() => onNavigate('purchase')}
                  className="px-3 py-1.5 bg-[var(--brand-color)] text-white rounded-lg text-[10px] font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer shrink-0 ml-2"
                >
                  Order
                </button>
              </div>
            ))}
            <button onClick={() => onNavigate('purchase')} className="w-full py-2 mt-auto text-center text-[10px] text-[var(--brand-color)] font-semibold hover:underline cursor-pointer">
              View all recommendations
            </button>
          </div>
        </motion.div>
        )}

        {moduleSettings?.enableAILowStock !== false && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.12 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-lg bg-[var(--color-red-500-solid)] flex items-center justify-center">
                <Brain className="w-3 h-3 text-white" />
              </div>
              <h2 className="text-sm font-bold">Low Stock Predictions</h2>
              {lowStockSource && <AiSourceBadge source={lowStockSource} />}
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          {lowStockPreds.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-medium">No low stock predictions</p>
            </div>
          ) : (
            <div className="space-y-3">
              {lowStockPreds.slice(0, 5).map(pred => (
                <div key={pred.item} className={`rounded-xl border p-3 ${
                  pred.daysUntilOut <= 1 ? 'border-red-200 bg-red-50' :
                  pred.daysUntilOut <= 3 ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{pred.item}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                      pred.confidence === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>{pred.confidence} confidence</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>Stock: {pred.currentStock} {pred.unit}</span>
                    <span>·</span>
                    <span className={pred.daysUntilOut <= 1 ? 'text-red-600 font-bold' : ''}>
                      {pred.daysUntilOut <= 0 ? 'OUT TODAY' : `${pred.daysUntilOut} day${pred.daysUntilOut > 1 ? 's' : ''} left`}
                    </span>
                  </div>
                  <p className="text-[10px] mt-1 font-medium text-gray-600">{pred.suggestedAction}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
        )}

        {/* Weather Recommendation + Alerts combined */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}
          className="space-y-3"
        >
          {moduleSettings?.enableAIWeather !== false && (
            <WeatherWidget
              compact
              menuItems={items.map(i => i.name).filter(Boolean)}
              inventoryItems={items.map(i => i.name).filter(Boolean)}
            />
          )}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm">
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
          </div>
        </motion.div>

      </div>

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
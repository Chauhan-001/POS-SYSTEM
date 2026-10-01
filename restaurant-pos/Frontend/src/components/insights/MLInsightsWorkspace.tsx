/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MLInsightsWorkspace — one surface for ChitKuber's three ML models:
 *
 *   Demand  (Demand_forcasting_model) — 7-day per-product demand forecasts
 *   Basket  (Market_Basket_Analysis)  — combo predictions (pairs that sell)
 *   Uplit   (Uplit)                   — ranked customers for offer targeting
 *
 * Data comes from the Node backend's /api/ml-pipeline/* surface, which fronts
 * all three services. Tenant identity is derived server-side from the JWT —
 * this UI never sends a restaurantId.
 *
 * The Operations strip exposes the pipeline controls honestly: extraction
 * previews (no push), syncs, training triggers, and prediction refreshes.
 * When a service is not configured (env unset), its panel shows a clear
 * "not configured" state instead of fake data.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, RefreshCw, CloudUpload, GraduationCap, PlayCircle,
  AlertCircle, CheckCircle2, Users, Layers, Zap, Database, PieChart,
} from 'lucide-react';
import {
  fetchMlPipelineStatus, fetchDemandPredictions, pullDemandPredictions,
  syncDemandModel, previewDemandExtraction,
  fetchComboPredictions, pullComboPredictions, syncBasketModel, trainBasketModel,
  previewBasketExtraction, fetchUpliftCustomers, pushUpliftExperiments,
  fetchStoredSegments, syncCustomerSegments,
  type MlPipelineStatus, type StoredDemandPrediction, type StoredComboPrediction,
  type UpliftCustomerRow, type StoredSegmentRow,
} from '../../api/client';

interface MLInsightsWorkspaceProps {
  currencySymbol: string;
}

type TabKey = 'demand' | 'basket' | 'uplift' | 'segments';
type OpsState = { running: boolean; message: string; ok: boolean | null };

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

const DATA_MODE_LABELS: Record<string, string> = {
  restaurant_ml: 'ML model (your data)',
  statistical_ensemble: 'Statistical ensemble',
  cold_start_priors: 'Cold-start priors',
};

export default function MLInsightsWorkspace({ currencySymbol }: MLInsightsWorkspaceProps) {
  const [tab, setTab] = useState<TabKey>('demand');
  const [status, setStatus] = useState<MlPipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [demandRows, setDemandRows] = useState<StoredDemandPrediction[]>([]);
  const [comboRows, setComboRows] = useState<StoredComboPrediction[]>([]);
  const [upliftRows, setUpliftRows] = useState<UpliftCustomerRow[]>([]);
  const [upliftTotal, setUpliftTotal] = useState<number | null>(null);
  const [upliftUnavailable, setUpliftUnavailable] = useState<string | null>(null);
  const [segmentRows, setSegmentRows] = useState<StoredSegmentRow[]>([]);

  const [ops, setOps] = useState<Record<string, OpsState>>({});

  const setOp = (key: string, patch: Partial<OpsState>) =>
    setOps((prev) => ({ ...prev, [key]: { running: false, message: '', ok: null, ...prev[key], ...patch } }));

  const loadPredictions = useCallback(async () => {
    setLoading(true);
    try {
      const [demand, combos, uplift, segments] = await Promise.all([
        fetchDemandPredictions({ limit: 200 }),
        fetchComboPredictions(100),
        fetchUpliftCustomers(50).catch((err: Error) => {
          setUpliftUnavailable(err?.message?.includes('not configured') ? 'Uplit service not configured' : 'Uplit service unreachable');
          return null;
        }),
        fetchStoredSegments(500).catch(() => null),
      ]);
      if (demand?.predictions) setDemandRows(demand.predictions as StoredDemandPrediction[]);
      if (combos?.predictions) setComboRows(combos.predictions as StoredComboPrediction[]);
      if (uplift?.customers) {
        setUpliftRows(uplift.customers);
        setUpliftTotal(uplift.total_eligible ?? null);
        setUpliftUnavailable(null);
      }
      if (segments?.segments) setSegmentRows(segments.segments as StoredSegmentRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMlPipelineStatus().then(setStatus).catch(() => setStatus(null));
    void loadPredictions();
  }, [loadPredictions]);

  // ── Operations ──────────────────────────────────────────────────────────

  const runOp = async (key: string, fn: () => Promise<any>, okMsg: (res: any) => string) => {
    setOp(key, { running: true, message: 'Working…', ok: null });
    try {
      const res = await fn();
      setOp(key, { running: false, message: okMsg(res), ok: true });
    } catch (err) {
      setOp(key, { running: false, message: err instanceof Error ? err.message : 'Failed', ok: false });
    }
  };

  const opDemandPull = () => runOp('demandPull',
    async () => {
      // Refresh forecasts for the products already present in ml_predictions.
      const ids = Array.from(new Set(demandRows.map((r) => r.entityId)));
      return pullDemandPredictions(ids.length > 0 ? ids : [], 7);
    },
    () => 'Forecasts refreshed for known products');

  const opDemandSync = () => runOp('demandSync', () => syncDemandModel({ limitBills: 5000 }),
    (res) => `Synced ${res?.result?.sync?.acceptedRows ?? 0} rows to the Demand model`);

  const opDemandPreview = () => runOp('demandPreview', () => previewDemandExtraction(200),
    (res) => `Extraction preview: ${res?.totalOrders ?? 0} bills would sync`);

  const opComboPull = () => runOp('comboPull', () => pullComboPredictions(),
    (res) => `Stored ${res?.stats?.predictionsStored ?? 0} combo predictions`);

  const opBasketSync = () => runOp('basketSync', () => syncBasketModel({ limitBills: 5000 }),
    (res) => `Synced ${res?.result?.sync?.acceptedRows ?? 0} transactions`);

  const opBasketTrain = () => runOp('basketTrain', () => trainBasketModel(),
    (res) => res?.ok ? 'Training ran (its data gates decided the outcome)' : `Training skipped: ${res?.detail ?? 'unknown'}`);

  const opBasketPreview = () => runOp('basketPreview', () => previewBasketExtraction(200),
    (res) => `Extraction preview: ${res?.totalTransactions ?? 0} transactions would sync`);

  const opUpliftPush = () => runOp('upliftPush', () => pushUpliftExperiments(),
    (res) => res?.configured ? `Pushed ${res?.pushed ?? 0} rows (${res?.convertedCount ?? 0} conversions)` : 'Uplit not configured — export only');

  const opSegmentSync = () => runOp('segmentSync', () => syncCustomerSegments(),
    (res) => {
      const r = res?.result;
      if (!r?.training?.is_trained) {
        return `Synced ${r?.extraction?.extracted ?? 0} customers — model needs ≥30 with visit history; rule tiers active`;
      }
      return `Trained k=${r.training.k} on ${r.training.customers_usable} customers · ${r.storedPredictions} segments stored`;
    });

  // ── Status pill ─────────────────────────────────────────────────────────

  const StatusPill = ({ configured, label }: { configured: boolean | undefined; label: string }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${configured ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
      {configured ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {label} {configured ? 'connected' : 'not configured'}
    </span>
  );

  const NotConfigured = ({ name, envVar }: { name: string; envVar: string }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle className="text-gray-400 mb-3" size={36} />
      <p className="text-gray-700 font-medium">{name} is not connected</p>
      <p className="text-sm text-gray-500 mt-1 max-w-md">
        Set <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{envVar}</code> in the backend
        environment (and start the service) to enable this panel.
      </p>
    </div>
  );

  // ── Tabs ────────────────────────────────────────────────────────────────

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'demand', label: 'Demand Forecast', icon: <TrendingUp size={16} /> },
    { key: 'basket', label: 'Combo Intelligence', icon: <Layers size={16} /> },
    { key: 'uplift', label: 'Customer Uplift', icon: <Users size={16} /> },
    { key: 'segments', label: 'Segments', icon: <PieChart size={16} /> },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header + service status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">ML Insights</h1>
          <p className="text-sm text-gray-500">Predictions from your connected intelligence models</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill configured={status?.demandModel?.configured} label="Demand" />
          <StatusPill configured={status?.basketModel?.configured} label="Basket" />
          <StatusPill configured={status?.uplitModel?.configured} label="Uplit" />
          <StatusPill configured={status?.segmentModel?.configured} label="Segments" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <RefreshCw className="animate-spin mr-2" size={18} /> Loading predictions…
        </div>
      ) : (
        <>
          {/* ── Demand tab ── */}
          {tab === 'demand' && (
            <div className="space-y-4">
              <OpStrip
                ops={[
                  { key: 'demandPull', label: 'Refresh forecasts', icon: <RefreshCw size={14} />, state: ops.demandPull, fn: opDemandPull },
                  { key: 'demandSync', label: 'Sync bills', icon: <CloudUpload size={14} />, state: ops.demandSync, fn: opDemandSync },
                  { key: 'demandPreview', label: 'Preview extraction', icon: <Database size={14} />, state: ops.demandPreview, fn: opDemandPreview },
                ]}
              />
              {!status?.demandModel?.configured ? (
                <NotConfigured name="The Demand model" envVar="ML_DEMAND_BASE_URL" />
              ) : demandRows.length === 0 ? (
                <EmptyState text="No forecasts stored yet. Use “Sync bills” then “Refresh forecasts” — the daily scheduler does this automatically when enabled." />
              ) : (
                <DemandTable rows={demandRows} currencySymbol={currencySymbol} />
              )}
            </div>
          )}

          {/* ── Basket tab ── */}
          {tab === 'basket' && (
            <div className="space-y-4">
              <OpStrip
                ops={[
                  { key: 'comboPull', label: 'Refresh combos', icon: <RefreshCw size={14} />, state: ops.comboPull, fn: opComboPull },
                  { key: 'basketSync', label: 'Sync bills', icon: <CloudUpload size={14} />, state: ops.basketSync, fn: opBasketSync },
                  { key: 'basketTrain', label: 'Train model', icon: <GraduationCap size={14} />, state: ops.basketTrain, fn: opBasketTrain },
                  { key: 'basketPreview', label: 'Preview extraction', icon: <Database size={14} />, state: ops.basketPreview, fn: opBasketPreview },
                ]}
              />
              {!status?.basketModel?.configured ? (
                <NotConfigured name="The Basket (combo) service" envVar="ML_BASKET_BASE_URL" />
              ) : comboRows.length === 0 ? (
                <EmptyState text="No combo predictions yet. Sync bills, then train the model — it needs enough transaction history before it will produce predictions (rule-based combos may still appear)." />
              ) : (
                <ComboTable rows={comboRows} currencySymbol={currencySymbol} />
              )}
            </div>
          )}

          {/* ── Uplit tab ── */}
          {tab === 'uplift' && (
            <div className="space-y-4">
              <OpStrip
                ops={[
                  { key: 'upliftPush', label: 'Push experiment data', icon: <CloudUpload size={14} />, state: ops.upliftPush, fn: opUpliftPush },
                ]}
              />
              {upliftUnavailable ? (
                <NotConfigured name="The Uplit (uplift) service" envVar="ML_UPLIT_BASE_URL" />
              ) : upliftRows.length === 0 ? (
                <EmptyState text="No uplift rankings yet. Uplit needs real offer-experiment data: record assignments and redemptions (they build up automatically as offers are served), then push the ledger." />
              ) : (
                <UpliftTable rows={upliftRows} total={upliftTotal} />
              )}
            </div>
          )}

          {/* ── Segments tab ── */}
          {tab === 'segments' && (
            <div className="space-y-4">
              <OpStrip
                ops={[
                  { key: 'segmentSync', label: 'Sync & train segments', icon: <RefreshCw size={14} />, state: ops.segmentSync, fn: opSegmentSync },
                ]}
              />
              {!status?.segmentModel?.configured ? (
                <NotConfigured name="The Customer Segmentation service" envVar="ML_SEGMENT_BASE_URL" />
              ) : segmentRows.length === 0 ? (
                <EmptyState text="No segments stored yet. Run “Sync & train segments” — it extracts your customers' visit history, trains a per-restaurant K-Means model (needs ≥30 customers with visits), and labels each customer Champions → Dormant. Below the threshold, honest rule tiers are stored instead." />
              ) : (
                <SegmentTable rows={segmentRows} currencySymbol={currencySymbol} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

function OpStrip({ ops }: {
  ops: Array<{ key: string; label: string; icon: React.ReactNode; state?: OpsState; fn: () => void }>;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
      {ops.map((op) => (
        <div key={op.key} className="flex flex-col">
          <button
            onClick={op.fn}
            disabled={op.state?.running}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-wait"
          >
            {op.state?.running ? <RefreshCw size={14} className="animate-spin" /> : op.icon}
            {op.label}
          </button>
          {op.state?.message && (
            <span className={`text-xs mt-1 ${op.state.ok === false ? 'text-red-600' : op.state.ok ? 'text-emerald-600' : 'text-gray-500'}`}>
              {op.state.message}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Zap className="text-gray-300 mb-3" size={36} />
      <p className="text-sm text-gray-500 max-w-md">{text}</p>
    </div>
  );
}

function DemandTable({ rows, currencySymbol }: { rows: StoredDemandPrediction[]; currencySymbol: string }) {
  // Group by product; sort each product's dates ascending.
  const byProduct = new Map<string, StoredDemandPrediction[]>();
  for (const row of rows) {
    const list = byProduct.get(row.entityId);
    if (list) list.push(row);
    else byProduct.set(row.entityId, [row]);
  }
  const products = Array.from(byProduct.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-3">
      {products.map(([productId, points]) => {
        const total = points.reduce((a, p) => a + (p.expected || 0), 0);
        const mode = points[0]?.dataMode ? DATA_MODE_LABELS[points[0].dataMode] || points[0].dataMode : null;
        const conf = points[0]?.confidenceLevel;
        return (
          <div key={productId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-gray-900 text-sm">{productId}</p>
                <p className="text-xs text-gray-500">
                  {mode ?? 'unknown mode'}
                  {conf ? ` · ${conf.replace('_', ' ').toLowerCase()}` : ''}
                  {` · ${points.length}-day horizon`}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-700">
                Total {fmtNum(total)} units · ≈{currencySymbol}{fmtNum(total * 0, 0)}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-gray-100">
              {points.map((p) => (
                <div key={p.predictionFor} className="bg-white px-3 py-2">
                  <p className="text-xs text-gray-500">{p.predictionFor}</p>
                  <p className="text-sm font-semibold text-gray-900">{fmtNum(p.expected)}</p>
                  <p className="text-xs text-gray-400">
                    {fmtNum(p.lower, 0)}–{fmtNum(p.upper, 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComboTable({ rows, currencySymbol }: { rows: StoredComboPrediction[]; currencySymbol: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2">Product A</th>
            <th className="px-4 py-2">Product B</th>
            <th className="px-4 py-2 text-right">Expected (7d)</th>
            <th className="px-4 py-2 text-right">Est. profit (7d)</th>
            <th className="px-4 py-2 text-right">Model</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.entityId}-${r.generatedAt}`} className="border-t border-gray-100">
              <td className="px-4 py-2 text-gray-800">{shortName(r.productAId)}</td>
              <td className="px-4 py-2 text-gray-800">{shortName(r.productBId)}</td>
              <td className="px-4 py-2 text-right font-medium">{fmtNum(r.expectedPurchases7d)}</td>
              <td className="px-4 py-2 text-right">
                {r.estimatedFutureProfit === null ? '—' : `${currencySymbol}${fmtNum(r.estimatedFutureProfit, 0)}`}
              </td>
              <td className="px-4 py-2 text-right text-xs text-gray-500">{r.modelVersion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpliftTable({ rows, total }: { rows: UpliftCustomerRow[]; total: number | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-600">
        Top {rows.length} of {total ?? rows.length} eligible customers — ranked by predicted uplift from an offer
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2">Customer</th>
            <th className="px-4 py-2 text-right">Uplift</th>
            <th className="px-4 py-2 text-right">Score</th>
            <th className="px-4 py-2">Eligibility</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.customer_id} className="border-t border-gray-100">
              <td className="px-4 py-2 text-gray-800">{c.customer_id}</td>
              <td className="px-4 py-2 text-right font-medium text-emerald-700">
                +{fmtNum(c.uplift_percentage_points, 1)} pp
              </td>
              <td className="px-4 py-2 text-right">{fmtNum(c.uplift_score, 2)}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'eligible' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {c.status ?? 'unknown'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEGMENT_COLORS: Record<string, string> = {
  Champions: 'bg-emerald-100 text-emerald-700',
  Loyal: 'bg-blue-100 text-blue-700',
  Regular: 'bg-sky-100 text-sky-700',
  Potential: 'bg-amber-100 text-amber-700',
  'At-risk': 'bg-orange-100 text-orange-700',
  Dormant: 'bg-gray-200 text-gray-600',
  New: 'bg-violet-100 text-violet-700',
};

function SegmentTable({ rows, currencySymbol }: { rows: StoredSegmentRow[]; currencySymbol: string }) {
  // Summary strip + customer table; trained rows carry model provenance.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.segment, (counts.get(r.segment) || 0) + 1);
  const trainedCount = rows.filter((r) => r.isTrained).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([seg, n]) => (
          <span key={seg} className={`px-3 py-1 rounded-full text-sm font-medium ${SEGMENT_COLORS[seg] ?? 'bg-gray-100 text-gray-700'}`}>
            {seg}: {n}
          </span>
        ))}
        <span className="px-3 py-1 rounded-full text-sm text-gray-500 bg-gray-50">
          {trainedCount}/{rows.length} from trained model{trainedCount < rows.length ? ' (rest: rule tiers)' : ''}
        </span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Segment</th>
              <th className="px-4 py-2 text-right">Days since visit</th>
              <th className="px-4 py-2 text-right">Visits</th>
              <th className="px-4 py-2 text-right">Total spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entityId} className="border-t border-gray-100">
                <td className="px-4 py-2 text-gray-800">{shortName(r.entityId)}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${SEGMENT_COLORS[r.segment] ?? 'bg-gray-100 text-gray-700'}`}>
                    {r.segment}
                  </span>
                  {!r.isTrained && <span className="ml-1.5 text-[10px] text-gray-400">rule</span>}
                </td>
                <td className="px-4 py-2 text-right">{r.recencyDays ?? '—'}</td>
                <td className="px-4 py-2 text-right">{r.frequency ?? '—'}</td>
                <td className="px-4 py-2 text-right">{r.monetary === null ? '—' : `${currencySymbol}${fmtNum(r.monetary, 0)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shortName(id: string): string {
  // Product ids are ObjectIds or P_<NAME> slugs — show the readable tail.
  if (id.startsWith('P_')) return id.slice(2).replace(/_/g, ' ').toLowerCase();
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

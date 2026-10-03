/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryAgentPanel — owner-facing inventory action plan. Calls the
 * deterministic inventory agent (POST /ai/inventory-agent/recommend), which
 * reads live stock levels, the stockout forecast, expiry risk and kitchen
 * wastage. Read-only: the panel never writes to inventory — it only shows
 * evidence-backed actions the owner can act on in Purchasing / Expiry.
 */

import React, { useState } from 'react';
import { Bot, RefreshCw, Loader2, AlertTriangle, PackageCheck, CalendarClock, Trash2 } from 'lucide-react';
import {
  runInventoryAgentRecommendation,
  type InventoryAgentResult,
} from '../../../api/client';

const URGENCY_META: Record<string, { label: string; cls: string }> = {
  high: { label: 'Urgent', cls: 'bg-red-50 text-red-600 border-red-100' },
  medium: { label: 'Soon', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'Low', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

export default function InventoryAgentPanel({ currencySymbol = '' }: { currencySymbol?: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InventoryAgentResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await runInventoryAgentRecommendation();
      if (!res?.result) {
        setResult(null);
        setError('The inventory agent is unavailable right now. Check that the backend is reachable and try again.');
        return;
      }
      setResult(res.result);
    } finally {
      setLoading(false);
    }
  };

  const hasActions =
    result &&
    (result.purchaseRecommendations.length > 0 ||
      result.expiryRisks.length > 0 ||
      result.wastageSignals.length > 0);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Inventory agent</p>
          <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" /> AI action plan
          </h3>
          <p className="text-[11px] text-gray-500 mt-1">
            Reads stock levels, the stockout forecast, expiry batches and kitchen wastage. Nothing is ordered automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="shrink-0 flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing…</>
          ) : (
            <><RefreshCw className="w-3.5 h-3.5" /> {result ? 'Refresh plan' : 'Run agent'}</>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] text-gray-600"><strong>Summary:</strong> {result.summary}</p>

          {result.status === 'insufficient_data' && (
            <p className="text-[11px] text-gray-400">
              One or more data sources are unavailable — the plan covers only what could be read honestly.
            </p>
          )}

          {hasActions && (
            <div className="grid grid-cols-1 gap-3">
              {result.purchaseRecommendations.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <PackageCheck className="w-3 h-3" /> Reorder actions
                  </p>
                  <div className="space-y-1.5">
                    {result.purchaseRecommendations.slice(0, 6).map((r, i) => {
                      const meta = URGENCY_META[r.urgency] ?? URGENCY_META.low;
                      return (
                        <div key={`${r.item}-${i}`} className="flex items-start justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <div className="min-w-0">
                            <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-black mr-1.5 ${meta.cls}`}>{meta.label}</span>
                            <span className="text-xs font-bold text-gray-900">{r.item}</span>
                            <span className="text-[11px] text-gray-500"> — {r.suggestedQty}</span>
                            <p className="text-[10px] text-gray-400 mt-0.5">{r.reason}</p>
                          </div>
                          {r.estimatedCost != null && (
                            <span className="shrink-0 text-[11px] font-semibold text-gray-600">≈{currencySymbol}{r.estimatedCost}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.expiryRisks.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" /> Expiry risks
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {result.expiryRisks.slice(0, 6).map((e, i) => (
                      <span
                        key={`${e.itemId}-${i}`}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
                          e.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {e.itemName} · {e.daysUntilExpiry}d
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.wastageSignals.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Wastage hotspots
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {result.wastageSignals.slice(0, 6).map((w, i) => (
                      <span key={`${w.name}-${i}`} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] text-orange-700">
                        {w.name} · {w.qty}{w.unit ? ` ${w.unit}` : ''} (≈{currencySymbol}{w.cost})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result.nextActions.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Recommended next steps</p>
              <ul className="space-y-1">
                {result.nextActions.map((a, i) => (
                  <li key={i} className="text-[11px] text-gray-600">• {a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

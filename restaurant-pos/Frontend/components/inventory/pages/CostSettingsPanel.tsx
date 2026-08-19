/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostSettingsPanel — restaurant-level cost assumptions (layered model).
 *
 * Keeps the owner's work minimal: set a few ₹ amounts once, and every recipe
 * re-prices automatically (backend recalc on save). The "Calculate from recent
 * data" button is advisory only — suggestions are shown with Apply / Keep and
 * never silently overwrite the merchant's settings.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Loader2, FlaskConical, Flame, Percent, Package, TrendingUp,
  AlertTriangle, Check, RefreshCw, IndianRupee,
} from 'lucide-react';
import { fetchCostSettings, updateCostSettings, calibrateCostSettings } from '../../../src/api/client';
import { useNotify } from '../InventoryManager';

const fmt = (n: number) => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CostSettingsPanel() {
  const notify = useNotify();
  const [settings, setSettings] = useState<any | null>(null);
  const [synced, setSynced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Draft inputs (strings so empty = 0 renders cleanly).
  const [minor, setMinor] = useState('0');
  const [cooking, setCooking] = useState('0');
  const [wastage, setWastage] = useState('0');
  const [markup, setMarkup] = useState('10');
  const [pkgDineIn, setPkgDineIn] = useState('0');
  const [pkgTakeaway, setPkgTakeaway] = useState('0');
  const [pkgDelivery, setPkgDelivery] = useState('0');

  // Calibration
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<any | null>(null);
  const [calError, setCalError] = useState('');

  const load = useCallback(async () => {
    const data = await fetchCostSettings();
    if (!data) { setSynced(false); return; }
    setSettings(data);
    setSynced(true);
    setMinor(String(data.minorIngredientAllowance ?? 0));
    setCooking(String(data.cookingAllowance ?? 0));
    setWastage(String(data.wastagePercent ?? 0));
    setMarkup(String(data.conservativeMarkupPercent ?? 10));
    setPkgDineIn(String(data.packaging?.dineIn ?? 0));
    setPkgTakeaway(String(data.packaging?.takeaway ?? 0));
    setPkgDelivery(String(data.packaging?.delivery ?? 0));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

  const handleSave = async () => {
    setSaving(true);
    const res = await updateCostSettings({
      minorIngredientAllowance: num(minor),
      cookingAllowance: num(cooking),
      wastagePercent: num(wastage),
      conservativeMarkupPercent: num(markup),
      packaging: { dineIn: num(pkgDineIn), takeaway: num(pkgTakeaway), delivery: num(pkgDelivery) },
    });
    setSaving(false);
    if (res) {
      notify('Cost settings saved — all recipes re-priced', 'success');
      setSettings(res); setCalibration(null);
    } else {
      notify('Save failed — check the connection', 'warning');
    }
  };

  const handleCalibrate = async () => {
    setCalibrating(true); setCalError('');
    const data = await calibrateCostSettings(60);
    setCalibrating(false);
    if (data) setCalibration(data);
    else setCalError('Calibration unavailable — no expense/bill data found.');
  };

  const applySuggestion = (key: 'cookingAllowance' | 'minorIngredientAllowance') => {
    const s = calibration?.suggestions?.[key]?.suggested;
    if (s === undefined) return;
    if (key === 'cookingAllowance') setCooking(String(s));
    else setMinor(String(s));
    notify(`Suggested ${key === 'cookingAllowance' ? 'cooking' : 'minor ingredient'} allowance applied to the form — press Save to use it`, 'info');
  };

  const inputCls = "w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Settings className="w-4 h-4 text-[var(--brand-color)]" /> Cost Settings
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">Once-off assumptions — every recipe re-prices automatically when these change.</p>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !synced}
          className="px-4 py-2 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save Settings
        </button>
      </div>

      {!synced && settings === null && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-10 text-center text-sm text-gray-400">Loading cost settings…</div>
      )}

      {synced && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Allowances */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Per-serving allowances</p>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center"><FlaskConical className="w-4 h-4 text-amber-600" /></div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-700">Minor ingredients <span className="text-gray-400 font-normal">(₹/item — salt, small masala, garnish)</span></label>
                <input value={minor} onChange={(e) => setMinor(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center"><Flame className="w-4 h-4 text-orange-600" /></div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-700">Cooking / operational <span className="text-gray-400 font-normal">(₹/item — gas, electricity, water)</span></label>
                <input value={cooking} onChange={(e) => setCooking(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center"><Percent className="w-4 h-4 text-red-600" /></div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-700">Standard wastage <span className="text-gray-400 font-normal">(% of direct + minor + cooking)</span></label>
                <input value={wastage} onChange={(e) => setWastage(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-blue-600" /></div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-700">Conservative estimate markup <span className="text-gray-400 font-normal">(% above variable cost — used for offer safety)</span></label>
                <input value={markup} onChange={(e) => setMarkup(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
              </div>
            </div>

            <p className="text-[10px] text-gray-400 leading-relaxed pt-2 border-t border-[var(--color-border-default)]">
              Fixed costs (rent, salaries, subscriptions) are <b>not</b> part of recipe variable cost — they are modeled separately at restaurant level.
            </p>
          </div>

          {/* Packaging + calibration */}
          <div className="space-y-4">
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Packaging by channel (₹ per order)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Dine-in</label>
                  <input value={pkgDineIn} onChange={(e) => setPkgDineIn(e.target.value)} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Takeaway</label>
                  <input value={pkgTakeaway} onChange={(e) => setPkgTakeaway(e.target.value)} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Delivery</label>
                  <input value={pkgDelivery} onChange={(e) => setPkgDelivery(e.target.value)} inputMode="decimal" className={inputCls} />
                </div>
              </div>
            </div>

            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Calculate from recent data
                </p>
                <button
                  onClick={() => void handleCalibrate()}
                  disabled={calibrating}
                  className="px-3 py-1.5 bg-blue-50 text-[var(--brand-color)] rounded-lg text-[10px] font-bold hover:bg-blue-100 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1"
                >
                  {calibrating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Analyze 60 days
                </button>
              </div>

              {calError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {calError}
                </div>
              )}

              {calibration && (
                <div className="space-y-3">
                  <p className="text-[11px] text-gray-500 leading-relaxed">{calibration.summary}</p>

                  {calibration.itemsSold > 0 && (
                    <div className="space-y-2">
                      {calibration.suggestions.cookingAllowance.suggested > 0 && (
                        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
                          <div>
                            <p className="text-[10px] font-bold text-orange-700 uppercase">Cooking allowance</p>
                            <p className="text-xs font-mono text-gray-700">
                              Recommended {fmt(calibration.suggestions.cookingAllowance.suggested)}
                              <span className="text-gray-400"> · current {fmt(calibration.suggestions.cookingAllowance.current)}</span>
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => applySuggestion('cookingAllowance')} className="px-2.5 py-1.5 bg-[var(--color-orange-600-solid)] text-white rounded-lg text-[10px] font-bold hover:bg-[var(--color-orange-700-solid)] transition-all cursor-pointer">Use {fmt(calibration.suggestions.cookingAllowance.suggested)}</button>
                            <button onClick={() => setCalibration(null)} className="px-2.5 py-1.5 bg-[var(--color-bg-white)] border border-orange-200 text-orange-700 rounded-lg text-[10px] font-bold hover:bg-orange-50 transition-all cursor-pointer">Keep {fmt(calibration.suggestions.cookingAllowance.current)}</button>
                          </div>
                        </div>
                      )}
                      {calibration.suggestions.minorIngredientAllowance.suggested > 0 && (
                        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          <div>
                            <p className="text-[10px] font-bold text-amber-700 uppercase">Minor ingredients</p>
                            <p className="text-xs font-mono text-gray-700">
                              Recommended {fmt(calibration.suggestions.minorIngredientAllowance.suggested)}
                              <span className="text-gray-400"> · current {fmt(calibration.suggestions.minorIngredientAllowance.current)}</span>
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => applySuggestion('minorIngredientAllowance')} className="px-2.5 py-1.5 bg-[var(--color-amber-600-solid)] text-white rounded-lg text-[10px] font-bold hover:bg-[var(--color-amber-700-solid)] transition-all cursor-pointer">Use {fmt(calibration.suggestions.minorIngredientAllowance.suggested)}</button>
                            <button onClick={() => setCalibration(null)} className="px-2.5 py-1.5 bg-[var(--color-bg-white)] border border-amber-200 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-50 transition-all cursor-pointer">Keep {fmt(calibration.suggestions.minorIngredientAllowance.current)}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <IndianRupee className="w-3 h-3" /> {calibration.itemsSold.toLocaleString('en-IN')} items sold · ₹{Number(calibration.operatingExpenses || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} operating expenses in the window.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

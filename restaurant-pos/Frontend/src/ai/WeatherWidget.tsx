/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeatherWidget — Compact weather-based recommendation component.
 * Shows only when relevant. Always expanded (no collapse toggle).
 * Integrates into Dashboard and Inventory.
 */

import React, { useState, useEffect } from 'react';
import { Thermometer, CloudRain, Snowflake, Sun, Loader2, AlertCircle } from 'lucide-react';
import { getWeatherRec } from './aiData';
import type { WeatherRec } from './aiData';

const WeatherWidget: React.FC<{ compact?: boolean; menuItems?: string[]; inventoryItems?: string[] }> = React.memo(({ compact = false, menuItems = [], inventoryItems = [] }) => {
  const [weather, setWeather] = useState<WeatherRec | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getWeatherRec().then(w => { setWeather(w); setLoading(false); }).catch(() => {
      setWeather(null);
      setLoading(false);
    });
  }, []);

  const iconMap: Record<string, React.ReactNode> = {
    hot: <Sun className="w-5 h-5 text-amber-500" />,
    rainy: <CloudRain className="w-5 h-5 text-blue-500" />,
    cold: <Snowflake className="w-5 h-5 text-cyan-500" />,
    pleasant: <Sun className="w-5 h-5 text-emerald-500" />,
  };

  // Menu-aware suggestions — only keep recommendations that actually exist on
  // the active menu so the weather block never recommends an item you don't sell.
  // An empty menu yields NO suggestions: we prompt to add items instead of
  // falling back to generic dishes that aren't on the menu.
  const menuName = (n: string) => n.trim().toLowerCase();
  const matchesRealList = (candidate: string, real: string[]) =>
    real.some(m => {
      const mName = menuName(m);
      const cName = menuName(candidate);
      return mName === cName || mName.includes(cName) || cName.includes(mName);
    });
  const hasMenu = menuItems.length > 0;
  const suggestedItems = weather && hasMenu
    ? weather.suggestedItems.filter(s => matchesRealList(s.name, menuItems))
    : [];
  // Inventory tips — only from the REAL inventory list (never raw AI items).
  const hasInventoryList = inventoryItems.length > 0;
  const inventoryTips = weather && hasInventoryList
    ? weather.inventoryAdjustment.filter(a => matchesRealList(a.item, inventoryItems))
    : [];

  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-sm overflow-hidden">
      {/* Header — always visible, no collapse toggle */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-50 border border-[var(--color-border-default)] flex items-center justify-center">
            {loading ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (weather ? (iconMap[weather.condition] || <Thermometer className="w-5 h-5 text-gray-400" />) : <Thermometer className="w-5 h-5 text-gray-400" />)}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              {weather ? <><span className="text-sm font-bold">{weather.icon} {weather.temperature}°C</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold capitalize">{weather.condition}</span></> : <span className="text-sm text-gray-400">{loading ? 'Loading...' : 'Weather unavailable'}</span>}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">AI recommendation</p>
          </div>
        </div>
      </div>

      {/* Body — always expanded */}
      {weather && (
        <div className="border-t border-[var(--color-border-default)] overflow-hidden">
          <div className="px-4 py-3 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">{weather.recommendation}</p>

            {!hasMenu && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl border border-amber-200 px-3 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>No menu items yet.</strong> Add products to your menu first to get weather-based dish recommendations.
                </span>
              </div>
            )}

            {suggestedItems.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Prepare extra</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedItems.map(item => (
                    <div key={item.name} className="px-2.5 py-1.5 bg-blue-50 rounded-xl border border-blue-100">
                      <p className="text-xs font-semibold text-blue-700">{item.name}</p>
                      <p className="text-[9px] text-blue-500 mt-0.5">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!compact && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Inventory tips</p>
                {!hasInventoryList ? (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl border border-amber-200 px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>No inventory items yet.</strong> Add items to your inventory first to get weather-based inventory tips.
                    </span>
                  </div>
                ) : inventoryTips.length > 0 ? (
                  <div className="space-y-1">
                    {inventoryTips.map(adj => (
                      <div key={adj.item} className="flex items-center gap-2 text-xs text-gray-600 py-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          adj.action === 'increase' ? 'bg-[var(--color-emerald-500-solid)]' :
                          adj.action === 'decrease' ? 'bg-[var(--color-red-500-solid)]' : 'bg-[var(--color-amber-500-solid)]'
                        }`} />
                        <span className="font-medium">{adj.item}:</span>
                        <span className="capitalize">{adj.action}</span>
                        <span className="text-gray-400">— {adj.reason}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No inventory items match today's weather.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

WeatherWidget.displayName = 'WeatherWidget';
export default WeatherWidget;

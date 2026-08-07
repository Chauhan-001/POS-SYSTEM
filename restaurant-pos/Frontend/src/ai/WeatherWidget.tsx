/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeatherWidget — Compact weather-based recommendation component.
 * Shows only when relevant. Can be collapsed. Integrates into Dashboard and Inventory.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, Thermometer, CloudRain, Snowflake, Sun, Loader2 } from 'lucide-react';
import { getWeatherRec } from './aiData';
import type { WeatherRec } from './aiData';

const WeatherWidget: React.FC<{ compact?: boolean }> = React.memo(({ compact = false }) => {
  const [expanded, setExpanded] = useState(false);
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

  return (
    <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-50 border border-[#e1e2ed] flex items-center justify-center">
            {loading ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (weather ? (iconMap[weather.condition] || <Thermometer className="w-5 h-5 text-gray-400" />) : <Thermometer className="w-5 h-5 text-gray-400" />)}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              {weather ? <><span className="text-sm font-bold">{weather.icon} {weather.temperature}°C</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold capitalize">{weather.condition}</span></> : <span className="text-sm text-gray-400">{loading ? 'Loading...' : 'Weather unavailable'}</span>}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">AI recommendation</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {/* Body */}
      <AnimatePresence>
        {expanded && weather && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-[#e1e2ed] overflow-hidden"
          >
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">{weather.recommendation}</p>

              {weather.suggestedItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Prepare extra</p>
                  <div className="flex flex-wrap gap-2">
                    {weather.suggestedItems.map(item => (
                      <div key={item.name} className="px-2.5 py-1.5 bg-blue-50 rounded-xl border border-blue-100">
                        <p className="text-xs font-semibold text-blue-700">{item.name}</p>
                        <p className="text-[9px] text-blue-500 mt-0.5">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!compact && weather.inventoryAdjustment && weather.inventoryAdjustment.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Inventory tips</p>
                  {weather.inventoryAdjustment.map(adj => (
                    <div key={adj.item} className="flex items-center gap-2 text-xs text-gray-600 py-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        adj.action === 'increase' ? 'bg-emerald-500' :
                        adj.action === 'decrease' ? 'bg-red-500' : 'bg-amber-500'
                      }`} />
                      <span className="font-medium">{adj.item}:</span>
                      <span className="capitalize">{adj.action}</span>
                      <span className="text-gray-400">— {adj.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

WeatherWidget.displayName = 'WeatherWidget';
export default WeatherWidget;

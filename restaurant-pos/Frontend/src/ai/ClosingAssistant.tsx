/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ClosingAssistant — AI-powered closing time summary.
 * Shown after daily closing / Z-Report. Provides actionable insights.
 * Compact, clean, no clutter. Answers "What should I do next?"
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, TrendingUp, Package, AlertTriangle, ShoppingCart, CheckCircle, Loader2 } from 'lucide-react';
import { generateClosingAssistant } from './aiData';
import type { ClosingAssistantData } from './aiData';

interface ClosingAssistantProps {
  totalRevenue: number;
  orderCount: number;
  lowStockItems: number;
  wasteCost: number;
}

const moodConfig: Record<string, { emoji: string; label: string; color: string }> = {
  great: { emoji: '🌟', label: 'Great day!', color: 'text-emerald-600' },
  good: { emoji: '👍', label: 'Good day', color: 'text-blue-600' },
  okay: { emoji: '📊', label: 'Okay day', color: 'text-amber-600' },
  needs_attention: { emoji: '⚠️', label: 'Needs attention', color: 'text-red-600' },
};

const ClosingAssistant: React.FC<ClosingAssistantProps> = ({
  totalRevenue, orderCount, lowStockItems, wasteCost,
}) => {
  const [data, setData] = useState<ClosingAssistantData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    generateClosingAssistant(totalRevenue, orderCount, lowStockItems, wasteCost)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [totalRevenue, orderCount, lowStockItems, wasteCost]);

  if (loading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="bg-gradient-to-br from-[#f8f6ff] to-white rounded-2xl border border-purple-200 shadow-sm p-8 flex items-center justify-center"
      >
        <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
      </motion.div>
    );
  }

  if (!data) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="bg-gradient-to-br from-[#f8f6ff] to-white rounded-2xl border border-purple-200 shadow-sm p-6"
      >
        <div className="flex items-center gap-3 text-gray-400">
          <Sparkles className="w-5 h-5 text-purple-300" />
          <div>
            <p className="text-sm font-semibold text-gray-500">Closing Assistant</p>
            <p className="text-[10px] mt-0.5">AI summary is currently unavailable. Using local estimates.</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const mood = moodConfig[data.mood] || moodConfig.okay;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[#f8f6ff] to-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-purple-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800">Closing Assistant</span>
            <p className="text-[10px] text-gray-400 mt-0.5">AI-powered end-of-day summary</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg ${mood.color}`}>{mood.emoji}</span>
          <span className={`text-xs font-bold ${mood.color}`}>{mood.label}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Today's Summary */}
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-emerald-500" />
          <div>
            <p className="text-sm font-bold">{data.todaySummary}</p>
            {data.revenuePrediction && (
              <p className="text-[10px] text-gray-400">{data.revenuePrediction}</p>
            )}
          </div>
        </div>

        {/* Tomorrow's Prep */}
        <div>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3 text-emerald-500" /> Tomorrow's Prep
          </p>
          <ul className="space-y-1.5">
            {data.tomorrowPrep.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                <span className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Items to Order */}
        {data.itemsToOrder.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShoppingCart className="w-3 h-3 text-amber-500" /> Items to Order
            </p>
            <div className="space-y-1.5">
              {data.itemsToOrder.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risks */}
        <div>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-500" /> Potential Risks
          </p>
          <div className="space-y-1.5">
            {data.potentialRisks.map((risk, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {risk.startsWith('⚠️') ? (
                  <span className="text-red-500 font-medium">{risk}</span>
                ) : (
                  <span className="text-emerald-600">{risk}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

ClosingAssistant.displayName = 'ClosingAssistant';
export default ClosingAssistant;

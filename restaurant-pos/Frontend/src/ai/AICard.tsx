/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICard — Reusable AI insight widget for dashboards and pages.
 * Compact, actionable, visually consistent with existing design.
 */

import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, TrendingUp, AlertTriangle, Info, ChevronRight } from 'lucide-react';

interface AICardProps {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
  compact?: boolean;
  className?: string;
  onAction?: () => void;
  actionLabel?: string;
}

const colorMap: Record<string, { bg: string; border: string; iconBg: string }> = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', iconBg: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', iconBg: 'bg-purple-500' },
  red: { bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-500' },
  gray: { bg: 'bg-gray-50', border: 'border-gray-200', iconBg: 'bg-gray-500' },
};

const AICard: React.FC<AICardProps> = React.memo(({
  title, children, icon, color = 'purple', compact = false,
  className = '', onAction, actionLabel,
}) => {
  const colors = colorMap[color] || colorMap.purple;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border ${colors.border} ${colors.bg} overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 ${compact ? 'px-4 py-2.5' : 'px-5 py-3'} border-b ${colors.border}`}>
        <div className={`w-6 h-6 rounded-lg ${colors.iconBg} flex items-center justify-center shrink-0`}>
          {icon || <Sparkles className="w-3.5 h-3.5 text-white" />}
        </div>
        <span className={`font-bold ${compact ? 'text-xs' : 'text-sm'} text-gray-800`}>{title}</span>
      </div>

      {/* Body */}
      <div className={compact ? 'px-4 py-3' : 'px-5 py-4'}>
        {children}
      </div>

      {/* Action */}
      {onAction && actionLabel && (
        <div className={`px-5 py-2.5 border-t ${colors.border}`}>
          <button onClick={onAction}
            className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
          >
            {actionLabel} <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </motion.div>
  );
});

AICard.displayName = 'AICard';
export default AICard;

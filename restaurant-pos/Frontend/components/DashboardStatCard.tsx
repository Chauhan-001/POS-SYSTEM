/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Memoized KPI stat card used in DashboardWorkspace.
 * Extracted to prevent re-rendering all 4 stat cards when only one data point changes.
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  badge?: string;
  badgeColor?: string;
  children?: React.ReactNode;
}

function StatCard({ label, value, subtitle, icon: Icon, iconBg, iconColor, badge, badgeColor, children }: StatCardProps) {
  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4 sm:p-5 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase text-gray-500 tracking-wider truncate">{label}</span>
          <div className={`w-9 h-9 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center shrink-0 shadow-xs`}>
            <Icon className="w-4.5 h-4.5" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-black text-[var(--color-text-primary)] font-mono tracking-tight">{value}</span>
          {badge && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor || 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 font-medium mt-1 truncate">{subtitle}</p>
      </div>
      {children && (
        <div className="mt-3.5 pt-3 border-t border-[var(--color-border-default)]/60">
          {children}
        </div>
      )}
    </div>
  );
}

export default React.memo(StatCard);

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
  children?: React.ReactNode;
}

function StatCard({ label, value, subtitle, icon: Icon, iconBg, iconColor, children }: StatCardProps) {
  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{label}</p>
          <p className="text-2xl font-black text-gray-900 mt-1 font-mono">{value}</p>
          <p className="text-[10px] text-gray-400 mt-1">{subtitle}</p>
        </div>
        <div className={`p-3 rounded-xl ${iconBg} ${iconColor}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      {children && (
        <div className="mt-3 border-t border-gray-50 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

export default React.memo(StatCard);

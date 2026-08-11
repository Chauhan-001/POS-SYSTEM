/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, X } from 'lucide-react';
import type { ActivityEntry } from '../../types';

interface ActivityFeedModalProps {
  isOpen: boolean;
  activityFeed: ActivityEntry[];
  onClose: () => void;
}

export default function ActivityFeedModal({ isOpen, activityFeed, onClose }: ActivityFeedModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-1.5"><Activity className="w-4 h-4 text-blue-600" /> Activity Feed</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-2">
          {activityFeed.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No transactions yet today</p>
          ) : (
            activityFeed.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg border-b border-gray-100 last:border-0">
                <div className="w-2 h-2 rounded-full mt-1.5 bg-[var(--brand-color)] shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold">{entry.title}</p>
                  <p className="text-[10px] text-gray-500">{entry.description}</p>
                </div>
                <span className="text-[9px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

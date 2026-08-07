/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RefreshCw, X } from 'lucide-react';

interface SyncState {
  lastSynced: string | null;
  online: boolean;
  pendingChanges: number;
}

interface SyncPanelModalProps {
  isOpen: boolean;
  syncState: SyncState;
  onClose: () => void;
  onSync: () => void;
}

export default function SyncPanelModal({ isOpen, syncState, onClose, onSync }: SyncPanelModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 border border-[#e1e2ed] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-sm mb-4 flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4 text-[#004ac6]" />
          Sync Status
        </h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Status</span>
            <span className="text-xs font-bold text-green-600">● {syncState.online ? "Online" : "Offline"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Last Synced</span>
            <span className="text-xs font-mono">{syncState.lastSynced ? new Date(syncState.lastSynced).toLocaleTimeString() : "Never"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Pending Changes</span>
            <span className="text-xs font-mono">{syncState.pendingChanges}</span>
          </div>
          <button onClick={onSync} className="w-full py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer">
            Sync Now
          </button>
        </div>
      </div>
    </div>
  );
}

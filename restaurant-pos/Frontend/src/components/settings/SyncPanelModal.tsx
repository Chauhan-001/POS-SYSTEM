/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RefreshCw, X, AlertTriangle, Trash2, RotateCcw } from 'lucide-react';
import type { PendingOperation } from '../../lib/syncEngine';

interface SyncState {
  lastSynced: string | null;
  online: boolean;
  pendingChanges: number;
}

interface SyncPanelModalProps {
  isOpen: boolean;
  syncState: SyncState;
  operations: ReadonlyArray<PendingOperation>;
  onClose: () => void;
  onSync: () => void;
  onRetry: (id: string) => void;
  onClear: (id: string) => void;
}

/** Human-readable label for an operation (e.g. "POST /bills"). */
function opLabel(op: PendingOperation): string {
  const base = `${op.method} ${op.path}`;
  return base.length > 42 ? `${base.slice(0, 39)}...` : base;
}

export default function SyncPanelModal({ isOpen, syncState, operations, onClose, onSync, onRetry, onClear }: SyncPanelModalProps) {
  if (!isOpen) return null;

  const stalledCount = operations.filter((o) => o.stalled).length;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-sm w-full mx-4 border border-[var(--color-border-default)] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-sm mb-4 flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4 text-[var(--brand-color)]" />
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
          <button onClick={onSync} className="w-full py-2 bg-[var(--brand-color)] text-white rounded-lg text-xs font-bold hover:bg-[var(--color-primary-hover)] cursor-pointer">
            Sync Now
          </button>

          {operations.length > 0 && (
            <div className="border-t border-[var(--color-border-default)] pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-700">Queued Operations</span>
                {stalledCount > 0 && (
                  <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {stalledCount} need attention
                  </span>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {operations.map((op) => (
                  <div key={op.id} className={`rounded-lg border px-2.5 py-2 ${op.stalled ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-bold text-gray-800 truncate">{opLabel(op)}</span>
                      {op.stalled ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => onRetry(op.id)}
                            title="Retry this operation"
                            className="p-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onClear(op.id)}
                            title="Discard this operation"
                            className="p-1 rounded-md bg-gray-400 text-white hover:bg-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-gray-500 shrink-0">retry {op.retries}/{op.maxRetries}</span>
                      )}
                    </div>
                    {op.stalled && op.error && (
                      <div className="mt-1 text-[10px] text-amber-700 truncate" title={op.error}>{op.error}</div>
                    )}
                    {!op.stalled && (
                      <div className="mt-0.5 text-[10px] text-gray-400">{new Date(op.createdAt).toLocaleString()}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={onClose} className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700 cursor-pointer flex items-center justify-center gap-1">
            <X className="w-3 h-3" /> Close
          </button>
        </div>
      </div>
    </div>
  );
}

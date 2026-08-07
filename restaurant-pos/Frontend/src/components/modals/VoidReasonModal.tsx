/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ban } from 'lucide-react';

interface VoidReason {
  id: string;
  label: string;
}

interface VoidReasonModalProps {
  isOpen: boolean;
  voidReasons: VoidReason[];
  onSelect: (reasonId: string) => void;
  onClose: () => void;
}

export default function VoidReasonModal({ isOpen, voidReasons, onSelect, onClose }: VoidReasonModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-1.5">
          <Ban className="w-4 h-4 text-red-500" />
          Void Reason
        </h3>
        <div className="space-y-2">
          {voidReasons.map((r) => (
            <button
              key={r.id}
              onClick={() => { onSelect(r.id); onClose(); }}
              className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs font-semibold border border-[#e1e2ed] cursor-pointer transition-all"
            >
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}

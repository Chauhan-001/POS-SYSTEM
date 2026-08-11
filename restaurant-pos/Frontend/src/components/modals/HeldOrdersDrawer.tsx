/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RefreshCw, X } from 'lucide-react';

interface HeldOrder {
  id: string;
  timestamp: string;
  items: any[];
  customer: any | null;
  type: any;
  orderId?: string;
}

interface HeldOrdersDrawerProps {
  isOpen: boolean;
  heldOrders: HeldOrder[];
  onClose: () => void;
  onRecall: (holdId: string) => void;
}

export default function HeldOrdersDrawer({ isOpen, heldOrders, onClose, onRecall }: HeldOrdersDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[40] flex items-start justify-center pt-16 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 border border-[#e1e2ed]" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-[var(--brand-color)]" /> Held Orders ({heldOrders.length})</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 max-h-96 overflow-y-auto space-y-2">
          {heldOrders.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No held orders</p>
          ) : (
            heldOrders.map((hold) => (
              <div key={hold.id} className="bg-gray-50 rounded-lg p-3 border border-[#e1e2ed] flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold">{hold.items.length} items @ {hold.timestamp}</p>
                  <p className="text-[10px] text-gray-500">{hold.type} {hold.customer ? `- ${hold.customer.name}` : ""}</p>
                </div>
                <button onClick={() => onRecall(hold.id)} data-tour="recall-item" className="px-3 py-1 bg-[var(--brand-color)] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] cursor-pointer">Recall</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

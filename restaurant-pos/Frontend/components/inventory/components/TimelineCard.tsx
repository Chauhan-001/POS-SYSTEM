import { ShoppingCart, Utensils, SlidersHorizontal, Trash2, ClipboardCheck, X } from 'lucide-react';
import type { TimelineEntry } from '../types';

const typeConfig = {
  purchased: { icon: ShoppingCart, color: 'text-emerald-600 bg-emerald-50 border-emerald-200', label: 'Purchased' },
  sold: { icon: Utensils, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'Sold' },
  adjusted: { icon: SlidersHorizontal, color: 'text-amber-600 bg-amber-50 border-amber-200', label: 'Adjusted' },
  waste: { icon: Trash2, color: 'text-red-600 bg-red-50 border-red-200', label: 'Waste' },
  closing: { icon: ClipboardCheck, color: 'text-purple-600 bg-purple-50 border-purple-200', label: 'Closing' },
};

export default function TimelineCard({ entry, isLast, onDelete }: {
  entry: TimelineEntry;
  isLast?: boolean;
  /** When provided, renders a delete button (used for real purchase rows). */
  onDelete?: (id: string) => void;
}) {
  const config = typeConfig[entry.type];
  const Icon = config.icon;
  return (
    <div className="group relative flex gap-4 pb-6">
      {!isLast && <div className="absolute left-[19px] top-10 bottom-0 w-px bg-[#e1e2ed]" />}
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${config.color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold">{entry.item}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${config.color}`}>{config.label}</span>
        </div>
        <p className="text-xs text-gray-600">{entry.details}</p>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
          <span>{entry.quantity > 0 ? '+' : ''}{entry.quantity} {entry.unit}</span>
          <span>{entry.operator}</span>
          <span>{entry.timestamp}</span>
        </div>
      </div>
      {onDelete && (
        <button onClick={() => onDelete(entry.id)} title="Delete purchase"
          className="self-start p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

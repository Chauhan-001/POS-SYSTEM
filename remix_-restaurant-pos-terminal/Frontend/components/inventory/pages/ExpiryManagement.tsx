import { motion } from 'motion/react';
import { Calendar, Clock, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';
import { EXPIRY_ITEMS } from '../data';
import { useNotify } from '../InventoryManager';

const timeGroups = [
  { label: 'Expired', range: (d: number) => d < 0, color: 'bg-red-50 border-red-200', dot: 'bg-red-500', textColor: 'text-red-700' },
  { label: 'Today', range: (d: number) => d === 0, color: 'bg-red-50 border-red-200', dot: 'bg-red-500', textColor: 'text-red-700' },
  { label: 'Tomorrow', range: (d: number) => d === 1, color: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500', textColor: 'text-amber-700' },
  { label: '3 Days', range: (d: number) => d >= 2 && d <= 3, color: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500', textColor: 'text-amber-700' },
  { label: '7 Days', range: (d: number) => d >= 4 && d <= 7, color: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500', textColor: 'text-blue-700' },
  { label: 'Safe', range: (d: number) => d > 7, color: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', textColor: 'text-emerald-700' },
];

const actionLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  use_immediately: { label: 'Use Now', icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'bg-amber-50 text-amber-700' },
  donate: { label: 'Donate', icon: <Info className="w-3.5 h-3.5" />, color: 'bg-blue-50 text-blue-700' },
  discard: { label: 'Discard', icon: <AlertTriangle className="w-3.5 h-3.5" />, color: 'bg-red-50 text-red-700' },
  sale: { label: 'Sale', icon: <Clock className="w-3.5 h-3.5" />, color: 'bg-emerald-50 text-emerald-700' },
};

export default function ExpiryManagement() {
  const notify = useNotify();
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Expiry Tracking</h1>
        <p className="text-xs text-gray-400 mt-0.5">Items approaching expiration</p>
      </div>

      {/* Timeline cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {timeGroups.filter(g => g.label !== 'Safe').map(group => {
          const items = EXPIRY_ITEMS.filter(i => group.range(i.daysRemaining));
          return (
            <motion.div key={group.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
              className={`rounded-2xl border p-5 ${group.color}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                <span className={`text-sm font-bold ${group.textColor}`}>{group.label}</span>
              </div>
              <p className={`text-3xl font-bold font-mono ${group.textColor}`}>{items.length}</p>
              <p className="text-[10px] text-gray-500 mt-1">items</p>
            </motion.div>
          );
        })}
      </div>

      {/* Items list */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] overflow-hidden shadow-sm"
      >
        <div className="p-4 border-b border-[#e1e2ed]">
          <p className="text-sm font-bold">All Items</p>
        </div>
        <div className="divide-y divide-[#e1e2ed]">
          {EXPIRY_ITEMS.map(item => {
            const group = timeGroups.find(g => g.range(item.daysRemaining)) || timeGroups[timeGroups.length - 1];
            const action = actionLabels[item.suggestedAction] || actionLabels.discard;
            return (
              <div key={item.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                  <div>
                    <p className="text-sm font-semibold">{item.item}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{item.batchNumber}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold font-mono">{item.quantity} {item.unit}</p>
                    <p className="text-[10px] text-gray-400">
                      <Calendar className="w-3 h-3 inline mr-0.5" />
                      {item.expiryDate}
                    </p>
                  </div>
                  <button onClick={() => notify(`${item.item} marked for ${action.label.toLowerCase()}`, 'success')}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all hover:scale-105 ${action.color}`}>
                    {action.icon}{action.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
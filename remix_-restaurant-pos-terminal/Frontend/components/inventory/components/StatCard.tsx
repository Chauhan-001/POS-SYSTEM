import type { LucideIcon } from 'lucide-react';

export default function StatCard({ icon: Icon, label, value, sub, color = 'blue' }: { icon: LucideIcon; label: string; value: string; sub?: string; color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'emerald' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]} bg-opacity-50`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <p className="text-xl font-bold font-mono">{value}</p>
      {sub && <p className="text-[10px] mt-1 opacity-70">{sub}</p>}
    </div>
  );
}

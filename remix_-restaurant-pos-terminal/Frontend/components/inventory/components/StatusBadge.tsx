export default function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  const colors: Record<string, string> = {
    healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    normal: 'bg-blue-50 text-blue-700 border-blue-200',
    low: 'bg-amber-50 text-amber-700 border-amber-200',
    critical: 'bg-red-50 text-red-700 border-red-200',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive: 'bg-gray-50 text-gray-500 border-gray-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
  };
  const dots: Record<string, string> = {
    healthy: 'bg-emerald-500',
    normal: 'bg-blue-500',
    low: 'bg-amber-500',
    critical: 'bg-red-500',
    active: 'bg-emerald-500',
    inactive: 'bg-gray-400',
    completed: 'bg-emerald-500',
    pending: 'bg-amber-500',
    cancelled: 'bg-red-500',
  };
  const sizes = { sm: 'text-[10px] px-2 py-0.5', md: 'text-xs px-2.5 py-1', lg: 'text-sm px-3 py-1.5' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${colors[status] || 'bg-gray-50 text-gray-600 border-gray-200'} ${sizes[size]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status] || 'bg-gray-400'}`} />
      {status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')}
    </span>
  );
}

export default function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse bg-white rounded-xl border border-[#e1e2ed] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-2 bg-gray-100 rounded w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

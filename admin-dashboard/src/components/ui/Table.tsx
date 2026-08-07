import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { Skeleton } from './Skeleton'

export interface Column<T> {
  key: string
  header: string
  render?: (item: T) => ReactNode
  sortable?: boolean
  className?: string
  hideOnMobile?: boolean
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onRowClick?: (item: T) => void
  emptyMessage?: string
  keyExtractor: (item: T) => string
}

export function Table<T>({
  columns,
  data,
  loading,
  page = 1,
  totalPages = 1,
  onPageChange,
  onRowClick,
  emptyMessage = 'No data found',
  keyExtractor,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800">
        <div className="space-y-3">
          <div className="flex gap-4">
            {columns.map((col) => (
              <Skeleton key={col.key} className="h-8 flex-1" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              {columns.map((col) => (
                <Skeleton key={col.key} className="h-10 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-surface-200 bg-white py-16 dark:border-surface-700 dark:bg-surface-800">
        <p className="text-sm text-surface-500 dark:text-surface-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 font-medium text-surface-600 dark:text-surface-400',
                    col.hideOnMobile && 'hidden md:table-cell',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr
                key={keyExtractor(item)}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'border-b border-surface-100 transition-colors last:border-0 dark:border-surface-700/50',
                  onRowClick && 'cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/30',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-surface-700 dark:text-surface-300',
                      col.hideOnMobile && 'hidden md:table-cell',
                      col.className,
                    )}
                  >
                    {col.render ? col.render(item) : (item as any)[col.key] ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-surface-200 px-4 py-3 dark:border-surface-700">
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(1)} disabled={page === 1} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 disabled:opacity-50 dark:hover:bg-surface-700 dark:hover:text-surface-300">
              <ChevronsLeft size={16} />
            </button>
            <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 disabled:opacity-50 dark:hover:bg-surface-700 dark:hover:text-surface-300">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[2rem] text-center text-sm font-medium text-surface-700 dark:text-surface-300">{page}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 disabled:opacity-50 dark:hover:bg-surface-700 dark:hover:text-surface-300">
              <ChevronRight size={16} />
            </button>
            <button onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 disabled:opacity-50 dark:hover:bg-surface-700 dark:hover:text-surface-300">
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search...' }: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="block w-full max-w-xs rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 dark:placeholder-surface-500"
    />
  )
}

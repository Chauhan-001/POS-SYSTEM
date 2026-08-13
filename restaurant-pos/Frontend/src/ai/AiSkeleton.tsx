/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AiSkeleton — shimmer placeholder rendered while an AI request is in flight.
 * Using skeletons instead of bare spinners keeps the layout stable and shows
 * the user the section is about to fill with content.
 */


interface AiSkeletonProps {
  /** Number of shimmer bars to render (card body density). */
  rows?: number;
  /** Extra classes for height/width tuning per card. */
  className?: string;
  /** Optional label (e.g. "Scanning inventory…") under the bars. */
  label?: string;
}

export function AiSkeleton({ rows = 3, className = '', label }: AiSkeletonProps) {
  return (
    <div className={`flex flex-col gap-2.5 ${className}`} aria-busy="true" aria-label={label || 'Loading'}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-3.5 rounded-lg bg-gradient-to-r from-gray-100 via-gray-200/80 to-gray-100 bg-[length:200%_100%] animate-pulse"
          style={{ width: `${Math.max(55, 100 - i * 14)}%` }}
        />
      ))}
      {label && <p className="text-[10px] text-gray-400 font-medium mt-0.5">{label}</p>}
    </div>
  );
}

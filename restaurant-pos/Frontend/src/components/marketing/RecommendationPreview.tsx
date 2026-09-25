/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationPreview — what you see BEFORE anything is created. Clicking a
 * recommendation card no longer dumps every suggested value into the offer
 * builder; instead the owner gets a clear preview of exactly what the
 * recommendation proposes, with two safe paths:
 *
 *   - "Edit & Create"  → opens the normal editable builder, prefilled.
 *   - "Create as shown" → creates the offer exactly as previewed (draft unless
 *                         the owner checks "Go live now").
 *
 * A banner image can be attached here (optional) and travels into the offer as
 * `imageUrl`. Everything shown is server-derived recommendation data — the
 * modal never calculates economics. Branch scope defaults to ALL branches;
 * multi-branch restaurants can scope it right here.
 */

import React from 'react';
import { X, Pencil, CheckCircle2, Sparkles, CalendarDays, Users, Tag } from 'lucide-react';
import { opportunityMeta, OFFER_TYPE_LABELS, offerValueLabel, fmtNumber } from './shared';

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface RecommendationPreviewProps {
  suggestion: any;
  currencySymbol: string;
  onEdit: (suggestion: any) => void;
  onClose: () => void;
}

export default function RecommendationPreview({ suggestion, currencySymbol, onEdit, onClose }: RecommendationPreviewProps) {
  const meta = opportunityMeta(suggestion.recommendationSource);
  const isWarning = !!suggestion.isWarning;

  const scheduleBits: string[] = [];
  if (Array.isArray(suggestion.daysOfWeek) && suggestion.daysOfWeek.length > 0) {
    scheduleBits.push(suggestion.daysOfWeek.map((d: number) => DAYS[d]).join(', '));
  }
  if (suggestion.startHour != null && suggestion.endHour != null) {
    scheduleBits.push(`${suggestion.startHour}:00 – ${suggestion.endHour}:00`);
  }

  const scopeLabel =
    Array.isArray(suggestion.applicableCategories) && suggestion.applicableCategories.length > 0
      ? `${suggestion.applicableCategories.length} categor${suggestion.applicableCategories.length === 1 ? 'y' : 'ies'}`
      : 'Whole order';

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >

      <div
        className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl bg-[var(--color-bg-white)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Recommendation preview"
      >
        {/* Header */}
        <div className={`p-5 ${isWarning ? 'bg-gradient-to-br from-red-600 to-rose-500' : 'bg-gradient-to-br from-[#0b2a5b] to-[var(--brand-color)]'} text-white rounded-t-3xl`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-xl shrink-0">{meta.icon}</div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-white/70">{meta.eyebrow}</p>
                <h3 className="text-base font-black leading-tight">{suggestion.title}</h3>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer" aria-label="Close preview">
              <X className="w-4 h-4" />
            </button>
          </div>
          {isWarning && (
            <span className="inline-block mt-2 text-[9px] font-black bg-[var(--color-bg-white)] text-red-600 px-2 py-1 rounded-full uppercase tracking-wide">
              Safety check — review before activating
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Description */}
          <p className="text-xs text-gray-600 leading-relaxed">{suggestion.description}</p>

          {/* Offer chips */}
          <div className="flex flex-wrap gap-2">
            {!isWarning && (
              <span className="px-2.5 py-1.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] font-black text-[var(--brand-color)] flex items-center gap-1.5">
                <Tag className="w-3 h-3" /> {OFFER_TYPE_LABELS[suggestion.type] || suggestion.type} · {offerValueLabel(suggestion.type, suggestion.value, currencySymbol)}
              </span>
            )}
            {suggestion.minOrderValue ? (
              <span className="px-2.5 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-600">
                Min order {currencySymbol}{fmtNumber(suggestion.minOrderValue)}
              </span>
            ) : null}
            <span className="px-2.5 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-600 flex items-center gap-1.5">
              <Users className="w-3 h-3" /> {scopeLabel}
            </span>
            {suggestion.priority ? (
              <span className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold ${
                suggestion.priority === 'high' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500'
              }`}>
                {PRIORITY_LABELS[suggestion.priority] || suggestion.priority}
              </span>
            ) : null}
            {suggestion.estimatedReach ? (
              <span className="px-2.5 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-500">
                ~{fmtNumber(suggestion.estimatedReach)} reach
              </span>
            ) : null}
          </div>

          {/* Schedule */}
          {scheduleBits.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
              <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
              {scheduleBits.join(' · ')}
            </div>
          )}

          {/* Provenance */}
          {(suggestion.recommendationSource || suggestion.recommendationReason) && (
            <div className="rounded-2xl bg-purple-50 border border-purple-100 p-3.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-purple-400 mb-1">Why this recommendation</p>
              {suggestion.recommendationReason && (
                <p className="text-xs text-gray-700 leading-relaxed">“{suggestion.recommendationReason}”</p>
              )}
              {suggestion.recommendationSource && (
                <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-[var(--color-bg-white)] border border-purple-200 text-[9px] font-black text-purple-600 uppercase tracking-wide">
                  source · {String(suggestion.recommendationSource).replace(/_/g, ' ')}
                </span>
              )}
            </div>
          )}

          {/* Note about Studio */}
          <div className="rounded-2xl bg-blue-50 border border-blue-200 p-3.5">
            <p className="text-[11px] text-blue-700">
              <span className="font-bold">Next step:</span> You'll configure the promotional creative, message, branches and schedule in the step-by-step wizard.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={() => onEdit(suggestion)}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" /> Create Offer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

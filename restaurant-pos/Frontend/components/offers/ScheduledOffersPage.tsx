/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scheduled Offers — Shows all scheduled offers with countdown-to-launch
 * indicators, a calendar view of upcoming campaigns, and quick actions
 * to publish, edit, or reschedule.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Calendar,
  CalendarDays,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  Target,
  Users,
  RefreshCw,
  Send,
} from 'lucide-react';
import type { Offer } from '../../src/types';

const API_BASE = '/api/offers';

// ─── Helpers ──────────────────────────────────────────────────

function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatCountdown(days: number): { text: string; urgent: boolean } {
  if (days <= 0) return { text: 'Today!', urgent: true };
  if (days === 1) return { text: 'Tomorrow', urgent: true };
  if (days <= 3) return { text: `In ${days} days`, urgent: true };
  if (days <= 7) return { text: `In ${days} days`, urgent: false };
  if (days <= 14) return { text: `In ${days} days`, urgent: false };
  if (days <= 30) return { text: `In ${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''}`, urgent: false };
  return { text: `In ${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''}`, urgent: false };
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getScheduleSource(offer: Offer): string {
  if (offer.scheduledDate) return offer.scheduledDate;
  if (offer.startDate) return offer.startDate;
  return offer.createdAt;
}

interface ScheduledOffersPageProps {
  offers: Offer[];
  loading: boolean;
  onRefresh: () => void;
  onEdit: (offer: Offer) => void;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  currencySymbol: string;
}

export default function ScheduledOffersPage({
  offers,
  loading,
  onRefresh,
  onEdit,
  onPublish,
  onDelete,
  currencySymbol,
}: ScheduledOffersPageProps) {
  const [viewMode, setViewMode] = useState<'cards' | 'calendar'>('cards');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());

  // Filter to only scheduled + upcoming draft offers with a start/scheduled date
  const scheduled = useMemo(() => {
    return offers.filter(o => {
      if (o.status === 'scheduled') return true;
      if (o.status === 'draft' && (o.scheduledDate || o.startDate)) return true;
      return false;
    }).sort((a, b) => {
      const dateA = getScheduleSource(a);
      const dateB = getScheduleSource(b);
      return dateA.localeCompare(dateB);
    });
  }, [offers]);

  // Calendar data
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
    const days: Array<{ day: number; offers: Offer[] }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOffers = scheduled.filter(o => {
        const src = getScheduleSource(o);
        return src.startsWith(dateStr);
      });
      days.push({ day: d, offers: dayOffers });
    }

    return { firstDayOfWeek, days };
  }, [calendarMonth, calendarYear, scheduled]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const prevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  };

  const nextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-gray-900 text-sm">Scheduled Offers</h3>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
            {scheduled.length} upcoming
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <div className="bg-gray-100 rounded-xl p-0.5 flex">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                viewMode === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              <Clock className="w-3.5 h-3.5 inline-block mr-1" /> Timeline
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                viewMode === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5 inline-block mr-1" /> Calendar
            </button>
          </div>
        </div>
      </div>

      {scheduled.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <CalendarCheck className="w-10 h-10 mb-2 text-gray-300" />
          <p className="text-sm font-medium">No scheduled offers</p>
          <p className="text-xs mt-1">Schedule an offer from the Offer Builder to see it here</p>
        </div>
      ) : viewMode === 'cards' ? (
        /* ── Timeline / Card View ── */
        <div className="space-y-3">
          {scheduled.map(offer => {
            const scheduleDate = getScheduleSource(offer);
            const daysUntil = getDaysUntil(scheduleDate);
            const countdown = formatCountdown(daysUntil);

            return (
              <div
                key={offer._id}
                className={`bg-white rounded-2xl border-2 p-4 transition-all hover:shadow-md ${
                  countdown.urgent ? 'border-amber-300 bg-amber-50/20' : 'border-gray-100'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Countdown Badge */}
                  <div className={`w-16 h-16 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                    countdown.urgent
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    <span className="text-xl font-black">{daysUntil <= 0 ? '🎉' : daysUntil}</span>
                    <span className="text-[8px] font-bold uppercase tracking-wider mt-0.5">
                      {daysUntil <= 0 ? 'Launch' : daysUntil === 1 ? 'Day' : 'Days'}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-extrabold text-gray-900 text-sm">{offer.title}</span>
                      {offer.isAiGenerated && (
                        <span className="text-[8px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded uppercase">AI</span>
                      )}
                      {countdown.urgent && (
                        <span className="text-[8px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded uppercase animate-pulse">Urgent</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate max-w-lg">{offer.description}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1 text-[10px] text-indigo-600 font-bold">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(scheduleDate)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-500">
                        <Clock className="w-3 h-3" />
                        <span className={countdown.urgent ? 'text-amber-600 font-bold' : ''}>
                          {countdown.text}
                        </span>
                      </div>
                      {offer.estimatedReach && (
                        <div className="flex items-center gap-1 text-[10px] text-blue-500">
                          <Target className="w-3 h-3" />
                          <span>{offer.estimatedReach} reach</span>
                        </div>
                      )}
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 capitalize">
                        {offer.type === 'percentage' ? `${offer.value}% Off` : offer.type === 'flat' ? `₹${offer.value} Off` : offer.type}
                      </span>
                    </div>
                    {offer.targetSegmentNames && offer.targetSegmentNames.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 text-[9px] text-gray-400">
                        <Users className="w-3 h-3" />
                        <span>Targets: {offer.targetSegmentNames.slice(0, 2).join(', ')}{offer.targetSegmentNames.length > 2 ? ' + more' : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onPublish(offer._id)}
                      className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-[10px] font-bold transition-all active:scale-95 cursor-pointer"
                    >
                      <Send className="w-3 h-3" /> Publish Now
                    </button>
                    <button
                      onClick={() => onEdit(offer)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                      title="Edit"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete(offer._id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Calendar View ── */
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          {/* Calendar Nav */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={prevMonth}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h4 className="font-bold text-gray-900 text-base">
              {monthNames[calendarMonth]} {calendarYear}
            </h4>
            <button
              onClick={nextMonth}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map(d => (
              <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells before first day */}
            {Array.from({ length: calendarDays.firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] bg-gray-50/50 rounded-lg" />
            ))}

            {calendarDays.days.map(({ day, offers: dayOffers }) => {
              const isToday = day === today.getDate() && calendarMonth === today.getMonth() && calendarYear === today.getFullYear();
              const hasOffers = dayOffers.length > 0;

              return (
                <div
                  key={day}
                  className={`min-h-[80px] rounded-lg p-1.5 border transition-all ${
                    isToday
                      ? 'border-indigo-400 bg-indigo-50/30'
                      : hasOffers
                        ? 'border-amber-200 bg-amber-50/20'
                        : 'border-transparent bg-gray-50/30'
                  }`}
                >
                  <div className={`text-[11px] font-bold mb-1 ${
                    isToday ? 'text-indigo-700' : hasOffers ? 'text-amber-700' : 'text-gray-400'
                  }`}>
                    {day}
                  </div>
                  {hasOffers && (
                    <div className="space-y-0.5">
                      {dayOffers.slice(0, 2).map(o => (
                        <div
                          key={o._id}
                          className="text-[7px] font-bold text-white bg-indigo-600 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-indigo-700 transition-colors"
                          title={o.title}
                        >
                          {o.title}
                        </div>
                      ))}
                      {dayOffers.length > 2 && (
                        <div className="text-[7px] text-indigo-500 font-bold text-center">
                          +{dayOffers.length - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded border border-indigo-400 bg-indigo-50" />
              <span className="text-[9px] text-gray-500">Today</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded border border-amber-200 bg-amber-50" />
              <span className="text-[9px] text-gray-500">Has scheduled offers</span>
            </div>
          </div>

          {/* Scheduled Offers List Below Calendar */}
          {scheduled.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h5 className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-indigo-600" />
                All Scheduled Campaigns
              </h5>
              <div className="space-y-2">
                {scheduled.map(o => {
                  const scheduleDate = getScheduleSource(o);
                  const daysUntil = getDaysUntil(scheduleDate);
                  return (
                    <div key={o._id} className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${
                          daysUntil <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {daysUntil <= 0 ? '!' : daysUntil}d
                        </div>
                        <div>
                          <span className="font-extrabold text-gray-900 text-xs block">{o.title}</span>
                          <span className="text-[9px] text-gray-400">{formatDate(scheduleDate)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => onPublish(o._id)}
                        className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer"
                      >
                        <Send className="w-3 h-3" /> Publish
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {scheduled.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Scheduled</span>
            <span className="text-xl font-black text-indigo-700 mt-1 block">
              {scheduled.filter(o => o.status === 'scheduled').length}
            </span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Launching This Week</span>
            <span className="text-xl font-black text-amber-700 mt-1 block">
              {scheduled.filter(o => getDaysUntil(getScheduleSource(o)) <= 7).length}
            </span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Launching Today</span>
            <span className="text-xl font-black text-green-700 mt-1 block">
              {scheduled.filter(o => getDaysUntil(getScheduleSource(o)) <= 0).length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

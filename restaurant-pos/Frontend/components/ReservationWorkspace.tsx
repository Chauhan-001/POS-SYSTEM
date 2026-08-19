/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReservationWorkspace — Table booking calendar, reservation management,
 * and waiting list queue system.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar, Clock, Users, Phone, Plus, X, CheckCircle,
  XCircle, UserCheck, UserX, AlertCircle, Clock as Timer,
  Search, Ban, UserPlus, PartyPopper, Edit3,
} from 'lucide-react';
import type { Reservation, WaitingEntry, TableInfo } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';

interface ReservationWorkspaceProps {
  reservations: Reservation[];
  onUpdateReservations: (res: Reservation[]) => void;
  waitingList: WaitingEntry[];
  onUpdateWaitingList: (wl: WaitingEntry[]) => void;
  tables: TableInfo[];
  onCreateOrder: (type: string, tableId?: string) => void;
  showToast?: (message: string, type: 'success' | 'info' | 'warning') => void;
}

type TabMode = 'reservations' | 'waiting';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getElapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function getTodayString(): string {
  const tzoffset = new Date().getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzoffset).toISOString().slice(0, 10);
}

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function getNextDays(count: number): string[] {
  const today = new Date();
  const result: string[] = [];
  for (let i = -1; i <= count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const tzoffset = d.getTimezoneOffset() * 60000;
    result.push(new Date(d.getTime() - tzoffset).toISOString().slice(0, 10));
  }
  return result;
}

function isTableAvailable(tables: TableInfo[], guestCount: number): TableInfo | undefined {
  return tables.find(t => t.status === 'Available' && t.capacity >= guestCount);
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: any }> = {
  'Confirmed': { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: CheckCircle },
  'Seated': { bg: 'bg-green-50 border-green-200', text: 'text-green-700', icon: UserCheck },
  'Cancelled': { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: XCircle },
  'No Show': { bg: 'bg-gray-100 border-gray-200', text: 'text-gray-600', icon: Ban },
  'Waiting': { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: Timer },
};

export default function ReservationWorkspace({
  reservations, onUpdateReservations,
  waitingList, onUpdateWaitingList,
  tables, onCreateOrder, showToast,
}: ReservationWorkspaceProps) {
  const [tab, setTab] = useState<TabMode>('reservations');
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [showNewRes, setShowNewRes] = useState(false);
  const [showAddWait, setShowAddWait] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);

  // Reservation form state
  const [resForm, setResForm] = useState({
    customerName: '', customerPhone: '', guestCount: 2,
    time: '19:00', date: getTodayString(), notes: '', occasion: '',
  });

  // Waiting list form state
  const [waitForm, setWaitForm] = useState({
    customerName: '', customerPhone: '', guestCount: 2,
    notes: '', partyType: 'adult' as 'adult' | 'family' | 'business',
  });

  const dates = useMemo(() => getNextDays(7), []);

  // Filter reservations for selected date
  const dayReservations = useMemo(() =>
    reservations.filter(r => r.date === selectedDate && r.status !== 'Cancelled')
      .sort((a, b) => a.time.localeCompare(b.time)),
  [reservations, selectedDate]);

  const activeWaiting = useMemo(() =>
    waitingList.filter(w => w.status === 'Waiting')
      .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()),
  [waitingList]);

  const todayConfirmations = useMemo(() =>
    reservations.filter(r => r.date === getTodayString() && r.status === 'Confirmed'),
  [reservations]);

  // Auto-advance estimated wait times
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const waitingWithWait = useMemo(() => activeWaiting.map(w => ({
    ...w,
    waitedMinutes: getElapsedMinutes(w.joinedAt),
  })), [activeWaiting, tick]);

  const handleEditReservation = (res: Reservation) => {
    setEditingReservationId(res.id);
    setResForm({
      customerName: res.customerName,
      customerPhone: res.customerPhone,
      guestCount: res.guestCount,
      time: res.time,
      date: res.date,
      notes: res.notes || '',
      occasion: res.occasion || '',
    });
    setShowNewRes(true);
  };

  const handleSaveReservation = () => {
    if (!resForm.customerName.trim() || !resForm.customerPhone.trim()) {
      showToast?.('Customer name and phone are required', 'warning');
      return;
    }

    if (editingReservationId) {
      // Update existing reservation
      const updated = reservations.map(r =>
        r.id === editingReservationId
          ? {
              ...r,
              customerName: resForm.customerName.trim(),
              customerPhone: resForm.customerPhone.trim(),
              guestCount: resForm.guestCount,
              date: resForm.date,
              time: resForm.time,
              notes: resForm.notes.trim() || undefined,
              occasion: resForm.occasion.trim() || undefined,
            }
          : r
      );
      onUpdateReservations(updated);
      // BACKEND CALLED — push reservation edits to /api/reservations.
      if (/^[a-fA-F0-9]{24}$/.test(editingReservationId)) {
        api.updateReservation(editingReservationId, {
          customerName: resForm.customerName.trim(),
          customerPhone: resForm.customerPhone.trim(),
          guestCount: resForm.guestCount,
          date: resForm.date,
          time: resForm.time,
          ...(resForm.notes.trim() ? { notes: resForm.notes.trim() } : {}),
          ...(resForm.occasion.trim() ? { occasion: resForm.occasion.trim() } : {}),
        }).catch(err => debugWarn('ReservationWorkspace', 'updateReservation failed:', err));
      }
      showToast?.('Reservation updated successfully', 'success');
    } else {
      // Create new reservation
      const newRes: Reservation = {
        id: `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        customerName: resForm.customerName.trim(),
        customerPhone: resForm.customerPhone.trim(),
        guestCount: resForm.guestCount,
        date: resForm.date,
        time: resForm.time,
        status: 'Confirmed',
        notes: resForm.notes.trim() || undefined,
        occasion: resForm.occasion.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      const next = [newRes, ...reservations];
      onUpdateReservations(next);
      // BACKEND CALLED — create the reservation in /api/reservations. On success
      // the local temp id is swapped for the server _id so status changes line up.
      api.createReservation({
        customerName: newRes.customerName,
        customerPhone: newRes.customerPhone,
        guestCount: newRes.guestCount,
        date: newRes.date,
        time: newRes.time,
        ...(newRes.notes ? { notes: newRes.notes } : {}),
        ...(newRes.occasion ? { occasion: newRes.occasion } : {}),
        status: newRes.status,
      }).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (serverId) {
          onUpdateReservations(next.map((r) => r.id === newRes.id ? { ...r, id: serverId } : r));
        }
      }).catch(err => debugWarn('ReservationWorkspace', 'createReservation failed:', err));
      showToast?.('Reservation created successfully', 'success');
    }

    setShowNewRes(false);
    setEditingReservationId(null);
    setResForm({ customerName: '', customerPhone: '', guestCount: 2, time: '19:00', date: getTodayString(), notes: '', occasion: '' });
  };

  const handleAddWaiting = () => {
    if (!waitForm.customerName.trim() || !waitForm.customerPhone.trim()) {
      showToast?.('Customer name and phone are required', 'warning');
      return;
    }
    const newEntry: WaitingEntry = {
      id: `wait_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      customerName: waitForm.customerName.trim(),
      customerPhone: waitForm.customerPhone.trim(),
      guestCount: waitForm.guestCount,
      joinedAt: new Date().toISOString(),
      estimatedWaitMinutes: waitingWithWait.length * 10 + 10,
      status: 'Waiting',
      notes: waitForm.notes.trim() || undefined,
      partyType: waitForm.partyType,
    };
    const next = [newEntry, ...waitingList];
    onUpdateWaitingList(next);
    // BACKEND CALLED — add the guest to /api/reservations/waiting. On success
    // the local temp id is swapped for the server _id so status updates line up.
    api.createWaiting({
      customerName: newEntry.customerName,
      customerPhone: newEntry.customerPhone,
      guestCount: newEntry.guestCount,
      ...(newEntry.notes ? { notes: newEntry.notes } : {}),
      ...(newEntry.partyType ? { partyType: newEntry.partyType } : {}),
      estimatedWaitMinutes: newEntry.estimatedWaitMinutes,
      status: newEntry.status,
    }).then((created: any) => {
      const serverId = created?._id || created?.id;
      if (serverId) {
        onUpdateWaitingList(next.map((w) => w.id === newEntry.id ? { ...w, id: serverId } : w));
      }
    }).catch(err => debugWarn('ReservationWorkspace', 'createWaiting failed:', err));
    showToast?.('Added to waiting list', 'success');
    setShowAddWait(false);
    setWaitForm({ customerName: '', customerPhone: '', guestCount: 2, notes: '', partyType: 'adult' });
  };

  const handleSeatReservation = (res: Reservation) => {
    const avail = tables.find(t =>
      t.status === 'Available' && t.capacity >= res.guestCount
    );
    if (!avail) {
      // Try to seat with partial match
      const anyAvail = tables.find(t => t.status === 'Available');
      if (anyAvail) {
        showToast?.(`No table for ${res.guestCount} guests. Seating at Table ${anyAvail.number} (cap. ${anyAvail.capacity})`, 'warning');
        onUpdateReservations(reservations.map(r => r.id === res.id ? { ...r, status: 'Seated', tableId: anyAvail.id, tableNumber: anyAvail.number } : r));
        syncReservationStatus(res.id, { status: 'Seated', tableId: anyAvail.id, tableNumber: anyAvail.number });
        onCreateOrder('Dine In', anyAvail.id);
        return;
      }
      showToast?.('No available tables right now', 'warning');
      return;
    }
    onUpdateReservations(reservations.map(r => r.id === res.id ? { ...r, status: 'Seated', tableId: avail.id, tableNumber: avail.number } : r));
    syncReservationStatus(res.id, { status: 'Seated', tableId: avail.id, tableNumber: avail.number });
    onCreateOrder('Dine In', avail.id);
    showToast?.(`${res.customerName} seated at Table ${avail.number}`, 'success');
  };

  const syncReservationStatus = (id: string, updates: Record<string, unknown>) => {
    // BACKEND CALLED — sync a reservation status change (Seated/Cancelled/No Show).
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      api.updateReservation(id, updates).catch(err => debugWarn('ReservationWorkspace', 'updateReservation failed:', err));
    }
  };

  const handleSeatFromWaiting = (entry: WaitingEntry) => {
    const avail = tables.find(t =>
      t.status === 'Available' && t.capacity >= entry.guestCount
    );
    if (!avail) {
      const anyAvail = tables.find(t => t.status === 'Available');
      if (anyAvail) {
        showToast?.(`No table for ${entry.guestCount} guests. Seating at Table ${anyAvail.number}`, 'warning');
        onUpdateWaitingList(waitingList.map(w => w.id === entry.id ? { ...w, status: 'Seated' } : w));
        if (/^[a-fA-F0-9]{24}$/.test(entry.id)) {
          api.updateWaiting(entry.id, { status: 'Seated' }).catch(err => debugWarn('ReservationWorkspace', 'updateWaiting failed:', err));
        }
        onCreateOrder('Dine In', anyAvail.id);
        return;
      }
      showToast?.('No available tables', 'warning');
      return;
    }
    onUpdateWaitingList(waitingList.map(w => w.id === entry.id ? { ...w, status: 'Seated' } : w));
    if (/^[a-fA-F0-9]{24}$/.test(entry.id)) {
      api.updateWaiting(entry.id, { status: 'Seated' }).catch(err => debugWarn('ReservationWorkspace', 'updateWaiting failed:', err));
    }
    onCreateOrder('Dine In', avail.id);
    showToast?.(`${entry.customerName} seated at Table ${avail.number}`, 'success');
  };

  const handleCancelReservation = (id: string) => {
    onUpdateReservations(reservations.map(r => r.id === id ? { ...r, status: 'Cancelled' } : r));
    syncReservationStatus(id, { status: 'Cancelled' });
    showToast?.('Reservation cancelled', 'info');
  };

  const handleNoShow = (id: string) => {
    onUpdateReservations(reservations.map(r => r.id === id ? { ...r, status: 'No Show' } : r));
    syncReservationStatus(id, { status: 'No Show' });
    showToast?.('Marked as No Show', 'info');
  };

  const handleRemoveWaiting = (id: string) => {
    onUpdateWaitingList(waitingList.map(w => w.id === id ? { ...w, status: 'Cancelled' } : w));
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      api.updateWaiting(id, { status: 'Cancelled' }).catch(err => debugWarn('ReservationWorkspace', 'updateWaiting failed:', err));
    }
    showToast?.('Removed from waiting list', 'info');
  };

  const filteredReservations = searchQuery
    ? dayReservations.filter(r =>
        r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.customerPhone.includes(searchQuery)
      )
    : dayReservations;

  // Count reservations per day for the mini calendar
  const resCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    reservations.forEach(r => {
      if (r.status === 'Confirmed') {
        map[r.date] = (map[r.date] || 0) + 1;
      }
    });
    return map;
  }, [reservations]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-page)]">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">

        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-black text-gray-900">Reservations</h1>
              <p className="text-[10px] text-gray-400">Table booking & guest queue management</p>
            </div>
          </div>
          {/* Tab toggle */}
          <div className="flex bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-1 shadow-xs">
            <button onClick={() => setTab('reservations')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                tab === 'reservations' ? 'bg-rose-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Calendar className="w-3.5 h-3.5" />
              Reservations
              {todayConfirmations.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[8px] font-bold">{todayConfirmations.length}</span>}
            </button>
            <button onClick={() => setTab('waiting')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                tab === 'waiting' ? 'bg-[var(--color-amber-600-solid)] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Timer className="w-3.5 h-3.5" />
              Waiting List
              {waitingWithWait.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[8px] font-bold">{waitingWithWait.length}</span>}
            </button>
          </div>
        </div>

        {/* ===== RESERVATIONS TAB ===== */}
        {tab === 'reservations' && (
          <>
            {/* Date Calendar Bar */}
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-3 shadow-xs overflow-x-auto">
              <div className="flex items-center gap-1.5 min-w-max">
                {dates.map(date => {
                  const isToday = date === getTodayString();
                  const isSelected = date === selectedDate;
                  const count = resCountByDate[date] || 0;
                  return (
                    <button key={date} onClick={() => setSelectedDate(date)}
                      className={`flex flex-col items-center px-3.5 py-2 rounded-xl transition-all cursor-pointer min-w-[56px] ${
                        isSelected
                          ? 'bg-rose-600 text-white shadow-md scale-105'
                          : isToday
                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                            : 'text-gray-600 hover:bg-gray-50'
                      }`}>
                      <span className={`text-[8px] font-bold uppercase ${isSelected ? 'text-rose-200' : 'text-gray-400'}`}>
                        {getDayName(date)}
                      </span>
                      <span className="text-sm font-black mt-0.5">{date.slice(8, 10)}</span>
                      <span className={`text-[7px] mt-0.5 ${isSelected ? 'text-rose-200' : 'text-gray-400'}`}>
                        {formatDateDisplay(date).split(' ')[1]}
                      </span>
                      {count > 0 && (
                        <span className={`mt-1 px-1.5 py-0.5 rounded-full text-[7px] font-bold ${
                          isSelected ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search + New Reservation */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input type="text" placeholder="Search by name or phone..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--color-border-default)] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-rose-200 bg-[var(--color-bg-white)]" />
              </div>
              <button onClick={() => { setResForm(f => ({ ...f, date: selectedDate })); setShowNewRes(true); }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-bold hover:bg-rose-700 transition-all cursor-pointer shadow-xs">
                <Plus className="w-3.5 h-3.5" />
                New Reservation
              </button>
            </div>

            {/* Reservation Cards */}
            {filteredReservations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                <Calendar className="w-16 h-16 mb-3" />
                <p className="text-sm font-bold">No reservations for this date</p>
                <p className="text-[10px] mt-1">Click "New Reservation" to book a table</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredReservations.map(res => {
                  const st = STATUS_STYLES[res.status] || STATUS_STYLES['Confirmed'];
                  const StatusIcon = st.icon;
                  const avail = isTableAvailable(tables, res.guestCount);
                  return (
                    <div key={res.id}
                      className={`rounded-xl border p-4 ${st.bg} ${st.text} shadow-xs transition-all hover:shadow-md`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm font-black">{res.time}</span>
                        </div>
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 text-[8px] font-bold uppercase">
                          <StatusIcon className="w-2.5 h-2.5" />
                          {res.status}
                        </span>
                      </div>
                      <div className="space-y-1 mb-3">
                        <p className="font-bold text-gray-900 text-xs">{res.customerName}</p>
                        <div className="flex items-center gap-3 text-[10px] text-gray-500">
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{res.customerPhone}</span>
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{res.guestCount} guests</span>
                        </div>
                        {res.occasion && (
                          <span className="inline-flex items-center gap-1 text-[9px] text-rose-500 font-semibold">
                            <PartyPopper className="w-3 h-3" />{res.occasion}
                          </span>
                        )}
                        {res.notes && <p className="text-[9px] text-gray-400 italic mt-1">"{res.notes}"</p>}
                        {res.tableNumber && <p className="text-[9px] text-gray-400 mt-1">Table #{res.tableNumber}</p>}
                      </div>
                      {res.status === 'Confirmed' && (
                        <div className="flex gap-1.5 mt-2 pt-2 border-t border-white/50">
                          <button onClick={() => handleSeatReservation(res)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-[var(--color-green-500-solid)] text-white rounded-lg text-[9px] font-bold hover:bg-[var(--color-green-600-solid)] transition-all cursor-pointer"
                            title={avail ? `Seat at Table ${avail.number}` : 'Find available table'}>
                            <UserCheck className="w-3 h-3" /> Seat
                          </button>
                          <button onClick={() => handleEditReservation(res)}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-[9px] font-bold hover:bg-blue-200 transition-all cursor-pointer">
                            <Edit3 className="w-3 h-3" /> Edit
                          </button>
                          <button onClick={() => handleNoShow(res.id)}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-[9px] font-bold hover:bg-gray-300 transition-all cursor-pointer">
                            <UserX className="w-3 h-3" /> No Show
                          </button>
                          <button onClick={() => handleCancelReservation(res.id)}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-100 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-200 transition-all cursor-pointer">
                            <XCircle className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      )}
                      {(res.status === 'Seated' || res.status === 'No Show' || res.status === 'Cancelled') && (
                        <div className="mt-2 pt-2 border-t border-white/50 text-[9px] text-gray-400 text-center">
                          {res.status === 'Seated' ? 'Guest seated' : res.status === 'No Show' ? 'Did not arrive' : 'Cancelled'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ===== WAITING LIST TAB ===== */}
        {tab === 'waiting' && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Waiting</p>
                <p className="text-2xl font-black text-amber-600 mt-1">{waitingWithWait.length}</p>
              </div>
              <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Avg Wait</p>
                <p className="text-2xl font-black text-gray-900 mt-1">
                  {waitingWithWait.length > 0
                    ? `${Math.round(waitingWithWait.reduce((s, w) => s + w.waitedMinutes, 0) / waitingWithWait.length)}m`
                    : '—'}
                </p>
              </div>
              <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Available Tables</p>
                <p className="text-2xl font-black text-green-600 mt-1">{tables.filter(t => t.status === 'Available').length}</p>
              </div>
              <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Seated Today</p>
                <p className="text-2xl font-black text-blue-600 mt-1">
                  {waitingList.filter(w => w.status === 'Seated').length}
                </p>
              </div>
            </div>

            {/* Add to Waiting List */}
            <div className="flex justify-end">
              <button onClick={() => setShowAddWait(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--color-amber-600-solid)] text-white rounded-lg text-[10px] font-bold hover:bg-[var(--color-amber-700-solid)] transition-all cursor-pointer shadow-xs">
                <UserPlus className="w-3.5 h-3.5" />
                Add to Waiting List
              </button>
            </div>

            {/* Queue */}
            {waitingWithWait.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                <Timer className="w-16 h-16 mb-3" />
                <p className="text-sm font-bold">Waiting list is empty</p>
                <p className="text-[10px] mt-1">Add walk-in customers to the queue</p>
              </div>
            ) : (
              <div className="space-y-2">
                {waitingWithWait.map((entry, idx) => {
                  const isUrgent = entry.waitedMinutes > entry.estimatedWaitMinutes + 5;
                  const isLong = entry.waitedMinutes > 20;
                  return (
                    <div key={entry.id}
                      className={`bg-[var(--color-bg-white)] rounded-xl border p-4 shadow-xs transition-all hover:shadow-md ${
                        isUrgent ? 'border-amber-300 bg-amber-50/30' : 'border-[var(--color-border-default)]'
                      }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {/* Position badge */}
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${
                            idx === 0 ? 'bg-green-100 text-green-700' :
                            idx === 1 ? 'bg-blue-100 text-blue-700' :
                            idx === 2 ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            #{idx + 1}
                          </div>
                          <div>
                            <p className="font-bold text-xs text-gray-900">{entry.customerName}</p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{entry.guestCount}</span>
                              <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{entry.customerPhone}</span>
                              {entry.partyType && (
                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[8px] font-semibold">{entry.partyType}</span>
                              )}
                            </div>
                            {entry.notes && <p className="text-[9px] text-gray-400 mt-0.5">{entry.notes}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Wait time */}
                          <div className="text-right">
                            <div className={`text-sm font-black font-mono ${
                              isLong ? 'text-red-500' : isUrgent ? 'text-amber-600' : 'text-gray-700'
                            }`}>
                              {entry.waitedMinutes}m
                            </div>
                            <div className="text-[8px] text-gray-400">
                              Est. {entry.estimatedWaitMinutes}m
                            </div>
                          </div>
                          {isLong && <AlertCircle className="w-4 h-4 text-red-400 animate-pulse" />}
                        </div>
                      </div>
                      <div className="flex gap-1.5 mt-3 pt-2 border-t border-gray-100">
                        <button onClick={() => handleSeatFromWaiting(entry)}
                          className="flex items-center justify-center gap-1 px-3 py-1.5 bg-[var(--color-green-500-solid)] text-white rounded-lg text-[9px] font-bold hover:bg-[var(--color-green-600-solid)] transition-all cursor-pointer flex-1">
                          <UserCheck className="w-3 h-3" /> Seat Now
                        </button>
                        <button onClick={() => handleRemoveWaiting(entry.id)}
                          className="flex items-center justify-center gap-1 px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-200 transition-all cursor-pointer">
                          <XCircle className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ===== NEW RESERVATION / EDIT RESERVATION MODAL ===== */}
        {showNewRes && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setShowNewRes(false); setEditingReservationId(null); }}>
            <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-gray-900">{editingReservationId ? 'Edit Reservation' : 'New Reservation'}</h3>
                <button onClick={() => { setShowNewRes(false); setEditingReservationId(null); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Customer Name</label>
                  <input type="text" value={resForm.customerName} onChange={e => setResForm(f => ({ ...f, customerName: e.target.value }))}
                    placeholder="e.g. Aarav Mehta"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Phone</label>
                    <input type="text" value={resForm.customerPhone} onChange={e => setResForm(f => ({ ...f, customerPhone: e.target.value }))}
                      placeholder="10-digit phone"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Guests</label>
                    <input type="number" min={1} max={20} value={resForm.guestCount} onChange={e => setResForm(f => ({ ...f, guestCount: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Date</label>
                    <input type="date" value={resForm.date} onChange={e => setResForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200 cursor-pointer" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Time</label>
                    <input type="time" value={resForm.time} onChange={e => setResForm(f => ({ ...f, time: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Occasion (optional)</label>
                  <select value={resForm.occasion} onChange={e => setResForm(f => ({ ...f, occasion: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200 bg-[var(--color-bg-white)] cursor-pointer">
                    <option value="">None</option>
                    <option value="Birthday">Birthday</option>
                    <option value="Anniversary">Anniversary</option>
                    <option value="Business Meeting">Business Meeting</option>
                    <option value="Date Night">Date Night</option>
                    <option value="Family Dinner">Family Dinner</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Notes (optional)</label>
                  <input type="text" value={resForm.notes} onChange={e => setResForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Special requests..."
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-200" />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setShowNewRes(false); setEditingReservationId(null); }}
                  className="flex-1 px-4 py-2 border border-[var(--color-border-default)] text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer">
                  Cancel
                </button>
                <button onClick={handleSaveReservation}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-all cursor-pointer shadow-xs">
                  {editingReservationId ? 'Save Changes' : 'Create Reservation'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== ADD TO WAITING LIST MODAL ===== */}
        {showAddWait && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAddWait(false)}>
            <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-gray-900">Add to Waiting List</h3>
                <button onClick={() => setShowAddWait(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Customer Name</label>
                  <input type="text" value={waitForm.customerName} onChange={e => setWaitForm(f => ({ ...f, customerName: e.target.value }))}
                    placeholder="e.g. Arjun Nair"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-200" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Phone</label>
                    <input type="text" value={waitForm.customerPhone} onChange={e => setWaitForm(f => ({ ...f, customerPhone: e.target.value }))}
                      placeholder="10-digit phone"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-200" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Guests</label>
                    <input type="number" min={1} max={20} value={waitForm.guestCount} onChange={e => setWaitForm(f => ({ ...f, guestCount: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-200" />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Party Type</label>
                  <select value={waitForm.partyType} onChange={e => setWaitForm(f => ({ ...f, partyType: e.target.value as any }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-200 bg-[var(--color-bg-white)] cursor-pointer">
                    <option value="adult">Adults</option>
                    <option value="family">Family</option>
                    <option value="business">Business</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-400 tracking-wider block mb-1">Notes (optional)</label>
                  <input type="text" value={waitForm.notes} onChange={e => setWaitForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="e.g. Needs high chair"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-200" />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowAddWait(false)}
                  className="flex-1 px-4 py-2 border border-[var(--color-border-default)] text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer">
                  Cancel
                </button>
                <button onClick={handleAddWaiting}
                  className="flex-1 px-4 py-2 bg-[var(--color-amber-600-solid)] text-white rounded-lg text-xs font-bold hover:bg-[var(--color-amber-700-solid)] transition-all cursor-pointer shadow-xs">
                  Add to Queue
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-[9px] text-gray-400 text-center py-2 border-t border-[var(--color-border-default)]">
          Enable/disable reservations in Settings → Modules & Features
        </div>
      </div>
    </div>
  );
}

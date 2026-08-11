/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Position + PIN switch-user screen.
 *
 * Shown after the cashier presses Exit (End Shift). Instead of a full logout,
 * the terminal stays logged in and the next user picks their position
 * (Owner / Manager / Cashier) and enters their 4-digit PIN. The PIN is
 * verified LOCALLY against the cached employee list (pos_employees), so the
 * screen works fully offline. A full logout lives in Settings → Logout.
 */

import React, { useMemo, useState } from 'react';
import { X, Crown, Briefcase, ShoppingCart, Delete, ShieldCheck, AlertTriangle, UserRound } from 'lucide-react';
import { normalizeRole, type Employee } from '../src/types';

interface PinLoginScreenProps {
  /** Local employee list (with pins) to verify against */
  employees: Employee[];
  /** Currently signed-in employee (shown as context) */
  currentEmployee?: Employee | null;
  onLoginSuccess: (employee: Employee) => void;
  /** Cancel back to the POS without switching */
  onCancel: () => void;
}

const POSITIONS: Array<{ role: Employee['role']; label: string; icon: any; color: string }> = [
  { role: 'Owner', label: 'Owner', icon: Crown, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { role: 'Manager', label: 'Manager', icon: Briefcase, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { role: 'Cashier', label: 'Cashier', icon: ShoppingCart, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
];

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function PinLoginScreen({ employees, currentEmployee, onLoginSuccess, onCancel }: PinLoginScreenProps) {
  const [position, setPosition] = useState<Employee['role'] | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // Only employees that actually have a 4-digit PIN set (in Staff) can sign in
  // here — employees without a PIN are listed below with a hint instead.
  // Roles are normalized before comparing so backend-synced lowercase roles
  // ('owner') still match the title-case position chips.
  const employeesForPosition = useMemo(
    () => (position ? employees.filter((e) => normalizeRole(e.role) === position && e.status === 'Active' && /^\d{4}$/.test(e.pin || '')) : []),
    [employees, position]
  );
  const pinlessForPosition = useMemo(
    () => (position ? employees.filter((e) => normalizeRole(e.role) === position && e.status === 'Active' && !/^\d{4}$/.test(e.pin || '')) : []),
    [employees, position]
  );

  const handleKey = (key: string) => {
    setError('');
    if (key === 'clear') { setPin(''); return; }
    if (key === 'back') { setPin((p) => p.slice(0, -1)); return; }
    if (!position) { setError('Select a position first.'); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      verify(next);
    }
  };

  const verify = (enteredPin: string) => {
    if (!position) return;
    // If two staff share the same PIN, the first match wins — POS pins are
    // expected to be unique per restaurant.
    const matches = employeesForPosition.filter((e) => e.pin === enteredPin);
    const match = matches[0] || null;
    if (match) {
      onLoginSuccess(match);
    } else {
      setError(`Incorrect PIN for ${position}. Try again.`);
      setPin('');
    }
  };

  const selectPosition = (role: Employee['role']) => {
    setPosition(role);
    setPin('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[90] bg-[#191b23]/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-[#e1e2ed] flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="bg-[#191b23] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-black tracking-wide">END SHIFT — SWITCH USER</h2>
              <p className="text-[10px] text-gray-400">Select position &amp; enter PIN to continue</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-white transition-colors cursor-pointer" title="Cancel">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Current user context */}
          {currentEmployee && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-[11px] text-gray-600">
              <UserRound className="w-4 h-4 text-gray-400" />
              <span>
                Ending shift of <strong className="text-gray-900">{currentEmployee.name}</strong>
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[9px] font-bold">{currentEmployee.role}</span>
              </span>
            </div>
          )}

          {/* Position selector */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Select Position</p>
            <div className="grid grid-cols-3 gap-2">
              {POSITIONS.map(({ role, label, icon: Icon, color }) => {
                const count = employees.filter((e) => normalizeRole(e.role) === role && e.status === 'Active').length;
                const selected = position === role;
                return (
                  <button
                    key={role}
                    onClick={() => selectPosition(role)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all cursor-pointer ${
                      selected
                        ? 'border-[var(--brand-color)] bg-blue-50 shadow-md'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`p-2 rounded-lg border ${color}`}>
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className={`text-[11px] font-bold ${selected ? 'text-[var(--brand-color)]' : 'text-gray-700'}`}>{label}</span>
                    <span className="text-[9px] text-gray-400">{count} active</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Available employees for the selected position */}
          {position && (
            <div className="flex flex-wrap gap-1.5">
              {employeesForPosition.length > 0 ? (
                employeesForPosition.map((e) => (
                  <span key={e.id} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                    {e.name}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-amber-600 font-semibold">
                  {pinlessForPosition.length > 0
                    ? `Set a 4-digit PIN for ${pinlessForPosition.map((e) => e.name).join(', ')} in Staff to enable PIN login.`
                    : `No active ${position} employees. Add one in Staff first.`}
                </span>
              )}
            </div>
          )}

          {/* PIN display */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Enter 4-Digit PIN</p>
            <div className="flex items-center justify-center gap-3 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-11 h-12 rounded-xl border-2 flex items-center justify-center transition-all ${
                    pin.length > i ? 'border-[var(--brand-color)] bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full bg-[var(--brand-color)]" />
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              {error}
            </div>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {KEYPAD.map((key) => (
              <button
                key={key}
                onClick={() => handleKey(key)}
                className={`h-12 rounded-xl text-lg font-bold transition-all cursor-pointer select-none ${
                  key === 'clear'
                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px]'
                    : key === 'back'
                      ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      : 'bg-[#f3f3fe] hover:bg-[#e4e4f5] text-gray-900'
                }`}
              >
                {key === 'clear' ? 'CLR' : key === 'back' ? <Delete className="w-5 h-5 mx-auto" /> : key}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 font-bold text-xs hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Back to POS
            </button>
            <button
              onClick={() => verify(pin)}
              disabled={!position || pin.length !== 4}
              className="flex-1 py-2.5 rounded-lg bg-[var(--brand-color)] hover:bg-[#003ea8] disabled:opacity-50 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

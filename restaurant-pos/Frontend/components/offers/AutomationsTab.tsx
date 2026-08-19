/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AutomationsTab — predefined automation recipes (Phase 19). These are NOT a
 * workflow engine: each card is a simple ON/OFF recipe that the backend turns
 * into a real campaign for the matching segment, at most once per day.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Cake, Heart, Gem, Zap, Loader2, CheckCircle } from 'lucide-react';
import { fetchAutomations, updateAutomation } from '../../src/api/client';

interface Automation {
  id: string;
  type: 'birthday' | 'win_back' | 'vip';
  name: string;
  description: string;
  enabled: boolean;
  channel: string;
  message: string;
  offerTemplate: { type: string; value: number; title: string; minOrderValue?: number | null };
  lastRunAt?: string | null;
}

const TYPE_META: Record<string, { icon: React.ElementType; color: string; badge: string }> = {
  birthday: { icon: Cake, color: 'bg-pink-50 text-pink-600', badge: 'Customers with a birthday tomorrow' },
  win_back: { icon: Heart, color: 'bg-red-50 text-red-500', badge: 'No visit in 30+ days' },
  vip: { icon: Gem, color: 'bg-purple-50 text-purple-600', badge: 'Top customers · 20+ visits' },
};

export default function AutomationsTab() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAutomations();
      setAutomations(res || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const patch = async (id: string, p: Partial<Automation>) => {
    setBusyId(id);
    try {
      const res = await updateAutomation(id, p);
      if (res?.data) {
        setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...res.data } : a)));
      }
    } catch { /* silent */ }
    setBusyId(null);
  };

  const toggle = (a: Automation) => {
    patch(a.id, { enabled: !a.enabled });
    showToast(a.enabled ? `${a.name} turned OFF` : `${a.name} turned ON — runs daily for matching customers`);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500" />
        <h3 className="font-bold text-gray-900 text-sm">Automations</h3>
        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          Runs automatically, once per day
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {automations.map((a) => {
          const meta = TYPE_META[a.type] || { icon: Zap, color: 'bg-gray-100 text-gray-600', badge: '' };
          const Icon = meta.icon;
          return (
            <div
              key={a.id}
              className={`bg-[var(--color-bg-white)] rounded-2xl border-2 p-5 flex flex-col gap-3 transition-all ${
                a.enabled ? 'border-green-200 shadow-md' : 'border-[var(--color-border-default)]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                {/* Toggle */}
                <button
                  onClick={() => toggle(a)}
                  disabled={busyId === a.id}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-60 ${a.enabled ? 'bg-[var(--color-green-500-solid)]' : 'bg-gray-300'}`}
                  title={a.enabled ? 'Turn off' : 'Turn on'}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-[var(--color-bg-white)] rounded-full shadow transition-all ${a.enabled ? 'left-[22px]' : 'left-0.5'}`}
                  />
                </button>
              </div>

              <div>
                <h4 className="font-extrabold text-gray-900 text-sm">{a.name}</h4>
                <p className="text-[10px] text-gray-400 mt-0.5">{a.description}</p>
                <span className="inline-block mt-1.5 text-[9px] font-black text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {meta.badge}
                </span>
              </div>

              {/* Offer template */}
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Offer</p>
                <p className="text-sm font-black text-[var(--brand-color)]">
                  {a.offerTemplate?.title || a.name}{' '}
                  <span className="text-gray-700">
                    · {a.offerTemplate?.type === 'percentage' ? `${a.offerTemplate?.value}% OFF` : a.offerTemplate?.type === 'flat' ? `Rs.${a.offerTemplate?.value} OFF` : a.offerTemplate?.value}
                  </span>
                </p>
              </div>

              {/* Channel */}
              <div>
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Channel</label>
                <select
                  value={a.channel}
                  onChange={(e) => patch(a.id, { channel: e.target.value })}
                  disabled={busyId === a.id}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[11px] font-bold text-gray-700 bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="app_notification">App Push</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>

              {a.lastRunAt && (
                <p className="text-[9px] text-gray-400">
                  Last run: {new Date(a.lastRunAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </p>
              )}

              <p className={`text-[10px] font-bold ${a.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                {a.enabled ? '● Running daily' : '○ Off'}
              </p>
            </div>
          );
        })}
      </div>

      {automations.length === 0 && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-10 text-center text-xs text-gray-400">
          No automation recipes yet.
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#1e293b] text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border border-slate-700/60 z-50">
          <div className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center">
            <CheckCircle className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight">{toast}</span>
        </div>
      )}
    </div>
  );
}

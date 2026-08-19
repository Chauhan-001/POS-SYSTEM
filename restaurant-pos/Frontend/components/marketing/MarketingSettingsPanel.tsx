/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketingSettingsPanel — secondary, context-free access to supporting
 * systems that were previously primary tabs:
 *   Automations  — recipe-style birthday / win-back / VIP automations (reused)
 *   Segments     — the auto-segment engine viewer/refresher (reused)
 *   Loyalty & Rewards — points rate, visit milestones, reward catalog
 */

import React, { useState, useEffect } from 'react';
import { Zap, Users, Ticket, Plus, Trash2, Info, HelpCircle, X, Save } from 'lucide-react';
import type { LoyaltyReward, SystemSettings, Product, VisitMilestone } from '../../src/types';
import AutomationsTab from '../offers/AutomationsTab';
import CustomerSegmentsPage from '../offers/CustomerSegmentsPage';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';

interface MarketingSettingsPanelProps {
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
}

type SettingsTab = 'automations' | 'segments' | 'loyalty';

export default function MarketingSettingsPanel({ rewards, onUpdateRewards, currencySymbol, settings, onUpdateSettings, products = [] }: MarketingSettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('automations');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'automations', label: 'Automations', icon: Zap },
    { id: 'segments', label: 'Segments', icon: Users },
    { id: 'loyalty', label: 'Loyalty & Rewards', icon: Ticket },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Marketing settings</p>
        <h3 className="text-sm font-extrabold text-gray-900">Supporting systems</h3>
      </div>

      <div className="flex gap-2 border-b border-gray-100 pb-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${tab === t.id ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-gray-200 text-gray-500 hover:text-[var(--brand-color)]'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'automations' && <AutomationsTab />}
      {tab === 'segments' && <CustomerSegmentsPage />}
      {tab === 'loyalty' && (
        <LoyaltyPanel
          rewards={rewards} onUpdateRewards={onUpdateRewards} currencySymbol={currencySymbol}
          settings={settings} onUpdateSettings={onUpdateSettings} products={products} notify={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#1e293b] text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border border-slate-700/60 z-50">
          <span className="text-xs font-bold tracking-tight">{toast}</span>
        </div>
      )}
    </div>
  );
}

// ─── Loyalty & Rewards ────────────────────────────────────────────

function LoyaltyPanel({ rewards, onUpdateRewards, currencySymbol, settings, onUpdateSettings, products, notify }: {
  rewards: LoyaltyReward[]; onUpdateRewards: (u: LoyaltyReward[]) => void; currencySymbol: string;
  settings?: SystemSettings; onUpdateSettings?: (u: SystemSettings) => void; products: Product[]; notify: (m: string) => void;
}) {
  const [ptsPerUnit, setPtsPerUnit] = useState<number>(settings?.loyaltyPointsPerDollar ?? 1);
  const [milestones, setMilestones] = useState<VisitMilestone[]>(settings?.visitMilestones || []);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneVisits, setMilestoneVisits] = useState(5);
  const [milestoneProductId, setMilestoneProductId] = useState(products[0]?.id || '');

  const [rewardForm, setRewardForm] = useState<null | { editingId: string | null; title: string; pointsRequired: number; type: 'percentage' | 'flat' | 'item'; value: number; minBillAmount: number; isLargeReward: boolean; rewardItemId: string }>(null);

  // Load the server-authoritative loyalty rate (LoyaltySettings.pointsPerCurrency
  // — the ONLY value the awarding engine reads). The SystemSettings mirror
  // (loyaltyPointsPerDollar) is just for POS-local display; saving here must
  // also write through to /loyalty/settings or the marketing rate changes nothing.
  useEffect(() => {
    let cancelled = false;
    api.fetchLoyaltySettings().then((s: any) => {
      if (cancelled) return;
      const rate = s?.pointsPerCurrency;
      if (typeof rate === 'number' && !Number.isNaN(rate)) {
        setPtsPerUnit(rate);
        if (onUpdateSettings && settings) {
          onUpdateSettings({ ...settings, loyaltyPointsPerDollar: rate });
        }
      }
    }).catch((err) => debugWarn('Loyalty', 'fetchLoyaltySettings failed:', err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePointsRate = () => {
    const rate = Number(ptsPerUnit);
    if (!Number.isFinite(rate) || rate < 0) { notify('Enter a valid points rate.'); return; }
    // Authoritative write — the loyalty engine reads THIS store. When offline,
    // writeOfflineAware resolves with null after queueing, so a null result
    // means the change will replay on reconnect (not a failure).
    api.updateLoyaltySettings({ pointsPerCurrency: rate })
      .then((s: any) => {
        if (onUpdateSettings && settings) {
          onUpdateSettings({ ...settings, loyaltyPointsPerDollar: Number(s?.pointsPerCurrency ?? rate) });
        }
        notify(s ? 'Points rate updated.' : 'Offline — rate will sync when back online.');
      })
      .catch((err) => {
        debugWarn('Loyalty', 'updateLoyaltySettings failed:', err);
        notify('Offline — rate will sync when back online.');
        if (onUpdateSettings && settings) {
          onUpdateSettings({ ...settings, loyaltyPointsPerDollar: rate });
        }
      });
  };

  const addMilestone = () => {
    const product = products.find((p) => p.id === milestoneProductId);
    if (!product) { notify('Pick a menu item for this milestone.'); return; }
    if (milestones.some((m) => m.visits === milestoneVisits)) { notify(`Visit #${milestoneVisits} is already set.`); return; }
    const next = [...milestones, { id: `vm_${Date.now()}`, visits: milestoneVisits, rewardItemId: product.id, rewardItemName: product.name }].sort((a, b) => a.visits - b.visits);
    setMilestones(next);
    if (onUpdateSettings && settings) onUpdateSettings({ ...settings, visitMilestones: next });
    setShowMilestoneForm(false);
    notify(`Visit #${milestoneVisits} reward saved.`);
  };

  const removeMilestone = (id: string) => {
    const next = milestones.filter((m) => m.id !== id);
    setMilestones(next);
    if (onUpdateSettings && settings) onUpdateSettings({ ...settings, visitMilestones: next });
  };

  const submitReward = async () => {
    if (!rewardForm) return;
    const f = rewardForm;
    if (!f.title.trim() || f.pointsRequired <= 0 || f.value <= 0) { notify('Fill in title, points and value.'); return; }
    const matched = f.type === 'item' ? products.find((p) => p.id === f.rewardItemId) : undefined;
    const payload: any = {
      title: f.title.trim(), pointsRequired: f.pointsRequired, type: f.type, value: f.value,
      minBillAmount: f.minBillAmount, isLargeReward: f.isLargeReward,
      ...(matched ? { rewardItemId: matched.id, rewardItemName: matched.name } : {}),
    };
    if (f.editingId) {
      onUpdateRewards(rewards.map((r) => (r.id === f.editingId ? { ...r, ...payload } : r)));
      if (/^[a-fA-F0-9]{24}$/.test(f.editingId)) {
        api.updateReward(f.editingId, payload).catch((err) => debugWarn('Loyalty', 'updateReward failed:', err));
      }
      notify('Reward tier updated.');
    } else {
      const temp: LoyaltyReward = { id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`, ...payload };
      onUpdateRewards([...rewards, temp]);
      api.createReward(payload).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (serverId) onUpdateRewards(([...rewards, temp]).map((r) => (r.id === temp.id ? { ...r, id: serverId } : r)));
      }).catch((err) => debugWarn('Loyalty', 'createReward failed:', err));
      notify('Reward tier registered.');
    }
    setRewardForm(null);
  };

  return (
    <div className="space-y-6">
      {/* Points rate */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">Points accumulation</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-gray-700">Earn</span>
          <input type="number" step="0.001" min="0" value={ptsPerUnit} onChange={(e) => setPtsPerUnit(Number(e.target.value))}
            className="w-24 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-sm font-black text-[var(--brand-color)] text-center focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <span className="text-xs font-bold text-gray-700">point(s) per {currencySymbol}1.00 spent</span>
          <button onClick={savePointsRate} className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer hover:bg-[var(--color-primary-hover)] transition-all ml-auto">
            <Save className="w-3.5 h-3.5" /> Save rate
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1"><Info className="w-3 h-3" /> A customer spending {currencySymbol}1,000 earns {Math.round(1000 * ptsPerUnit)} points at this rate.</p>
      </div>

      {/* Visit milestones */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Visit milestone rewards</p>
          <button onClick={() => { setShowMilestoneForm(!showMilestoneForm); setMilestoneProductId(products[0]?.id || ''); }}
            className="flex items-center gap-1 text-xs font-black text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add milestone
          </button>
        </div>

        {showMilestoneForm && (
          <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-4 space-y-3 mb-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Visit #</label>
                <input type="number" min="1" value={milestoneVisits} onChange={(e) => setMilestoneVisits(Number(e.target.value))}
                  className="w-24 px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-sm font-bold" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Free dish</label>
                <select value={milestoneProductId} onChange={(e) => setMilestoneProductId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-sm font-bold bg-[var(--color-bg-white)]">
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({currencySymbol}{p.price.toFixed(2)})</option>)}
                </select>
              </div>
              <button onClick={addMilestone} className="bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer">Save</button>
            </div>
          </div>
        )}

        {milestones.length === 0 ? (
          <p className="text-xs text-gray-400 flex items-center gap-1.5"><HelpCircle className="w-4 h-4" /> No milestones yet — reward customers on their 2nd, 5th or 100th visit.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {milestones.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 bg-indigo-50 rounded-full flex items-center justify-center font-mono text-[10px] font-black text-indigo-700">#{m.visits}</span>
                  <span className="text-xs font-extrabold text-gray-800">{m.rewardItemName}</span>
                </div>
                <button onClick={() => removeMilestone(m.id)} className="p-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reward catalog */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Reward catalog</p>
          <button onClick={() => setRewardForm({ editingId: null, title: '', pointsRequired: 30, type: 'flat', value: 5, minBillAmount: 10, isLargeReward: false, rewardItemId: products[0]?.id || '' })}
            className="flex items-center gap-1 text-xs font-black text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add reward
          </button>
        </div>

        {rewards.length === 0 ? (
          <p className="text-xs text-gray-400">No reward tiers yet. Add one — customers redeem it with loyalty points.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rewards.map((r) => (
              <div key={r.id} className="border-2 border-dashed border-[var(--color-border-default)] rounded-2xl p-4 hover:border-[var(--brand-color)] transition-all relative">
                <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 bg-[var(--color-surface-muted)] rounded-full border-r-2 border-dashed border-[var(--color-border-default)]" />
                <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 bg-[var(--color-surface-muted)] rounded-full border-l-2 border-dashed border-[var(--color-border-default)]" />
                <span className="font-extrabold text-[10px] bg-blue-50 text-[var(--brand-color)] px-2.5 py-0.5 rounded-full font-mono">{r.pointsRequired} pts</span>
                <h4 className="font-extrabold text-xs text-gray-900 mt-2">{r.title}</h4>
                <p className="text-[10px] text-gray-400 mt-0.5">Min spend {currencySymbol}{r.minBillAmount.toFixed(2)}</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                  <strong className="text-xs font-black text-[var(--brand-color)] font-mono uppercase">
                    {r.type === 'percentage' ? `${r.value}% OFF` : r.type === 'item' ? 'FREE' : `-${currencySymbol}${r.value.toFixed(2)}`}
                  </strong>
                  <div className="flex gap-1">
                    <button onClick={() => setRewardForm({ editingId: r.id, title: r.title, pointsRequired: r.pointsRequired, type: r.type, value: r.value, minBillAmount: r.minBillAmount, isLargeReward: r.isLargeReward, rewardItemId: r.rewardItemId || '' })}
                      className="p-1 text-gray-300 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded cursor-pointer">✏️</button>
                    <button onClick={() => { onUpdateRewards(rewards.filter((x) => x.id !== r.id)); if (/^[a-fA-F0-9]{24}$/.test(r.id)) api.deleteReward(r.id).catch(() => undefined); }}
                      className="p-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer">🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reward form modal */}
      {rewardForm && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-black text-gray-900 text-sm">{rewardForm.editingId ? 'Update reward tier' : 'New reward tier'}</h4>
              <button onClick={() => setRewardForm(null)} className="text-gray-400 hover:text-gray-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={rewardForm.title} onChange={(e) => setRewardForm({ ...rewardForm, title: e.target.value })} placeholder="Reward title (e.g. Free Garlic Bread)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Points</label>
                  <input type="number" value={rewardForm.pointsRequired} onChange={(e) => setRewardForm({ ...rewardForm, pointsRequired: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Type</label>
                  <select value={rewardForm.type} onChange={(e) => setRewardForm({ ...rewardForm, type: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold bg-[var(--color-bg-white)]">
                    <option value="flat">Flat {currencySymbol} off</option>
                    <option value="percentage">Percentage off</option>
                    <option value="item">Free item</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Value</label>
                  <input type="number" value={rewardForm.value} onChange={(e) => setRewardForm({ ...rewardForm, value: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Min bill ({currencySymbol})</label>
                  <input type="number" value={rewardForm.minBillAmount} onChange={(e) => setRewardForm({ ...rewardForm, minBillAmount: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold" />
                </div>
              </div>
              {rewardForm.type === 'item' && (
                <select value={rewardForm.rewardItemId} onChange={(e) => setRewardForm({ ...rewardForm, rewardItemId: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold bg-[var(--color-bg-white)]">
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rewardForm.isLargeReward} onChange={(e) => setRewardForm({ ...rewardForm, isLargeReward: e.target.checked })} className="w-4 h-4 rounded cursor-pointer" />
                <span className="text-xs font-extrabold text-gray-800">OTP security lock (verify customer phone on redemption)</span>
              </label>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setRewardForm(null)} className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer">Cancel</button>
                <button onClick={submitReward} className="flex-1 py-2.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm">{rewardForm.editingId ? 'Save changes' : 'Add reward'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

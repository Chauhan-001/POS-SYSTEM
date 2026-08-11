/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotePage — "tell customers about my offer". Wraps the existing campaign
 * backend (/api/campaigns): offer selection, friendly audience, channel,
 * AI-generated message, preview, then send-now or schedule with confirmation.
 * Delivery always happens in the background (queued), never silently.
 */

import React, { useMemo, useState } from 'react';
import { Megaphone, Wand2, Loader2, CheckCircle, Send, CalendarClock, Users, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import { EmptyState, fmtNumber, AUDIENCE_OPTIONS, OFFER_TYPE_LABELS, offerValueLabel } from './shared';
import { estimateAudience, resolveAudience } from './useMarketingData';

interface PromotePageProps {
  offers: any[];
  segments: any[];
  campaigns: any[];
  currencySymbol: string;
  initialOfferId: string | null;
  onClearOffer: () => void;
  onRefreshed: () => void;
  notify: (msg: string) => void;
}

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { id: 'sms', label: 'SMS', icon: '📱' },
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'app_notification', label: 'Push notification', icon: '🔔' },
  { id: 'webhook', label: 'Webhook', icon: '🔗' },
];

export default function PromotePage({ offers, segments, campaigns, currencySymbol, initialOfferId, onClearOffer, onRefreshed, notify }: PromotePageProps) {
  const [offerId, setOfferId] = useState<string | null>(initialOfferId);
  const [audienceChoice, setAudienceChoice] = useState('everyone');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [channel, setChannel] = useState('whatsapp');
  const [message, setMessage] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);
  const [error, setError] = useState('');

  const selected = offers.find((o) => o._id === offerId) || null;

  const audienceSize = useMemo(
    () => estimateAudience(segments, audienceChoice, undefined, customIds),
    [segments, audienceChoice, customIds],
  );

  const selectOffer = (id: string) => {
    setOfferId(id);
    onClearOffer();
    const o = offers.find((x) => x._id === id);
    if (o) {
      const val = offerValueLabel(o.type, o.value, currencySymbol);
      setMessage(`🎉 ${o.title}!\n\nGet ${val}${o.minOrderValue ? ` on orders above ${currencySymbol}${fmtNumber(o.minOrderValue)}` : ''}.${o.couponCode ? `\n\nUse code ${o.couponCode}` : ''}\n\nDon't miss out!`);
    }
  };

  const generateMessage = async () => {
    if (!selected) return;
    setAiBusy(true);
    setError('');
    try {
      const res = await api.generateOfferCopy({
        type: selected.type, value: selected.value,
        discountValue: offerValueLabel(selected.type, selected.value, currencySymbol),
        applicableCategories: selected.applicableCategories || [],
        targetAudience: AUDIENCE_OPTIONS.find((a) => a.id === audienceChoice)?.label,
        reason: selected.recommendationReason,
        minOrderValue: selected.minOrderValue,
        durationDays: selected.endDate ? Math.max(1, Math.round((new Date(selected.endDate).getTime() - Date.now()) / 86400000)) : 7,
        language: 'en',
      });
      const data = res?.data || res;
      if (data?.whatsapp || data?.sms) setMessage(data.whatsapp || data.sms);
    } catch (err) {
      debugWarn('Promote', 'copy failed:', err);
      setError('AI copy is unavailable right now — edit the message manually and send.');
    } finally {
      setAiBusy(false);
    }
  };

  const doSend = async () => {
    if (!selected || !message.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { segmentIds } = resolveAudience(segments, audienceChoice, undefined, customIds);
      const campaign = await api.createCampaign({
        name: `${selected.title} — ${CHANNELS.find((c) => c.id === channel)?.label}`,
        description: '',
        offerId: selected._id,
        audience: { segmentIds, customerPhones: [] },
        template: { channel, message: message.trim() },
        schedule: scheduleMode === 'scheduled' ? { mode: 'scheduled', scheduledAt: new Date(scheduledAt).toISOString() } : { mode: 'immediate' },
      });
      const id = campaign?.data?.id || campaign?.data?._id || campaign?.id || campaign?._id;
      if (!id) { setError('Campaign could not be created. Check your connection.'); return; }
      if (scheduleMode === 'scheduled') {
        notify('Promotion scheduled. It will be sent automatically at the set time.');
      } else {
        const sent = await api.sendCampaign(id);
        if (sent?.data) notify('Promotion queued for delivery (background).');
        else notify('Promotion saved as a draft — connect a channel in Settings → Integrations to send.');
      }
      setConfirm(null);
      setMessage('');
      setOfferId(null);
      onClearOffer();
      onRefreshed();
    } catch (err) {
      debugWarn('Promote', 'send failed:', err);
      setError('We couldn\u2019t send this promotion. Check the message and try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeCampaign = async (c: any) => {
    await api.deleteCampaign(c.id || c._id);
    notify('Campaign deleted.');
    onRefreshed();
  };

  const STATUS_STYLES: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', scheduled: 'bg-amber-50 text-amber-700',
    sending: 'bg-blue-50 text-blue-700', sent: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-600', cancelled: 'bg-gray-100 text-gray-500', partial: 'bg-orange-50 text-orange-700',
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Promote</p>
        <h3 className="text-sm font-extrabold text-gray-900">Tell customers about your offer</h3>
        <p className="text-[11px] text-gray-400 mt-1">Pick an offer, choose who gets it, write a message, and send.</p>
      </div>

      {/* STEP 1 — Offer */}
      <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">1 · Select an offer</p>
        {offers.filter((o) => o.status === 'active').length === 0 ? (
          <p className="text-xs text-gray-400">No live offers to promote yet. Create one on the Create tab first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {offers.filter((o) => o.status === 'active').map((o) => (
              <button
                key={o._id}
                onClick={() => selectOffer(o._id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer text-left ${
                  offerId === o._id ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)] shadow-sm' : 'bg-white border-gray-200 text-gray-700 hover:border-[var(--brand-color)]'
                }`}
              >
                {o.title}
                <span className={`block text-[9px] font-semibold mt-0.5 ${offerId === o._id ? 'text-blue-100' : 'text-gray-400'}`}>
                  {offerValueLabel(o.type, o.value, currencySymbol)}{o.couponCode ? ` · ${o.couponCode}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          {/* STEP 2 — Audience */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">2 · Choose audience</p>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.filter((a) => a.id !== 'tier').map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAudienceChoice(a.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${audienceChoice === a.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-400'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {audienceChoice === 'custom' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {segments.map((s: any) => {
                  const on = customIds.includes(s._id);
                  return (
                    <button key={s._id} onClick={() => setCustomIds(on ? customIds.filter((x) => x !== s._id) : [...customIds, s._id])}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600'}`}>
                      {s.name} · {s.customerCount}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <Users className="w-4 h-4 text-[var(--brand-color)]" />
              <span className="text-xs font-bold text-gray-700">{audienceSize ? `${fmtNumber(audienceSize)} customers` : 'All customers'}</span>
            </div>
          </div>

          {/* STEP 3 — Channel */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">3 · Channel</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <button key={c.id} onClick={() => setChannel(c.id)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${channel === c.id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:border-purple-400'}`}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* STEP 4 — Message */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">4 · Message</p>
              <button onClick={generateMessage} disabled={aiBusy} className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 transition-colors cursor-pointer disabled:opacity-60">
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} {aiBusy ? 'Writing…' : 'Regenerate'}
              </button>
            </div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder="What should customers receive?"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none" />
            <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Preview</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{message || 'Your message will appear here…'}</p>
            </div>
          </div>

          {/* STEP 5 — Schedule + send */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">5 · When</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(['now', 'scheduled'] as const).map((m) => (
                  <button key={m} onClick={() => setScheduleMode(m)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer ${scheduleMode === m ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {m === 'now' ? 'Send now' : 'Schedule'}
                  </button>
                ))}
              </div>
              {scheduleMode === 'scheduled' && (
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              )}
              <button
                onClick={() => setConfirm({ message: message.trim(), audienceCount: audienceSize })}
                disabled={!message.trim() || saving}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50 ml-auto"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Promotion
              </button>
            </div>
          </div>
        </>
      )}

      {/* Campaign history */}
      <div>
        <h4 className="text-xs font-extrabold text-gray-700 mb-3">Recent promotions</h4>
        {campaigns.length === 0 ? (
          <EmptyState icon="📣" title="Nothing sent yet" subtitle="Promotions you send will appear here with their delivery status." />
        ) : (
          <div className="bg-white rounded-2xl border border-[#e1e2ed] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-black uppercase text-[9px] tracking-wider">
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 hidden md:table-cell">Audience</th>
                  <th className="px-4 py-3 hidden lg:table-cell">Sent / Failed</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaigns.map((c) => (
                  <tr key={c.id || c._id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <p className="font-extrabold text-gray-900">{c.name}</p>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5 capitalize">
                        <MessageSquare className="w-3 h-3" /> {c.template?.channel || '—'}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell font-bold text-gray-700">{c.stats?.audienceCount ?? 0}</td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <span className="text-green-600 font-bold">{c.stats?.sentCount ?? 0}</span> / <span className="text-red-500 font-bold">{c.stats?.failedCount ?? 0}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button onClick={() => removeCampaign(c)} className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send confirmation */}
      {confirm && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <Send className="w-5 h-5 text-green-600" />
              <h4 className="font-black text-gray-900">Send this promotion?</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">
              Sending <strong className="text-gray-900">“{selected?.title}”</strong> via{' '}
              <span className="capitalize font-bold">{CHANNELS.find((c) => c.id === channel)?.label}</span> to{' '}
              <strong className="text-gray-900">{confirm.audienceCount ? `${fmtNumber(confirm.audienceCount)} customers` : 'all customers'}</strong>.
              {scheduleMode === 'scheduled' && ' It will be delivered automatically at the scheduled time.'}
            </p>
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap">{confirm.message}</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer">Cancel</button>
              <button onClick={doSend} disabled={saving} className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Confirm Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

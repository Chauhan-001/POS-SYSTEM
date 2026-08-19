/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotePage — "tell customers about my offer". A full-screen dedicated page
 * that opens when the user selects an offer to promote. Wraps the existing
 * campaign backend (/api/campaigns): offer selection, friendly audience,
 * channel, AI-generated message with tone/language, preview, then send or
 * schedule with confirmation. Delivery always happens in the background
 * (queued), never silently.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Megaphone, Wand2, Loader2, CheckCircle, Send, CalendarClock,
  Users, MessageSquare, RefreshCw, Trash2, Sparkles, Copy, ChevronDown,
} from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import {
  EmptyState, fmtNumber, AUDIENCE_OPTIONS, OFFER_TYPE_LABELS,
  offerValueLabel, COPY_TONES, COPY_LANGUAGES, BackHeader,
} from './shared';
import { estimateAudience, resolveAudience } from './useMarketingData';

interface PromotePageProps {
  offers: any[];
  segments: any[];
  campaigns: any[];
  currencySymbol: string;
  /** When non-null the page opens directly to this offer (dedicated page mode). */
  initialOfferId: string | null;
  onClearOffer: () => void;
  onRefreshed: () => void;
  notify: (msg: string) => void;
  /** Called when the user wants to go back to the offers list. */
  onBack?: () => void;
}

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { id: 'sms', label: 'SMS', icon: '📱' },
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'app_notification', label: 'Push notification', icon: '🔔' },
  { id: 'webhook', label: 'Webhook', icon: '🔗' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', scheduled: 'bg-amber-50 text-amber-700',
  sending: 'bg-blue-50 text-blue-700', sent: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-600', cancelled: 'bg-gray-100 text-gray-500',
  partial: 'bg-orange-50 text-orange-700',
};

export default function PromotePage({
  offers, segments, campaigns, currencySymbol, initialOfferId,
  onClearOffer, onRefreshed, notify, onBack,
}: PromotePageProps) {
  const [offerId, setOfferId] = useState<string | null>(initialOfferId);
  const [audienceChoice, setAudienceChoice] = useState('everyone');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [channel, setChannel] = useState('whatsapp');
  const [message, setMessage] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [copyTone, setCopyTone] = useState('friendly');
  const [copyLanguage, setCopyLanguage] = useState('en');
  const [copyLength, setCopyLength] = useState<'short' | 'medium'>('medium');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const selected = offers.find((o) => o._id === offerId) || null;

  const audienceSize = useMemo(
    () => estimateAudience(segments, audienceChoice, undefined, customIds),
    [segments, audienceChoice, customIds],
  );

  // When initialOfferId changes (e.g. from Offers page), set it.
  useEffect(() => {
    if (initialOfferId && initialOfferId !== offerId) {
      setOfferId(initialOfferId);
    }
  }, [initialOfferId]);

  const selectOffer = (id: string) => {
    setOfferId(id);
    onClearOffer();
    setError('');
    setMessage('');
    const o = offers.find((x) => x._id === id);
    if (o) {
      const val = offerValueLabel(o.type, o.value, currencySymbol);
      setMessage(
        `🎉 ${o.title}!\n\nGet ${val}${o.minOrderValue ? ` on orders above ${currencySymbol}${fmtNumber(o.minOrderValue)}` : ''}.${o.couponCode ? `\n\nUse code ${o.couponCode}` : ''}\n\nDon't miss out!`,
      );
    }
  };

  const generateMessage = useCallback(async () => {
    if (!selected) return;
    setAiBusy(true);
    setAiStatus('Connecting to AI…');
    setError('');
    try {
      setAiStatus('Generating copy with your style settings…');
      const res = await api.generateOfferCopy({
        type: selected.type, value: selected.value,
        discountValue: offerValueLabel(selected.type, selected.value, currencySymbol),
        applicableCategories: selected.applicableCategories || [],
        targetAudience: AUDIENCE_OPTIONS.find((a) => a.id === audienceChoice)?.label,
        reason: selected.recommendationReason,
        minOrderValue: selected.minOrderValue,
        durationDays: selected.endDate
          ? Math.max(1, Math.round((new Date(selected.endDate).getTime() - Date.now()) / 86400000))
          : 7,
        tone: copyTone as any,
        language: copyLanguage as any,
        bustCache: true,
      });
      const data = res?.data || res;
      if (data?.whatsapp || data?.sms) {
        setMessage(data.whatsapp || data.sms);
        setAiStatus('AI copy generated ✓');
        setTimeout(() => setAiStatus(''), 2000);
      } else if (data?.fallback) {
        setAiStatus('AI unavailable — used template copy');
        setTimeout(() => setAiStatus(''), 3000);
      } else {
        setError('AI copy is unavailable right now — edit the message manually and send.');
      }
    } catch (err) {
      debugWarn('Promote', 'copy failed:', err);
      setError('AI copy is unavailable right now — edit the message manually and send.');
    } finally {
      setAiBusy(false);
    }
  }, [selected, currencySymbol, audienceChoice, copyTone, copyLanguage]);

  // Auto-generate when offer is first selected
  useEffect(() => {
    if (selected && !message && !aiBusy) {
      generateMessage();
    }
  }, [selected?._id]);

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }, []);

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
        schedule: scheduleMode === 'scheduled'
          ? { mode: 'scheduled', scheduledAt: new Date(scheduledAt).toISOString() }
          : { mode: 'immediate' },
      });
      const id = campaign?.data?.id || campaign?.data?._id || campaign?.id || campaign?._id;
      if (!id) {
        setError('Campaign could not be created. Check your connection.');
        return;
      }
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

  const activeOffers = offers.filter((o) => o.status === 'active');

  // ── Full-screen dedicated page when an offer is selected ──────────
  if (selected) {
    const val = offerValueLabel(selected.type, selected.value, currencySymbol);
    return (
      <div className="space-y-5">
        {/* Back header */}
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <button
            onClick={() => { setOfferId(null); onClearOffer(); }}
            className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-extrabold text-gray-900 truncate">Promote: {selected.title}</h2>
            <p className="text-[10px] text-gray-400">{val}{selected.couponCode ? ` · Code: ${selected.couponCode}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
              selected.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>{selected.status}</span>
          </div>
        </div>

        {/* Step 1 — Audience */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center text-[10px] font-black text-blue-600">1</div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Who should receive this?</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AUDIENCE_OPTIONS.filter((a) => a.id !== 'tier').map((a) => (
              <button
                key={a.id}
                onClick={() => setAudienceChoice(a.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  audienceChoice === a.id
                    ? 'bg-[var(--color-blue-600-solid)] text-white border-blue-600 shadow-sm'
                    : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-blue-400'
                }`}
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
                  <button key={s._id}
                    onClick={() => setCustomIds(on ? customIds.filter((x) => x !== s._id) : [...customIds, s._id])}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                      on ? 'bg-[var(--color-indigo-600-solid)] text-white border-indigo-600'
                        : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'
                    }`}>
                    {s.name} · {s.customerCount}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
            <Users className="w-4 h-4 text-[var(--brand-color)]" />
            <span className="text-xs font-bold text-gray-700">
              {audienceSize ? `${fmtNumber(audienceSize)} customers` : 'All customers'}
            </span>
          </div>
        </div>

        {/* Step 2 — Channel */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-purple-50 flex items-center justify-center text-[10px] font-black text-purple-600">2</div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Delivery channel</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <button key={c.id} onClick={() => setChannel(c.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  channel === c.id
                    ? 'bg-[var(--color-purple-600-solid)] text-white border-purple-600 shadow-sm'
                    : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-purple-400'
                }`}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 3 — Message + AI */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-[10px] font-black text-amber-600">3</div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Message</p>
            </div>
            <button
              onClick={generateMessage}
              disabled={aiBusy}
              className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 transition-colors cursor-pointer disabled:opacity-60 px-3 py-1.5 rounded-lg hover:bg-purple-50"
            >
              {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiBusy ? 'Writing…' : 'Generate with AI'}
            </button>
          </div>

          {/* AI status bar */}
          {aiStatus && (
            <div className={`mb-3 px-3 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2 ${
              aiStatus.includes('✓') ? 'bg-green-50 text-green-700' :
              aiStatus.includes('unavailable') ? 'bg-amber-50 text-amber-700' :
              'bg-purple-50 text-purple-700'
            }`}>
              <Sparkles className="w-3 h-3" />
              {aiStatus}
            </div>
          )}

          {/* Style controls */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Tone</label>
              <select value={copyTone} onChange={(e) => setCopyTone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-purple-200">
                {COPY_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Language</label>
              <select value={copyLanguage} onChange={(e) => setCopyLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-purple-200">
                {COPY_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Length</label>
              <div className="flex gap-1.5">
                {(['short', 'medium'] as const).map((len) => (
                  <button key={len} onClick={() => setCopyLength(len)}
                    className={`flex-1 px-2 py-2 rounded-xl text-[10px] font-bold border transition-all cursor-pointer capitalize ${
                      copyLength === len
                        ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {len}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Message textarea */}
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="Your promotional message will appear here…"
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none leading-relaxed"
            />
            {message && (
              <button
                onClick={() => copyToClipboard(message, 'msg')}
                className="absolute top-2 right-2 p-1.5 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                title="Copy message"
              >
                {copiedField === 'msg' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {/* Live preview */}
          {message && (
            <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Preview</p>
                <button
                  onClick={() => copyToClipboard(message, 'preview')}
                  className="text-[9px] font-bold text-gray-400 hover:text-gray-600 cursor-pointer flex items-center gap-1"
                >
                  {copiedField === 'preview' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{message}</p>
            </div>
          )}

          {error && (
            <div className="mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">{error}</div>
          )}
        </div>

        {/* Step 4 — Schedule + Send */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-green-50 flex items-center justify-center text-[10px] font-black text-green-600">4</div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">When to send</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {(['now', 'scheduled'] as const).map((m) => (
                <button key={m} onClick={() => setScheduleMode(m)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-all ${
                    scheduleMode === m
                      ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)] shadow-sm'
                      : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {m === 'now' ? '⚡ Send now' : '📅 Schedule'}
                </button>
              ))}
            </div>
            {scheduleMode === 'scheduled' && (
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
            )}
          </div>
        </div>

        {/* Send button */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => { setOfferId(null); onClearOffer(); }}
            className="px-4 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-all cursor-pointer"
          >
            Choose different offer
          </button>
          <button
            onClick={() => setConfirm({ message: message.trim(), audienceCount: audienceSize })}
            disabled={!message.trim() || saving}
            className="flex items-center gap-2 bg-[var(--color-green-600-solid)] hover:bg-[var(--color-green-700-solid)] text-white px-8 py-3 rounded-xl text-sm font-black shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {scheduleMode === 'scheduled' ? 'Schedule Promotion' : 'Send Promotion'}
          </button>
        </div>

        {/* Recent campaigns */}
        {campaigns.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-extrabold text-gray-700 mb-3">Recent promotions</h4>
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
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
          </div>
        )}

        {/* Send confirmation modal */}
        {confirm && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl max-w-sm w-full p-6">
              <div className="flex items-center gap-2 mb-3">
                <Send className="w-5 h-5 text-green-600" />
                <h4 className="font-black text-gray-900">Send this promotion?</h4>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mb-2">
                Sending <strong className="text-gray-900">"{selected.title}"</strong> via{' '}
                <span className="capitalize font-bold">{CHANNELS.find((c) => c.id === channel)?.label}</span> to{' '}
                <strong className="text-gray-900">
                  {confirm.audienceCount ? `${fmtNumber(confirm.audienceCount)} customers` : 'all customers'}
                </strong>.
                {scheduleMode === 'scheduled' && ' It will be delivered automatically at the scheduled time.'}
              </p>
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap">{confirm.message}</p>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer">Cancel</button>
                <button onClick={doSend} disabled={saving}
                  className="flex-1 py-2.5 bg-[var(--color-green-600-solid)] hover:bg-[var(--color-green-700-solid)] text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Confirm Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Offer selection grid (when no offer is selected yet) ──────────
  return (
    <div className="space-y-6">
      {onBack && (
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <button onClick={onBack}
            className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-extrabold text-gray-900">Promote an offer</h2>
            <p className="text-[10px] text-gray-400">Pick an offer to tell your customers about it.</p>
          </div>
        </div>
      )}

      {!onBack && (
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Promote</p>
          <h3 className="text-sm font-extrabold text-gray-900">Tell customers about your offer</h3>
          <p className="text-[11px] text-gray-400 mt-1">Pick an active offer below — you'll be taken to a dedicated page to compose and send.</p>
        </div>
      )}

      {activeOffers.length === 0 ? (
        <EmptyState
          icon="📣"
          title="No live offers to promote yet"
          subtitle="Create an offer on the Offers tab first, then come back here to promote it to your customers."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeOffers.map((o) => {
            const val = offerValueLabel(o.type, o.value, currencySymbol);
            return (
              <button
                key={o._id}
                onClick={() => selectOffer(o._id)}
                className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 text-left hover:border-[var(--brand-color)] hover:shadow-sm transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-gray-900 truncate">{o.title}</p>
                    <p className="text-xs font-bold text-[var(--brand-color)] mt-1">{val}</p>
                    {o.couponCode && (
                      <p className="text-[10px] font-bold text-gray-400 mt-1">Code: {o.couponCode}</p>
                    )}
                    {o.minOrderValue && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Min order: {currencySymbol}{fmtNumber(o.minOrderValue)}</p>
                    )}
                  </div>
                  <div className="shrink-0 w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-[var(--brand-color)] group-hover:bg-[var(--brand-color)] group-hover:text-white transition-all">
                    <Megaphone className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5 text-[10px] font-bold text-[var(--brand-color)] opacity-0 group-hover:opacity-100 transition-opacity">
                  Promote this offer <ChevronDown className="w-3 h-3 -rotate-90" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Recent campaigns */}
      {campaigns.length > 0 && (
        <div className="mt-8">
          <h4 className="text-xs font-extrabold text-gray-700 mb-3">Recent promotions</h4>
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden">
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
        </div>
      )}
    </div>
  );
}

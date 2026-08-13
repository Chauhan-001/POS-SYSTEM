/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferDetailModal — tap any offer to see what it is, how it's performing
 * (real OfferAnalytics from the backend), and what you can do with it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, Eye, Pause, Play, Copy, Megaphone, Trash2, Award, TrendingUp, ShoppingBag, DollarSign, Target, Loader2 } from 'lucide-react';
import * as api from '../../src/api/client';
import { offerValueLabel, OFFER_TYPE_LABELS, fmtNumber } from './shared';
import OfferEconomics from './OfferEconomics';

interface OfferDetailModalProps {
  offer: any;
  currencySymbol: string;
  onClose: () => void;
  onEdit: () => void;
  onStatusChange: (status: string) => void;
  onDuplicate: () => void;
  onPromote: () => void;
  onDelete: () => void;
}

export default function OfferDetailModal({ offer, currencySymbol, onClose, onEdit, onStatusChange, onDuplicate, onPromote, onDelete }: OfferDetailModalProps) {
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.fetchOfferAnalytics(offer._id).then((res: any) => {
      if (!cancelled) setAnalytics(Array.isArray(res?.analytics) ? res.analytics : []);
    }).catch(() => undefined).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offer._id]);

  const redeemed = analytics.reduce((s, a) => s + (a.redeemed || 0), 0);
  const revenue = analytics.reduce((s, a) => s + (a.revenueGenerated || 0), 0);
  const reached = analytics.reduce((s, a) => s + (a.customersReached || 0), 0);
  const opened = analytics.reduce((s, a) => s + (a.opened || 0), 0);
  const targeted = analytics.reduce((s, a) => s + (a.customersTargeted || 0), 0);
  const conversion = targeted > 0 ? Math.round((redeemed / targeted) * 100) : null;
  const aov = redeemed > 0 ? revenue / redeemed : null;
  const isLive = offer.status === 'active';
  // Deterministic economics for THIS offer (cost vs contribution per dish).
  const economicsDraft = useMemo(() => ({
    title: offer.title,
    type: offer.type,
    value: offer.value || 0,
    scope: 'products',
    productIds: offer.applicableProductIds || [],
    categories: offer.applicableCategories || [],
  }), [offer]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4 sticky top-0 bg-white">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-gray-900">{offer.title}</h3>
              {offer.isAiGenerated && <span className="text-[8px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded uppercase">AI</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{offer.description}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Overview */}
          <section>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Overview</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoCell label="Offer" value={`${OFFER_TYPE_LABELS[offer.type] || offer.type} · ${offerValueLabel(offer.type, offer.value, currencySymbol)}`} />
              <InfoCell label="Status" value={offer.status} live={isLive} />
              <InfoCell label="Eligibility" value={offer.minOrderValue ? `Min order ${currencySymbol}${fmtNumber(offer.minOrderValue)}` : 'No minimum'} />
              <InfoCell label="Schedule" value={offer.daysOfWeek && offer.daysOfWeek.length ? `Repeats weekly${offer.startHour != null ? ` · ${offer.startHour}:00–${offer.endHour}:00` : ''}` : (offer.startDate ? `${offer.startDate}${offer.endDate ? ` → ${offer.endDate}` : ''}` : 'Always on')} />
              <InfoCell label="Audience" value={offer.targetSegmentNames?.length ? offer.targetSegmentNames.join(', ') : offer.targetTier?.length ? `${offer.targetTier.join('/')} members` : 'Everyone'} />
              <InfoCell label="Channels" value={[offer.whatsappMessage && 'WhatsApp', offer.smsMessage && 'SMS', offer.appNotification && 'Push', offer.emailBody && 'Email', 'Checkout', 'Website'].filter(Boolean).join(' + ') || 'Checkout'} />
              {offer.couponCode && <InfoCell label="Coupon" value={offer.couponCode} mono />}
              {offer.maxUses ? <InfoCell label="Redemptions" value={`${fmtNumber(offer.currentUses || 0)} / ${fmtNumber(offer.maxUses)}`} /> : null}
              {offer.recommendationReason && <InfoCell label="Why" value={offer.recommendationReason} wide />}
            </div>
          </section>

          {/* Performance */}
          <section>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Performance</p>
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-gray-300 animate-spin" /></div>
            ) : analytics.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-xl p-4">
                Not enough data yet — this offer hasn't had redemptions or campaign deliveries recorded yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={`${currencySymbol}${fmtNumber(Math.round(revenue))}`} tone="bg-emerald-100 text-emerald-700" />
                <MetricCard icon={<Award className="w-4 h-4" />} label="Redemptions" value={fmtNumber(redeemed)} tone="bg-green-100 text-green-700" />
                <MetricCard icon={<Target className="w-4 h-4" />} label="Conversion" value={conversion !== null ? `${conversion}%` : '—'} tone="bg-blue-100 text-blue-700" />
                <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Avg order" value={aov ? `${currencySymbol}${fmtNumber(Math.round(aov))}` : '—'} tone="bg-purple-100 text-purple-700" />
              </div>
            )}
          </section>

          {/* Economics — how this offer affects your money (deterministic, read-only) */}
          <section>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">How this offer makes money</p>
            <OfferEconomics
              currencySymbol={currencySymbol}
              draft={economicsDraft}
              onApplyAssistant={() => { /* read-only view — no form to prefill */ }}
            />
          </section>

          {/* Actions */}
          <section className="border-t border-gray-100 pt-5">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Actions</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={onEdit} className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2.5 rounded-xl text-xs font-black cursor-pointer hover:bg-[#003ea8] transition-all"><Eye className="w-3.5 h-3.5" /> Edit</button>
              {(isLive || offer.status === 'paused') && (
                <button onClick={() => onStatusChange(isLive ? 'paused' : 'active')} className="flex items-center gap-1.5 bg-amber-500 text-white px-4 py-2.5 rounded-xl text-xs font-black cursor-pointer hover:bg-amber-600 transition-all">
                  {isLive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {isLive ? 'Pause' : 'Resume'}
                </button>
              )}
              <button onClick={onDuplicate} className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer hover:border-[var(--brand-color)] transition-all"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
              <button onClick={onPromote} className="flex items-center gap-1.5 bg-purple-600 text-white px-4 py-2.5 rounded-xl text-xs font-black cursor-pointer hover:bg-purple-700 transition-all"><Megaphone className="w-3.5 h-3.5" /> Promote</button>
              <button onClick={onDelete} className="flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-200 px-4 py-2.5 rounded-xl text-xs font-black cursor-pointer hover:bg-red-100 transition-all ml-auto">
                <Trash2 className="w-3.5 h-3.5" /> End offer
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">Ending an offer stops it immediately and can't be undone — use Pause to stop temporarily.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value, live, mono, wide }: { label: string; value: string; live?: boolean; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`bg-gray-50 border border-gray-100 rounded-xl px-3.5 py-3 ${wide ? 'col-span-2 sm:col-span-3' : ''}`}>
      <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xs font-bold mt-1 ${live ? 'text-green-600' : 'text-gray-800'} ${mono ? 'font-mono tracking-widest' : ''}`}>{value}</p>
    </div>
  );
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="bg-white border border-[#e1e2ed] rounded-xl p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone}`}>{icon}</div>
      <p className="text-lg font-black text-gray-900 mt-2">{value}</p>
      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

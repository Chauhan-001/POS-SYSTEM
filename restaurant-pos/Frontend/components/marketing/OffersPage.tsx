/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OffersPage — simple offer management grouped by lifecycle:
 *   Live now · Starting soon · Drafts · Expired (shown only when needed)
 * Actions: View, Edit, Pause/Resume, Duplicate, Promote, End (delete).
 * Status management is never the dominant visual element.
 */

import React, { useMemo, useState } from 'react';
import { Tag, Plus, Search, Play, Pause, Copy, Trash2, Megaphone, Eye, RefreshCw, AlertTriangle } from 'lucide-react';
import { offerValueLabel, OFFER_TYPE_LABELS, EmptyState, Spinner, fmtNumber } from './shared';
import OfferDetailModal from './OfferDetailModal';

interface OffersPageProps {
  offers: any[];
  loading: boolean;
  currencySymbol: string;
  onRefresh: () => void;
  onEdit: (offer: any) => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (offer: any) => void;
  onPromote: (offerId: string) => void;
  onCreate: () => void;
}

type Filter = 'all' | 'live' | 'scheduled' | 'draft' | 'expired';

export default function OffersPage({ offers, loading, currencySymbol, onRefresh, onEdit, onStatusChange, onDelete, onDuplicate, onPromote, onCreate }: OffersPageProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<any | null>(null);

  const requestEnd = (offer: any) => setConfirmEnd(offer);

  const confirmEndOffer = () => {
    if (!confirmEnd) return;
    onDelete(confirmEnd._id);
    setConfirmEnd(null);
  };

  const live = useMemo(() => offers.filter((o) => o.status === 'active'), [offers]);
  const starting = useMemo(() => offers.filter((o) => o.status === 'scheduled'), [offers]);
  const drafts = useMemo(() => offers.filter((o) => o.status === 'draft'), [offers]);
  const expired = useMemo(() => offers.filter((o) => o.status === 'expired' || o.status === 'cancelled'), [offers]);

  const matches = (o: any) => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${o.title} ${o.description || ''} ${o.couponCode || ''}`.toLowerCase().includes(q)) return false;
    }
    if (filter === 'live') return o.status === 'active';
    if (filter === 'scheduled') return o.status === 'scheduled';
    if (filter === 'draft') return o.status === 'draft';
    if (filter === 'expired') return o.status === 'expired' || o.status === 'cancelled';
    return true;
  };

  const detailOffer = offers.find((o) => o._id === detailId) || null;

  const Filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'live', label: 'Live' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'draft', label: 'Drafts' },
    { id: 'expired', label: 'Expired' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Offers</p>
          <h3 className="text-sm font-extrabold text-gray-900">Your promotions</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[var(--brand-color)] font-bold transition-colors cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={onCreate} className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Create Promotion
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search offers or coupon codes…"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
          {Filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filter === f.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading offers…" />
      ) : offers.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No active offers"
          subtitle="You don't have any promotions yet. Create your first one, or let AI find an opportunity for you."
          cta={
            <>
              <button onClick={onCreate} className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Create Promotion
              </button>
            </>
          }
        />
      ) : (
        <div className="space-y-8">
          {(filter === 'all' || filter === 'live') && <GroupSection title="Live now" empty="No live offers" offers={live.filter(matches)} render={renderOffer} />}
          {(filter === 'all' || filter === 'scheduled') && <GroupSection title="Starting soon" empty="Nothing scheduled" offers={starting.filter(matches)} render={renderOffer} />}
          {(filter === 'all' || filter === 'draft') && <GroupSection title="Drafts" empty="No drafts" offers={drafts.filter(matches)} render={renderOffer} />}
          {(filter === 'all' || filter === 'expired') && expired.length > 0 && (
            <GroupSection title="Expired" empty="No expired offers" offers={expired.filter(matches)} muted render={renderOffer} />
          )}
        </div>
      )}

      {detailOffer && (
        <OfferDetailModal
          offer={detailOffer}
          currencySymbol={currencySymbol}
          onClose={() => setDetailId(null)}
          onEdit={() => onEdit(detailOffer)}
          onStatusChange={(s) => { onStatusChange(detailOffer._id, s); setDetailId(null); }}
          onDuplicate={() => { onDuplicate(detailOffer); setDetailId(null); }}
          onPromote={() => { onPromote(detailOffer._id); setDetailId(null); }}
          onDelete={() => { requestEnd(detailOffer); setDetailId(null); }}
        />
      )}

      {/* End-offer confirmation — dangerous action, never unconfirmed */}
      {confirmEnd && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmEnd(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-600" /></span>
              <h4 className="font-black text-gray-900 text-sm">End this offer?</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              <strong className="text-gray-900">“{confirmEnd.title}”</strong> will stop immediately and can't be undone.
              Customers will no longer see it. Use <strong>Pause</strong> instead if you want to restart it later.
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmEnd(null)} className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer">Cancel</button>
              <button onClick={confirmEndOffer} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs cursor-pointer flex items-center justify-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> End offer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderOffer(o: any) {
    const isLive = o.status === 'active';
    return (
      <div key={o._id} className="bg-white rounded-2xl border border-[#e1e2ed] p-4 hover:shadow-md transition-all group">
        <div className="flex flex-wrap items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-base font-black shrink-0 ${
            isLive ? 'bg-green-100 text-green-700' : o.status === 'scheduled' ? 'bg-amber-100 text-amber-700' : o.status === 'draft' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-400'
          }`}>
            {OFFER_TYPE_LABELS[o.type] === 'Percentage OFF' ? '%' : OFFER_TYPE_LABELS[o.type] === 'Flat ₹ OFF' ? '₹' : '🏷️'}
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-gray-900 text-sm">{o.title}</span>
              {o.isAiGenerated && <span className="text-[8px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded uppercase">AI</span>}
              {o.couponCode && <span className="font-mono font-bold text-[9px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{o.couponCode}</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{o.description}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] font-bold">
              <span className="px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 text-gray-700">
                {offerValueLabel(o.type, o.value, currencySymbol)}
              </span>
              {o.minOrderValue ? <span className="text-gray-400">Min {currencySymbol}{fmtNumber(o.minOrderValue)}</span> : null}
              {o.daysOfWeek && o.daysOfWeek.length > 0 ? <span className="text-gray-400">Repeats weekly</span> : null}
              {o.maxUses ? (
                <span className="text-gray-400">{fmtNumber(o.currentUses || 0)} / {fmtNumber(o.maxUses)} redemptions</span>
              ) : o.currentUses ? (
                <span className="text-gray-400">{fmtNumber(o.currentUses)} redemptions</span>
              ) : null}
              {o.endDate && <span className="text-red-400">Ends {o.endDate}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ActionBtn title="View" onClick={() => setDetailId(o._id)}><Eye className="w-3.5 h-3.5" /></ActionBtn>
            {(o.status === 'active' || o.status === 'paused') && (
              <ActionBtn title={isLive ? 'Pause' : 'Resume'} onClick={() => onStatusChange(o._id, isLive ? 'paused' : 'active')}>
                {isLive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </ActionBtn>
            )}
            {o.status === 'draft' && (
              <ActionBtn title="Publish" onClick={() => onStatusChange(o._id, 'active')}><Play className="w-3.5 h-3.5" /></ActionBtn>
            )}
            <ActionBtn title="Duplicate" onClick={() => onDuplicate(o)}><Copy className="w-3.5 h-3.5" /></ActionBtn>
            <ActionBtn title="Promote" onClick={() => onPromote(o._id)} tone="purple"><Megaphone className="w-3.5 h-3.5" /></ActionBtn>
            <ActionBtn title="End offer" danger onClick={() => requestEnd(o)}><Trash2 className="w-3.5 h-3.5" /></ActionBtn>
          </div>
        </div>
      </div>
    );
  }
}

function GroupSection({ title, empty, offers, muted, render }: { title: string; empty: string; offers: any[]; muted?: boolean; render: (o: any) => React.ReactNode }) {
  if (offers.length === 0) return null;
  return (
    <section>
      <h4 className={`text-xs font-extrabold mb-3 ${muted ? 'text-gray-400' : 'text-gray-700'}`}>{title} <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full ml-1">{offers.length}</span></h4>
      <div className="space-y-3">{offers.map(render)}</div>
    </section>
  );
}

function ActionBtn({ title, onClick, children, tone, danger }: { title: string; onClick: () => void; children: React.ReactNode; tone?: string; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-lg transition-all cursor-pointer ${
        danger ? 'text-gray-300 hover:text-red-600 hover:bg-red-50'
          : tone === 'purple' ? 'text-gray-300 hover:text-purple-600 hover:bg-purple-50'
          : 'text-gray-300 hover:text-[var(--brand-color)] hover:bg-blue-50'
      }`}
    >
      {children}
    </button>
  );
}

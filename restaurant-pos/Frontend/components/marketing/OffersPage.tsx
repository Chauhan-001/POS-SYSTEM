/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OffersPage — campaign management grouped by lifecycle:
 *   Live now · Paused · Starting soon · Drafts · Expired (shown only when needed)
 *
 * Actions: View, Edit, Pause/Resume, Duplicate, End.
 *
 * Design goals: convenience, speed, flexibility.
 *   - Create from Advisory tab or Recommendations
 *   - Every action is visible without digging into menus
 *   - Status management is never the dominant visual element
 */

import React, { useMemo, useState } from 'react';
import {
  Tag, Search, Play, Pause, Copy, Trash2, Eye,
  AlertTriangle, ArrowRight, TrendingUp, Clock,
  CheckCircle2, Package, Sparkles, LayoutGrid, Filter,
} from 'lucide-react';
import { offerValueLabel, OFFER_TYPE_LABELS, EmptyState, Spinner, fmtNumber, provenanceBadge } from './shared';
import OfferDetailModal from './OfferDetailModal';

interface OffersPageProps {
  offers: any[];
  loading: boolean;
  currencySymbol: string;
  onEdit: (offer: any) => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (offer: any) => void;
  /** Active branches — used to name the branch scope on each offer card. */
  branches?: { id: string; name: string; isActive?: boolean }[];
}

type Filter = 'all' | 'live' | 'paused' | 'scheduled' | 'draft' | 'expired';

export default function OffersPage({
  offers, loading, currencySymbol, onEdit, onStatusChange, onDelete,
  onDuplicate, branches = [],
}: OffersPageProps) {
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
  const paused = useMemo(() => offers.filter((o) => o.status === 'paused'), [offers]);
  const starting = useMemo(() => offers.filter((o) => o.status === 'scheduled'), [offers]);
  const drafts = useMemo(() => offers.filter((o) => o.status === 'draft'), [offers]);
  const expired = useMemo(() => offers.filter((o) => o.status === 'expired' || o.status === 'cancelled'), [offers]);

  const matches = (o: any) => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${o.title} ${o.description || ''} ${o.couponCode || ''}`.toLowerCase().includes(q)) return false;
    }
    if (filter === 'live') return o.status === 'active';
    if (filter === 'paused') return o.status === 'paused';
    if (filter === 'scheduled') return o.status === 'scheduled';
    if (filter === 'draft') return o.status === 'draft';
    if (filter === 'expired') return o.status === 'expired' || o.status === 'cancelled';
    return true;
  };

  const detailOffer = offers.find((o) => o._id === detailId) || null;

  const Filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: offers.length },
    { id: 'live', label: 'Live', count: live.length },
    { id: 'paused', label: 'Paused', count: paused.length },
    { id: 'scheduled', label: 'Scheduled', count: starting.length },
    { id: 'draft', label: 'Drafts', count: drafts.length },
    { id: 'expired', label: 'Expired', count: expired.length },
  ];

  // Stats
  const totalRedemptions = useMemo(() =>
    offers.reduce((sum, o) => sum + (o.currentUses || 0), 0), [offers]);
  const liveCount = live.length;

  return (
    <div className="space-y-5">
      {/* Header + Create buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Offers</p>
          <h3 className="text-sm font-extrabold text-gray-900">Your promotions</h3>
        </div>
        <div />
      </div>

      {/* Stats bar */}
      {offers.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-black text-gray-900 leading-none">{liveCount}</p>
              <p className="text-[9px] font-bold text-gray-400 mt-0.5">Live now</p>
            </div>
          </div>
          <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="text-lg font-black text-gray-900 leading-none">{totalRedemptions.toLocaleString()}</p>
              <p className="text-[9px] font-bold text-gray-400 mt-0.5">Redemptions</p>
            </div>
          </div>
          <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-lg font-black text-gray-900 leading-none">{starting.length}</p>
              <p className="text-[9px] font-bold text-gray-400 mt-0.5">Scheduled</p>
            </div>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search offers or coupon codes…"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
          {Filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filter === f.id ? 'bg-[var(--color-bg-white)] text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {f.label}
              {f.count > 0 && (
                <span className={`text-[8px] font-black px-1 py-0.5 rounded-full ${
                  filter === f.id ? 'bg-[var(--brand-color)]/10 text-[var(--brand-color)]' : 'bg-gray-200 text-gray-500'
                }`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading offers…" />
      ) : offers.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No offers yet"
          subtitle="Create your first promotion from the Advisory tab or Recommendations page."
        />
      ) : (
        <div className="space-y-8">
          {(filter === 'all' || filter === 'live') && (
            <GroupSection title="Live now" empty="No live offers" offers={live.filter(matches)} render={renderOffer} />
          )}
          {(filter === 'all' || filter === 'paused') && paused.length > 0 && (
            <GroupSection title="Paused" empty="No paused offers" offers={paused.filter(matches)} muted render={renderOffer} />
          )}
          {(filter === 'all' || filter === 'scheduled') && (
            <GroupSection title="Starting soon" empty="Nothing scheduled" offers={starting.filter(matches)} render={renderOffer} />
          )}
          {(filter === 'all' || filter === 'draft') && (
            <GroupSection title="Drafts" empty="No drafts" offers={drafts.filter(matches)} render={renderOffer} />
          )}
          {(filter === 'all' || filter === 'expired') && expired.length > 0 && (
            <GroupSection title="Expired" empty="No expired offers" offers={expired.filter(matches)} muted render={renderOffer} />
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailOffer && (
        <OfferDetailModal
          offer={detailOffer}
          currencySymbol={currencySymbol}
          onClose={() => setDetailId(null)}
          onEdit={() => onEdit(detailOffer)}
          onStatusChange={(s) => { onStatusChange(detailOffer._id, s); setDetailId(null); }}          onDuplicate={() => { onDuplicate(detailOffer); setDetailId(null); }}
          onDelete={() => { requestEnd(detailOffer); setDetailId(null); }}
        />
      )}

      {/* End-offer confirmation */}
      {confirmEnd && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmEnd(null)}>
          <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-600" /></span>
              <h4 className="font-black text-gray-900 text-sm">End this offer?</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              <strong className="text-gray-900">"{confirmEnd.title}"</strong> will stop immediately and can't be undone.
              Customers will no longer see it. Use <strong>Pause</strong> instead if you want to restart it later.
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmEnd(null)} className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer">Cancel</button>
              <button onClick={confirmEndOffer} className="flex-1 py-2.5 bg-[var(--color-red-600-solid)] hover:bg-[var(--color-red-700-solid)] text-white font-bold rounded-xl text-xs cursor-pointer flex items-center justify-center gap-1.5">
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
      <div key={o._id} className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4 hover:shadow-md transition-all group">
        <div className="flex flex-wrap items-start gap-4">
          {/* Icon / image */}
          <div className="relative w-12 h-12 shrink-0">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-base font-black ${
              isLive ? 'bg-green-100 text-green-700' : o.status === 'paused' ? 'bg-amber-100 text-amber-700' : o.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : o.status === 'draft' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-400'
            }`}>
              {OFFER_TYPE_LABELS[o.type] === 'Percentage OFF' ? '%' : OFFER_TYPE_LABELS[o.type] === 'Flat ₹ OFF' ? '₹' : '🏷️'}
            </div>
            {o.imageUrl && (
              <img
                src={o.imageUrl} alt={`${o.title} banner`}
                className="absolute inset-0 w-12 h-12 rounded-xl object-cover border border-[var(--color-border-default)] shadow-sm"
                loading="lazy"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-gray-900 text-sm">{o.title}</span>
              {o.status === 'active' && <span className="text-[8px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded uppercase">Live</span>}
              {o.status === 'paused' && <span className="text-[8px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase">Paused</span>}
              {o.status === 'scheduled' && <span className="text-[8px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded uppercase">Scheduled</span>}
              {o.status === 'draft' && <span className="text-[8px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded uppercase">Draft</span>}
              {o.isAiGenerated && <span className="text-[8px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded uppercase">AI</span>}
              {(() => { const pv = provenanceBadge(o.recommendationSource); return pv ? <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${pv.cls}`}>{pv.label}</span> : null; })()}
              {o.couponCode && <span className="font-mono font-bold text-[9px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{o.couponCode}</span>}
              {(() => {
                const ids: string[] = Array.isArray(o.branchIds) ? o.branchIds : [];
                if (ids.length === 0) return <span className="text-[8px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">All branches</span>;
                const names = ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean);
                const label = names.length === ids.length ? names.join(', ') : `${ids.length} ${ids.length === 1 ? 'branch' : 'branches'}`;
                return <span className="text-[8px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100" title={label}>{label}</span>;
              })()}
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

          {/* Actions — visible on hover, always accessible */}
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
      <h4 className={`text-xs font-extrabold mb-3 ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
        {title} <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full ml-1">{offers.length}</span>
      </h4>
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

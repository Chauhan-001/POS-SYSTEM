/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProposalsInbox — where agent + owner campaign proposals wait for the owner's
 * decision. Closes the agent loop: "Save as proposal" on the Recommendations
 * page lands here; the owner reviews, submits, approves or rejects.
 *
 * Card design:
 *   - friendly title (the raw `OBJECTIVE • SOURCE • date` name stays as a
 *     small receipt line for search/support);
 *   - CLICK the card → "Why this recommendation": the stored evidence lines
 *     (risks.notes) rewritten in plain language by agentCopy.ts — the
 *     technical strings remain on the proposal as audit evidence;
 *   - segment-first audience: real segment chips first, then ONE grouped
 *     customer chip (never a promotion per single customer);
 *   - the REAL attached offer (populated title + deal) or an honest
 *     "no offer yet" note — nothing invented.
 *
 * Backend contract (all tenant-scoped, role-checked server-side):
 *   GET  /api/campaigns/proposals                — inbox (offer populated)
 *   POST /api/campaigns/proposals/:id/submit     — pending → validating → ready
 *   POST /api/campaigns/proposals/:id/approve    — owner approval
 *   POST /api/campaigns/proposals/:id/reject     — reject with feedback
 *
 * Proposals are read-only here: nothing is sent to customers from this screen —
 * approval hands the draft to the campaign lifecycle.
 */

import React, { useState } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Inbox, RefreshCw, Bot, User, Sparkles,
  AlertTriangle, ChevronDown, HelpCircle, Tag, Users, ListChecks,
} from 'lucide-react';
import { EmptyState, Spinner } from './shared';
import {
  friendlyProposalTitle,
  friendlyEvidenceLine,
  friendlyDeal,
  customerGroupPhrase,
  sourceFromProposalName,
  RUNG_LABELS,
} from './agentCopy';
import type { CampaignProposal } from '../../api/client';

const APPROVAL_META: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Draft', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  validating: { label: 'Validating', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  ready_for_approval: { label: 'Ready for approval', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-600 border-red-100' },
};

const EXECUTION_META: Record<string, string> = {
  pending: 'not scheduled',
  scheduled: 'scheduled',
  active: 'active',
  paused: 'paused',
  completed: 'completed',
  measured: 'measured',
};

const OBJECTIVE_LABELS: Record<string, string> = {
  REACTIVATE_CUSTOMERS: 'Bring customers back',
  WINBACK: 'Win back lost customers',
  RETENTION: 'Keep regulars coming',
  ACQUISITION: 'Attract new customers',
  REWARD_LOYALTY: 'Reward loyal customers',
  BOOST_SALES: 'Boost sales',
  CLEAR_INVENTORY: 'Clear stock',
};

/** Segment-first audience summary: real groups, then one grouped count. */
function audienceSummary(p: CampaignProposal): string {
  const names = p.audience?.segmentNames ?? [];
  const phones = p.audience?.customerPhones ?? [];
  const parts: string[] = [];
  if (names.length > 0) parts.push(names.join(', '));
  if (phones.length > 0) parts.push(`${phones.length} customer${phones.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Audience resolved at send time';
}

/** The attached offer as the UI sees it (populated object, id, or none). */
function attachedOffer(p: CampaignProposal): { title: string; deal: string | null } | 'id-only' | null {
  const offer = p.offerId;
  if (!offer) return null;
  if (typeof offer === 'string') return 'id-only';
  return { title: offer.title || 'Attached offer', deal: friendlyDeal(offer) };
}

export default function ProposalsInbox({
  proposals,
  loading,
  currencySymbol: _currencySymbol,
  onActionDone,
  showToast,
}: {
  proposals: CampaignProposal[];
  loading: boolean;
  currencySymbol: string;
  /** Called after a successful submit/approve/reject so the parent refetches. */
  onActionDone: () => void;
  showToast: (msg: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const act = async (id: string, kind: 'submit' | 'approve' | 'reject') => {
    setBusyId(id);
    setActionError('');
    try {
      const { submitCampaignProposal, approveCampaignProposal, rejectCampaignProposal } = await import('../../api/client');
      const res =
        kind === 'submit'
          ? await submitCampaignProposal(id)
          : kind === 'approve'
            ? await approveCampaignProposal(id)
            : await rejectCampaignProposal(id, { rating: 'neutral' });
      if (!res) {
        setActionError('Could not reach the server — the proposal was not changed. Check your connection and try again.');
        return;
      }
      showToast(
        kind === 'submit' ? 'Proposal submitted for approval'
          : kind === 'approve' ? 'Proposal approved'
          : 'Proposal rejected',
      );
      onActionDone();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Spinner label="Loading proposals…" />;

  if (proposals.length === 0) {
    return (
      <EmptyState
        icon="📥"
        title="No proposals yet"
        subtitle="Run the AI agent on the Recommendations tab and save its plan as a proposal — it will appear here for your approval."
      />
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}
      {proposals.map((p) => {
        const approval = APPROVAL_META[p.approvalStatus] ?? APPROVAL_META.pending;
        const isAgent = p.source === 'agent';
        const canSubmit = p.approvalStatus === 'pending';
        const canDecide = p.approvalStatus === 'ready_for_approval';
        const busy = busyId === p._id;
        const open = expandedId === p._id;
        const { title, raw } = friendlyProposalTitle(p.name, p.source);
        const rung = sourceFromProposalName(p.name);
        const whyNotes: string[] = p.risks?.notes?.length
          ? p.risks.notes
          : p.description
            ? p.description.split(' | ')
            : [];
        const segments = p.audience?.segmentNames ?? [];
        const customerCount = p.audience?.customerPhones?.length ?? 0;
        const offer = attachedOffer(p);
        const validation = p.validationResult;

        return (
          <div key={p._id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* ── Clickable card header: click reveals WHY this recommendation ── */}
            <div
              className="p-4 cursor-pointer select-none hover:bg-slate-50/70 transition-colors"
              onClick={() => setExpandedId(open ? null : p._id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-bold ${approval.cls}`}>
                      {approval.label}
                    </span>
                    {isAgent ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-purple-50 border border-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-600">
                        <Bot className="w-3 h-3" /> AI agent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        <User className="w-3 h-3" /> You
                      </span>
                    )}
                    {p.executionStatus && p.executionStatus !== 'pending' && (
                      <span className="text-[10px] text-gray-400">{EXECUTION_META[p.executionStatus] ?? p.executionStatus}</span>
                    )}
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 truncate">{title}</h4>
                  {/* Receipt line: the raw proposal name (searchable, supports audit) */}
                  <p className="text-[10px] font-mono text-gray-400 truncate mt-0.5">{raw}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpandedId(open ? null : p._id); }}
                  aria-expanded={open}
                  aria-label={open ? 'Hide why this recommendation' : 'Why this recommendation'}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 cursor-pointer hover:bg-slate-50"
                >
                  {open ? 'Hide' : 'Why?'} <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* ── Always-visible facts: objective / audience / real offer ── */}
            <div className="px-4 pb-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {p.objective && (
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] block mb-0.5">Goal</span>
                  <span className="text-gray-700 font-medium">{OBJECTIVE_LABELS[p.objective] ?? p.objective}</span>
                </div>
              )}
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] block mb-0.5">Audience</span>
                <span className="text-gray-700 font-medium">{audienceSummary(p)}</span>
              </div>
              {offer && offer !== 'id-only' && (
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] block mb-0.5">Offer</span>
                  <span className="text-gray-700 font-medium">
                    {offer.title}
                    {offer.deal && <span className="ml-1.5 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{offer.deal}</span>}
                  </span>
                </div>
              )}
            </div>

            {/* ── Expanded: why this recommendation (human language) ── */}
            {open && (
              <div className="mx-4 mt-2 mb-3 rounded-xl border border-purple-100 bg-purple-50/40 p-3 space-y-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-purple-500 mb-1.5 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" /> Why this recommendation
                  </p>
                  {whyNotes.length > 0 ? (
                    <ul className="space-y-1">
                      {whyNotes.map((line, i) => (
                        <li key={i} className="text-[11px] text-gray-600 flex gap-1.5">
                          <span className="text-purple-400 shrink-0">•</span>
                          <span>{friendlyEvidenceLine(line)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-gray-500">No evidence was stored with this proposal.</p>
                  )}
                  {rung && RUNG_LABELS[rung] && (
                    <p className="text-[10px] text-gray-500 mt-1.5">
                      The audience was picked using <span className="font-bold text-gray-600">{RUNG_LABELS[rung]}</span>.
                    </p>
                  )}
                </div>

                {/* Segment-first audience */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-purple-500 mb-1.5 flex items-center gap-1">
                    <Users className="w-3 h-3" /> Who it reaches
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {segments.map((name) => (
                      <span key={name} className="inline-flex items-center rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700">
                        {name}
                      </span>
                    ))}
                    {customerCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700">
                        <Users className="w-3 h-3 text-gray-400" />
                        {customerCount} customer{customerCount === 1 ? '' : 's'}
                        {rung && <span className="text-gray-400 font-normal">· {customerGroupPhrase(rung)}</span>}
                      </span>
                    )}
                    {segments.length === 0 && customerCount === 0 && (
                      <span className="text-[11px] text-gray-500">Audience is resolved when the campaign sends — nothing sent yet.</span>
                    )}
                  </div>
                </div>

                {/* Real offer (or honest absence) */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-purple-500 mb-1.5 flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Offer
                  </p>
                  {offer && offer !== 'id-only' ? (
                    <p className="text-[11px] text-gray-700">
                      <span className="font-bold">{offer.title}</span>
                      {offer.deal && <span className="text-gray-500"> — {offer.deal}</span>}
                    </p>
                  ) : offer === 'id-only' ? (
                    <p className="text-[11px] text-gray-700">A real offer is attached to this proposal.</p>
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      No offer attached yet — after approval, pick a real offer in Promote. Nothing is sent to customers until you choose one.
                    </p>
                  )}
                </div>

                {/* Validation checks (after submit) */}
                {validation && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-purple-500 mb-1.5 flex items-center gap-1">
                      <ListChecks className="w-3 h-3" /> Pre-send checks
                    </p>
                    {validation.valid ? (
                      <p className="text-[11px] font-semibold text-emerald-600">All checks passed — ready to schedule once approved.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {validation.errors.slice(0, 3).map((e, i) => (
                          <li key={i} className="text-[11px] text-amber-700">• {e}</li>
                        ))}
                      </ul>
                    )}
                    {validation.warnings.slice(0, 2).map((w, i) => (
                      <p key={i} className="text-[10px] text-gray-400 mt-0.5">⚠ {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Actions ── */}
            {(canSubmit || canDecide) && (
              <div className="px-4 pb-4 mt-1 flex flex-wrap items-center gap-2">
                {canSubmit && (
                  <button
                    type="button"
                    onClick={() => act(p._id, 'submit')}
                    disabled={busy}
                    className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Submit for approval
                  </button>
                )}
                {canDecide && (
                  <>
                    <button
                      type="button"
                      onClick={() => act(p._id, 'approve')}
                      disabled={busy}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => act(p._id, 'reject')}
                      disabled={busy}
                      className="flex items-center gap-1.5 border border-red-200 text-red-600 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </>
                )}
              </div>
            )}
            {p.approvalStatus === 'approved' && (
              <p className="px-4 pb-4 mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                <Inbox className="w-3.5 h-3.5" /> Approved — hand off to Promote to schedule the broadcast.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

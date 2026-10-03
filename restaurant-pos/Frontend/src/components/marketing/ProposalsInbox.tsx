/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProposalsInbox — where agent + owner campaign proposals wait for the owner's
 * decision. Closes the agent loop: "Save as proposal" on the Recommendations
 * page lands here; the owner reviews, submits, approves or rejects.
 *
 * Backend contract (all tenant-scoped, role-checked server-side):
 *   GET  /api/campaigns/proposals                — inbox
 *   POST /api/campaigns/proposals/:id/submit     — pending → validating → ready
 *   POST /api/campaigns/proposals/:id/approve    — owner approval
 *   POST /api/campaigns/proposals/:id/reject     — reject with feedback
 *
 * Proposals are read-only here: nothing is sent to customers from this screen —
 * approval hands the draft to the campaign lifecycle.
 */

import React, { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Inbox, RefreshCw, Bot, User, Sparkles, AlertTriangle } from 'lucide-react';
import { EmptyState, Spinner } from './shared';
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

function audienceSummary(p: CampaignProposal): string {
  const names = p.audience?.segmentNames ?? [];
  const phones = p.audience?.customerPhones ?? [];
  const parts: string[] = [];
  if (phones.length > 0) parts.push(`${phones.length} customer${phones.length === 1 ? '' : 's'}`);
  if (names.length > 0) parts.push(names.join(', '));
  return parts.join(' · ') || 'Audience resolved at send time';
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
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}
      {proposals.map((p) => {
        const approval = APPROVAL_META[p.approvalStatus] ?? APPROVAL_META.pending;
        const isAgent = p.source === 'agent';
        const canSubmit = p.approvalStatus === 'pending';
        const canDecide = p.approvalStatus === 'ready_for_approval';
        const busy = busyId === p._id;
        return (
          <div key={p._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                <h4 className="text-sm font-bold text-gray-900 truncate">{p.name}</h4>
                {p.description && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{p.description}</p>}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {p.objective && (
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] block mb-0.5">Objective</span>
                  <span className="text-gray-700 font-medium">{OBJECTIVE_LABELS[p.objective] ?? p.objective}</span>
                </div>
              )}
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] block mb-0.5">Audience</span>
                <span className="text-gray-700 font-medium">{audienceSummary(p)}</span>
              </div>
            </div>

            {(canSubmit || canDecide) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                <Inbox className="w-3.5 h-3.5" /> Approved — hand off to Promote to schedule the broadcast.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

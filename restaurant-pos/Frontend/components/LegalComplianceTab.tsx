/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LegalComplianceTab — Settings → LEGAL & COMPLIANCE.
 *
 * Sections:
 *  - Legal documents: the current published versions (backend is the source of
 *    truth — versions/content are never hardcoded here).
 *  - Required acceptances: documents the signed-in user has not accepted yet.
 *  - My acceptances: the user's acceptance history with timestamps.
 *  - Consent: OPTIONAL marketing/communications consent — separate from
 *    contractual acceptance, never pre-checked.
 *  - Data rights: export request + account closure request (recorded server-side).
 *  - Owner statistics: acceptance counts for this restaurant.
 *
 * Platform-wide document administration lives in the admin dashboard; the POS
 * only ever reads published versions and records the user's own acceptances.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, CheckCircle, Shield, Download, UserX, ChevronDown, ChevronUp, RefreshCw, Info } from 'lucide-react';
import {
  fetchPublishedLegalDocuments,
  fetchMyRequiredLegal,
  acceptLegalDocument,
  fetchMyAcceptances,
  fetchMyConsents,
  setLegalConsent,
  requestDataExport,
  requestAccountClose,
  fetchLegalAcceptanceStats,
  type LegalDocumentInfo,
  type LegalAcceptanceInfo,
  type LegalConsentInfo,
} from '../src/api/client';

const DOC_TYPE_LABELS: Record<string, string> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  merchant_agreement: 'Restaurant Merchant Agreement',
  customer_terms: 'Customer Terms & Conditions',
  refund_policy: 'Refund & Cancellation Policy',
  ai_voice_disclosure: 'AI & Voice Data Disclosure',
  acceptable_use: 'Acceptable Use Policy',
  data_processing_addendum: 'Data Processing Addendum',
};

const CONSENT_LABELS: Record<string, { label: string; desc: string }> = {
  marketing_consent: { label: 'Marketing & Promotions', desc: 'Receive promotional offers, campaigns and news (optional).' },
  communications_consent: { label: 'Service Communications', desc: 'Order/service updates and transactional messages (optional).' },
};

export default function LegalComplianceTab({ isOwner }: { isOwner?: boolean }) {
  const [documents, setDocuments] = useState<LegalDocumentInfo[]>([]);
  const [required, setRequired] = useState<Array<{ documentType: string; version: string; title: string; previouslyAcceptedVersion?: string | null }>>([]);
  const [acceptances, setAcceptances] = useState<LegalAcceptanceInfo[]>([]);
  const [consents, setConsents] = useState<LegalConsentInfo[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [openDoc, setOpenDoc] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const loadAll = useCallback(async () => {
    const [docs, req, acc, cons] = await Promise.all([
      fetchPublishedLegalDocuments().catch(() => []),
      fetchMyRequiredLegal().catch(() => []),
      fetchMyAcceptances().catch(() => []),
      fetchMyConsents().catch(() => []),
    ]);
    setDocuments(docs);
    setRequired(req);
    setAcceptances(acc);
    setConsents(cons);
    if (isOwner) {
      setStats(await fetchLegalAcceptanceStats().catch(() => null));
    }
  }, [isOwner]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const consentMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of consents) map[c.consentType] = !!c.granted;
    return map;
  }, [consents]);

  const handleAccept = async (type: string) => {
    setBusy(true);
    const result = await acceptLegalDocument(type, 'settings', 'pos');
    setBusy(false);
    if (result.ok) {
      showToast('Accepted. Thank you — your acceptance has been recorded.');
      await loadAll();
    } else {
      showToast(result.error || 'Could not record acceptance.');
    }
  };

  const handleConsent = async (type: string, granted: boolean) => {
    setBusy(true);
    const result = await setLegalConsent(type, granted, 'settings');
    setBusy(false);
    if (result.ok) {
      showToast(granted ? 'Consent granted.' : 'Consent withdrawn.');
      await loadAll();
    } else {
      showToast(result.error || 'Could not update consent.');
    }
  };

  const handleExport = async () => {
    if (!window.confirm('Request a copy of your personal data? This creates a data-export request that is recorded and processed by the platform.')) return;
    setBusy(true);
    const result = await requestDataExport();
    setBusy(false);
    showToast(result.ok ? 'Data export request received. It will be processed by the platform.' : (result.error || 'Could not create the request.'));
  };

  const handleClose = async () => {
    if (!window.confirm('Request account closure? Your request will be recorded and processed. Legally-required business records are retained per applicable law — this does not instantly delete your data.')) return;
    setBusy(true);
    const result = await requestAccountClose();
    setBusy(false);
    showToast(result.ok ? 'Account closure request received and recorded.' : (result.error || 'Could not create the request.'));
  };

  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(d);
    }
  };

  return (
    <div className="space-y-5">
      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">
          {toast}
        </div>
      )}

      {/* Intro */}
      <div className="rounded-2xl border border-[#e3e6ef] bg-white p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-[var(--brand-color)] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-gray-900">Legal documents & your consent</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Documents shown here are the current published versions, managed centrally by the platform. Accepting a
              document records the exact version, date and context. Privacy consent (marketing / communications) is
              separate from contractual acceptance and is never pre-checked.
            </p>
          </div>
        </div>
      </div>

      {/* Required acceptances */}
      {required.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Documents requiring your acceptance
          </h4>
          <p className="text-xs text-amber-700 mt-1">
            New versions of these documents are in effect. Please review and accept them to continue.
          </p>
          <div className="mt-3 space-y-2">
            {required.map((r) => (
              <div key={r.documentType} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{r.title || DOC_TYPE_LABELS[r.documentType] || r.documentType}</p>
                  <p className="text-[10px] text-gray-500">
                    Version {r.version}
                    {r.previouslyAcceptedVersion ? ` · you previously accepted ${r.previouslyAcceptedVersion}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleAccept(r.documentType)}
                  className="shrink-0 rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Published documents */}
      <div className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
          <FileText className="w-4 h-4" />
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Published documents</span>
          <button type="button" onClick={() => void loadAll()} className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-[var(--brand-color)] flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="divide-y divide-[#eef0f6]">
          {documents.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-gray-400">
              No published documents yet. Platform administrators publish documents from the admin dashboard.
            </div>
          )}
          {documents.map((doc) => {
            const key = doc.documentType;
            const isOpen = !!openDoc[key];
            return (
              <div key={`${key}-${doc.version}`}>
                <button
                  type="button"
                  onClick={() => setOpenDoc((p) => ({ ...p, [key]: !p[key] }))}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 truncate">{doc.title}</p>
                    <p className="text-[10px] text-gray-400">v{doc.version} · effective {fmtDate(doc.effectiveAt)}</p>
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <div className="rounded-xl border border-[#eef0f6] bg-gray-50 p-4 max-h-80 overflow-y-auto">
                      <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-gray-600">{doc.content}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Consent — separate from acceptance */}
      <div className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
          <Shield className="w-4 h-4" />
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Privacy consent (optional)</span>
        </div>
        <div className="divide-y divide-[#eef0f6]">
          {Object.entries(CONSENT_LABELS).map(([type, meta]) => (
            <div key={type} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-gray-800">{meta.label}</p>
                <p className="text-[10px] text-gray-500">{meta.desc}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleConsent(type, !consentMap[type])}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${consentMap[type] ? 'bg-[var(--brand-color)]' : 'bg-gray-300'}`}
                aria-pressed={!!consentMap[type]}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${consentMap[type] ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* My acceptances */}
      <div className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">My acceptances</span>
        </div>
        {acceptances.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-gray-400">No acceptance records yet.</div>
        ) : (
          <div className="divide-y divide-[#eef0f6] max-h-56 overflow-y-auto">
            {acceptances.map((a) => (
              <div key={a._id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{a.documentTitle || DOC_TYPE_LABELS[a.documentType] || a.documentType}</p>
                  <p className="text-[10px] text-gray-400">Version {a.documentVersion} · {a.context || 'pos'}</p>
                </div>
                <span className="shrink-0 text-[10px] font-medium text-gray-500">{fmtDate(a.acceptedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data rights */}
      <div className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
          <Info className="w-4 h-4" />
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Data rights</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Request a copy of your data</p>
              <p className="text-[10px] text-gray-500">Creates an export request for your personal data. Recorded and processed by the platform.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExport()}
              className="shrink-0 rounded-lg border border-[var(--brand-color)] px-3 py-1.5 text-[11px] font-bold text-[var(--brand-color)] hover:bg-[var(--brand-color)]/5 disabled:opacity-50"
            >
              Request export
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><UserX className="w-3.5 h-3.5" /> Request account closure</p>
              <p className="text-[10px] text-gray-500">Records your closure request. Business records are retained per applicable law.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleClose()}
              className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Request closure
            </button>
          </div>
        </div>
      </div>

      {/* Owner stats */}
      {isOwner && stats && (
        <div className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Acceptance statistics (this restaurant)</span>
          </div>
          <div className="p-4">
            {(!stats.acceptances || stats.acceptances.length === 0) ? (
              <p className="text-xs text-gray-400">No acceptance records for this restaurant yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {stats.acceptances.map((row: any) => (
                  <div key={`${row.documentType}-${row.version}`} className="rounded-xl border border-[#eef0f6] bg-gray-50 px-3 py-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700 truncate">{DOC_TYPE_LABELS[row.documentType] || row.documentType} · v{row.version}</span>
                    <span className="text-[11px] font-bold text-[var(--brand-color)]">{row.acceptances}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400 leading-relaxed">
        Legal documents are managed centrally by the platform and can be updated without a software release. Nothing on
        this screen is legal advice — documents are subject to review by a qualified lawyer before commercial use.
      </p>
    </div>
  );
}

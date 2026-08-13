/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LegalAcceptanceGate — server-verified re-acceptance gate.
 *
 * On app start (after authentication) it asks the backend which published
 * documents the signed-in user has not yet accepted (new onboarding users and
 * users facing a re-acceptance after a new version). While mandatory documents
 * are pending, a blocking modal lists them and requires explicit acceptance —
 * acceptance records are created server-side and the version is resolved by the
 * backend, never by this component.
 *
 * Non-blocking (requireAcceptance=false) documents are informational only and
 * never gate the app.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import { fetchMyRequiredLegal, acceptLegalDocument } from '../src/api/client';

interface RequiredDoc {
  documentType: string;
  version: string;
  title: string;
  previouslyAcceptedVersion?: string | null;
}

export default function LegalAcceptanceGate() {
  const [required, setRequired] = useState<RequiredDoc[]>([]);
  const [checked, setChecked] = useState(false);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const docs = await fetchMyRequiredLegal();
      setRequired(docs.filter((d) => d.documentType));
    } catch {
      // Backend unreachable — never block the POS on the gate; the gate only
      // blocks when the backend itself confirms required acceptances.
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (type: string) => {
    setBusyType(type);
    setError(null);
    try {
      const result = await acceptLegalDocument(type, 're_acceptance', 'pos');
      if (!result.ok) {
        setError(result.error || 'Could not record acceptance.');
      } else {
        const remaining = required.filter((r) => r.documentType !== type);
        setRequired(remaining);
        if (remaining.length === 0) setChecked(false); // allow gate to unmount
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusyType(null);
    }
  };

  // Non-blocking until the backend confirms pending acceptances.
  if (!checked || required.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-[var(--brand-color)] text-white flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 shrink-0" />
          <div>
            <h2 className="text-sm font-bold">Updated legal documents</h2>
            <p className="text-[11px] opacity-80">Please review and accept to continue using the POS.</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            New versions of the following documents are in effect. Acceptance is recorded with the exact version, date
            and context. If you previously accepted an older version, that record is kept.
          </p>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
              {error}
            </div>
          )}
          {required.map((doc) => (
            <div key={doc.documentType} className="rounded-xl border border-[#e3e6ef] p-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-[var(--brand-color)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{doc.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Version {doc.version}
                    {doc.previouslyAcceptedVersion ? ` · previously accepted v${doc.previouslyAcceptedVersion}` : ''}
                  </p>
                  <div className="mt-3 rounded-lg bg-gray-50 border border-[#eef0f6] p-3 max-h-44 overflow-y-auto">
                    <p className="text-[11px] leading-relaxed text-gray-600">
                      The full document is available in Settings → Legal &amp; Compliance. By accepting, you agree to
                      this version of the {doc.title} as published by the platform.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyType !== null}
                    onClick={() => accept(doc.documentType)}
                    className="mt-3 w-full rounded-xl bg-[var(--brand-color)] py-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busyType === doc.documentType ? 'Recording…' : `I agree to ${doc.title}`}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-[#eef0f6] bg-gray-50">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Legal documents are managed centrally and may be updated without a software release. This screen does not
            constitute legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}

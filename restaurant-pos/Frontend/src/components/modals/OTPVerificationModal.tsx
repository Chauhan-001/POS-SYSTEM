/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Shield, X } from 'lucide-react';

interface OTPVerificationState {
  isOpen: boolean;
  code: string;
  typedCode: string;
  reward: any | null;
  phone?: string;
  isServerOtp?: boolean;
}

interface OTPVerificationModalProps {
  state: OTPVerificationState;
  onTypedCodeChange: (code: string) => void;
  onVerify: (e: React.FormEvent) => void;
  onClose: () => void;
}

export default function OTPVerificationModal({ state, onTypedCodeChange, onVerify, onClose }: OTPVerificationModalProps) {
  if (!state.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-[var(--brand-color)]" />
          SMS Verification
        </h3>
        <p className="text-xs text-gray-600 mb-2">
          Enter the OTP sent to customer mobile
          {state.phone ? <span className="font-mono font-bold text-[var(--brand-color)]"> ({state.phone})</span> : null}
        </p>
        {/* Server-issued OTPs echo the code in demo mode so the till can display it.
            In real SMS mode (no code) the customer reads it from their phone. */}
        {state.code ? (
          <p className="text-[10px] bg-yellow-50 border border-yellow-200 rounded p-2 mb-4 text-yellow-700">
            Simulated OTP: <strong>{state.code}</strong> (demo mode — server-issued)
          </p>
        ) : (
          <p className="text-[10px] bg-blue-50 border border-blue-200 rounded p-2 mb-4 text-blue-700">
            OTP sent via SMS — ask the customer for the code from their phone.
          </p>
        )}
        <form onSubmit={onVerify} className="space-y-3">
          <input
            type="text"
            maxLength={6}
            placeholder="Enter OTP"
            value={state.typedCode}
            onChange={(e) => onTypedCodeChange(e.target.value.replace(/\D/g, ""))}
            className="w-full px-3 py-2 text-center text-lg font-mono font-bold border border-[#c3c6d7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">
              Cancel
            </button>
            <button type="submit" className="flex-1 py-2 bg-[var(--brand-color)] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer shadow-sm">
              Verify
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FirstTimeSetup — Owner registration wizard shown when no Owner account
 * exists in the database.
 *
 * Flow:
 *   1. Basic Info      — owner name, phone, email, restaurant name
 *   2. Credentials     — owner creates their own User ID + Password
 *
 * Every registration is granted a 14-day, all-features free trial automatically
 * (server-side; no plan selection or payment during setup). The owner picks a
 * paid plan later from Settings → Subscription, which lists all plans and
 * collects payment via Razorpay.
 *
 * After successful registration the Owner is auto-logged in and redirected to
 * the Dashboard. This screen never appears again.
 */

import React, { useState, useEffect } from 'react';
import { ShieldCheck, User, Phone, Mail, Lock, Eye, EyeOff, Store, AlertTriangle, CheckCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import * as api from '../src/api/client';

interface FirstTimeSetupProps {
  onSetupComplete: (employee: any, pin?: string) => void;
  /** Fired when the user already has credentials and wants to sign in instead. */
  onAlreadyHaveAccount?: () => void;
}

type Step = 'basic' | 'credentials' | 'loading' | 'success' | 'error';

export default function FirstTimeSetup({ onSetupComplete, onAlreadyHaveAccount }: FirstTimeSetupProps) {
  const [step, setStep] = useState<Step>('basic');
  const [errorMessage, setErrorMessage] = useState('');

  // Every registration is granted this trial server-side (backend default).
  const TRIAL_DAYS = 14;

  // Step 1 — basic info
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [restaurantName, setRestaurantName] = useState('');

  // Submitting flag (separate from step so the credentials form can disable itself)
  const [submitting, setSubmitting] = useState(false);

  // ── Legal consent (required before creating the account) ──
  // Registration is always a first-time act, so acceptance is never seeded
  // from a previous device consent — the user must explicitly accept for
  // this new account. (Login only prompts on a new device.)
  // Separate checkboxes for Terms & Conditions and Privacy Policy.
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState<boolean>(false);
  const [consentError, setConsentError] = useState(false);

  const toggleConsent = (type: 'terms' | 'privacy', checked: boolean) => {
    if (type === 'terms') setAcceptedTerms(checked);
    else setAcceptedPrivacy(checked);
    setConsentError(false);
  };
  const allConsented = acceptedTerms && acceptedPrivacy;

  const openLegal = (doc: 'terms' | 'privacy') => {
    window.open(`legal/${doc}.html`, '_blank', 'noopener,noreferrer');
  };

  // Step 4 — credentials
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Real-time clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const validateBasic = (): boolean => {
    const errors: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2) errors.fullName = 'Full name must be at least 2 characters';
    if (!phone.trim() || !/^\d{10}$/.test(phone.trim())) errors.phone = 'Enter a valid 10-digit mobile number';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address';
    if (!restaurantName.trim() || restaurantName.trim().length < 2) errors.restaurantName = 'Restaurant name must be at least 2 characters';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateCredentials = (): boolean => {
    const errors: Record<string, string> = {};
    const uid = userId.trim();
    if (!uid || uid.length < 3) errors.userId = 'User ID must be at least 3 characters';
    else if (!/^[a-zA-Z0-9_]+$/.test(uid)) errors.userId = 'Only letters, numbers and underscores allowed';
    if (!password || password.length < 6) errors.password = 'Password must be at least 6 characters';
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const nextFromBasic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateBasic()) return;
    // No plan choice or payment during setup — every registration is a
    // 14-day all-features trial (granted server-side).
    setStep('credentials');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCredentials()) return;
    if (!allConsented) {
      setConsentError(true);
      setErrorMessage('');
      return;
    }
    setErrorMessage('');
    setSubmitting(true);
    setStep('loading');

    const result = await api.registerOwner({
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      password,
      confirmPassword,
      restaurantName: restaurantName.trim(),
      userId: userId.trim(),
      // No planId/payment: the backend grants a 14-day all-features trial.
    });

    setSubmitting(false);
    if (result.success && result.employee) {
      // Registration succeeded → the owner is auto-logged-in. Only now record
      // consent on this device, so the prompt survives a failed submission
      // instead of being recorded the moment the checkbox is clicked.
      localStorage.setItem('pos_legal_consent', '1');
      setStep('success');
      // Brief delay so the user sees the success state before redirect.
      setTimeout(() => {
        onSetupComplete(result.employee, password);
      }, 1500);
    } else {
      setStep('error');
      setErrorMessage(result.error || 'Registration failed. Please try again.');
    }
  };

  const steps: Array<{ key: Step; label: string }> = [
    { key: 'basic', label: 'Basic Info' },
    { key: 'credentials', label: 'Credentials' },
  ];
  const currentStepIndex = Math.max(0, steps.findIndex((s) => s.key === step));

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[var(--color-bg-page)] via-[var(--color-bg-white)] to-[var(--color-surface-muted)] text-[var(--color-text-primary)] flex flex-col font-sans">
      {/* Top bar */}
      <div className="bg-[var(--color-sidebar-bg)] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[var(--color-sidebar-border)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2563eb]" />
          <span className="font-semibold tracking-wider">RESTAURANT POS TERMINAL v1.4.2</span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <span>{currentTime.toLocaleDateString()}</span>
          <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
          <span className="text-emerald-400">● SETUP MODE</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-5xl bg-[var(--color-bg-white)] rounded-2xl shadow-xl border border-[var(--color-border-default)] overflow-hidden grid md:grid-cols-5">

          {/* Left panel — Branding & info */}
          <div className="md:col-span-2 bg-gradient-to-br from-[var(--brand-color)] to-[#0031a0] p-8 md:p-10 text-white flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-white/5 rounded-full" />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/5 rounded-full" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/[0.03] rounded-full" />

            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center mb-6">
                <Store className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight">Welcome to Your POS</h1>
              <p className="text-sm text-blue-200 leading-relaxed mb-8">
                Set up your restaurant in minutes. You'll get a {TRIAL_DAYS}-day free trial with all features — no card required. Pick a paid plan anytime from Settings.
              </p>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Owner Account</p>
                    <p className="text-xs text-blue-200">Full system access & control</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{TRIAL_DAYS}-Day Free Trial</p>
                    <p className="text-xs text-blue-200">All features, no card required</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Your Own Login</p>
                    <p className="text-xs text-blue-200">Choose your User ID & Password</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 text-xs text-blue-300">
              <p>Secure setup • One-time configuration</p>
            </div>
          </div>

          {/* Right panel — Wizard */}
          <div className="md:col-span-3 p-8 md:p-10 overflow-y-auto max-h-[80vh]">
            {step === 'success' ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">Setup Complete!</h2>
                <p className="text-sm text-gray-500">Welcome to your restaurant POS. Redirecting to Dashboard...</p>
              </div>
            ) : (
              <>
                {/* Progress indicator */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                      {step === 'basic' && 'Basic Information'}
                      {step === 'credentials' && 'Create Your Login'}
                      {step === 'error' && 'Registration'}
                      {step === 'loading' && 'Creating your account...'}
                    </h2>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      Step {currentStepIndex + 1} of {steps.length}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {steps.map((s, i) => (
                      <div
                        key={s.key}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${i <= currentStepIndex ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}
                      />
                    ))}
                  </div>
                </div>

                {step === 'error' && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                {errorMessage && step !== 'error' && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* ── STEP 1: BASIC INFO ── */}
                {step === 'basic' && (
                  <form onSubmit={nextFromBasic} className="space-y-5">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <User className="w-3.5 h-3.5" />
                        Owner Details
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              placeholder="e.g., Rajesh Kumar"
                              className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.fullName ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                            />
                          </div>
                          {fieldErrors.fullName && <p className="text-xs text-red-500 mt-1">{fieldErrors.fullName}</p>}
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Mobile Number <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                              placeholder="e.g., 9876543210"
                              maxLength={10}
                              className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.phone ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                            />
                          </div>
                          {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">{fieldErrors.phone}</p>}
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-gray-400">(optional)</span></label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="e.g., owner@restaurant.com"
                              className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.email ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                            />
                          </div>
                          {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <Store className="w-3.5 h-3.5" />
                        Restaurant Details
                      </h3>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Restaurant Name <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={restaurantName}
                            onChange={(e) => setRestaurantName(e.target.value)}
                            placeholder="e.g., The Royal Bistro"
                            className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.restaurantName ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                          />
                        </div>
                        {fieldErrors.restaurantName && <p className="text-xs text-red-500 mt-1">{fieldErrors.restaurantName}</p>}
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-lg font-semibold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                    >
                      Continue — Create Your Login
                    </button>

                    {onAlreadyHaveAccount && (
                      <div className="pt-2 text-center">
                        <p className="text-xs text-gray-500 mb-1">Already registered your restaurant?</p>
                        <button
                          type="button"
                          onClick={onAlreadyHaveAccount}
                          className="text-xs font-semibold text-[var(--brand-color)] hover:underline cursor-pointer"
                        >
                          I already have an account — Sign in
                        </button>
                      </div>
                    )}
                  </form>
                )}

                {/* ── STEP 4: CREDENTIALS ── */}
                {step === 'credentials' && (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5" />
                        Create your login — {TRIAL_DAYS} days free trial with all features
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">User ID <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={userId}
                              onChange={(e) => setUserId(e.target.value)}
                              placeholder="e.g., my_restaurant_owner"
                              className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] font-mono ${fieldErrors.userId ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                            />
                          </div>
                          {fieldErrors.userId && <p className="text-xs text-red-500 mt-1">{fieldErrors.userId}</p>}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Min. 6 characters"
                                className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.password ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                              />
                              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            {fieldErrors.password && <p className="text-xs text-red-500 mt-1">{fieldErrors.password}</p>}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password <span className="text-red-500">*</span></label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type={showConfirm ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter password"
                                className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] ${fieldErrors.confirmPassword ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)]'}`}
                              />
                              <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            {fieldErrors.confirmPassword && <p className="text-xs text-red-500 mt-1">{fieldErrors.confirmPassword}</p>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Legal consent (required before account creation) ── */}
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                      <label className="flex items-start gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={acceptedTerms}
                          onChange={(e) => toggleConsent('terms', e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-[var(--brand-color)] cursor-pointer"
                          aria-invalid={consentError && !acceptedTerms}
                        />
                        <span className="text-xs text-gray-600 leading-snug">
                          I agree to the{' '}
                          <button type="button" onClick={() => openLegal('terms')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                            Terms &amp; Conditions
                          </button>
                        </span>
                      </label>
                      <label className="flex items-start gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={acceptedPrivacy}
                          onChange={(e) => toggleConsent('privacy', e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-[var(--brand-color)] cursor-pointer"
                          aria-invalid={consentError && !acceptedPrivacy}
                        />
                        <span className="text-xs text-gray-600 leading-snug">
                          I acknowledge the{' '}
                          <button type="button" onClick={() => openLegal('privacy')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                            Privacy Policy
                          </button>
                          , and I confirm that the information provided is accurate and that I am authorized to register this restaurant.
                        </span>
                      </label>
                      {consentError && !allConsented && (
                        <p className="text-xs text-red-600 flex items-center gap-1.5 mt-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Please accept both the Terms &amp; Conditions and Privacy Policy to create your account.
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !allConsented}
                      className="w-full bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-lg font-semibold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Starting your {TRIAL_DAYS}-day free trial...
                        </>
                      ) : (
                        'Complete Setup & Open Dashboard'
                      )}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setStep('basic')}
                        disabled={submitting}
                        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer disabled:opacity-50"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> Back
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[var(--color-bg-white)] text-gray-500 text-center py-3 text-xs border-t border-[var(--color-border-default)]">
        Powered by Restaurant POS Terminal. One-time setup for first-time restaurant owners.
      </div>
    </div>
  );
}

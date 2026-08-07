/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FirstTimeSetup — Owner registration on very first application launch.
 * Only appears when no Owner account exists in the database.
 * After successful registration, the Owner is auto-logged in and
 * redirected to the Dashboard. This screen never appears again.
 */

import React, { useState, useEffect } from 'react';
import { ShieldCheck, User, Phone, Mail, Lock, Eye, EyeOff, Store, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import * as api from '../src/api/client';

interface FirstTimeSetupProps {
  onSetupComplete: (employee: any, pin?: string) => void;
}

export default function FirstTimeSetup({ onSetupComplete }: FirstTimeSetupProps) {
  const [step, setStep] = useState<'form' | 'loading' | 'success' | 'error'>('form');
  const [errorMessage, setErrorMessage] = useState('');

  // Form fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');

  // Validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Real-time clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!fullName.trim() || fullName.trim().length < 2) {
      errors.fullName = 'Full name must be at least 2 characters';
    }
    if (!phone.trim() || !/^\d{10}$/.test(phone.trim())) {
      errors.phone = 'Enter a valid 10-digit mobile number';
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid email address';
    }
    if (!password || password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    if (!restaurantName.trim() || restaurantName.trim().length < 2) {
      errors.restaurantName = 'Restaurant name must be at least 2 characters';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validate()) return;

    setStep('loading');

    const result = await api.registerOwner({
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      password,
      confirmPassword,
      restaurantName: restaurantName.trim(),
    });

    if (result.success && result.employee) {
      setStep('success');
      // Brief delay so user sees the success state before redirect. Pass the
      // chosen password along so the owner is cached locally with a PIN and
      // can switch users via Position + PIN right away.
      setTimeout(() => {
        onSetupComplete(result.employee, password);
      }, 1500);
    } else {
      setStep('error');
      setErrorMessage(result.error || 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[#faf8ff] via-white to-[#f0f4ff] text-[#191b23] flex flex-col font-sans">
      {/* Top bar */}
      <div className="bg-[#191b23] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[#2e3039]">
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
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl border border-[#e1e2ed] overflow-hidden grid md:grid-cols-5">
          
          {/* Left panel — Branding & info */}
          <div className="md:col-span-2 bg-gradient-to-br from-[#004ac6] to-[#0031a0] p-8 md:p-10 text-white flex flex-col justify-between relative overflow-hidden">
            {/* Decorative circles */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-white/5 rounded-full" />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/5 rounded-full" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/[0.03] rounded-full" />

            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center mb-6">
                <Store className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight">Welcome to Your POS</h1>
              <p className="text-sm text-blue-200 leading-relaxed mb-8">
                Set up your restaurant in minutes. This is a one-time configuration — after completion, you'll be logged in and ready to serve.
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
                    <p className="text-sm font-medium">Restaurant Profile</p>
                    <p className="text-xs text-blue-200">Configure details later in Settings</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Ready for Staff</p>
                    <p className="text-xs text-blue-200">Add employees after setup</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 text-xs text-blue-300">
              <p>Secure setup • One-time configuration</p>
            </div>
          </div>

          {/* Right panel — Form */}
          <div className="md:col-span-3 p-8 md:p-10 overflow-y-auto max-h-[80vh]">
            {step === 'success' ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-[#191b23] mb-2">Setup Complete!</h2>
                <p className="text-sm text-gray-500">Welcome to your restaurant POS. Redirecting to Dashboard...</p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-[#191b23] mb-1">First-Time Setup</h2>
                  <p className="text-sm text-gray-500">Create your Owner account and register your restaurant.</p>
                </div>

                {step === 'error' && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Owner Details */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                      <User className="w-3.5 h-3.5" />
                      Owner Details
                    </h3>
                    <div className="space-y-3">
                      {/* Full Name */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="e.g., Rajesh Kumar"
                            className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.fullName ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
                          />
                        </div>
                        {fieldErrors.fullName && <p className="text-xs text-red-500 mt-1">{fieldErrors.fullName}</p>}
                      </div>

                      {/* Mobile */}
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
                            className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.phone ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
                          />
                        </div>
                        {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">{fieldErrors.phone}</p>}
                      </div>

                      {/* Email (optional) */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-gray-400">(optional)</span></label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="e.g., owner@restaurant.com"
                            className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.email ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
                          />
                        </div>
                        {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
                      </div>

                      {/* Password */}
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
                              className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.password ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
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
                              className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.confirmPassword ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
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

                  {/* Restaurant Details */}
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
                          className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] ${fieldErrors.restaurantName ? 'border-red-300 bg-red-50' : 'border-[#c3c6d7]'}`}
                        />
                      </div>
                      {fieldErrors.restaurantName && <p className="text-xs text-red-500 mt-1">{fieldErrors.restaurantName}</p>}
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={step === 'loading'}
                    className="w-full bg-[#004ac6] hover:bg-[#003ea8] text-white py-3 rounded-lg font-semibold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
                  >
                    {step === 'loading' ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Creating your account...
                      </>
                    ) : (
                      'Complete Setup & Open Dashboard'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white text-gray-500 text-center py-3 text-xs border-t border-[#e1e2ed]">
        Powered by Restaurant POS Terminal. One-time setup for first-time restaurant owners.
      </div>
    </div>
  );
}

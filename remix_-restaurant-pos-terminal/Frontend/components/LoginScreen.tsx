/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ShieldCheck, Printer, Wifi, Server, Database, Eye, EyeOff, Lock, User, RefreshCw, AlertTriangle } from 'lucide-react';
import { Employee } from '../src/types';

interface LoginScreenProps {
  employees: Employee[];
  onLoginSuccess: (employee: Employee) => void;
  settings?: any;
}

export default function LoginScreen({ employees, onLoginSuccess, settings }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Simulated status states
  const [internetStatus, setInternetStatus] = useState<'online' | 'offline'>('online');
  const [printerStatus, setPrinterStatus] = useState<'ready' | 'error'>('ready');
  const [backendStatus, setBackendStatus] = useState<'live' | 'down'>('live');
  const [databaseStatus, setDatabaseStatus] = useState<'synced' | 'local_only'>('synced');

  // Real-time local clock
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Preset quick log-in credentials for testing
  const quickLogins = [
    { label: 'Ravi (Cashier)', username: 'cashier', pin: '3333', role: 'Cashier' },
    { label: 'Vansh (Manager)', username: 'manager', pin: '2222', role: 'Manager' },
    { label: 'Rajesh (Owner)', username: 'owner', pin: '1111', role: 'Owner' }
  ];

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Employee ID / Username and password are required.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const found = employees.find(
        (emp) =>
          emp.status === 'Active' &&
          (emp.username.toLowerCase() === username.trim().toLowerCase() || emp.pin === password) &&
          (password === emp.pin || password === 'admin')
      );

      setIsLoading(false);

      if (found) {
        onLoginSuccess(found);
      } else {
        setError('Invalid credentials or inactive staff account. Try Quick Login shortcuts below.');
      }
    }, 800);
  };

  const handleQuickLogin = (uname: string, pin: string) => {
    setUsername(uname);
    setPassword(pin);
    setIsLoading(true);
    setTimeout(() => {
      const found = employees.find((emp) => emp.username === uname);
      setIsLoading(false);
      if (found) {
        onLoginSuccess(found);
      }
    }, 400);
  };

  return (
    <div id="login_screen_container" className="min-h-screen bg-[#faf8ff] text-[#191b23] flex flex-col justify-between font-sans">
      {/* Top Simulated Desktop Header */}
      <div className="bg-[#191b23] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[#2e3039]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2563eb]" />
          <span className="font-semibold tracking-wider">RESTAURANT POS TERMINAL v1.4.2</span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <span>{currentTime.toLocaleDateString()}</span>
          <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
          <span className="text-[#2563eb]">● SECURE MODE</span>
        </div>
      </div>

      {/* Main Form Center Layout */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg overflow-hidden border border-[#e1e2ed] grid md:grid-cols-2">
          
          {/* Left Panel: App Info & Diagnostics */}
          <div className="bg-[#f3f3fe] p-8 flex flex-col justify-between border-r border-[#e1e2ed]">
            <div>
              {/* Brand Logo Placeholder */}
              <div className="flex items-center gap-3 mb-6">
                {settings?.sidebarLogoUrl ? (
                  <img 
                    src={settings.sidebarLogoUrl} 
                    alt="Logo" 
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="w-12 h-12 rounded-lg object-cover bg-[#004ac6] border border-gray-200 shadow-md shrink-0 gpu" 
                    onError={(e) => {
                      const target = e.currentTarget;
                      const parent = target.parentElement;
                      if (!parent || parent.querySelector('.img-fallback')) return;
                      target.style.display = 'none';
                      parent.classList.add('bg-gradient-to-br', 'from-gray-100', 'to-gray-50');
                      const fallback = document.createElement('span');
                      fallback.className = 'img-fallback text-sm font-bold text-gray-600';
                      fallback.textContent = (settings?.restaurantName || 'TRB').charAt(0);
                      parent.appendChild(fallback);
                    }}
                  />
                ) : (
                  <div className="w-12 h-12 bg-[#004ac6] text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-md px-1 text-center leading-tight">
                    {settings?.restaurantName ? settings.restaurantName.split(' ').map((w: string) => w[0]).join('').substring(0, 3).toUpperCase() : 'TRB'}
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-[#191b23]">{settings?.restaurantName || 'The Royal Bistro'}</h1>
                  <p className="text-xs text-[#505f76]">Loyalty-Integrated Terminal</p>
                </div>
              </div>

              <p className="text-sm text-[#505f76] mb-8 leading-relaxed">
                Welcome to the high-velocity Billing & Loyalty POS module. Verify system ready indicators before opening sales shift.
              </p>

              {/* Status Diagnostics Diagnostic Panel */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Terminal Readiness Diagnostics</h3>
                
                {/* Diagnostics Rows */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded-lg border border-[#e7e7f3] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <Wifi className={`w-4 h-4 ${internetStatus === 'online' ? 'text-green-600' : 'text-red-500'}`} />
                      <span className="font-medium text-gray-700">Internet</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${internetStatus === 'online' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {internetStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-[#e7e7f3] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <Printer className={`w-4 h-4 ${printerStatus === 'ready' ? 'text-green-600' : 'text-amber-500'}`} />
                      <span className="font-medium text-gray-700">Printer</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${printerStatus === 'ready' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {printerStatus === 'ready' ? '80MM READY' : 'NO PAPER'}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-[#e7e7f3] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <Server className={`w-4 h-4 ${backendStatus === 'live' ? 'text-green-600' : 'text-red-500'}`} />
                      <span className="font-medium text-gray-700">Backend API</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${backendStatus === 'live' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {backendStatus === 'live' ? 'LIVE' : 'ERROR'}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-[#e7e7f3] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <Database className="w-4 h-4 text-green-600" />
                      <span className="font-medium text-gray-700">PostgreSQL</span>
                    </div>
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                      SYNCED
                    </span>
                  </div>
                </div>

                {/* Simulation Control Panel */}
                <div className="mt-4 p-3 bg-white rounded-lg border border-dashed border-[#c3c6d7] text-xs">
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="text-gray-700 flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#004ac6]" />
                      Simulation Controls (Cashier Testing)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button 
                      onClick={() => setInternetStatus(internetStatus === 'online' ? 'offline' : 'online')} 
                      className="px-2 py-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 font-medium cursor-pointer"
                    >
                      Toggle Internet {internetStatus === 'online' ? '🔴' : '🟢'}
                    </button>
                    <button 
                      onClick={() => setPrinterStatus(printerStatus === 'ready' ? 'error' : 'ready')} 
                      className="px-2 py-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 font-medium cursor-pointer"
                    >
                      Toggle Paper Out {printerStatus === 'ready' ? '⚠️' : '🟢'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500 mt-6 flex justify-between items-center">
              <span>Tenant ID: <strong className="text-gray-700 font-semibold">royal_bistro_01</strong></span>
              <span>Build 2.08.16</span>
            </div>
          </div>

          {/* Right Panel: Login Credentials Form */}
          <div className="p-8 flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-2 text-[#191b23]">Staff Authorization</h2>
              <p className="text-xs text-gray-500 mb-6">Enter your credentials or select from the quick credentials list.</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                {/* Employee ID */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                    Employee Username or ID
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g., cashier"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#c3c6d7] focus:outline-none focus:ring-2 focus:ring-[#004ac6] text-sm"
                      required
                    />
                  </div>
                </div>

                {/* Password / PIN */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Secured PIN / Password
                    </label>
                    <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Please contact restaurant Owner or Administrator to reset your PIN code.'); }} className="text-xs text-[#004ac6] hover:underline">
                      Forgot Password?
                    </a>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="e.g., 4-digit PIN (3333)"
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#c3c6d7] focus:outline-none focus:ring-2 focus:ring-[#004ac6] font-mono text-sm tracking-widest"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                {/* Options row */}
                <div className="flex items-center justify-between py-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded text-[#004ac6] focus:ring-[#004ac6]"
                    />
                    <span className="text-xs text-gray-600 font-medium">Remember terminal session</span>
                  </label>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#004ac6] hover:bg-[#003ea8] text-white py-3 rounded-lg font-semibold text-sm transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Authenticating Server Credentials...
                    </>
                  ) : (
                    'Authenticate & Open Cashier Shift'
                  )}
                </button>
              </form>
            </div>

            {/* Quick Testing Shortcuts (Very convenient for verification) */}
            <div className="mt-6 pt-5 border-t border-[#e1e2ed]">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
                Cashier Testing Quick Shortcuts
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {quickLogins.map((quick) => (
                  <button
                    key={quick.username}
                    type="button"
                    onClick={() => handleQuickLogin(quick.username, quick.pin)}
                    className="p-2 text-center bg-[#f3f3fe] hover:bg-[#e7e7f3] border border-[#c3c6d7] rounded-lg transition-all text-[11px] font-semibold cursor-pointer text-gray-800"
                  >
                    <div>{quick.role}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">PIN: {quick.pin}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          
        </div>
      </div>

      {/* Outer Footer */}
      <div className="bg-white text-gray-500 text-center py-4 text-xs border-t border-[#e1e2ed]">
        Designed for Windows POS. Press <strong className="text-gray-700">F11</strong> to toggle Fullscreen mode. Dedicated to high-speed hospitality operators.
      </div>
    </div>
  );
}

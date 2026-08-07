import React, { useState, useEffect } from 'react';
import { ShieldCheck, Eye, EyeOff, Lock, User, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';

interface LoginScreenProps {
  onLoginSuccess: (employee: any, pin?: string) => void;
  settings?: any;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    try {
      const result = await auth.login(username.trim(), password, false);
      if (result.employee) {
        onLoginSuccess(result.employee, password);
      }
    } catch { /* error handled by auth context */ }
  };

  return (
    <div id="login_screen_container" className="fixed inset-0 bg-[#faf8ff] text-[#191b23] flex flex-col font-sans">
      <div className="bg-[#191b23] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[#2e3039]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2563eb]" />
          <span className="font-semibold tracking-wider">POS TERMINAL v1.0.0</span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <span>{currentTime.toLocaleDateString()}</span>
          <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
          <span className="text-[#2563eb]">● SECURE MODE</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden border border-[#e1e2ed]">
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#004ac6] text-white rounded-xl flex items-center justify-center font-bold text-xl mx-auto mb-4 shadow-md">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#191b23]">POS Terminal Sign In</h1>
              <p className="text-xs text-gray-500 mt-1">Enter your User ID and Password to access the POS terminal.</p>
            </div>

            {auth.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <span>{auth.error}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  User ID / Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. owner_ratjs_s6uj"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#c3c6d7] focus:outline-none focus:ring-2 focus:ring-[#004ac6] text-sm font-mono"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#c3c6d7] focus:outline-none focus:ring-2 focus:ring-[#004ac6] font-mono text-sm"
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

              <button
                type="submit"
                disabled={auth.isLoading}
                className="w-full bg-[#004ac6] hover:bg-[#003ea8] text-white py-3 rounded-lg font-semibold text-sm transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
              >
                {auth.isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  'Sign In to POS'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="bg-white text-gray-500 text-center py-4 text-xs border-t border-[#e1e2ed]">
        POS Terminal — Secure Access. Press <strong className="text-gray-700">F11</strong> for Fullscreen.
      </div>
    </div>
  );
}
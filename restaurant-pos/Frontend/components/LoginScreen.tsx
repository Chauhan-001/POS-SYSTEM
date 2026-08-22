import React, { useMemo, useState, useEffect } from 'react';
import { ShieldCheck, Eye, EyeOff, Lock, User, RefreshCw, AlertTriangle, Crown, Briefcase, ShoppingCart, Delete, LogIn, Fingerprint, Users, ChevronRight, X } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';
import { normalizeRole, type Employee } from '../src/types';
import { getSavedAccounts, removeAccount, type SavedAccount } from '../src/savedAccounts';

export type LoginMethod = 'password' | 'role_pin' | 'pin' | 'tap_only';

interface LoginScreenProps {
  onLoginSuccess: (employee: any, pin?: string) => void;
  settings?: any;
  /** Cached local employee roster — used to verify PIN / tap-to-open offline. */
  employees?: Employee[];
  /** The store's configured sign-in method. Defaults to password. */
  loginMethod?: LoginMethod;
  /** True when this is the first-ever boot (no Owner registered yet). */
  isFirstRun?: boolean;
  onRegister?: () => void;
}

const POSITIONS: Array<{ role: Employee['role']; label: string; icon: any; color: string }> = [
  { role: 'Owner', label: 'Owner', icon: Crown, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { role: 'Manager', label: 'Manager', icon: Briefcase, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { role: 'Cashier', label: 'Cashier', icon: ShoppingCart, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
];

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

const METHOD_META: Record<LoginMethod, { title: string; subtitle: string }> = {
  password: { title: 'POS Terminal Sign In', subtitle: 'Enter your admin-generated User ID and Password.' },
  role_pin: { title: 'Sign In — Role & PIN', subtitle: 'Pick your position then enter your 4-digit PIN.' },
  pin: { title: 'Sign In — PIN', subtitle: 'Enter your 4-digit PIN. Your role is detected automatically.' },
  tap_only: { title: 'Tap to Open', subtitle: 'Tap your name to open the terminal. No PIN required.' },
};

export default function LoginScreen({ onLoginSuccess, settings, employees = [], loginMethod = 'password', isFirstRun = false, onRegister }: LoginScreenProps) {
  const auth = useAuth();
  const method: LoginMethod = ['password', 'role_pin', 'pin', 'tap_only'].includes(settings?.security?.loginMethod)
    ? (settings.security.loginMethod as LoginMethod)
    : loginMethod;

  // Two-option gate: when there is no owner/cache yet, ask whether this person
  // is an existing user (login) or a brand-new restaurant (register).
  const [view, setView] = useState<'choose' | 'login'>(isFirstRun ? 'choose' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // PIN / role state
  const [position, setPosition] = useState<Employee['role'] | null>(null);
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState('');

  // ── Legal consent gate (per-account, version-aware) ─────────────
  // Consent is recorded per-user in localStorage (device-level cache) AND
  // server-side via LegalAcceptanceGate. The localStorage flag is a UX
  // convenience that hides the checkbox when the same user has previously
  // accepted on this device. The REAL enforcement is server-side.
  //
  // Per-account: stored as JSON { [userId]: true } so Account A's
  // acceptance does NOT satisfy Account B.
  const getConsentMap = (): Record<string, boolean> => {
    try {
      const raw = localStorage.getItem('pos_legal_consent');
      if (!raw) return {};
      if (raw === '1') return { __legacy__: true }; // migrate old single-flag format
      return JSON.parse(raw);
    } catch { return {}; }
  };
  const isConsentedFor = (uid: string): boolean => {
    const map = getConsentMap();
    return !!map[uid] || !!map.__legacy__;
  };
  // Start with consent pending — will be resolved when username is entered
  const [consentPersisted, setConsentPersisted] = useState<boolean>(false);
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [consentError, setConsentError] = useState(false);

  // When username changes, re-evaluate consent state for that account
  const checkConsentForUsername = (u: string) => {
    if (u.trim() && isConsentedFor(u.trim().toLowerCase())) {
      setConsentPersisted(true);
      setAcceptedTerms(true);
    } else {
      setConsentPersisted(false);
      setAcceptedTerms(false);
    }
  };

  const toggleConsent = (checked: boolean) => {
    setAcceptedTerms(checked);
    setConsentError(false);
  };

  /** Persist per-account consent — called only once a sign-in actually succeeds. */
  const recordConsent = (uid: string) => {
    try {
      const map = getConsentMap();
      map[uid.toLowerCase()] = true;
      localStorage.setItem('pos_legal_consent', JSON.stringify(map));
    } catch { /* ignore */ }
    setConsentPersisted(true);
  };

  const openLegal = (doc: 'terms' | 'privacy') => {
    window.open(`legal/${doc}.html`, '_blank', 'noopener,noreferrer');
  };

  /** Lock every login path until legal consent is given. */
  const requireConsent = (): boolean => {
    if (acceptedTerms) return true;
    setConsentError(true);
    setLocalError('');
    return false;
  };

  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  // Load saved accounts on mount
  useEffect(() => {
    setSavedAccounts(getSavedAccounts());
  }, []);

  const handleSavedAccountClick = async (account: SavedAccount) => {
    setLocalError('');
    // Pre-fill username and check consent for this specific account
    setUsername(account.username);
    checkConsentForUsername(account.username);
    setView('login');
  };

  const handleRemoveSavedAccount = (e: React.MouseEvent, account: SavedAccount) => {
    e.stopPropagation();
    removeAccount(account.userId, account.restaurantId);
    setSavedAccounts(getSavedAccounts());
  };

  const visibleAccounts = showAllAccounts ? savedAccounts : savedAccounts.slice(0, 3);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'Active'),
    [employees],
  );
  const positionEmployees = useMemo(
    () => (position ? activeEmployees.filter((e) => normalizeRole(e.role) === position) : []),
    [activeEmployees, position],
  );

  const error = auth.error || localError;

  const handleKey = (key: string) => {
    setLocalError('');
    if (key === 'clear') { setPin(''); return; }
    if (key === 'back') { setPin((p) => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) verifyPinOffline(next);
  };

  const verifyPinOffline = (enteredPin: string) => {
    if (!requireConsent()) return;
    const pool = method === 'role_pin' ? positionEmployees : activeEmployees;
    const match = pool.find((e) => /^\d{4}$/.test(e.pin || '') && e.pin === enteredPin);
    if (match) {
      recordConsent(match.username || match.name);
      onLoginSuccess(match, enteredPin);
    } else {
      setLocalError(`Incorrect PIN. Try again.`);
      setPin('');
    }
  };

  const handleTapEmployee = (emp: Employee) => {
    if (!requireConsent()) return;
    recordConsent(emp.username || emp.name);
    onLoginSuccess(emp);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (!requireConsent()) return;
    setLocalError('');
    try {
      const result = await auth.login(username.trim(), password, false, 'password');
      if (result.employee) {
        recordConsent(username.trim());
        onLoginSuccess(result.employee, password);
      } else if (result.user) {
        // Restaurant/owner identity may not have an Employee — still open.
        recordConsent(username.trim());
        onLoginSuccess({
          id: result.user.id,
          name: result.user.name,
          role: result.user.role,
          username,
          status: 'active',
        }, /^\d{4}$/.test(password) ? password : undefined);
      }
    } catch { /* error handled by auth context */ }
  };

  return (
    <div id="login_screen_container" className="fixed inset-0 bg-[var(--color-bg-page)] text-[var(--color-text-primary)] flex flex-col font-sans">
      <div className="bg-[var(--color-sidebar-bg)] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[var(--color-sidebar-border)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2563eb]" />
          <span className="font-semibold tracking-wider">POS TERMINAL v1.0.0</span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <span className="text-[#2563eb]">● {method === 'tap_only' ? 'QUICK OPEN' : method === 'password' ? 'PASSWORD MODE' : 'PIN MODE'}</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[var(--color-bg-white)] rounded-xl shadow-lg overflow-hidden border border-[var(--color-border-default)]">
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[var(--brand-color)] text-white rounded-xl flex items-center justify-center font-bold text-xl mx-auto mb-4 shadow-md">
                {method === 'tap_only' ? <Fingerprint className="w-8 h-8" /> : <ShieldCheck className="w-8 h-8" />}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{METHOD_META[method].title}</h1>
              <p className="text-xs text-gray-500 mt-1">{METHOD_META[method].subtitle}</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* ── SAVED ACCOUNTS (quick switch) ── */}
            {view === 'login' && savedAccounts.length > 0 && !isFirstRun && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Continue as…</p>
                  {savedAccounts.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAccounts(!showAllAccounts)}
                      className="text-[10px] text-[var(--brand-color)] hover:underline cursor-pointer"
                    >
                      {showAllAccounts ? 'Show less' : `Show all (${savedAccounts.length})`}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {visibleAccounts.map((account) => (
                    <button
                      key={`${account.userId}-${account.restaurantId}`}
                      type="button"
                      onClick={() => handleSavedAccountClick(account)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-[var(--brand-color)] hover:bg-blue-50/50 transition-all cursor-pointer text-left group"
                    >
                      <span className="w-10 h-10 rounded-lg bg-[var(--brand-color)]/10 text-[var(--brand-color)] font-bold flex items-center justify-center text-sm shrink-0">
                        {account.displayName ? account.displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() : '👤'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-gray-900 truncate">{account.displayName}</span>
                        <span className="block text-[10px] text-gray-400 truncate">{account.restaurantName} · {account.username} · {normalizeRole(account.role)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleRemoveSavedAccount(e, account)}
                          className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Remove saved account"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[var(--brand-color)]" />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="my-3 border-t border-gray-100" />
              </div>
            )}

            {/* ── TWO-OPTION CHOOSER (first run — no cached login) ── */}
            {view === 'choose' && isFirstRun && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p className="text-xs text-gray-500">How would you like to continue?</p>
                </div>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="w-full p-5 rounded-xl border-2 border-[var(--brand-color)] bg-blue-50/50 hover:bg-blue-50 hover:shadow-md transition-all cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-lg bg-[var(--brand-color)]/10 text-[var(--brand-color)] flex items-center justify-center">
                      <LogIn className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="font-bold text-sm text-[var(--color-text-primary)]">Existing User</p>
                      <p className="text-[11px] text-gray-500">I already have a User ID & Password</p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={onRegister}
                  className="w-full p-5 rounded-xl border-2 border-gray-200 hover:border-[var(--brand-color)] hover:shadow-md transition-all cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                      <Crown className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="font-bold text-sm text-[var(--color-text-primary)]">New Restaurant</p>
                      <p className="text-[11px] text-gray-500">I'm new here — register my restaurant</p>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* ── PASSWORD MODE ── */}
            {view === 'login' && method === 'password' && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">User ID / Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); checkConsentForUsername(e.target.value); }}
                      placeholder="e.g. owner_ratjs_s6uj"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--color-border-input)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] text-sm font-mono"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#c3c6d3] focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] font-mono text-sm"
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
                {/* ── Legal consent (required only on a new device) ── */}
                {!consentPersisted && (
                  <>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => toggleConsent(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[var(--brand-color)] cursor-pointer"
                        aria-invalid={consentError}
                      />
                      <span className="text-xs text-gray-600 leading-snug">
                        I agree to the{' '}
                        <button type="button" onClick={() => openLegal('terms')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Terms &amp; Conditions
                        </button>{' '}
                        and{' '}
                        <button type="button" onClick={() => openLegal('privacy')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Privacy Policy
                        </button>
                      </span>
                    </label>
                    {consentError && !acceptedTerms && (
                      <p className="text-xs text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Please accept the Terms &amp; Conditions and Privacy Policy to sign in.
                      </p>
                    )}
                  </>
                )}
                <button
                  type="submit"
                  disabled={auth.isLoading || !acceptedTerms}
                  className="w-full bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-lg font-semibold text-sm transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {auth.isLoading ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Authenticating...</>
                  ) : (
                    <><LogIn className="w-4 h-4" /> Sign In to POS</>
                  )}
                </button>
              </form>
            )}

            {/* ── ROLE + PIN / PIN ONLY ── */}
            {view === 'login' && (method === 'role_pin' || method === 'pin') && (
              <div className="space-y-4">
                {method === 'role_pin' && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Select Position</p>
                    <div className="grid grid-cols-3 gap-2">
                      {POSITIONS.map(({ role, label, icon: Icon, color }) => {
                        const count = activeEmployees.filter((e) => normalizeRole(e.role) === role).length;
                        const selected = position === role;
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => { setPosition(role); setPin(''); setLocalError(''); }}
                            className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all cursor-pointer ${selected ? 'border-[var(--brand-color)] bg-blue-50 shadow-md' : 'border-gray-200 bg-[var(--color-bg-white)] hover:border-gray-300 hover:bg-gray-50'}`}
                          >
                            <span className={`p-2 rounded-lg border ${color}`}><Icon className="w-5 h-5" /></span>
                            <span className={`text-[11px] font-bold ${selected ? 'text-[var(--brand-color)]' : 'text-gray-700'}`}>{label}</span>
                            <span className="text-[9px] text-gray-400">{count} active</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {positionEmployees.length === 0 && (
                  <p className="text-[10px] text-amber-600 font-semibold">
                    {method === 'role_pin'
                      ? 'No active staff for this position with a 4-digit PIN. Add them in Settings → Staff first.'
                      : 'No active staff with a 4-digit PIN. Enable PIN login in the Sign-in settings or add staff in Settings → Staff.'}
                  </p>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Enter 4-Digit PIN</p>
                  <div className="flex items-center justify-center gap-3 py-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`w-11 h-12 rounded-xl border-2 flex items-center justify-center transition-all ${pin.length > i ? 'border-[var(--brand-color)] bg-blue-50' : 'border-gray-200 bg-[var(--color-bg-white)]'}`}>
                        {pin.length > i && <span className="w-3 h-3 rounded-full bg-[var(--brand-color)]" />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {KEYPAD.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleKey(key)}
                      className={`h-12 rounded-xl text-lg font-bold transition-all cursor-pointer select-none ${key === 'clear' ? 'bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px]' : key === 'back' ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : 'bg-[var(--color-primary-light)] hover:bg-[var(--color-surface-muted)] text-gray-900'}`}
                    >
                      {key === 'clear' ? 'CLR' : key === 'back' ? <Delete className="w-5 h-5 mx-auto" /> : key}
                    </button>
                  ))}
                </div>

                {/* Legal consent — required only on a new device */}
                {!consentPersisted && (
                  <>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => toggleConsent(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[var(--brand-color)] cursor-pointer"
                      />
                      <span className="text-xs text-gray-600 leading-snug">
                        I agree to the{' '}
                        <button type="button" onClick={() => openLegal('terms')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Terms &amp; Conditions
                        </button>{' '}
                        and{' '}
                        <button type="button" onClick={() => openLegal('privacy')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Privacy Policy
                        </button>
                      </span>
                    </label>
                    {consentError && !acceptedTerms && (
                      <p className="text-xs text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Please accept the Terms &amp; Conditions and Privacy Policy to sign in.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── TAP TO OPEN ── */}
            {view === 'login' && method === 'tap_only' && (
              <div className="space-y-3">
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {activeEmployees.length === 0 && (
                    <p className="text-xs text-amber-600 font-semibold text-center">No active staff found. Tap-to-open requires staff added in Settings → Staff.</p>
                  )}
                  {activeEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => handleTapEmployee(emp)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-[var(--brand-color)] hover:bg-blue-50 transition-all cursor-pointer text-left"
                    >
                      <span className="w-9 h-9 rounded-lg bg-[var(--brand-color)]/10 text-[var(--brand-color)] font-bold flex items-center justify-center text-sm">
                        {emp.name ? emp.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '?'}
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-gray-900">{emp.name}</span>
                        <span className="block text-[10px] text-gray-400">{normalizeRole(emp.role)}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {/* Legal consent — required only on a new device */}
                {!consentPersisted && (
                  <>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => toggleConsent(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[var(--brand-color)] cursor-pointer"
                      />
                      <span className="text-xs text-gray-600 leading-snug">
                        I agree to the{' '}
                        <button type="button" onClick={() => openLegal('terms')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Terms &amp; Conditions
                        </button>{' '}
                        and{' '}
                        <button type="button" onClick={() => openLegal('privacy')} className="underline text-[var(--brand-color)] hover:opacity-80 cursor-pointer font-medium">
                          Privacy Policy
                        </button>
                      </span>
                    </label>
                    {consentError && !acceptedTerms && (
                      <p className="text-xs text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Please accept the Terms &amp; Conditions and Privacy Policy to sign in.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Register option — always available on the sign-in screen.
                Leads to the isolated FirstTimeSetup registration screen. */}
            {view === 'login' && onRegister && (
              <div className="mt-5 pt-4 border-t border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 mb-2">Don't have an account? Register your restaurant to become the Owner.</p>
                <button
                  type="button"
                  onClick={onRegister}
                  className="w-full border border-[var(--brand-color)] text-[var(--brand-color)] py-2.5 rounded-lg font-semibold text-xs hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  Register now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-[var(--color-bg-white)] text-gray-500 text-center py-4 text-xs border-t border-[var(--color-border-default)]">
        POS Terminal — Secure Access. Press <strong className="text-gray-700">F11</strong> for Fullscreen.
      </div>
    </div>
  );
}
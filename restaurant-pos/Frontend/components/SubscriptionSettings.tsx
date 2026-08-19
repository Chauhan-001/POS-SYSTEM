import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, AlertTriangle, CheckCircle, Clock, Shield, Layers, Calendar, Smartphone, FileText, ArrowRight, Loader, Crown, RefreshCw, Users, Building2, BadgeCheck, Receipt } from 'lucide-react';
import * as api from '../src/api/client';

interface Plan {
  _id: string;
  planId: string;
  name: string;
  description: string;
  price: number;
  maxUsers: number;
  maxDevices: number;
  features: string[];
  aiEnabled: boolean;
  trialDays: number;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  limits?: {
    maxBranches: number;
    maxDevicesPerBranch: number;
  };
}

interface SubscriptionStatus {
  restaurantId: string;
  restaurantName: string;
  plan: string;
  status: 'trial' | 'active' | 'grace' | 'suspended';
  trialStart: string | null;
  trialEnd: string | null;
  subscriptionStart: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  graceEnd: string | null;
  maxDevices: number;
  currentDevices: number;
  features: string[];
  limits?: {
    maxBranches: number;
    maxDevicesPerBranch: number;
  };
  branchUsage?: {
    totalBranches: number;
    activeBranches: number;
    remainingBranches: number | string;
  };
}

interface BranchUsageResponse {
  plan: string;
  maxBranches: number;
  usage: {
    totalBranches: number;
    activeBranches: number;
    remainingBranches: number | string;
  };
  branches: Array<{
    id: string;
    name: string;
    status: string;
    isHeadBranch: boolean;
    employees: number;
    tables: number;
  }>;
}

interface HistoryItem {
  payments: any[];
  invoices: any[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  trial: { label: 'Trial', color: 'text-blue-600', bg: 'bg-[var(--color-blue-500-solid)]', icon: <Clock className="w-4 h-4" /> },
  active: { label: 'Active', color: 'text-emerald-600', bg: 'bg-[var(--color-emerald-500-solid)]', icon: <CheckCircle className="w-4 h-4" /> },
  grace: { label: 'Grace Period', color: 'text-amber-600', bg: 'bg-[var(--color-amber-500-solid)]', icon: <AlertTriangle className="w-4 h-4" /> },
  suspended: { label: 'Suspended', color: 'text-red-600', bg: 'bg-[var(--color-red-500-solid)]', icon: <Shield className="w-4 h-4" /> },
};

const FEATURE_LABELS: Record<string, string> = {
  core_pos: 'Core POS',
  basic_reports: 'Basic Reports',
  advanced_reports: 'Advanced Reports',
  table_service: 'Table Service',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  qr_ordering: 'QR Ordering',
  kitchen_display: 'Kitchen Display',
  products: 'Products',
  staff: 'Staff',
  discounts: 'Discounts',
  guest_checkout: 'Guest Checkout',
  order_notes: 'Order Notes',
  offers: 'Offers',
  loyalty: 'Loyalty',
  reservations: 'Reservations',
  inventory: 'Inventory',
  expense_tracking: 'Expense Tracking',
  analytics: 'Analytics',
  ai: 'AI Insights',
  custom_branding: 'Custom Branding',
  api_access: 'API Access',
  priority_support: 'Priority Support',
  multi_branch: 'Multi-Branch',
  crm: 'CRM',
  finance: 'Finance',
  multi_device: 'Multi Device',
  offline_mode: 'Offline Mode',
  customer_display: 'Customer Display',
  marketing: 'Marketing',
  integrations: 'Integrations',
  online_ordering: 'Online Ordering',
  waiter_management: 'Waiter Management',
  voice_ordering: 'Voice Ordering',
  dedicated_manager: 'Dedicated Manager',
};

function featureLabel(f: string): string {
  if (FEATURE_LABELS[f]) return FEATURE_LABELS[f];
  return f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function getOfflineSub(): SubscriptionStatus | null {
  try {
    // Per-restaurant namespaced key — switching accounts never reads another
    // restaurant's cached subscription data (e.g. stale trial features).
    const cached = localStorage.getItem(api.getSubscriptionCacheKeys().cache);
    if (cached) {
      const parsed = JSON.parse(cached);
      const age = Date.now() - (parsed._cachedAt || 0);
      // Use cache for up to 15 minutes
      if (age < 15 * 60 * 1000) {
        delete parsed._cachedAt;
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function setOfflineSub(data: SubscriptionStatus) {
  try {
    localStorage.setItem(api.getSubscriptionCacheKeys().cache, JSON.stringify({ ...data, _cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

function getOfflinePlans(): Plan[] | null {
  try {
    const cached = localStorage.getItem(api.getSubscriptionCacheKeys().plans);
    if (cached) {
      const parsed = JSON.parse(cached);
      const age = Date.now() - (parsed?._cachedAt || 0);
      if (Array.isArray(parsed?.plans) && age < 15 * 60 * 1000) {
        return parsed.plans;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function setOfflinePlans(plans: Plan[]) {
  try {
    localStorage.setItem(api.getSubscriptionCacheKeys().plans, JSON.stringify({ plans, _cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

export default function SubscriptionSettings() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [history, setHistory] = useState<HistoryItem | null>(null);
  const [branchUsage, setBranchUsage] = useState<BranchUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const plansRef = useRef<HTMLDivElement>(null);

  const scrollToPlans = () => {
    plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    loadRazorpayScript().then(setRazorpayReady);
  }, []);

  useEffect(() => {
    // Load cached subscription data immediately for offline-first
    const cached = getOfflineSub();
    if (cached) {
      setSubscription(cached);
    }
    const cachedPlans = getOfflinePlans();
    if (cachedPlans) {
      setPlans(cachedPlans);
    }
    loadData();
  }, []);

  async function loadData() {
    setError(null);
    setSessionError(false);
    // Status is fetched with HTTP-status awareness so an expired session (401)
    // or unreachable server surfaces a clear message instead of a blank card.
    // The remaining sections load independently — a single failure never blanks
    // the whole page (`get()` silently returns null on HTTP/network errors).
    const [statusDetail, plansData, historyData, branchUsageData] = await Promise.allSettled([
      api.fetchSubscriptionStatusDetailed(),
      api.fetchPlans(),
      api.fetchSubscriptionHistory(),
      api.fetchBranchUsage(),
    ]);

    let failed = 0;
    let sessionExpired = false;

    if (statusDetail.status === 'fulfilled' && statusDetail.value) {
      const { data, httpStatus, ok } = statusDetail.value;
      console.log('Fetched subscription status:', { data, httpStatus, ok });
      if (ok && data) {
        setSubscription(data);
        setOfflineSub(data);
      } else if (httpStatus === 401) {
        // Live call returned 401 even after the client's auto token-refresh.
        sessionExpired = true;
      } else {
        console.error('Failed to fetch subscription status', statusDetail.value);
        failed++;
      }
    } else {
      console.error('Failed to fetch subscription status', statusDetail);
      failed++;
    }

    if (plansData.status === 'fulfilled' && plansData.value) {
      console.log('Fetched plans:', plansData.value);
      setPlans(plansData.value);
      setOfflinePlans(plansData.value);
    } else {
      console.error('Failed to fetch plans', plansData);
      failed++;
    }
    if (historyData.status === 'fulfilled' && historyData.value) setHistory(historyData.value); else failed++;
    if (branchUsageData.status === 'fulfilled' && branchUsageData.value) setBranchUsage(branchUsageData.value); else failed++;

    setLoading(false);
    if (sessionExpired) {
      setSessionError(true);
    } else if (failed === 4) {
      setError('Failed to load subscription data. Check that the server is running and your session is active, then retry.');
    } else if (failed > 0) {
      // Partial failure — keep showing what loaded but surface a hint.
      console.warn('[SubscriptionSettings] One or more subscription sections failed to load.');
    }
  }

  async function handleSubscribe(planId: string) {
    if (!razorpayReady) {
      const loaded = await loadRazorpayScript();
      if (!loaded) { setError('Failed to load payment gateway'); return; }
    }

    setProcessing(true);
    setError(null);
    try {
      const order = await api.createSubscriptionOrder(planId);
      if (!order || !order.orderId) {
        setError('Failed to create payment order');
        setProcessing(false);
        return;
      }

      if (!order.keyId) {
        setError('Payment gateway configuration error: missing API key. Contact support.');
        setProcessing(false);
        return;
      }

      const options: any = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: subscription?.restaurantName || 'Restaurant',
        description: `Subscription - ${planId}`,
        order_id: order.orderId,
        handler: async (response: any) => {
          try {
            const result = await api.verifyPayment({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });
            if (result?.success) {
              await loadData();
            } else {
              setError('Payment verification failed');
            }
          } catch {
            setError('Payment verification failed');
          } finally {
            setProcessing(false);
          }
        },
        modal: {
          ondismiss: () => setProcessing(false),
        },
        prefill: {
          contact: '',
          email: '',
        },
        theme: { color: '#004ac6' },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch {
      setError('Failed to initiate payment');
      setProcessing(false);
    }
  }

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function daysRemaining(dateStr: string | null | undefined): number {
    if (!dateStr) return 0;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-6 h-6 animate-spin text-[var(--brand-color)]" />
        <span className="ml-3 text-sm text-gray-500">Loading subscription data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={loadData} className="mt-3 text-xs text-[var(--brand-color)] hover:underline cursor-pointer">Retry</button>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-[var(--color-text-primary)]">Session expired</p>
          <p className="text-xs text-gray-500 mt-1">
            The server says your login session is no longer valid. Please log out and log back in to refresh your session, then retry.
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button onClick={loadData} className="text-xs text-[var(--brand-color)] hover:underline cursor-pointer">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const statusConfig = subscription ? STATUS_CONFIG[subscription.status] || STATUS_CONFIG.trial : STATUS_CONFIG.trial;
  const currentPlan = plans.find(p => p.planId === subscription?.plan);
  const planName = currentPlan ? currentPlan.name : (subscription?.plan || 'N/A');
  const branchData = branchUsage?.usage || subscription?.branchUsage;
  const maxBranches = branchUsage?.maxBranches ?? subscription?.limits?.maxBranches ?? 0;
  const totalBranches = branchData?.totalBranches ?? 0;
  const daysLeft = daysRemaining(subscription?.expiryDate || subscription?.trialEnd);
  const sortedPlans = [...plans].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const allFeatures = Array.from(new Set(sortedPlans.flatMap((p) => p.features)));
  const expiryLabel = subscription?.renewalDate ? formatDate(subscription.renewalDate) : formatDate(subscription?.trialEnd || subscription?.expiryDate);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-color)] to-[#7c3aed] flex items-center justify-center shadow-md shadow-blue-200">
            <Crown className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900 leading-tight">Subscription</h2>
            <p className="text-xs text-gray-500">Manage your plan and billing information.</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* ── Status Card ── */}
      {subscription && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-sm overflow-hidden">
          {/* Plan banner — clickable: scrolls to available plans */}
          <div
            role="button"
            tabIndex={0}
            onClick={scrollToPlans}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToPlans(); } }}
            title="Scroll to available plans"
            className="relative bg-gradient-to-r from-[#0b1b3a] via-[#12275c] to-[#1e3a8a] px-6 py-5 text-white overflow-hidden cursor-pointer group transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <div className="absolute -right-8 -top-10 w-48 h-48 rounded-full bg-white/5" />
            <div className="absolute -right-2 top-6 w-24 h-24 rounded-full bg-white/5" />
            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl ${statusConfig.bg} flex items-center justify-center shadow-lg`}>
                  {statusConfig.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black tracking-tight">{planName}</h3>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-wider">
                      <BadgeCheck className="w-3 h-3" /> {statusConfig.label}
                    </span>
                  </div>
                  <p className="text-xs text-blue-200 mt-0.5 flex items-center gap-1.5">
                    <Building2 className="w-3 h-3" /> {subscription.restaurantName}
                    {subscription.status === 'trial' ? (
                      <span className="text-emerald-300">· Free trial — {daysLeft} days left</span>
                    ) : currentPlan ? (
                      <span className="text-blue-300">· ₹{Number(currentPlan.price || 0).toLocaleString('en-IN')}/month</span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold">Renews</p>
                <p className="text-sm font-bold">{expiryLabel}</p>
                {daysLeft > 0 && (
                  <p className="text-[10px] text-amber-300 font-semibold mt-0.5">{daysLeft} days remaining</p>
                )}
              </div>
              <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-[10px] font-bold uppercase tracking-wider transition-colors group-hover:bg-white/20">
                View Plans <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Plans Grid ── */}
      <div ref={plansRef} className="scroll-mt-4">
        {/* Current usage summary strip */}
        {subscription && (
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100">
              <Smartphone className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Devices / Branch</span>
              <span className="text-xs font-black text-gray-900">
                {subscription.currentDevices}
                <span className="text-gray-400 font-semibold">/{subscription.limits?.maxDevicesPerBranch ?? subscription.maxDevices ?? 3}</span>
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100">
              <Users className="w-3.5 h-3.5 text-violet-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Branches</span>
              <span className="text-xs font-black text-gray-900">
                {totalBranches}
                {maxBranches > 0 && <span className="text-gray-400 font-semibold">/{maxBranches}</span>}
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-100">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Days Left</span>
              <span className="text-xs font-black text-gray-900">{daysLeft}</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-[var(--brand-color)] to-[#7c3aed]" />
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Available Plans</h3>
        </div>
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 text-left py-4 pl-6 pr-4 text-[10px] uppercase tracking-wider text-gray-400 font-bold bg-gray-50 border-b border-gray-100">
                    Features
                  </th>
                  {sortedPlans.map((plan) => {
                    const isCurrentPlan = subscription?.plan === plan.planId;
                    return (
                      <th
                        key={plan.planId}
                        className={`px-4 py-4 border-b border-gray-100 text-left align-top ${isCurrentPlan ? 'bg-blue-50/70' : 'bg-[var(--color-bg-white)]'}`}
                      >
                        <div className={`flex flex-col gap-1.5 ${isCurrentPlan ? 'rounded-xl border border-[var(--brand-color)]/25 ring-2 ring-[var(--brand-color)]/10 px-3 py-3 -mx-1 bg-blue-50/40' : ''}`}>
                          {isCurrentPlan && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-[var(--brand-color)] to-[#7c3aed] text-white text-[9px] font-black uppercase tracking-wider shadow-sm self-start">
                              <Crown className="w-3 h-3" /> {subscription?.status === 'trial' ? 'Trial Active' : 'Current Plan'}
                            </span>
                          )}
                          <h4 className="text-sm font-black text-gray-900 leading-tight">{plan.name}</h4>
                          <div className="flex items-baseline gap-1">
                            {subscription?.status === 'trial' && plan.price === 0 ? (
                              <span className="text-xl font-black text-emerald-600 tracking-tight">Free trial</span>
                            ) : (
                              <>
                                <span className="text-xl font-black text-gray-900 tracking-tight">
                                  ₹{Number(plan.price || 0).toLocaleString('en-IN')}
                                </span>
                                <span className="text-[11px] text-gray-400 font-medium">/month</span>
                              </>
                            )}
                          </div>
                          {plan.price === 0 && (
                            <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-bold self-start">Starter</span>
                          )}
                          <button
                            onClick={() => handleSubscribe(plan.planId)}
                            disabled={isCurrentPlan || processing}
                            className={`mt-2 w-full py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                              isCurrentPlan
                                ? 'bg-gray-100 text-gray-400'
                                : 'bg-gradient-to-r from-[var(--brand-color)] to-[#7c3aed] text-white hover:opacity-90 hover:shadow-md hover:shadow-blue-200'
                            }`}
                          >
                            {processing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : isCurrentPlan ? (subscription?.status === 'trial' ? 'Trial Active' : 'Current Plan') : (
                              <>
                                Upgrade Plan <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sticky left-0 z-10 py-3 pl-6 pr-4 text-xs font-bold text-gray-700 bg-gray-50 border-b border-gray-100">
                    Max Devices per Branch
                  </td>
                  {sortedPlans.map((plan) => {
                    const isCurrentPlan = subscription?.plan === plan.planId;
                    return (
                      <td key={plan.planId} className={`px-4 py-3 text-xs font-bold text-gray-900 border-b border-gray-100 ${isCurrentPlan ? 'bg-blue-50/40' : 'bg-[var(--color-bg-white)]'}`}>
                        {(() => { const d = plan.limits?.maxDevicesPerBranch ?? plan.maxDevices ?? 3; return d > 0 ? d : 'Unlimited'; })()}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 py-3 pl-6 pr-4 text-xs font-bold text-gray-700 bg-gray-50 border-b border-gray-100">
                    Max Users
                  </td>
                  {sortedPlans.map((plan) => {
                    const isCurrentPlan = subscription?.plan === plan.planId;
                    return (
                      <td key={plan.planId} className={`px-4 py-3 text-xs font-bold text-gray-900 border-b border-gray-100 ${isCurrentPlan ? 'bg-blue-50/40' : 'bg-[var(--color-bg-white)]'}`}>
                        {plan.maxUsers > 0 ? plan.maxUsers : 'Unlimited'}
                      </td>
                    );
                  })}
                </tr>
                {allFeatures.map((f) => (
                  <tr key={f}>
                    <td className="sticky left-0 z-10 py-2.5 pl-6 pr-4 text-[13px] text-gray-700 font-medium bg-gray-50 border-b border-gray-100">
                      {featureLabel(f)}
                    </td>
                    {sortedPlans.map((plan) => {
                      const isCurrentPlan = subscription?.plan === plan.planId;
                      const has = plan.features.includes(f);
                      return (
                        <td key={plan.planId} className={`px-4 py-2.5 border-b border-gray-100 ${isCurrentPlan ? 'bg-blue-50/40' : 'bg-[var(--color-bg-white)]'}`}>
                          {has ? (
                            <CheckCircle className={`w-4 h-4 ${isCurrentPlan ? 'text-[var(--brand-color)]' : 'text-emerald-500'}`} />
                          ) : (
                            <span className="text-gray-300 font-bold">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── Payment History ── */}
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-[var(--brand-color)]" />
          </div>
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Payment History</h3>
        </div>
        {history && history.payments.length > 0 ? (
          <>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 text-[10px] uppercase tracking-wider text-gray-400 font-bold">Date</th>
                    <th className="text-left py-3 text-[10px] uppercase tracking-wider text-gray-400 font-bold">Invoice</th>
                    <th className="text-left py-3 text-[10px] uppercase tracking-wider text-gray-400 font-bold">Method</th>
                    <th className="text-left py-3 text-[10px] uppercase tracking-wider text-gray-400 font-bold">Amount</th>
                    <th className="text-right py-3 text-[10px] uppercase tracking-wider text-gray-400 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(showAllPayments ? history.payments : history.payments.slice(0, 5)).map((p: any) => {
                    const isCash = p.gateway === 'cash' || p.paymentMethod === 'cash';
                    return (
                      <tr key={p._id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-3.5 text-gray-900 font-medium">{formatDate(p.createdAt)}</td>
                        <td className="py-3.5 text-gray-500">{p.invoiceNumber || '-'}</td>
                        <td className="py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                            isCash ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {isCash ? 'Cash' : 'Online'}
                          </span>
                        </td>
                        <td className="py-3.5 font-bold text-gray-900">₹{Number(p.amount || 0).toLocaleString('en-IN')}</td>
                        <td className="py-3.5 text-right">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                            p.status === 'success' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
                          }`}>
                            {p.status === 'success' && <CheckCircle className="w-3 h-3" />}
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {history.payments.length > 5 && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => setShowAllPayments((s) => !s)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 bg-[var(--color-bg-white)] text-xs font-bold text-[var(--brand-color)] hover:bg-blue-50 hover:border-blue-200 shadow-sm transition-all cursor-pointer"
                >
                  {showAllPayments ? 'Show Less' : `See More (${history.payments.length - 5} more)`}
                  <ArrowRight className={`w-3.5 h-3.5 transition-transform ${showAllPayments ? 'rotate-90' : ''}`} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-10">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No payment history found.</p>
          </div>
        )}
      </div>
    </div>
  );
}

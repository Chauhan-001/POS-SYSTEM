import React, { useState, useEffect } from 'react';
import { CreditCard, AlertTriangle, CheckCircle, Clock, Zap, Shield, Layers, Calendar, Smartphone, FileText, ArrowRight, Loader, Wallet } from 'lucide-react';
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
    maxDevices: number;
    maxEmployees: number;
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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  trial: { label: 'Trial', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: <Clock className="w-4 h-4" /> },
  active: { label: 'Active', color: 'text-green-600 bg-green-50 border-green-200', icon: <CheckCircle className="w-4 h-4" /> },
  grace: { label: 'Grace Period', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: <AlertTriangle className="w-4 h-4" /> },
  suspended: { label: 'Suspended', color: 'text-red-600 bg-red-50 border-red-200', icon: <Shield className="w-4 h-4" /> },
};

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
  const [error, setError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [manualRenewProcessing, setManualRenewProcessing] = useState(false);
  const [manualRenewResult, setManualRenewResult] = useState<{ invoiceNumber: string; amount: number } | null>(null);

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

  async function handleManualRenew() {
    setManualRenewProcessing(true);
    setError(null);
    try {
      const result = await api.manualRenewSubscription({
        amount: plans.find(p => p.planId === subscription?.plan)?.price || 499,
        notes: 'Cash payment recorded from POS',
        paymentMethod: 'cash',
      });
      if (result && result.invoiceNumber) {
        setManualRenewResult({ invoiceNumber: result.invoiceNumber, amount: result.amount });
        await loadData();
      } else {
        setError('Failed to record payment. Please try again.');
      }
    } catch {
      setError('Failed to process manual renewal');
    } finally {
      setManualRenewProcessing(false);
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
          <p className="text-sm font-bold text-[#191b23]">Session expired</p>
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

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-gray-50 p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Subscription</h2>
          <p className="text-sm text-gray-500">Manage your plan and billing information.</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
        >
          <Loader className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Status Card ── */}
      {subscription && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${statusConfig.color.split(' ')[1]}`}>
                {statusConfig.icon}
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{planName}</h3>
                <p className="text-sm text-gray-500">{subscription.restaurantName}</p>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Devices Used</p>
              <div className="flex items-end gap-2">
                <p className="text-2xl font-bold text-gray-900">{subscription.currentDevices}</p>
                <p className="text-sm text-gray-500 mb-1">/ {subscription.maxDevices}</p>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
                <div 
                  className="h-full bg-blue-600 rounded-full" 
                  style={{ width: `${Math.min(100, (subscription.currentDevices / subscription.maxDevices) * 100)}%` }} 
                />
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Expires On</p>
              <p className="text-lg font-bold text-gray-900">{formatDate(subscription.trialEnd || subscription.expiryDate)}</p>
              <p className="text-xs text-gray-500">{daysRemaining(subscription.trialEnd || subscription.expiryDate)} days remaining</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Next Renewal</p>
              <p className="text-lg font-bold text-gray-900">{formatDate(subscription.renewalDate)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Plans Grid ── */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Available Plans</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {plans.map((plan) => {
            const isCurrentPlan = subscription?.plan === plan.planId;
            return (
              <div key={plan.planId} className={`bg-white rounded-2xl border ${isCurrentPlan ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'} p-6 shadow-sm`}>
                <h4 className="text-lg font-bold text-gray-900">{plan.name}</h4>
                <p className="text-sm text-gray-500 mt-1 mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-bold text-gray-900">₹{plan.price}</span>
                  <span className="text-sm text-gray-500">/month</span>
                </div>
                <ul className="space-y-3 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      {f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan.planId)}
                  disabled={isCurrentPlan}
                  className={`w-full py-3 rounded-xl font-bold transition ${isCurrentPlan ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'} cursor-pointer`}
                >
                  {isCurrentPlan ? 'Current Plan' : 'Upgrade Plan'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Payment History ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Payment History</h3>
        {history && history.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left py-3">Date</th>
                  <th className="text-left py-3">Invoice</th>
                  <th className="text-left py-3">Amount</th>
                  <th className="text-right py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.payments.map((p: any) => (
                  <tr key={p._id}>
                    <td className="py-3 text-gray-900">{formatDate(p.createdAt)}</td>
                    <td className="py-3 text-gray-600">{p.invoiceNumber || '-'}</td>
                    <td className="py-3 font-semibold text-gray-900">₹{p.amount}</td>
                    <td className="py-3 text-right">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        p.status === 'success' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No payment history found.</p>
        )}
      </div>
    </div>
  );
}
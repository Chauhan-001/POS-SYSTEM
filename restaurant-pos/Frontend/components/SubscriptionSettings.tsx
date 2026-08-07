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

export default function SubscriptionSettings() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [history, setHistory] = useState<HistoryItem | null>(null);
  const [branchUsage, setBranchUsage] = useState<BranchUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    loadData();
  }, []);

  async function loadData() {
    setError(null);
    try {
      const [plansData, statusData, historyData, branchUsageData] = await Promise.all([
        api.fetchPlans(),
        api.fetchSubscriptionStatus(),
        api.fetchSubscriptionHistory(),
        api.fetchBranchUsage(),
      ]);
      if (plansData) setPlans(plansData);
      if (statusData) {
        setSubscription(statusData);
        setOfflineSub(statusData);
      }
      if (historyData) setHistory(historyData);
      if (branchUsageData) setBranchUsage(branchUsageData);
    } catch (err) {
      if (!subscription) {
        setError('Failed to load subscription data');
      }
    } finally {
      setLoading(false);
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
        <Loader className="w-6 h-6 animate-spin text-[#004ac6]" />
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
          <button onClick={loadData} className="mt-3 text-xs text-[#004ac6] hover:underline cursor-pointer">Retry</button>
        </div>
      </div>
    );
  }

  const statusConfig = subscription ? STATUS_CONFIG[subscription.status] || STATUS_CONFIG.trial : STATUS_CONFIG.trial;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 space-y-6 pr-2 pb-6">
      {/* Current Subscription Status Card */}
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[#191b23]">Subscription Status</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{subscription?.restaurantName}</p>
          </div>
          <div className="flex items-center gap-2">
            {subscription && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${statusConfig.color}`}>
                {statusConfig.icon}
                {statusConfig.label}
              </span>
            )}
            <button
              onClick={loadData}
              className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
              title="Refresh Status"
            >
              <Loader className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {subscription && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Plan</p>
              <p className="text-sm font-bold text-[#191b23] mt-0.5 capitalize">{subscription.plan}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Devices</p>
              <p className="text-sm font-bold text-[#191b23] mt-0.5">{subscription.currentDevices} / {subscription.maxDevices}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
                {subscription.status === 'trial' ? 'Trial Ends' : 'Expires'}
              </p>
              <p className="text-sm font-bold text-[#191b23] mt-0.5">
                {formatDate(subscription.trialEnd || subscription.expiryDate)}
                {subscription.status !== 'suspended' && daysRemaining(subscription.trialEnd || subscription.expiryDate) > 0 && (
                  <span className="text-[10px] text-gray-400 font-normal ml-1">({daysRemaining(subscription.trialEnd || subscription.expiryDate)}d left)</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Renewal</p>
              <p className="text-sm font-bold text-[#191b23] mt-0.5">{formatDate(subscription.renewalDate)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Branch Usage Card */}
      {branchUsage && (
        <div className="bg-white rounded-xl border border-[#e1e2ed] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[#191b23]">Branch Usage</h3>
            <span className="text-xs text-gray-400">{branchUsage.plan}</span>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400 uppercase font-semibold">
                  {branchUsage.usage.totalBranches} / {branchUsage.maxBranches === 0 ? 'Unlimited' : branchUsage.maxBranches} Branches
                </span>
                <span className="text-xs font-bold text-[#191b23]">
                  {typeof branchUsage.usage.remainingBranches === 'number' 
                    ? `${branchUsage.usage.remainingBranches} remaining` 
                    : branchUsage.usage.remainingBranches}
                </span>
              </div>
              {branchUsage.maxBranches > 0 && (
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (branchUsage.usage.totalBranches / branchUsage.maxBranches) * 100)}%`,
                      backgroundColor: branchUsage.usage.totalBranches >= branchUsage.maxBranches ? '#ef4444' : '#22c55e'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {branchUsage.branches.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between py-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: b.status === 'active' ? '#22c55e' : '#9ca3af' }} />
                  <span className="font-medium text-[#191b23]">{b.name}</span>
                  {b.isHeadBranch && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-700">HEAD</span>}
                </div>
                <span className="text-gray-400">{b.employees} emp · {b.tables} tbl</span>
              </div>
            ))}
          </div>
          {branchUsage.maxBranches > 0 && branchUsage.usage.totalBranches >= branchUsage.maxBranches && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <span className="font-bold">Branch limit reached.</span> Upgrade your plan to create more branches.
            </div>
          )}
        </div>
      )}

      {/* Grace / Suspended Warnings */}
      {subscription?.status === 'grace' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">Grace Period Active</p>
            <p className="text-xs text-amber-700 mt-1">
              Your subscription expired. Renew now to avoid suspension.
              {subscription.graceEnd && ` Grace ends ${formatDate(subscription.graceEnd)}.`}
            </p>
          </div>
        </div>
      )}
      {subscription?.status === 'suspended' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">Subscription Suspended</p>
            <p className="text-xs text-red-700 mt-1">
              Your subscription has been suspended. Renew now to restore full access.
            </p>
          </div>
        </div>
      )}

      {/* Manual Renew Section — shown when subscription needs renewal */}
      {(subscription?.status === 'suspended' || subscription?.status === 'grace') && (
        <div className="bg-white rounded-xl border border-[#e1e2ed] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#004ac6]" />
              <h3 className="text-sm font-bold text-[#191b23]">Pay Offline (Cash / Bank)</h3>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            If you've made a payment outside the online gateway, click below to record it and instantly reactivate your subscription. An invoice will be generated for your records.
          </p>
          {manualRenewResult ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
              <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-green-800">Subscription Reactivated!</p>
              <div className="mt-2 space-y-1 text-xs text-green-700">
                <p>Invoice: <span className="font-semibold">{manualRenewResult.invoiceNumber}</span></p>
                <p>Amount: <span className="font-semibold">₹{manualRenewResult.amount}</span></p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleManualRenew}
                disabled={manualRenewProcessing}
                className="px-5 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003a9f] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                {manualRenewProcessing ? (
                  <><Loader className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                ) : (
                  <><CheckCircle className="w-3.5 h-3.5" /> Confirm Payment & Reactivate</>
                )}
              </button>
              <span className="text-[10px] text-gray-400">
                Payment already made outside the app
              </span>
            </div>
          )}
        </div>
      )}

      {/* Plan Cards */}
      <div>
        <h3 className="text-sm font-bold text-[#191b23] mb-3">Available Plans</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = subscription?.plan === plan.planId;
            const needsPayment = subscription?.status !== 'active' || !isCurrentPlan;

            return (
              <div
                key={plan.planId}
                className={`relative bg-white rounded-xl border p-5 transition-all ${
                  isCurrentPlan ? 'border-[#004ac6] ring-1 ring-[#004ac6]' : 'border-[#e1e2ed] hover:border-[#004ac6]'
                }`}
              >
                {isCurrentPlan && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold text-[#004ac6] bg-blue-50 px-2 py-0.5 rounded-full">Current</span>
                )}
                <h4 className="text-base font-bold text-[#191b23]">{plan.name}</h4>
                <p className="text-[11px] text-gray-400 mt-1">{plan.description}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-[#191b23]">₹{plan.price}</span>
                  <span className="text-[11px] text-gray-400">/month</span>
                </div>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-center gap-2 text-xs text-gray-600">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    Up to {plan.maxUsers} users
                  </li>
                  <li className="flex items-center gap-2 text-xs text-gray-600">
                    <Smartphone className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    Up to {plan.maxDevices} devices
                  </li>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </li>
                  ))}
                  {plan.aiEnabled && (
                    <li className="flex items-center gap-2 text-xs text-purple-600">
                      <Zap className="w-3.5 h-3.5 shrink-0" />
                      AI-Powered Features
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  onClick={() => handleSubscribe(plan.planId)}
                  disabled={processing || (isCurrentPlan && subscription?.status === 'active')}
                  className={`mt-5 w-full py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    isCurrentPlan && subscription?.status === 'active'
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-[#004ac6] text-white hover:bg-[#003a9f] disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
                >
                  {processing ? (
                    <><Loader className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                  ) : isCurrentPlan && subscription?.status === 'active' ? (
                    'Current Plan'
                  ) : (
                    <><Zap className="w-3.5 h-3.5" /> {subscription?.status === 'trial' ? 'Subscribe Now' : subscription?.status === 'suspended' ? 'Reactivate' : 'Upgrade'}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-5">
        <h3 className="text-sm font-bold text-[#191b23] mb-3">Payment History</h3>
        {history && history.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#e1e2ed]">
                  <th className="text-left py-2 px-2 text-gray-400 font-semibold">Date</th>
                  <th className="text-left py-2 px-2 text-gray-400 font-semibold">Invoice</th>
                  <th className="text-left py-2 px-2 text-gray-400 font-semibold">Amount</th>
                  <th className="text-left py-2 px-2 text-gray-400 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.payments.map((p: any) => (
                  <tr key={p._id} className="border-b border-[#f0f0f5]">
                    <td className="py-2 px-2 text-[#191b23]">{formatDate(p.createdAt)}</td>
                    <td className="py-2 px-2 text-[#191b23]">{p.invoiceNumber || '-'}</td>
                    <td className="py-2 px-2 text-[#191b23] font-semibold">₹{p.amount}</td>
                    <td className="py-2 px-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        p.status === 'success' ? 'text-green-600 bg-green-50' : p.status === 'created' ? 'text-blue-600 bg-blue-50' : 'text-red-600 bg-red-50'
                      }`}>
                        {p.status === 'success' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400">No payment records yet.</p>
        )}
      </div>
    </div>
  );
}
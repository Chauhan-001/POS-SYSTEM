import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Crown, Clock, AlertTriangle, CreditCard } from 'lucide-react'
import * as api from '../src/api/client'

interface Plan {
  id: string
  planId: string
  name: string
  description: string
  price: number
  maxUsers: number
  maxDevices: number
  features: string[]
  limits?: { maxBranches: number; maxDevicesPerBranch: number }
}

interface SubscriptionStatus {
  status: string
  plan: string
  trialEnd?: string
  trialStart?: string
  graceEnd?: string
}

export default function PlanSelectionPage({ onPlanSelected }: { onPlanSelected?: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'create_only' | 'trial_expired'>('create_only')

  // True when the restaurant was downgraded to the Free tier (core POS only)
  // after its subscription period expired and the 2-day warning elapsed.
  const isFreeTier = subscription?.status === 'active' && subscription?.plan === 'free'
  // True during the 2-day expiry warning window (grace).
  const isGrace = subscription?.status === 'grace'

  useEffect(() => {
    (async () => {
      const [plansData, subData] = await Promise.all([
        api.fetchPlans(),
        api.fetchSubscriptionStatus(),
      ])
      if (plansData) setPlans(Array.isArray(plansData) ? plansData : [])
      if (subData) {
        setSubscription(subData as any)
        // Check if trial has expired
        if (subData.status === 'suspended' && subData.trialEnd) {
          const trialEnd = new Date(subData.trialEnd)
          if (trialEnd < new Date()) {
            setMode('trial_expired')
          }
        }
      }
      setLoading(false)
    })()
  }, [])

  const handleSelectPlan = async (planId: string) => {
    setSelecting(planId)
    setError('')
    try {
      // Try to change plan via API (this will also activate suspended subscriptions)
      const result = await api.changeSubscriptionPlan(planId)
      if (result) {
        onPlanSelected?.()
      } else {
        // Fallback: try manual renew with the plan price
        const plan = plans.find(p => p.planId === planId)
        const renewed = await api.manualRenewSubscription({
          amount: plan?.price || 499,
          notes: `Plan activation: ${plan?.name || planId}`,
          paymentMethod: 'cash',
        })
        if (renewed) {
          onPlanSelected?.()
        } else {
          setError('Failed to activate subscription. Please try again or contact support.')
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setSelecting(null)
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg-page)]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--brand-color)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading plans...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--color-bg-page)] text-[var(--color-text-primary)] flex flex-col">
      {/* Header */}
      <div className="bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] px-6 py-5">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Crown size={24} className="text-[var(--brand-color)]" />
            <h1 className="text-xl font-bold">Choose Your Plan</h1>
          </div>
          {mode === 'trial_expired' ? (
            <div className="flex items-center gap-2 mt-2 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} />
              Your 7-day free trial has ended. Select a plan to continue using the POS system.
            </div>
          ) : isFreeTier ? (
            <div className="flex items-center gap-2 mt-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              <Crown size={16} />
              You're on the <strong>Free plan</strong> — core POS only. Upgrade to unlock AI, inventory, reports &amp; more.
            </div>
          ) : isGrace ? (
            <div className="flex items-center gap-2 mt-2 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} />
              Your subscription expired. Select a plan now — otherwise you'll move to the Free plan.
            </div>
          ) : (
            <p className="text-sm text-gray-500 mt-1">
              Your account is ready. Select a plan below to activate your POS terminal and start taking orders.
            </p>
          )}
        </div>
      </div>

      {/* Plan Cards */}
      <div className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto">
          {plans.length === 0 ? (
            <div className="text-center py-16">
              <CreditCard size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">No plans available yet. Please contact your administrator.</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {plans
                // The Free tier is fallback-only: it only appears in the grid
                // for restaurants already on it (downgraded). Paid, trial and
                // grace subscribers never see it — no voluntary downgrades.
                .filter((p) => p.planId !== 'free' || isFreeTier)
                .map((plan) => {
                const isSelected = selecting === plan.planId
                const currentPlan = subscription?.plan === plan.planId
                return (
                  <div
                    key={plan.id}
                    className={`bg-[var(--color-bg-white)] rounded-xl border-2 transition-all ${
                      currentPlan
                        ? 'border-[var(--brand-color)] ring-2 ring-[var(--brand-color)]/20'
                        : 'border-[var(--color-border-default)] hover:border-[var(--brand-color)]/50 hover:shadow-md'
                    }`}
                  >
                    {/* Current-plan ribbon — makes a free-tier downgrade unmistakable */}
                    {currentPlan && (
                      <div className="flex items-center justify-center gap-1.5 rounded-t-[10px] bg-[var(--brand-color)] text-white px-4 py-2 text-xs font-bold">
                        <CheckCircle size={13} />
                        {plan.planId === 'free' ? 'Current Plan · Free tier (core POS only)' : 'Current Plan'}
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="text-lg font-bold text-[var(--color-text-primary)]">{plan.name}</h3>
                      {plan.description && (
                        <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
                      )}
                      <div className="mt-3">
                        <span className="text-3xl font-bold text-[var(--color-text-primary)]">₹{Number(plan.price || 0).toLocaleString('en-IN')}</span>
                        <span className="text-sm text-gray-400 ml-1">/mo</span>
                      </div>

                      {/* Limits */}
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Limits</p>                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-[var(--color-surface-muted)] rounded-lg p-2 text-center">
                              <p className="text-gray-400">Users</p>
                              <p className="font-bold text-[var(--color-text-primary)]">{plan.maxUsers}</p>
                            </div>
                            <div className="bg-[var(--color-surface-muted)] rounded-lg p-2 text-center">
                              <p className="text-gray-400">Devices / Branch</p>
                              <p className="font-bold text-[var(--color-text-primary)]">{plan.limits?.maxDevicesPerBranch ?? plan.maxDevices ?? 3}</p>
                            </div>
                            <div className="bg-[var(--color-surface-muted)] rounded-lg p-2 text-center">
                              <p className="text-gray-400">Branches</p>
                              <p className="font-bold text-[var(--color-text-primary)]">
                                {plan.limits?.maxBranches === 0 ? '∞' : plan.limits?.maxBranches || 1}
                              </p>
                            </div>
                          </div>
                      </div>

                      {/* Features */}
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Features</p>
                        <div className="space-y-1.5">
                          {plan.features.map((f) => (
                            <div key={f} className="flex items-start gap-2 text-xs">
                              <CheckCircle size={12} className="text-green-500 mt-0.5 shrink-0" />
                              <span className="text-gray-700">{f.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="px-5 pb-5">
                      {currentPlan ? (
                        <button
                          disabled
                          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-400 cursor-not-allowed"
                        >
                          <CheckCircle size={14} className="inline mr-1.5" />
                          Current Plan
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSelectPlan(plan.planId)}
                          disabled={selecting !== null}
                          className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[var(--brand-color)] text-white opacity-70'
                              : 'bg-[var(--brand-color)] text-white hover:bg-[#003da0] active:scale-[0.98]'
                          }`}
                        >
                          {isSelected ? (
                            <><Clock size={14} className="inline animate-spin mr-1.5" /> Activating...</>
                          ) : (
                            'Select Plan'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              <XCircle size={16} />
              {error}
            </div>
          )}

          <p className="text-center text-xs text-gray-400 mt-6">
            Need help choosing? Contact your administrator or support team.
          </p>
        </div>
      </div>
    </div>
  )
}

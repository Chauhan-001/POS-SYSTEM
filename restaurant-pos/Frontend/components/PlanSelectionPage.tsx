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
  limits?: { maxBranches: number; maxDevices: number; maxEmployees: number }
}

interface SubscriptionStatus {
  status: string
  plan: string
  trialEnd?: string
  trialStart?: string
}

export default function PlanSelectionPage({ onPlanSelected }: { onPlanSelected?: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'create_only' | 'trial_expired'>('create_only')

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
      <div className="h-screen flex items-center justify-center bg-[#faf8ff]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#004ac6] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading plans...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto bg-[#faf8ff] text-[#191b23] flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-[#e1e2ed] px-6 py-5">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Crown size={24} className="text-[#004ac6]" />
            <h1 className="text-xl font-bold">Choose Your Plan</h1>
          </div>
          {mode === 'trial_expired' ? (
            <div className="flex items-center gap-2 mt-2 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} />
              Your 7-day free trial has ended. Select a plan to continue using the POS system.
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
              {plans.map((plan) => {
                const isSelected = selecting === plan.planId
                const currentPlan = subscription?.plan === plan.planId
                return (
                  <div
                    key={plan.id}
                    className={`bg-white rounded-xl border-2 transition-all ${
                      currentPlan
                        ? 'border-[#004ac6] ring-2 ring-[#004ac6]/20'
                        : 'border-[#e1e2ed] hover:border-[#004ac6]/50 hover:shadow-md'
                    }`}
                  >
                    <div className="p-5">
                      <h3 className="text-lg font-bold text-[#191b23]">{plan.name}</h3>
                      {plan.description && (
                        <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
                      )}
                      <div className="mt-3">
                        <span className="text-3xl font-bold text-[#191b23]">₹{plan.price}</span>
                        <span className="text-sm text-gray-400 ml-1">/mo</span>
                      </div>

                      {/* Limits */}
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Limits</p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="bg-[#f5f5ff] rounded-lg p-2 text-center">
                            <p className="text-gray-400">Users</p>
                            <p className="font-bold text-[#191b23]">{plan.limits?.maxEmployees || plan.maxUsers}</p>
                          </div>
                          <div className="bg-[#f5f5ff] rounded-lg p-2 text-center">
                            <p className="text-gray-400">Devices</p>
                            <p className="font-bold text-[#191b23]">{plan.limits?.maxDevices || plan.maxDevices}</p>
                          </div>
                          <div className="bg-[#f5f5ff] rounded-lg p-2 text-center">
                            <p className="text-gray-400">Branches</p>
                            <p className="font-bold text-[#191b23]">
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
                              ? 'bg-[#004ac6] text-white opacity-70'
                              : 'bg-[#004ac6] text-white hover:bg-[#003da0] active:scale-[0.98]'
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

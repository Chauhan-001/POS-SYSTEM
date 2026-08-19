/**
 * =============================================================================
 *  UsageDashboard.tsx — Real-Time Subscription Usage Dashboard
 * =============================================================================
 *
 * Displays a comprehensive, color-coded view of a restaurant's resource usage
 * against their plan limits, along with feature activation status.
 *
 * Props:
 *   data: SubscriptionUsage | undefined — from the API
 *   isLoading: boolean
 *   onUpgrade: () => void — navigate to subscription tab
 */

import { useState } from 'react'
import {
  Building2, Monitor, Users, Crown, CheckCircle, XCircle,
  AlertTriangle, Zap, ArrowUp, Info, ChevronDown, ChevronUp,
  Sparkles, Lock, Unlock,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from './ui/Card'
import { Badge } from './ui/Badge'
import { Skeleton } from './ui/Skeleton'
import { Button } from './ui/Button'
import { formatCurrency } from '../utils/format'
import type { SubscriptionUsage } from '../types'

// ─── Props ────────────────────────────────────────────────────────

interface UsageDashboardProps {
  data: SubscriptionUsage | undefined
  isLoading: boolean
  onUpgrade: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────

function getUsageColor(pct: number, isUnlimited?: boolean): string {
  if (isUnlimited) return '#8b5cf6' // purple for unlimited
  if (pct >= 90) return '#ef4444'   // danger red
  if (pct >= 70) return '#f59e0b'   // warning amber
  return '#22c55e'                   // safe green
}

function getUsageBgColor(pct: number, isUnlimited?: boolean): string {
  if (isUnlimited) return 'bg-purple-100 dark:bg-purple-900/30'
  if (pct >= 90) return 'bg-danger/10'
  if (pct >= 70) return 'bg-warning/10'
  return 'bg-success/10'
}

function getUsageBadge(pct: number, isUnlimited?: boolean): { label: string; variant: 'success' | 'warning' | 'danger' | 'info' } {
  if (isUnlimited) return { label: 'Unlimited', variant: 'info' }
  if (pct >= 90) return { label: 'Critical', variant: 'danger' }
  if (pct >= 70) return { label: 'Warning', variant: 'warning' }
  if (pct >= 40) return { label: 'Moderate', variant: 'info' }
  return { label: 'Healthy', variant: 'success' }
}

// ─── Skeleton Loader ──────────────────────────────────────────────

function UsageDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Resource cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </Card>
        ))}
      </div>
      {/* Plan info */}
      <Card>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </Card>
      {/* Features */}
      <Card>
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── Usage Gauge ──────────────────────────────────────────────────

function UsageGauge({ current, limit, percentage, remaining, isUnlimited, label, icon: Icon, iconColor }: {
  current: number
  limit: number
  percentage: number
  remaining: number
  isUnlimited: boolean
  label: string
  icon: React.ElementType
  iconColor: string
}) {
  const color = getUsageColor(percentage, isUnlimited)
  const badge = getUsageBadge(percentage, isUnlimited)
  const isAtLimit = !isUnlimited && current >= limit
  const displayLimit = isUnlimited ? '∞' : limit

  return (
    <Card className="relative overflow-hidden group hover:shadow-md transition-all duration-300">
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 transition-colors duration-500"
        style={{ backgroundColor: color }}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
            {label}
          </p>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110 duration-200"
            style={{ backgroundColor: `${iconColor}15`, color: iconColor }}
          >
            <Icon size={18} />
          </div>
        </div>

        {/* Value display */}
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-3xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">
            {current}
          </span>
          <span className="text-lg font-semibold text-surface-400 dark:text-surface-500">
            / {displayLimit}
          </span>
        </div>

        {/* Progress bar */}
        {!isUnlimited && (
          <div className="w-full h-2.5 bg-surface-100 dark:bg-surface-700 rounded-full mt-3 mb-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out"
              style={{
                width: `${Math.min(100, percentage)}%`,
                backgroundColor: color,
              }}
            />
          </div>
        )}

        {/* Status info */}
        <div className="flex items-center justify-between mt-2">
          <Badge variant={badge.variant} className="text-[10px]">
            {badge.label}
          </Badge>
          <div className="flex items-center gap-1 text-xs">
            {isAtLimit ? (
              <span className="text-danger font-semibold flex items-center gap-1">
                <AlertTriangle size={12} /> Limit reached
              </span>
            ) : isUnlimited ? (
              <span className="text-purple-500 font-semibold flex items-center gap-1">
                <Infinity size={12} /> No limit
              </span>
            ) : (
              <span className="text-surface-400">
                <span className="font-semibold text-surface-600 dark:text-surface-300">{percentage}%</span> used
                {percentage > 0 && (
                  <span className="hidden sm:inline"> · {remaining > 0 ? `${remaining} left` : ''}</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function Infinity({ size, className }: { size?: number; className?: string }) {
  return (
    <svg width={size || 16} height={size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 1 0 0-8c-2 0-4 1.33-6 4Z" />
    </svg>
  )
}

// ─── Feature Card ─────────────────────────────────────────────────

function FeatureCard({ label, description, enabled }: {
  label: string
  description: string
  enabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-sm ${
        enabled
          ? 'border-success/30 bg-success/[0.03] dark:bg-success/[0.05]'
          : 'border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 opacity-70'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {enabled ? (
            <CheckCircle size={16} className="shrink-0 mt-0.5 text-success" />
          ) : (
            <Lock size={16} className="shrink-0 mt-0.5 text-surface-400" />
          )}
          <div className="min-w-0">
            <p className={`text-sm font-semibold truncate ${enabled ? 'text-surface-900 dark:text-surface-100' : 'text-surface-500'}`}>
              {label}
            </p>
            {expanded && description && (
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {enabled && (
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          )}
          {expanded ? (
            <ChevronUp size={14} className="text-surface-400" />
          ) : (
            <ChevronDown size={14} className="text-surface-400" />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Plan Overview Banner ─────────────────────────────────────────

function PlanBanner({ plan, onUpgrade }: {
  plan: SubscriptionUsage['plan']
  onUpgrade: () => void
}) {
  const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
    trial: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
    grace: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
    suspended: { bg: 'bg-danger/10', text: 'text-danger', dot: 'bg-danger' },
  }
  const sc = statusColors[plan.status] || statusColors.active

  // The active billing cadence and the price it actually charges.
  const period = plan.billingPeriod === 'yearly' ? 'yearly' : 'monthly'
  const altPeriod = period === 'yearly' ? 'monthly' : 'yearly'
  const activePrice = plan.billingPrice > 0
    ? plan.billingPrice
    : (period === 'yearly' ? plan.yearlyPrice : plan.price)
  const altPrice = altPeriod === 'yearly' ? plan.yearlyPrice : plan.price
  // Days left in the 2-day expiry warning window (status 'grace') before the
  // subscription auto-downgrades to the Free tier.
  const graceDaysRemaining = plan.graceEnd
    ? Math.max(0, Math.ceil((new Date(plan.graceEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  return (
    <Card className="relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.03] to-transparent pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Crown size={18} className="text-primary-600" />
            <CardTitle className="text-base">{plan.name}</CardTitle>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
            </span>
          </div>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {activePrice > 0 ? (
              <>
                <span className="font-semibold text-surface-700 dark:text-surface-300 capitalize">{period}</span>
                <span className="mx-1">·</span>
                {formatCurrency(activePrice)}/{period === 'yearly' ? 'yr' : 'mo'}
                {altPrice > 0 && (
                  <span className="text-xs text-surface-400"> · or {formatCurrency(altPrice)}/{altPeriod === 'yearly' ? 'yr' : 'mo'}</span>
                )}
              </>
            ) : (
              'Free plan'
            )}
            {plan.expiryDate && plan.status !== 'grace' && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-surface-400">
                · Expires {new Date(plan.expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </p>
          {plan.status === 'grace' && plan.graceEnd && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-warning bg-warning/10 rounded-lg px-2.5 py-1">
              <AlertTriangle size={13} />
              Subscription expired — moving to the Free plan (core POS only) in {graceDaysRemaining} day{graceDaysRemaining !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={onUpgrade}
        >
          <Zap size={14} />
          Change Plan
        </Button>
      </div>
    </Card>
  )
}

// ─── Main Component ───────────────────────────────────────────────

export default function UsageDashboard({ data, isLoading, onUpgrade }: UsageDashboardProps) {
  if (isLoading) return <UsageDashboardSkeleton />
  if (!data) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="text-surface-300 mb-4" />
          <p className="text-surface-500 font-medium">No usage data available</p>
          <p className="text-xs text-surface-400 mt-1">Ensure this restaurant has an active subscription.</p>
        </div>
      </Card>
    )
  }

  const { limits, features, plan } = data
  const totalEnabled = features.enabled.length
  const totalAvailable = features.available.length
  const period = plan.billingPeriod === 'yearly' ? 'yearly' : 'monthly'
  const activePrice = plan.billingPrice > 0
    ? plan.billingPrice
    : (period === 'yearly' ? plan.yearlyPrice : plan.price)
  // Days left in the 2-day expiry warning window before the free-tier downgrade.
  const graceDaysRemaining = plan.graceEnd
    ? Math.max(0, Math.ceil((new Date(plan.graceEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  return (
    <div className="space-y-6">
      {/* ─── Plan Overview Banner ────────────────────────────────── */}
      <PlanBanner plan={plan} onUpgrade={onUpgrade} />

      {/* ─── Resource Usage Cards ────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-3">
        <UsageGauge
          label="Branches"
          icon={Building2}
          iconColor="#6366f1"
          {...limits.branches}
        />
        <UsageGauge
          label="Devices per Branch"
          icon={Monitor}
          iconColor="#06b6d4"
          {...limits.devicesPerBranch}
        />
        <UsageGauge
          label="Users"
          icon={Users}
          iconColor="#22c55e"
          {...limits.users}
        />
      </div>

      {/* ─── Quick Stats Row ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Plan Price', value: activePrice > 0 ? `${formatCurrency(activePrice)}/${period === 'yearly' ? 'yr' : 'mo'}` : 'Free', icon: Zap, color: '#6366f1' },
          { label: 'Features Enabled', value: `${totalEnabled} / ${totalEnabled + totalAvailable}`, icon: Sparkles, color: '#f59e0b' },
          { label: 'Plan Status', value: plan.status.charAt(0).toUpperCase() + plan.status.slice(1), icon: Info, color: plan.status === 'active' ? '#22c55e' : plan.status === 'trial' ? '#3b82f6' : plan.status === 'grace' ? '#f59e0b' : '#ef4444' },
          { label: plan.status === 'grace' ? 'Free Downgrade' : 'Subscription', value: plan.status === 'grace' && plan.graceEnd ? `in ${graceDaysRemaining} day${graceDaysRemaining !== 1 ? 's' : ''}` : plan.expiryDate ? new Date(plan.expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'N/A', icon: Crown, color: plan.status === 'grace' ? '#f59e0b' : '#8b5cf6' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-3 p-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:shadow-sm transition-all duration-200"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${stat.color}15`, color: stat.color }}
            >
              <stat.icon size={15} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-surface-500 dark:text-surface-400 uppercase tracking-wider font-semibold truncate">
                {stat.label}
              </p>
              <p className="text-sm font-bold text-surface-900 dark:text-surface-100 truncate">
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Feature Activation ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary-600" />
            Feature Activation
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-500">
              {totalEnabled} enabled
            </span>
            <Badge variant="info" className="text-[10px]">
              {totalAvailable} available
            </Badge>
          </div>
        </CardHeader>

        {/* Featured enabled features */}
        {features.enabled.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <CheckCircle size={12} className="text-success" />
              Enabled Features
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {features.enabled.map((f) => (
                <FeatureCard key={f.key} label={f.label} description={f.description} enabled={true} />
              ))}
            </div>
          </div>
        )}

        {/* Available (disabled) features */}
        {features.available.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Lock size={12} className="text-surface-400" />
              Additional Features Available
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {features.available.map((f) => (
                <FeatureCard key={f.key} label={f.label} description={f.description} enabled={false} />
              ))}
            </div>

            {/* Upgrade prompt */}
            {features.available.length >= 2 && (
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-primary-500/[0.05] to-primary-500/[0.02] border border-primary-200 dark:border-primary-800/30">
                <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <ArrowUp size={16} className="text-primary-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                        Unlock more features
                      </p>
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                        Upgrade your plan to enable {features.available.length} additional feature{features.available.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" className="shrink-0 gap-1.5" onClick={onUpgrade}>
                    <Zap size={14} />
                    Upgrade Plan
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

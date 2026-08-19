/**
 * =============================================================================
 *  RestaurantDetails.tsx — Restaurant Detail & Management Page
 * =============================================================================
 *
 * Features:
 *   - Full restaurant profile with business & owner info
 *   - Tabbed interface: Overview, Subscription, Branches, Usage,
 *     Settings, Devices, Security, Timeline, Notes, Analytics
 *   - Subscription management (renew, upgrade/downgrade plan)
 *   - Branch creation modal
 *   - Payment history with search & date filters
 *   - Admin notes & audit trail
 *   - Quick actions: Edit, Suspend/Activate, Reset Password, Restart Sync
 *
 * Data Sources:
 *   - GET  /admin/restaurants/:id     → Restaurant details
 *   - GET  /admin/restaurants/:id/subscription → Subscription
 *   - GET  /admin/restaurants/:id/branch-usage  → Branch usage
 *   - GET  /admin/restaurants/:id/payment-history → Payments
 *   - Various PUT/POST mutation endpoints
 */

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Store, Mail, Phone, Calendar, Cpu, Monitor, Shield, Settings,
  CreditCard, Activity, FileText, CheckCircle, AlertTriangle, Key,
  Lock, Unlock, Plus, Trash2, Edit, Save, Clock, MapPin, Building, Building2,
  Crown, Users, ExternalLink, Search, ShieldOff, ShieldCheck, LogIn, Wallet,
  BarChart3, Users2, Receipt, Upload, HardDrive, Image as ImageIcon, Sparkles
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { Tooltip } from '../components/ui/Tooltip'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import apiClient from '../api/client'
import { getRestaurant, updateRestaurant, suspendRestaurant, activateRestaurant, createRestaurantBranch, getRestaurantDeviceActivitySummary, addAdminNote, resetRestaurantPassword, regenerateRestaurantCredentials, getRestaurantStatistics, uploadRestaurantImage, deleteRestaurantImage, getRestaurantStorage, resolveMediaUrl, type DeviceActivitySummary, type RestaurantStatistics, type StorageMetrics } from '../api/restaurants'
import { getSubscriptionByRestaurant, renewSubscription, upgradeSubscription, downgradeSubscription, getSubscriptionPayments, getSubscriptionUsage, updateGrantedFeatures } from '../api/subscriptions'
import { getPlans } from '../api/subscriptionPlans'
import { getBranchUsageByRestaurant } from '../api/branches'
import UsageDashboard from '../components/UsageDashboard'
import { formatDate, formatDateTime, formatCurrency, formatNumber } from '../utils/format'
import {
  getDevices, blockDevice, unblockDevice, getDeviceActivity,
  type DeviceActivityEvent, type DeviceFilters
} from '../api/devices'
import type { Device } from '../types'

// ─── Device Activity helpers ────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  device_registered: {
    icon: <Monitor size={14} />,
    color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20',
    label: 'Registered',
  },
  device_login: {
    icon: <LogIn size={14} />,
    color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20',
    label: 'Login',
  },
  device_blocked: {
    icon: <ShieldOff size={14} />,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
    label: 'Blocked',
  },
  device_unblocked: {
    icon: <ShieldCheck size={14} />,
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20',
    label: 'Unblocked',
  },
  device_inactive: {
    icon: <AlertTriangle size={14} />,
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20',
    label: 'Inactive',
  },
  heartbeat: {
    icon: <Activity size={14} />,
    color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/20',
    label: 'Heartbeat',
  },
}

function ActivityTimeline({ events }: { events: DeviceActivityEvent[] }) {
  return (
    <div className="relative space-y-0">
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-surface-400">No activity recorded yet.</p>
      ) : (
        events.map((ev, idx) => {
          const cfg = EVENT_CONFIG[ev.event] || {
            icon: <Activity size={14} />,
            color: 'text-surface-600 bg-surface-100 dark:text-surface-400 dark:bg-surface-800',
            label: ev.event,
          }
          const isLast = idx === events.length - 1
          return (
            <div key={ev.id} className="relative flex gap-3 pb-5">
              {!isLast && (
                <div className="absolute left-[15px] top-[30px] bottom-0 w-px bg-surface-200 dark:bg-surface-700" />
              )}
              <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${cfg.color}`}>
                {cfg.icon}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">{cfg.label}</span>
                  <span className="text-[10px] text-surface-400 shrink-0">{relativeTime(ev.timestamp)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-surface-500 dark:text-surface-400 leading-relaxed">{ev.description}</p>
                <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-surface-400">
                  <span>{formatDateTime(ev.timestamp)}</span>
                  {ev.ipAddress && <span>· IP: {ev.ipAddress}</span>}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  core_pos: 'Billing, orders, table management, and payment processing',
  basic_reports: 'Daily sales summaries, order history, and performance metrics',
  ai: 'AI-powered menu recommendations and demand forecasting',
  inventory: 'Stock tracking, purchase orders, and low-stock alerts',
  loyalty: 'Customer rewards program, points tracking, and promotions',
  reservations: 'Online and walk-in table booking with availability management',
  multi_branch: 'Centralized management across multiple restaurant locations',
  analytics: 'Advanced data visualizations and business intelligence dashboards',
  custom_branding: 'White-label experience with custom logo and branding',
  advanced_reports: 'Profit & loss, tax reports, and custom exportable data',
  api_access: 'REST API access for third-party integrations and custom tools',
  priority_support: 'Dedicated support with priority ticketing and SLAs',
}

/**
 * Full feature catalog (mirrors backend constants/planFeatures.ts).
 * Used by the admin feature-grant UI to show every grantable feature with
 * its label + description, independent of what the current plan includes.
 */
const FEATURE_CATALOG: Array<{ key: string; label: string; description: string }> = [
  { key: 'core_pos', label: 'Core POS', description: 'Billing, orders, table management, and payment processing' },
  { key: 'table_service', label: 'Table Service', description: 'Dine-in floor plan with table states and guest counts' },
  { key: 'takeaway', label: 'Takeaway', description: 'Takeaway and quick orders without a table' },
  { key: 'delivery', label: 'Delivery', description: 'Delivery orders from partner apps (Swiggy, Zomato, Uber Eats)' },
  { key: 'online_ordering', label: 'Online Ordering', description: 'Customer-facing online ordering website and order intake' },
  { key: 'qr_ordering', label: 'QR Ordering', description: 'QR-based self-ordering from the table, car, or pickup' },
  { key: 'waiter_management', label: 'Waiter Management', description: 'Assign waiters to tables and track service' },
  { key: 'kitchen_display', label: 'Kitchen Display', description: 'Kitchen order tickets (KOT) and display screen' },
  { key: 'products', label: 'Products & Menu', description: 'Product catalog, categories, variants, and menu management' },
  { key: 'staff', label: 'Staff Management', description: 'Employees, roles, PINs, and shift management' },
  { key: 'discounts', label: 'Discounts', description: 'Discounts, price overrides, and happy hours' },
  { key: 'guest_checkout', label: 'Guest Checkout', description: 'Bill without a registered customer' },
  { key: 'order_notes', label: 'Order Notes', description: 'Item notes, modifiers, and special instructions' },
  { key: 'offers', label: 'Offers & Promotions', description: 'Coupons, BOGO, and promotional offers' },
  { key: 'loyalty', label: 'Loyalty', description: 'Customer rewards program, points tracking, and promotions' },
  { key: 'crm', label: 'CRM', description: 'Customer profiles, segmentation, and relationship management' },
  { key: 'reservations', label: 'Reservations', description: 'Table booking and waitlist management' },
  { key: 'inventory', label: 'Inventory', description: 'Stock tracking, purchase orders, and low-stock alerts' },
  { key: 'expense_tracking', label: 'Expense Tracking', description: 'Record and categorize operational expenses' },
  { key: 'finance', label: 'Finance', description: 'Cash flow, P&L, and financial statements' },
  { key: 'analytics', label: 'Analytics', description: 'Advanced dashboards and business intelligence' },
  { key: 'basic_reports', label: 'Basic Reports', description: 'Daily sales summaries and order history' },
  { key: 'advanced_reports', label: 'Advanced Reports', description: 'Profit & loss, tax reports, and custom exports' },
  { key: 'multi_branch', label: 'Multi Branch', description: 'Centralized management across multiple locations' },
  { key: 'multi_device', label: 'Multi Device', description: 'Run the POS on multiple terminals concurrently' },
  { key: 'ai', label: 'AI', description: 'AI menu suggestions, demand forecasting, and smart insights' },
  { key: 'voice_ordering', label: 'Voice Ordering', description: 'Voice-assisted order entry and inventory' },
  { key: 'offline_mode', label: 'Offline Mode', description: 'Continue billing during internet outages' },
  { key: 'customer_display', label: 'Customer Display', description: 'Customer-facing order and payment display' },
  { key: 'marketing', label: 'Marketing', description: 'Campaigns and promotional tools' },
  { key: 'integrations', label: 'Integrations', description: 'Swiggy, Zomato, Uber Eats and delivery partners' },
  { key: 'api_access', label: 'API Access', description: 'REST API for third-party integrations' },
  { key: 'custom_branding', label: 'Custom Branding', description: 'White-label experience with custom logo and branding' },
  { key: 'priority_support', label: 'Priority Support', description: 'Dedicated support with priority ticketing' },
]

export default function RestaurantDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'subscription' | 'branches' | 'usage' | 'settings' | 'devices' | 'security' | 'timeline' | 'notes' | 'analytics'>('overview')
  const [newNote, setNewNote] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false)
  const [branchForm, setBranchForm] = useState({ name: '', address: '', phone: '', isHeadBranch: false })
  const [planChangeTarget, setPlanChangeTarget] = useState<{ action: 'upgrade' | 'downgrade'; planId: string; planName: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [paymentsPage, setPaymentsPage] = useState(1)
  const [deviceConfirmAction, setDeviceConfirmAction] = useState<{ device: Device; type: 'block' | 'unblock' } | null>(null)
  const [activityDevice, setActivityDevice] = useState<Device | null>(null)
  const [activityPage, setActivityPage] = useState(1)
  const [devicePage, setDevicePage] = useState(1)
  const [showRenewConfirm, setShowRenewConfirm] = useState(false)
  const [renewPeriod, setRenewPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetResult, setResetResult] = useState<{ message: string; ownerUserId?: string } | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [credentialsResult, setCredentialsResult] = useState<{ message: string; secretKey: string; apiKey: string } | null>(null)
  const [pendingFeature, setPendingFeature] = useState<{ key: string; action: 'grant' | 'revoke' } | null>(null)

  // ─── Branding media (logo / cover) ─────────────────────────────
  const logoInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [mediaUploading, setMediaUploading] = useState<{ logo?: boolean; cover?: boolean }>({})
  const [mediaDeleteConfirm, setMediaDeleteConfirm] = useState<'logo' | 'cover' | null>(null)

  const { data: storageMetrics, isLoading: storageLoading, refetch: refetchStorage } = useQuery({
    queryKey: ['restaurant-storage', id],
    queryFn: () => getRestaurantStorage(id!),
    enabled: !!id,
    retry: false,
  })

  const refreshAfterMedia = () => {
    queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
    queryClient.invalidateQueries({ queryKey: ['restaurant-statistics', id] })
    refetchStorage()
  }

  const handleMediaUpload = async (kind: 'logo' | 'cover', file?: File) => {
    if (!file) return
    // Client-side guard mirroring the backend rules (image only, ≤ 5 MB).
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file (JPG, PNG, WebP or GIF)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image exceeds the 5 MB size limit')
      return
    }
    setMediaUploading((s) => ({ ...s, [kind]: true }))
    try {
      await uploadRestaurantImage(id!, kind, file)
      refreshAfterMedia()
      toast.success(kind === 'logo' ? 'Logo uploaded successfully' : 'Cover image uploaded successfully')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.response?.data?.message || 'Upload failed')
    } finally {
      setMediaUploading((s) => ({ ...s, [kind]: false }))
    }
  }

  const handleMediaDelete = async (kind: 'logo' | 'cover') => {
    setMediaDeleteConfirm(null)
    try {
      await deleteRestaurantImage(id!, kind)
      refreshAfterMedia()
      toast.success(kind === 'logo' ? 'Logo removed' : 'Cover image removed')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.response?.data?.message || 'Delete failed')
    }
  }

  const formatStorage = (mb: number | null | undefined): string => {
    if (mb == null) return '—'
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
    return `${mb.toFixed(2)} MB`
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: restaurant, isLoading, error, refetch } = useQuery({
    queryKey: ['restaurant', id],
    queryFn: async () => {
      const res = await getRestaurant(id!)
      setEditForm(res)
      return res
    },
    enabled: !!id,
  })

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['restaurant-subscription', id],
    queryFn: () => getSubscriptionByRestaurant(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: branchUsage, isLoading: branchUsageLoading } = useQuery({
    queryKey: ['restaurant-branch-usage', id],
    queryFn: () => getBranchUsageByRestaurant(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: subscriptionUsage, isLoading: subscriptionUsageLoading } = useQuery({
    queryKey: ['restaurant-subscription-usage', id],
    queryFn: () => getSubscriptionUsage(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: restaurantStats, isLoading: statsLoading } = useQuery({
    queryKey: ['restaurant-statistics', id],
    queryFn: () => getRestaurantStatistics(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: plans } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => getPlans({}),
  })
  const currentPlan = plans?.data?.find((p: any) => p.planId === subscription?.plan)
  // Effective feature state: what the PLAN includes vs what the ADMIN granted
  // beyond the plan (grantedFeatures survives plan changes; revoking a feature
  // the plan itself includes has no effect).
  const planFeatureSet = new Set<string>(subscription?.planFeatures || [])
  const grantedFeatureSet = new Set<string>(subscription?.grantedFeatures || [])
  const monthlyPrice = currentPlan?.price || subscription?.price || 0
  const yearlyPrice = currentPlan?.yearlyPrice || 0
  const renewAmount = renewPeriod === 'yearly' ? (yearlyPrice > 0 ? yearlyPrice : monthlyPrice) : monthlyPrice
  const openRenewModal = () => {
    setRenewPeriod(subscription?.billingPeriod || 'monthly')
    setShowRenewConfirm(true)
  }

  // ─── Device queries ──────────────────────────────────────────

  const deviceFilters: DeviceFilters = {
    page: devicePage,
    limit: 10,
    restaurantId: id,
  }

  const { data: deviceList, isLoading: deviceListLoading, refetch: refetchDevices } = useQuery({
    queryKey: ['restaurant-devices', id, devicePage],
    queryFn: () => getDevices(deviceFilters),
    enabled: !!id,
    retry: false,
  })

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['device-activity', activityDevice?.id, activityPage],
    queryFn: () => getDeviceActivity(activityDevice!.id, activityPage),
    enabled: !!activityDevice,
  })

  const blockDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => blockDevice(deviceId),
    onSuccess: () => {
      toast.success('Device blocked successfully')
      refetchDevices()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to block device'),
  })

  const unblockDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => unblockDevice(deviceId),
    onSuccess: () => {
      toast.success('Device unblocked successfully')
      refetchDevices()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to unblock device'),
  })

  // ─── Device Activity Summary ──────────────────────────────────

  const { data: deviceActivitySummary, isLoading: summaryLoading } = useQuery({
    queryKey: ['restaurant-device-activity-summary', id],
    queryFn: () => getRestaurantDeviceActivitySummary(id!),
    enabled: !!id,
    retry: false,
  })

  // Reset page when filters change
  useEffect(() => {
    setPaymentsPage(1)
  }, [debouncedSearch, dateStart, dateEnd])

  const { data: paymentHistory, isLoading: paymentHistoryLoading } = useQuery({
    queryKey: ['restaurant-payments', id, debouncedSearch, dateStart, dateEnd, paymentsPage],
    queryFn: () => getSubscriptionPayments(id!, {
      search: debouncedSearch || undefined,
      startDate: dateStart || undefined,
      endDate: dateEnd || undefined,
      page: paymentsPage,
      pageSize: 10,
    }),
    enabled: !!id,
    retry: false,
  })

  const renewMutation = useMutation({
    mutationFn: () => renewSubscription(subscription?.id || '', { billingPeriod: renewPeriod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-subscription', id] })
      toast.success('Subscription renewed successfully')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to renew subscription'),
  })

  const updateMutation = useMutation({
    mutationFn: (data: any) => updateRestaurant(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      toast.success('Restaurant updated successfully')
      setShowEditModal(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update restaurant'),
  })

  const suspendMutation = useMutation({
    mutationFn: () => suspendRestaurant(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      toast.success('Restaurant suspended')
    },
  })

  const activateMutation = useMutation({
    mutationFn: () => activateRestaurant(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      toast.success('Restaurant activated')
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: () => resetRestaurantPassword(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      setResetResult(data)
      toast.success('Owner password reset successfully')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to reset password'),
  })

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateRestaurantCredentials(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      setCredentialsResult(data)
      toast.success('Credentials regenerated successfully')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to regenerate credentials'),
  })

  const createBranchMutation = useMutation({
    mutationFn: () => createRestaurantBranch(id!, branchForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-branch-usage', id] })
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      setShowCreateBranchModal(false)
      setBranchForm({ name: '', address: '', phone: '', isHeadBranch: false })
      toast.success('Branch created successfully')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create branch'),
  })

  const changePlanMutation = useMutation({
    mutationFn: ({ action, planId }: { action: 'upgrade' | 'downgrade'; planId: string }) => {
      if (!subscription?.id) throw new Error('No subscription ID')
      return action === 'upgrade'
        ? upgradeSubscription(subscription.id, planId)
        : downgradeSubscription(subscription.id, planId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-subscription', id] })
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      setPlanChangeTarget(null)
      toast.success('Plan changed successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to change plan')
      setPlanChangeTarget(null)
    },
  })

  // ─── Admin feature grants (add-ons on the current plan) ───────
  const grantFeatureMutation = useMutation({
    mutationFn: ({ feature, action }: { feature: string; action: 'grant' | 'revoke' }) =>
      updateGrantedFeatures(id!, action === 'grant' ? { grant: [feature] } : { revoke: [feature] }),
    onMutate: ({ feature, action }) => setPendingFeature({ key: feature, action }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-subscription', id] })
      queryClient.invalidateQueries({ queryKey: ['restaurant', id] })
      toast.success(
        vars.action === 'grant'
          ? `Feature granted — active in the POS immediately`
          : 'Feature revoked — no longer available in the POS'
      )
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update feature access'),
    onSettled: () => setPendingFeature(null),
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />
  if (isLoading || !restaurant) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Sticky Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-surface-200 shadow-sm dark:bg-surface-900 dark:border-surface-700">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/restaurants')}>
            <ArrowLeft size={16} /> Back
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-xl">
              {restaurant.name?.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">{restaurant.name}</h1>
                <Badge variant={restaurant.status === 'active' ? 'success' : 'danger'}>
                  {restaurant.status}
                </Badge>
              </div>
              <p className="text-xs text-surface-500 mt-0.5">
                Restaurant ID: <code className="font-mono bg-surface-100 dark:bg-surface-800 px-1 py-0.5 rounded">{restaurant.restaurantId || restaurant.id}</code> · Plan: <span className="capitalize font-semibold text-primary-600">{restaurant.plan}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions Panel */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)}>
            <Edit size={14} /> Edit
          </Button>
          {restaurant.status === 'active' ? (
            <Button variant="danger" size="sm" onClick={() => suspendMutation.mutate()} loading={suspendMutation.isPending}>
              Suspend
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => activateMutation.mutate()} loading={activateMutation.isPending}>
              Activate
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate(`/restaurants/${id}/crm`)}>
            <Users size={14} /> Customer CRM
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/restaurants/${id}/finance`)}>
            <Wallet size={14} /> Finance
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/restaurants/${id}/reports`)}>
            <BarChart3 size={14} /> Reports
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowResetConfirm(true)} loading={resetPasswordMutation.isPending}>
            <Key size={14} /> Reset Password
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
              <Store size={20} />
            </div>
            <div>
              <p className="text-xs text-surface-500">Subscription Plan</p>
              <p className="text-lg font-bold text-surface-900 dark:text-surface-100 capitalize">{restaurant.plan}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2.5 text-success">
              <Monitor size={20} />
            </div>
            <div>
              <p className="text-xs text-surface-500">Active Devices</p>
              <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {restaurant.devices} / {restaurant.maxDevices}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-info/10 p-2.5 text-info">
              <Cpu size={20} />
            </div>
            <div>
              <p className="text-xs text-surface-500">AI Assistant</p>
              <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {restaurant.aiEnabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2.5 text-warning">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-xs text-surface-500">Subscription Status</p>
              <p className={`text-lg font-bold capitalize ${subscription?.status === 'active' || subscription?.status === 'trial' ? 'text-success' : subscription?.status === 'grace' ? 'text-warning' : 'text-danger'}`}>
                {subscription?.status || restaurant.status}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Professional Tabs Navigation */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 overflow-x-auto">
        {[
          { id: 'overview', label: 'Overview', icon: Building },
          { id: 'subscription', label: 'Subscription', icon: CreditCard },
          { id: 'branches', label: 'Branches', icon: Building2 },
          { id: 'usage', label: 'Usage', icon: Activity },
          { id: 'settings', label: 'Restaurant Settings', icon: Settings },
          { id: 'devices', label: 'Users & Devices', icon: Monitor },
          { id: 'security', label: 'Security & Credentials', icon: Shield },
          { id: 'timeline', label: 'Activity Timeline', icon: Clock },
          { id: 'notes', label: `Admin Notes (${restaurant.adminNotes?.length || 0})`, icon: FileText },
          { id: 'analytics', label: 'Usage Analytics', icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Contents */}
      <div className="space-y-6">
        {activeTab === 'overview' && (
          <>
            {/* Subscription & Limit Cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Subscription</p>
                    <p className="text-lg font-bold capitalize text-surface-900 dark:text-surface-100">{subscription?.plan || restaurant.plan}</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium mt-0.5 ${
                      subscription?.status === 'active' || subscription?.status === 'trial' ? 'text-success' : subscription?.status === 'grace' ? 'text-warning' : 'text-danger'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        subscription?.status === 'active' || subscription?.status === 'trial' ? 'bg-success' : subscription?.status === 'grace' ? 'bg-warning' : 'bg-danger'
                      }`} />
                      {subscription?.status || 'active'}
                    </span>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-success/10 p-2.5 text-success">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Branch Usage</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                      {restaurant.branchCount ?? branchUsage?.usage?.totalBranches ?? '?'} / {branchUsage?.maxBranches === 0 ? '∞' : branchUsage?.maxBranches || subscription?.limits?.maxBranches || '?'}
                    </p>
                    {branchUsage && branchUsage.maxBranches > 0 && (
                      <div className="w-full h-1.5 bg-surface-200 rounded-full mt-1 overflow-hidden">
                        <div 
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, (branchUsage.usage.totalBranches / branchUsage.maxBranches) * 100)}%`,
                            backgroundColor: branchUsage.usage.totalBranches >= branchUsage.maxBranches ? '#ef4444' : '#22c55e'
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-info/10 p-2.5 text-info">
                    <Monitor size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Devices</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{restaurant.devices} / {restaurant.maxDevices}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-warning/10 p-2.5 text-warning">
                    <Cpu size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">AI Assistant</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{restaurant.aiEnabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Branding & Media Management */}
            <Card>
              <CardHeader><CardTitle>Branding & Media</CardTitle></CardHeader>
              <div className="space-y-4">
                {/* Cover banner */}
                <div className="relative h-40 rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700 bg-gradient-to-r from-primary-600/20 via-primary-500/10 to-surface-200 dark:from-primary-900/30 dark:to-surface-800">
                  {restaurant.coverImageUrl ? (
                    <img
                      src={resolveMediaUrl(restaurant.coverImageUrl)}
                      alt="Restaurant cover"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-surface-400">
                      <ImageIcon size={40} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                  <div className="absolute bottom-3 left-3 flex items-center gap-2">
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => { handleMediaUpload('cover', e.target.files?.[0] || undefined); e.target.value = '' }}
                    />
                    <Button size="sm" onClick={() => coverInputRef.current?.click()} loading={mediaUploading.cover}>
                      <Upload size={14} /> {restaurant.coverImageUrl ? 'Replace Cover' : 'Upload Cover'}
                    </Button>
                    {restaurant.coverImageUrl && (
                      <Button size="sm" variant="danger" onClick={() => setMediaDeleteConfirm('cover')}>
                        <Trash2 size={14} /> Remove
                      </Button>
                    )}
                  </div>
                </div>

                {/* Logo row */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 flex items-center justify-center shrink-0">
                    {restaurant.logoUrl ? (
                      <img src={resolveMediaUrl(restaurant.logoUrl)} alt="Restaurant logo" className="w-full h-full object-contain" />
                    ) : (
                      <Store size={28} className="text-surface-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">Restaurant Logo</p>
                    <p className="text-xs text-surface-500 mt-0.5">Shown on receipts, KOTs and the POS terminal. Square image recommended (JPG, PNG, WebP, GIF — max 5 MB).</p>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => { handleMediaUpload('logo', e.target.files?.[0] || undefined); e.target.value = '' }}
                      />
                      <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()} loading={mediaUploading.logo}>
                        <Upload size={14} /> {restaurant.logoUrl ? 'Replace Logo' : 'Upload Logo'}
                      </Button>
                      {restaurant.logoUrl && (
                        <Button size="sm" variant="danger" onClick={() => setMediaDeleteConfirm('logo')}>
                          <Trash2 size={14} /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Device Activity Summary Card */}
            {deviceActivitySummary ? (
              <div className="grid gap-6 md:grid-cols-4">
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                      <Activity size={20} />
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Events (24h)</p>
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                        {summaryLoading ? (
                          <span className="inline-block w-8 h-5 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                        ) : (
                          deviceActivitySummary.last24h
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                      <Activity size={20} />
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Events (7d)</p>
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                        {summaryLoading ? (
                          <span className="inline-block w-8 h-5 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                        ) : (
                          deviceActivitySummary.last7d
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-purple-50 p-2.5 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                      <Monitor size={20} />
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Active Devices</p>
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                        {summaryLoading ? (
                          <span className="inline-block w-8 h-5 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                        ) : (
                          deviceActivitySummary.uniqueDevices
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-amber-50 p-2.5 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                      <Clock size={20} />
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Total Events</p>
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                        {summaryLoading ? (
                          <span className="inline-block w-8 h-5 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                        ) : (
                          deviceActivitySummary.totalEvents
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            ) : !summaryLoading ? null : (
              <div className="grid gap-6 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-surface-100 p-2.5">
                        <div className="w-5 h-5 bg-surface-200 rounded animate-pulse" />
                      </div>
                      <div className="space-y-1">
                        <div className="h-3 w-16 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                        <div className="h-5 w-10 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Enabled Features — plan features + admin-granted add-ons */}
            {subscription?.features && subscription.features.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle>Enabled Features</CardTitle>
                    {subscription.grantedFeatures && subscription.grantedFeatures.length > 0 && (
                      <Badge variant="info" className="text-xs">
                        <Sparkles size={12} /> {subscription.grantedFeatures.length} admin grant
                        {subscription.grantedFeatures.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <div className="flex flex-wrap gap-2">
                  {subscription.features.map((f: string) => {
                    const granted = subscription.grantedFeatures?.includes(f) && !(subscription.planFeatures || []).includes(f)
                    return (
                      <Tooltip key={f} content={FEATURE_DESCRIPTIONS[f] || f.replace(/_/g, ' ')}>
                        <Badge variant={granted ? 'info' : 'success'} className="capitalize text-xs cursor-default">
                          {granted ? <Sparkles size={12} /> : <CheckCircle size={12} />} {f.replace(/_/g, ' ')}
                        </Badge>
                      </Tooltip>
                    )
                  })}
                </div>
                {subscription.grantedFeatures && subscription.grantedFeatures.length > 0 && (
                  <p className="mt-3 text-[11px] text-surface-400">
                    <Sparkles size={11} className="inline mr-1" />Badges with a sparkle are admin-granted add-ons beyond this plan.
                  </p>
                )}
              </Card>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Business Information</CardTitle></CardHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Legal Business Name</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.legalName || restaurant.name}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Brand Name</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.brandName || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">GST Number</span>
                    <span className="font-mono font-medium text-surface-900 dark:text-surface-100">{restaurant.gst || 'Not Provided'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Phone</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.phone}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-surface-500">Email</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.email || 'N/A'}</span>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader><CardTitle>Owner Information</CardTitle></CardHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Owner Name</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.ownerName}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Owner Email</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.ownerEmail}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                    <span className="text-surface-500">Owner Mobile</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.phone}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-surface-500">Emergency Contact</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{restaurant.emergencyContact || 'N/A'}</span>
                  </div>
                </div>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader><CardTitle>Address & Location</CardTitle></CardHeader>
                <div className="grid gap-4 md:grid-cols-3 text-sm">
                  <div>
                    <p className="text-xs text-surface-500">Complete Address</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100 mt-1">{restaurant.address || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">City / State</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100 mt-1">{restaurant.city || 'N/A'}, {restaurant.state || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Country & Timezone</p>
                    <p className="font-medium text-surface-900 dark:text-surface-100 mt-1">{restaurant.country || 'India'} ({restaurant.timezone || 'UTC'})</p>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}

        {activeTab === 'subscription' && (
          <div className="space-y-6">
            <Card className="p-0">
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle>Subscription & Billing Management</CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={openRenewModal} loading={renewMutation.isPending}>Renew Subscription</Button>
                  </div>
                </div>
              </div>
              {subscription?.status === 'grace' && subscription.graceEnd && (() => {
                const days = Math.max(0, Math.ceil((new Date(subscription.graceEnd as string).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                return (
                  <div className="mx-6 mb-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Subscription expired — 2-day warning active</p>
                      <p className="text-xs mt-0.5 opacity-90">
                        This restaurant will move to the <strong>Free plan</strong> (core POS only) in {days} day{days !== 1 ? 's' : ''}{' '}
                        (from {formatDate(subscription.graceEnd as string)}). Renew now to keep the current plan.
                      </p>
                    </div>
                  </div>
                )
              })()}
              {subLoading ? (
                <div className="flex items-center justify-center py-8 px-6">
                  <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : subscription ? (
                <div className="px-6 pb-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-4 p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                    <div>
                      <p className="text-xs text-surface-500">Current Plan</p>
                      <p className="text-lg font-bold capitalize text-primary-600 mt-1">{subscription.plan}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Status</p>
                      <Badge variant={subscription.status === 'active' || subscription.status === 'trial' ? 'success' : subscription.status === 'grace' ? 'warning' : 'danger'} className="mt-1">
                        {subscription.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Billing Amount</p>
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">
                        {formatCurrency(subscription.price)}{subscription.billingPeriod === 'yearly' ? '/yr' : '/mo'}
                        {currentPlan && (subscription.billingPeriod === 'yearly'
                          ? currentPlan.price > 0 && <span className="text-xs font-normal text-surface-500 ml-1">· {formatCurrency(currentPlan.price)}/mo</span>
                          : currentPlan.yearlyPrice > 0 && <span className="text-xs font-normal text-surface-500 ml-1">· {formatCurrency(currentPlan.yearlyPrice)}/yr</span>)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Auto-Renew</p>
                      <Badge variant={subscription.autoRenew ? 'success' : 'neutral'} className="mt-1">{subscription.autoRenew ? 'Enabled' : 'Disabled'}</Badge>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 p-4 rounded-xl border border-surface-200 dark:border-surface-700">
                    <div>
                      <p className="text-xs text-surface-500">Start Date</p>
                      <p className="font-semibold mt-1">{formatDate(subscription.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Expiry Date</p>
                      <p className="font-semibold mt-1">{subscription.expiryDate ? formatDate(subscription.expiryDate) : 'N/A'}</p>
                    </div>
                    {subscription.trialEnd && (
                      <div>
                        <p className="text-xs text-surface-500">Trial Ends</p>
                        <p className="font-semibold mt-1">{formatDate(subscription.trialEnd)}</p>
                      </div>
                    )}
                    {subscription.graceEnd && (
                      <div>
                        <p className="text-xs text-surface-500">Grace Period Ends</p>
                        <p className="font-semibold mt-1">{formatDate(subscription.graceEnd)}</p>
                      </div>
                    )}
                  </div>
                  {subscription.limits && (
                    <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                      <p className="text-xs font-semibold text-surface-500 mb-2">Plan Limits</p>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-surface-400">Branches</p>
                          <p className="font-bold">{subscription.limits.maxBranches === 0 ? 'Unlimited' : subscription.limits.maxBranches}</p>
                        </div>
                        <div>
                          <p className="text-xs text-surface-400">Devices per Branch</p>
                          <p className="font-bold">{subscription.limits.maxDevicesPerBranch ?? subscription.maxDevices ?? 3}</p>
                        </div>
                        <div>
                          <p className="text-xs text-surface-400">Users</p>
                          <p className="font-bold">{subscription.maxUsers ?? 5}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-6 pb-6 text-sm text-surface-500 text-center">No subscription record found for this restaurant.</div>
              )}
            </Card>

            {/* Admin Feature Grants — additional features on the current plan */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-primary-600" />
                  <CardTitle>Additional Features (Admin Grants)</CardTitle>
                </div>
              </CardHeader>
              <div className="px-6 pb-6 space-y-4">
                <p className="text-xs text-surface-500">
                  Grant features beyond this restaurant's current plan. Grants apply immediately everywhere
                  (server-side gates, POS, this page) and stay active even if the plan changes. Revoking a
                  feature the plan itself includes has no effect.
                </p>
                {!subscription ? (
                  <p className="text-sm text-surface-400 text-center py-4">Load subscription to manage feature access.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {FEATURE_CATALOG.map((f) => {
                      const inPlan = planFeatureSet.has(f.key)
                      const granted = grantedFeatureSet.has(f.key)
                      const pending = pendingFeature?.key === f.key
                      return (
                        <div
                          key={f.key}
                          className="flex items-start justify-between gap-3 rounded-xl border border-surface-200 dark:border-surface-700 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-surface-900 dark:text-surface-100">{f.label}</span>
                              {inPlan ? (
                                <Badge variant="success" className="text-[10px]">In Plan</Badge>
                              ) : granted ? (
                                <Badge variant="info" className="text-[10px]">Granted</Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[11px] text-surface-500 leading-snug">{f.description}</p>
                          </div>
                          <div className="shrink-0">
                            {inPlan ? (
                              <span className="text-[10px] text-surface-400">included</span>
                            ) : granted ? (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={pending}
                                loading={pending}
                                onClick={() => grantFeatureMutation.mutate({ feature: f.key, action: 'revoke' })}
                              >
                                Revoke
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                loading={pending}
                                onClick={() => grantFeatureMutation.mutate({ feature: f.key, action: 'grant' })}
                              >
                                Grant
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </Card>

            {/* Payment & Invoice History */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle>Payment & Invoice History</CardTitle>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      className="h-8 px-2 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      title="Start date"
                    />
                    <span className="text-xs text-surface-400">—</span>
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      className="h-8 px-2 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      title="End date"
                    />
                    <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search payments & invoices..."
                        className="h-8 pl-8 pr-3 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 w-56"
                      />
                    </div>
                    {(searchQuery || dateStart || dateEnd) && (
                      <button
                        onClick={() => { setSearchQuery(''); setDateStart(''); setDateEnd(''); }}
                        className="h-8 px-2 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
                        title="Clear filters"
                      >
                        Clear
                      </button>
                    )}
                    {paymentHistoryLoading && <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />}
                  </div>
                </div>
              </CardHeader>
              {paymentHistoryLoading ? (
                <div className="space-y-3">
                  <div className="h-8 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                  <div className="h-8 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                  <div className="h-8 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                </div>
              ) : paymentHistory ? (
                <div className="space-y-6">
                  {/* Payments */}
                  <div>
                    <p className="text-xs font-semibold text-surface-500 uppercase mb-2">Recent Payments</p>
                    {paymentHistory.payments.length === 0 ? (
                      <p className="text-sm text-surface-400 py-2">No payment records found.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-surface-200 dark:border-surface-700">
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Date</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Invoice</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Amount</th>
                              <th className="text-left py-3 text-xs text-surface-500 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentHistory.payments.map((p: any) => (
                              <tr key={p.id} className="border-b border-surface-100 dark:border-surface-800">
                                <td className="py-3 pr-4 text-surface-900 dark:text-surface-100">{formatDate(p.createdAt)}</td>
                                <td className="py-3 pr-4 font-mono text-xs text-surface-600">{p.invoiceNumber || '-'}</td>
                                <td className="py-3 pr-4 font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(p.amount)}</td>
                                <td className="py-3">
                                  <Badge variant={p.status === 'success' ? 'success' : p.status === 'created' ? 'info' : 'danger'}
                                    className="text-[10px]">
                                    {p.status}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Invoices */}
                  <div className="border-t border-surface-200 dark:border-surface-700 pt-4">
                    <p className="text-xs font-semibold text-surface-500 uppercase mb-2">Invoices</p>
                    {paymentHistory.invoices.length === 0 ? (
                      <p className="text-sm text-surface-400 py-2">No invoices generated yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-surface-200 dark:border-surface-700">
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Date</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Invoice #</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Plan</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Amount</th>
                              <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Tax (GST)</th>
                              <th className="text-left py-3 text-xs text-surface-500 font-semibold">Invoice</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentHistory.invoices.map((inv: any) => (
                              <tr key={inv.id} className="border-b border-surface-100 dark:border-surface-800">
                                <td className="py-3 pr-4 text-surface-900 dark:text-surface-100">{formatDate(inv.generatedAt)}</td>
                                <td className="py-3 pr-4 font-mono text-xs text-surface-600">{inv.invoiceNumber}</td>
                                <td className="py-3 pr-4 capitalize">{inv.plan}</td>
                                <td className="py-3 pr-4 font-semibold">{formatCurrency(inv.amount)}</td>
                                <td className="py-3 pr-4 text-surface-600">{formatCurrency(inv.tax)}</td>
                                <td className="py-3">
                                  {inv.pdfUrl ? (
                                    <a
                                      href={inv.pdfUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors"
                                    >
                                      <ExternalLink size={12} /> View
                                    </a>
                                  ) : (
                                    <span className="text-xs text-surface-400">N/A</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Pagination */}
                  {paymentHistory.totalPages > 1 && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-surface-500">
                        Page {paymentHistory.page} of {paymentHistory.totalPages}
                        {' — '}Payments: {paymentHistory.paymentTotal} · Invoices: {paymentHistory.invoiceTotal}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                          disabled={paymentsPage <= 1}
                          className="h-8 px-3 text-xs font-medium rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          ← Previous
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(paymentHistory.totalPages, 5) }, (_, i) => {
                            const start = Math.max(1, Math.min(paymentHistory.page - 2, paymentHistory.totalPages - 4))
                            const pg = start + i
                            if (pg > paymentHistory.totalPages) return null
                            return (
                              <button
                                key={pg}
                                onClick={() => setPaymentsPage(pg)}
                                className={`w-8 h-8 text-xs font-medium rounded-lg transition-colors ${
                                  pg === paymentsPage
                                    ? 'bg-primary-600 text-white'
                                    : 'border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700'
                                }`}
                              >
                                {pg}
                              </button>
                            )
                          })}
                        </div>
                        <button
                          onClick={() => setPaymentsPage((p) => Math.min(paymentHistory.totalPages, p + 1))}
                          disabled={paymentsPage >= paymentHistory.totalPages}
                          className="h-8 px-3 text-xs font-medium rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 text-sm text-surface-500 text-center">No payment records found.</div>
              )}
            </Card>

            {/* Plan Comparison Cards */}
            {plans && plans.data && plans.data.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100 mb-3">Available Plans</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  {plans.data.map((plan: any) => {
                    const isCurrent = subscription?.plan === plan.planId
                    const isUpgrade = plan.price > (subscription?.price ?? 0)
                    const isDowngrade = plan.price < (subscription?.price ?? 0)

                    return (
                      <Card key={plan.id} className={`relative flex flex-col ${isCurrent ? 'ring-2 ring-primary-500' : ''}`}>
                        {isCurrent && <span className="absolute top-2 right-2 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">Current</span>}
                        <CardHeader>
                          <CardTitle className="text-base">{plan.name}</CardTitle>
                          <p className="text-xs text-surface-500">{plan.description}</p>
                          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-2">
                            {formatCurrency(plan.price)}<span className="text-sm font-normal text-surface-400">/mo</span>
                          </p>
                          {plan.yearlyPrice > 0 && <p className="text-xs text-surface-500 mt-1">{formatCurrency(plan.yearlyPrice)}/yr</p>}
                        </CardHeader>
                        <div className="flex-1 space-y-3 text-sm">
                          <p className="text-xs font-semibold text-surface-500 uppercase">Limits</p>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="p-2 rounded-lg bg-surface-50 dark:bg-surface-800">
                              <p className="text-surface-400">Branches</p>
                              <p className="font-bold">{plan.limits?.maxBranches === 0 ? '∞' : plan.limits?.maxBranches || 1}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-surface-50 dark:bg-surface-800">
                              <p className="text-surface-400">Devices per Branch</p>
                              <p className="font-bold">{plan.limits?.maxDevicesPerBranch ?? plan.limits?.maxDevices ?? plan.maxDevices}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-surface-50 dark:bg-surface-800">
                              <p className="text-surface-400">Users</p>
                              <p className="font-bold">{plan.maxUsers}</p>
                            </div>
                          </div>
                          <p className="text-xs font-semibold text-surface-500 uppercase">Features</p>
                          <div className="flex flex-wrap gap-1">
                            {plan.features.map((f: string) => (
                              <Tooltip key={f} content={FEATURE_DESCRIPTIONS[f] || f.replace(/_/g, ' ')}>
                                <Badge variant="info" className="text-[10px] cursor-default">{f.replace(/_/g, ' ')}</Badge>
                              </Tooltip>
                            ))}
                          </div>
                        </div>

                        {/* Action Button */}
                        <div className="mt-3">
                          {isCurrent ? (
                            <Button variant="secondary" size="sm" disabled className="w-full cursor-not-allowed">
                              <CheckCircle size={14} /> Current Plan
                            </Button>
                          ) : isUpgrade ? (
                            <Button
                              size="sm"
                              className="w-full"
                              loading={changePlanMutation.isPending && planChangeTarget?.planId === plan.planId}
                              onClick={() => setPlanChangeTarget({ action: 'upgrade', planId: plan.planId, planName: plan.name })}
                            >
                              Upgrade
                            </Button>
                          ) : isDowngrade ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              loading={changePlanMutation.isPending && planChangeTarget?.planId === plan.planId}
                              onClick={() => setPlanChangeTarget({ action: 'downgrade', planId: plan.planId, planName: plan.name })}
                            >
                              Downgrade
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Feature Flags</CardTitle></CardHeader>
              <div className="grid gap-4 md:grid-cols-2 text-sm">
                <div className="flex items-center justify-between p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <div>
                    <p className="font-medium">AI Assistant</p>
                    <p className="text-xs text-surface-500">Voice inventory & smart insights</p>
                  </div>
                  <Badge variant={restaurant.aiEnabled ? 'success' : 'neutral'}>{restaurant.aiEnabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <div>
                    <p className="font-medium">Loyalty Program</p>
                    <p className="text-xs text-surface-500">Customer points & rewards</p>
                  </div>
                  <Badge variant={restaurant.loyaltyEnabled ? 'success' : 'neutral'}>{restaurant.loyaltyEnabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <div>
                    <p className="font-medium">Offline Mode Sync</p>
                    <p className="text-xs text-surface-500">Local-first queuing</p>
                  </div>
                  <Badge variant={restaurant.offlineMode ? 'success' : 'neutral'}>{restaurant.offlineMode ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <div>
                    <p className="font-medium">Weather Module</p>
                    <p className="text-xs text-surface-500">Local weather widget</p>
                  </div>
                  <Badge variant={restaurant.weatherEnabled ? 'success' : 'neutral'}>{restaurant.weatherEnabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader><CardTitle>POS & Billing Configuration</CardTitle></CardHeader>
              <div className="grid gap-4 md:grid-cols-3 text-sm">
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">Currency</p>
                  <p className="font-semibold mt-1">{restaurant.currency || 'INR'}</p>
                </div>
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">Timezone</p>
                  <p className="font-semibold mt-1">{restaurant.timezone || 'UTC'}</p>
                </div>
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">GST Enabled</p>
                  <Badge variant={restaurant.gstEnabled ? 'success' : 'neutral'} className="mt-1">{restaurant.gstEnabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">Tax Mode</p>
                  <p className="font-semibold mt-1">{restaurant.taxMode || 'Inclusive'}</p>
                </div>
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">Printer Type</p>
                  <p className="font-semibold mt-1">{restaurant.printerType || 'Thermal 80mm'}</p>
                </div>
                <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
                  <p className="text-xs text-surface-500">Receipt Width</p>
                  <p className="font-semibold mt-1">{restaurant.receiptWidth || '80mm'}</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'devices' && (
          <div className="space-y-4">
            {/* Device Limit Card */}
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Device Limit: {restaurant.devices} / {restaurant.maxDevices} in use</p>
                  <p className="text-xs text-surface-500 mt-0.5">Maximum concurrent POS terminals allowed for this plan.</p>
                </div>
              </div>
            </Card>

            {/* Device List Table */}
            <Card>
              <CardHeader><CardTitle>Registered POS Devices</CardTitle></CardHeader>
              {deviceListLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : deviceList && deviceList.data.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200 dark:border-surface-700">
                        <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Device</th>
                        <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Platform</th>
                        <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Last Seen</th>
                        <th className="text-left py-3 pr-4 text-xs text-surface-500 font-semibold">Status</th>
                        <th className="text-right py-3 text-xs text-surface-500 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deviceList.data.map((d: Device) => (
                        <tr key={d.id} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                          <td className="py-3 pr-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-primary-600 dark:text-primary-400">{d.deviceName}</span>
                              <code className="text-[10px] text-surface-400">{d.deviceId.substring(0, 12)}...</code>
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex flex-col">
                              <span className="text-xs text-surface-700 dark:text-surface-300">{d.os} {d.osVersion?.substring(0, 20)}</span>
                              <span className="text-[10px] text-surface-400">v{d.appVersion}</span>
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            {d.lastLogin ? (
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-surface-900 dark:text-surface-100">{relativeTime(d.lastLogin)}</span>
                                <span className="text-[10px] text-surface-400">{formatDateTime(d.lastLogin)}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-surface-400">Never</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant={d.status === 'active' ? 'success' : d.status === 'blocked' ? 'danger' : 'neutral'}>
                              {d.status}
                            </Badge>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => { setActivityDevice(d); setActivityPage(1); }}>
                                <Activity size={13} className="mr-1" />
                                Log
                              </Button>
                              {d.status === 'active' ? (
                                <Button variant="ghost" size="sm" onClick={() => setDeviceConfirmAction({ device: d, type: 'block' })}>
                                  Block
                                </Button>
                              ) : d.status === 'blocked' ? (
                                <Button variant="ghost" size="sm" onClick={() => setDeviceConfirmAction({ device: d, type: 'unblock' })}>
                                  Unblock
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Pagination */}
                  {deviceList.totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-surface-200 dark:border-surface-700">
                      <span className="text-xs text-surface-400">
                        Page {deviceList.page} of {deviceList.totalPages} · {deviceList.total} device{deviceList.total !== 1 ? 's' : ''}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" disabled={devicePage <= 1}
                          onClick={() => setDevicePage(p => Math.max(1, p - 1))}>
                          Previous
                        </Button>
                        <Button variant="secondary" size="sm" disabled={devicePage >= deviceList.totalPages}
                          onClick={() => setDevicePage(p => p + 1)}>
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-surface-500">
                  <Monitor size={32} className="mx-auto mb-2 text-surface-300" />
                  <p>No devices registered for this restaurant yet.</p>
                  <p className="text-xs text-surface-400 mt-1">Devices will appear here once staff log in from a POS terminal.</p>
                </div>
              )}
            </Card>

            {/* Activity Log Modal */}
            <Modal
              open={!!activityDevice}
              onClose={() => setActivityDevice(null)}
              title={activityDevice ? `Activity Log — ${activityDevice.deviceName}` : ''}
              size="2xl"
            >
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                {activityLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <ActivityTimeline events={activityData?.data || []} />
                )}
              </div>
              {activityData && activityData.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-surface-200 pt-3 dark:border-surface-700">
                  <span className="text-xs text-surface-400">Page {activityPage} of {activityData.totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={activityPage <= 1}
                      onClick={() => setActivityPage(p => Math.max(1, p - 1))}>Previous</Button>
                    <Button variant="secondary" size="sm" disabled={activityPage >= activityData.totalPages}
                      onClick={() => setActivityPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Button variant="secondary" onClick={() => setActivityDevice(null)}>Close</Button>
              </div>
            </Modal>

            {/* Block/Unblock Confirm Dialog */}
            <ConfirmDialog
              open={!!deviceConfirmAction}
              onClose={() => setDeviceConfirmAction(null)}
              onConfirm={() => {
                if (!deviceConfirmAction) return
                if (deviceConfirmAction.type === 'block') blockDeviceMutation.mutate(deviceConfirmAction.device.id)
                else unblockDeviceMutation.mutate(deviceConfirmAction.device.id)
                setDeviceConfirmAction(null)
              }}
              title={deviceConfirmAction?.type === 'block' ? 'Block Device' : 'Unblock Device'}
              message={deviceConfirmAction?.type === 'block'
                ? `Are you sure you want to block device "${deviceConfirmAction?.device.deviceName}"? It will be disconnected from the POS system.`
                : `Re-enable device "${deviceConfirmAction?.device.deviceName}"?`}
              confirmLabel={deviceConfirmAction?.type === 'block' ? 'Block' : 'Unblock'}
              variant={deviceConfirmAction?.type === 'block' ? 'danger' : 'primary'}
            />
          </div>
        )}

        {activeTab === 'security' && (
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Security & Access Credentials</CardTitle></CardHeader>
            <div className="text-sm">
              <div className="p-4 -mx-4 rounded-xl border border-surface-200 dark:border-surface-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Owner POS Login User ID</p>
                    <code className="text-xs font-mono bg-surface-100 dark:bg-surface-800 px-2 py-1 rounded mt-1 inline-block">{restaurant.ownerUserId || 'owner_default'}</code>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowRegenerateConfirm(true)} loading={regenerateMutation.isPending}>Regenerate Credentials</Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {activeTab === 'timeline' && (
          <Card>
            <CardHeader><CardTitle>Activity Audit Trail</CardTitle></CardHeader>
            <div className="space-y-3">
              {(restaurant.auditTrail || []).length === 0 ? (
                <p className="text-sm text-surface-500 py-4 text-center">No audit events recorded yet.</p>
              ) : (
                (restaurant.auditTrail || []).map((event: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 text-sm">
                    <Clock size={16} className="text-primary-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-surface-900 dark:text-surface-100">{event.action}</p>
                      <p className="text-xs text-surface-500 mt-0.5">Admin: {event.admin} · {formatDateTime(event.timestamp)} {event.reason ? `· Reason: ${event.reason}` : ''}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        {activeTab === 'notes' && (
          <Card>
            <CardHeader><CardTitle>Internal Admin Notes</CardTitle></CardHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add internal note for support team..." />
                <Button onClick={async () => {
                  if (!newNote.trim()) return
                  try {
                    await addAdminNote(id!, newNote)
                    toast.success('Note added successfully')
                    setNewNote('')
                    refetch()
                  } catch (err: any) {
                    toast.error(err?.response?.data?.message || 'Failed to add note')
                  }
                }}>Add Note</Button>
              </div>
              <div className="space-y-3 pt-2">
                {(restaurant.adminNotes || []).map((n: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 text-sm">
                    <p className="text-surface-900 dark:text-surface-100">{n.note}</p>
                    <p className="text-xs text-surface-400 mt-1">{n.admin} · {formatDateTime(n.timestamp)}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {activeTab === 'branches' && (
          <Card className="p-0">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>Branch Management</CardTitle>
                <Button
                  size="sm"
                  onClick={() => {
                    if (branchUsage && typeof branchUsage.usage.remainingBranches === 'number' && branchUsage.usage.remainingBranches <= 0) {
                      toast.error(`Branch limit reached. Your plan allows ${branchUsage.maxBranches} branches. Upgrade to create more.`);
                      return;
                    }
                    setShowCreateBranchModal(true);
                  }}
                  disabled={branchUsageLoading}
                >
                  <Plus size={14} /> Add Branch
                </Button>
              </div>
            </div>
            {branchUsageLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : branchUsage ? (
              <div className="px-6 pb-6 space-y-4">
                {/* Summary & Limit Bar */}
                <div className="grid gap-4 md:grid-cols-4 p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <div>
                    <p className="text-xs text-surface-500">Total Branches</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{branchUsage.usage.totalBranches}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Active</p>
                    <p className="text-lg font-bold text-success">{branchUsage.usage.activeBranches}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Limit</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{branchUsage.maxBranches === 0 ? 'Unlimited' : branchUsage.maxBranches}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500">Remaining</p>
                    <p className={`text-lg font-bold ${typeof branchUsage.usage.remainingBranches === 'number' && branchUsage.usage.remainingBranches <= 0 ? 'text-danger' : 'text-surface-900 dark:text-surface-100'}`}>
                      {branchUsage.usage.remainingBranches}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                {branchUsage.maxBranches > 0 && (
                  <div>
                    <div className="w-full h-2.5 bg-surface-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (branchUsage.usage.totalBranches / branchUsage.maxBranches) * 100)}%`,
                          backgroundColor: branchUsage.usage.totalBranches >= branchUsage.maxBranches ? '#ef4444' : '#22c55e',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Limit reached warning */}
                {typeof branchUsage.usage.remainingBranches === 'number' && branchUsage.usage.remainingBranches <= 0 && (
                  <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>Branch limit reached. Your plan allows {branchUsage.maxBranches} branches. <strong>Upgrade the subscription plan</strong> to create more branches.</span>
                  </div>
                )}

                {/* Branch list */}
                <div className="divide-y divide-surface-100 dark:divide-surface-800">
                  {branchUsage.branches.length === 0 ? (
                    <div className="py-8 text-center text-sm text-surface-500">
                      <Building2 size={32} className="mx-auto mb-2 text-surface-300" />
                      <p>No branches created yet.</p>
                    </div>
                  ) : (
                    branchUsage.branches.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between py-3 text-sm">
                        <div className="flex items-center gap-2">
                          {b.isHeadBranch ? (
                            <Crown size={16} className="text-purple-500" />
                          ) : (
                            <Building2 size={16} className="text-surface-400" />
                          )}
                          <span className="font-medium">{b.name}</span>
                          {b.isHeadBranch && <Badge variant="info" className="text-[9px]">HEAD</Badge>}
                          <Badge variant={b.status === 'active' ? 'success' : 'neutral'}>{b.status}</Badge>
                        </div>
                        <span className="text-xs text-surface-500">{b.employees} employees · {b.tables} tables</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="px-6 pb-6 text-sm text-surface-500 text-center">No branch data available.</div>
            )}
          </Card>
        )}

        {activeTab === 'usage' && (
          <UsageDashboard
            data={subscriptionUsage}
            isLoading={subscriptionUsageLoading}
            onUpgrade={() => setActiveTab('subscription')}
          />
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Storage Metrics (backend-driven) */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <HardDrive size={18} className="text-primary-600" />
                  <CardTitle>Storage Usage</CardTitle>
                </div>
              </CardHeader>
              <div>
                {storageLoading || !storageMetrics ? (
                  <div className="h-24 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                        <p className="text-xs text-surface-500">Storage Used</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{formatStorage(storageMetrics.usedMB)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                        <p className="text-xs text-surface-500">Storage Limit</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{storageMetrics.isUnlimited ? 'Unlimited' : formatStorage(storageMetrics.quotaMB)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                        <p className="text-xs text-surface-500">Remaining</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{storageMetrics.isUnlimited ? '∞' : formatStorage(storageMetrics.remainingMB)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                        <p className="text-xs text-surface-500">Usage</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{storageMetrics.usagePercent}%</p>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${storageMetrics.usagePercent > 80 ? 'bg-danger' : storageMetrics.usagePercent > 60 ? 'bg-warning' : 'bg-success'}`}
                        style={{ width: `${Math.min(100, storageMetrics.usagePercent)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="neutral">Logo · {formatStorage(storageMetrics.logoSizeBytes / (1024 * 1024))}</Badge>
                      <Badge variant="neutral">Cover · {formatStorage(storageMetrics.coverSizeBytes / (1024 * 1024))}</Badge>
                      <Badge variant="neutral">{storageMetrics.imageCount} image{storageMetrics.imageCount === 1 ? '' : 's'}</Badge>
                      <Badge variant="neutral">{storageMetrics.documentCount} document{storageMetrics.documentCount === 1 ? '' : 's'}</Badge>
                      <Badge variant="neutral">{storageMetrics.totalFiles} file{storageMetrics.totalFiles === 1 ? '' : 's'} total</Badge>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {statsLoading ? (
              <div className="grid gap-6 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <div className="h-20 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                  </Card>
                ))}
              </div>
            ) : restaurantStats ? (
              <>
                {/* KPI Grid */}
                <div className="grid gap-6 md:grid-cols-4">
                  <Card>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
                        <Receipt size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-surface-500">Total Bills</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{formatNumber(restaurantStats.usage.bills)}</p>
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-success/10 p-2.5 text-success">
                        <Wallet size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-surface-500">Total Revenue</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{formatCurrency(restaurantStats.usage.revenue)}</p>
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-info/10 p-2.5 text-info">
                        <Users2 size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-surface-500">Customers</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{formatNumber(restaurantStats.usage.customers)}</p>
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-warning/10 p-2.5 text-warning">
                        <Cpu size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-surface-500">AI + Voice Requests</p>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{formatNumber(restaurantStats.usage.aiRequests + restaurantStats.usage.voiceRequests)}</p>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <Card>
                    <CardHeader><CardTitle>Operations</CardTitle></CardHeader>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Plan</span>
                        <span className="font-semibold capitalize text-primary-600">{restaurantStats.plan}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Subscription Status</span>
                        <Badge variant={restaurantStats.subscriptionStatus === 'active' || restaurantStats.subscriptionStatus === 'trial' ? 'success' : restaurantStats.subscriptionStatus === 'grace' ? 'warning' : 'danger'}>{restaurantStats.subscriptionStatus}</Badge>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Employees</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.usage.employees)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Products</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.usage.products)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Loyalty Members</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.usage.loyaltyMembers)}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-surface-500">Total Device Events</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.activity.totalEvents)}</span>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>Branches & Devices</CardTitle></CardHeader>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Total Branches</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.branchStats.total)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Active Branches</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.branchStats.active)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Head Branches</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.branchStats.headBranches)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Active Devices</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.devices.active)} / {formatNumber(restaurantStats.devices.limit)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-surface-100 dark:border-surface-800">
                        <span className="text-surface-500">Offline Devices</span>
                        <span className="font-semibold">{formatNumber(restaurantStats.devices.offline)}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-surface-500">Last Activity</span>
                        <span className="font-semibold">{restaurantStats.activity.lastActive ? formatDateTime(restaurantStats.activity.lastActive) : 'Never'}</span>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
                    {restaurantStats.activity.recent.length === 0 ? (
                      <p className="py-8 text-center text-sm text-surface-400">No activity recorded yet.</p>
                    ) : (
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {restaurantStats.activity.recent.map((ev) => (
                          <div key={ev.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-sm">
                            <Activity size={14} className="text-primary-600 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium text-surface-900 dark:text-surface-100 text-xs">{ev.event}</p>
                              <p className="text-[11px] text-surface-500 truncate">{ev.description}</p>
                              <p className="text-[10px] text-surface-400 mt-0.5">{ev.createdAt ? formatDateTime(ev.createdAt) : ''}{ev.ipAddress ? ` · IP: ${ev.ipAddress}` : ''}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </>
            ) : (
              <Card>
                <div className="p-4 text-sm text-surface-500 text-center">
                  <Activity size={32} className="mx-auto mb-2 text-surface-300" />
                  <p>No statistics available yet.</p>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Reset Password Confirm Dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => { setShowResetConfirm(false); resetPasswordMutation.mutate() }}
        title="Reset Owner Password"
        message={`Reset the owner login PIN for "${restaurant.name}"? The owner will need to use the new credentials on their next login.`}
        confirmLabel="Reset PIN"
        variant="primary"
      />

      {/* Regenerate Credentials Confirm Dialog */}
      <ConfirmDialog
        open={showRegenerateConfirm}
        onClose={() => setShowRegenerateConfirm(false)}
        onConfirm={() => { setShowRegenerateConfirm(false); regenerateMutation.mutate() }}
        title="Regenerate Credentials"
        message={`Rotate the API credentials for "${restaurant.name}"? Any existing integrations using the old secret key will stop working.`}
        confirmLabel="Regenerate"
        variant="warning"
      />

      {/* Media Delete Confirm Dialog */}
      <ConfirmDialog
        open={mediaDeleteConfirm !== null}
        onClose={() => setMediaDeleteConfirm(null)}
        onConfirm={() => { if (mediaDeleteConfirm) handleMediaDelete(mediaDeleteConfirm) }}
        title={`Remove ${mediaDeleteConfirm === 'logo' ? 'Logo' : 'Cover Image'}`}
        message={`Remove the ${mediaDeleteConfirm === 'logo' ? 'logo' : 'cover image'} from "${restaurant.name}"? The file will be permanently deleted from storage.`}
        confirmLabel="Remove"
        variant="danger"
      />

      {/* Renew Confirm Dialog */}
      <Modal
        open={showRenewConfirm}
        onClose={() => setShowRenewConfirm(false)}
        title="Renew Subscription"
        size="md"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-surface-400">
              Extends by {renewPeriod === 'yearly' ? '365 days' : '30 days'}
            </span>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowRenewConfirm(false)} disabled={renewMutation.isPending}>Cancel</Button>
              <Button onClick={() => { setShowRenewConfirm(false); renewMutation.mutate() }} loading={renewMutation.isPending}>
                Renew — {formatCurrency(renewAmount)}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800/50 text-sm">
            <p className="font-medium text-surface-900 dark:text-surface-100">{restaurant.name}</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Plan: <span className="font-semibold capitalize text-surface-700 dark:text-surface-300">{subscription?.plan || restaurant.plan}</span>
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Billing Period</label>
            <div className="grid grid-cols-2 gap-3">
              {(['monthly', 'yearly'] as const).map((period) => {
                const selected = renewPeriod === period
                const amount = period === 'yearly' ? (yearlyPrice > 0 ? yearlyPrice : monthlyPrice) : monthlyPrice
                return (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setRenewPeriod(period)}
                    className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-600'
                        : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                    }`}
                  >
                    <p className={`text-sm font-semibold capitalize ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100'}`}>{period}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                      {formatCurrency(amount)}/{period === 'yearly' ? 'yr' : 'mo'}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Plan Change Confirm Dialog */}
      <ConfirmDialog
        open={!!planChangeTarget}
        onClose={() => setPlanChangeTarget(null)}
        onConfirm={() => {
          if (!planChangeTarget) return
          changePlanMutation.mutate({ action: planChangeTarget.action, planId: planChangeTarget.planId })
        }}
        title={planChangeTarget?.action === 'upgrade' ? 'Upgrade Plan' : 'Downgrade Plan'}
        message={`Are you sure you want to ${planChangeTarget?.action} to the "${planChangeTarget?.planName}" plan?`}
        confirmLabel={planChangeTarget?.action === 'upgrade' ? 'Upgrade' : 'Downgrade'}
        variant={planChangeTarget?.action === 'downgrade' ? 'warning' : 'primary'}
      />

      {/* Create Branch Modal */}
      {/* Reset Password Result Modal */}
      <Modal open={!!resetResult} onClose={() => setResetResult(null)} title="Owner PIN Reset">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            The owner PIN for <strong>{restaurant.name}</strong> has been reset. Share these credentials with the owner:
          </p>
          {resetResult?.ownerUserId && (
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800/50 space-y-3">
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400">OWNER USER ID</p>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-surface-100">{resetResult.ownerUserId}</p>
              </div>
            </div>
          )}
          <p className="text-xs text-warning">The new PIN is only shown to the owner at their next POS login flow. For security, it is not returned over this API.</p>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setResetResult(null)}>Done</Button>
        </div>
      </Modal>

      {/* Regenerate Credentials Result Modal */}
      <Modal open={!!credentialsResult} onClose={() => setCredentialsResult(null)} title="Credentials Regenerated">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            New API credentials for <strong>{restaurant.name}</strong>. Store these securely — they will not be shown again:
          </p>
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800/50 space-y-3">
            <div>
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400">SECRET KEY</p>
              <p className="font-mono text-sm font-bold text-surface-900 dark:text-surface-100 break-all">{credentialsResult?.secretKey}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400">API KEY</p>
              <p className="font-mono text-sm font-bold text-surface-900 dark:text-surface-100 break-all">{credentialsResult?.apiKey}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (credentialsResult) {
                  navigator.clipboard.writeText(`Secret Key: ${credentialsResult.secretKey}\nAPI Key: ${credentialsResult.apiKey}`)
                  toast.success('Credentials copied to clipboard')
                }
              }}
            >
              Copy Credentials
            </Button>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setCredentialsResult(null)}>Done</Button>
        </div>
      </Modal>

      <Modal open={showCreateBranchModal} onClose={() => { setShowCreateBranchModal(false); setBranchForm({ name: '', address: '', phone: '', isHeadBranch: false }); }} title="Create Branch">
        <div className="space-y-4">
          <Input label="Branch Name *" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="e.g. Downtown Branch" />
          <Input label="Address" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} placeholder="Branch address" />
          <Input label="Phone" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="Phone number" />
          <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
            <input type="checkbox" checked={branchForm.isHeadBranch} onChange={(e) => setBranchForm({ ...branchForm, isHeadBranch: e.target.checked })} className="rounded border-surface-300 text-primary-600" />
            Set as Head Branch
          </label>
          {branchUsage && typeof branchUsage.usage.remainingBranches === 'number' && (
            <p className="text-xs text-surface-500">
              {branchUsage.usage.totalBranches} / {branchUsage.maxBranches === 0 ? 'Unlimited' : branchUsage.maxBranches} branches used
              {branchUsage.usage.remainingBranches > 0 && ` — ${branchUsage.usage.remainingBranches} remaining`}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => { setShowCreateBranchModal(false); setBranchForm({ name: '', address: '', phone: '', isHeadBranch: false }); }}>Cancel</Button>
          <Button onClick={() => createBranchMutation.mutate()} loading={createBranchMutation.isPending} disabled={!branchForm.name.trim()}>Create Branch</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Restaurant Information">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <Input label="Restaurant Name" value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label="Legal Business Name" value={editForm.legalName || ''} onChange={(e) => setEditForm({ ...editForm, legalName: e.target.value })} />
          <Input label="Phone" value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <Input label="Email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          <Input label="GST Number" value={editForm.gst || ''} onChange={(e) => setEditForm({ ...editForm, gst: e.target.value })} />
          <Input label="Address" value={editForm.address || ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
          <Input label="City" value={editForm.city || ''} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
          <Input label="State" value={editForm.state || ''} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
          <Button onClick={() => updateMutation.mutate(editForm)} loading={updateMutation.isPending}>Save Changes</Button>
        </div>
      </Modal>
    </div>
  )
}

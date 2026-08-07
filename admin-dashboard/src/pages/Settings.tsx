/**
 * =============================================================================
 *  Settings.tsx — Platform Settings Page
 * =============================================================================
 *
 * Sections:
 *   - Company Information (name, email, phone, address)
 *   - Default Subscription (plan, devices, trial days, AI)
 *   - AI Settings (enabled, max requests per day, model)
 *   - General Configuration (registration, maintenance, timezone, language)
 *
 * Data Sources:
 *   - GET /admin/settings/company               → Company settings
 *   - GET /admin/settings/default-subscription   → Default sub settings
 *   - GET /admin/settings/ai                     → AI settings
 *   - GET /admin/settings/general                → General settings
 *   - PUT endpoints for each section
 *
 * Component: SettingsSection — Reusable wrapper for each settings group
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { ErrorPage } from '../components/ui/ErrorPage'
import { Skeleton } from '../components/ui/Skeleton'
import {
  getCompanySettings, updateCompanySettings,
  getDefaultSubscriptionSettings, updateDefaultSubscriptionSettings,
  getAISettings, updateAISettings,
  getGeneralSettings, updateGeneralSettings,
} from '../api/settings'
import { getPlans } from '../api/subscriptionPlans'

function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-0">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <div className="space-y-5">{children}</div>
    </Card>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()

  const company = useQuery({ queryKey: ['settings', 'company'], queryFn: getCompanySettings })
  const defaultSub = useQuery({ queryKey: ['settings', 'default-subscription'], queryFn: getDefaultSubscriptionSettings })
  const ai = useQuery({ queryKey: ['settings', 'ai'], queryFn: getAISettings })
  const plans = useQuery({ queryKey: ['subscription-plans'], queryFn: () => getPlans({ limit: 100 }) })
  const general = useQuery({ queryKey: ['settings', 'general'], queryFn: getGeneralSettings })

  const [companyForm, setCompanyForm] = useState<any>({})
  const [subForm, setSubForm] = useState<any>({})
  const [aiForm, setAiForm] = useState<any>({})
  const [generalForm, setGeneralForm] = useState<any>({})

  const availablePlans = plans.data?.data || []
  const defaultPlanId = availablePlans.length > 0 ? availablePlans[0].planId : 'basic'

  // Initialize form state from fetched data — using useEffect to avoid render-time state updates
  useEffect(() => {
    if (company.data && Object.keys(companyForm).length === 0) setCompanyForm(company.data)
  }, [company.data])

  useEffect(() => {
    if (defaultSub.data && Object.keys(subForm).length === 0) {
      const planList = plans.data?.data || []
      const savedPlan = defaultSub.data.plan
      const planExists = planList.some((p: any) => p.planId === savedPlan)
      setSubForm({ ...defaultSub.data, plan: planExists ? savedPlan : (planList[0]?.planId || 'basic') })
    }
  }, [defaultSub.data, plans.data])

  useEffect(() => {
    if (ai.data && Object.keys(aiForm).length === 0) setAiForm(ai.data)
  }, [ai.data])

  useEffect(() => {
    if (general.data && Object.keys(generalForm).length === 0) setGeneralForm(general.data)
  }, [general.data])

  const updateCompany = useMutation({
    mutationFn: () => updateCompanySettings(companyForm),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings', 'company'] }); toast.success('Company settings updated') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update'),
  })

  const updateSub = useMutation({
    mutationFn: () => updateDefaultSubscriptionSettings(subForm),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings', 'default-subscription'] }); toast.success('Default subscription updated') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update'),
  })

  const updateAi = useMutation({
    mutationFn: () => updateAISettings(aiForm),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings', 'ai'] }); toast.success('AI settings updated') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update'),
  })

  const updateGeneral = useMutation({
    mutationFn: () => updateGeneralSettings(generalForm),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings', 'general'] }); toast.success('General settings updated') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update'),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Settings</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Platform configuration</p>
      </div>

      <SettingsSection title="Company Information">
        {company.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <Input label="Company Name" value={companyForm.name || ''} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
            <Input label="Email" type="email" value={companyForm.email || ''} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} />
            <Input label="Phone" value={companyForm.phone || ''} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} />
            <Input label="Address" value={companyForm.address || ''} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
            <div className="flex justify-end"><Button onClick={() => updateCompany.mutate()} loading={updateCompany.isPending}>Save Company Info</Button></div>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Default Subscription">
        {defaultSub.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Default Plan</label>
              <select value={subForm.plan || defaultPlanId} onChange={(e) => setSubForm({ ...subForm, plan: e.target.value })}
                className="block w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100">
                {plans.isLoading ? (
                  <option value="">Loading plans...</option>
                ) : availablePlans.length === 0 ? (
                  <option value="basic">Basic</option>
                ) : (
                  availablePlans.map((p: any) => (
                    <option key={p.planId} value={p.planId}>
                      {p.name}{p.price && p.price > 0 ? ` - $${p.price}/mo` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
            <Input label="Max Devices" type="number" value={subForm.maxDevices || 1} onChange={(e) => setSubForm({ ...subForm, maxDevices: parseInt(e.target.value) || 1 })} />
            <Input label="Trial Days" type="number" value={subForm.trialDays || 0} onChange={(e) => setSubForm({ ...subForm, trialDays: parseInt(e.target.value) || 0 })} />
            <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input type="checkbox" checked={subForm.aiEnabled || false} onChange={(e) => setSubForm({ ...subForm, aiEnabled: e.target.checked })} className="rounded border-surface-300 text-primary-600" />
              Enable AI by default
            </label>
            <div className="flex justify-end"><Button onClick={() => updateSub.mutate()} loading={updateSub.isPending}>Save Default Subscription</Button></div>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="AI Settings">
        {ai.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input type="checkbox" checked={aiForm.enabled || false} onChange={(e) => setAiForm({ ...aiForm, enabled: e.target.checked })} className="rounded border-surface-300 text-primary-600" />
              Enable AI Features
            </label>
            <Input label="Max Requests Per Day" type="number" value={aiForm.maxRequestsPerDay || 0} onChange={(e) => setAiForm({ ...aiForm, maxRequestsPerDay: parseInt(e.target.value) || 0 })} />
            <Input label="AI Model" value={aiForm.model || ''} onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })} />
            <div className="flex justify-end"><Button onClick={() => updateAi.mutate()} loading={updateAi.isPending}>Save AI Settings</Button></div>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="General Configuration">
        {general.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input type="checkbox" checked={generalForm.allowRegistration || false} onChange={(e) => setGeneralForm({ ...generalForm, allowRegistration: e.target.checked })} className="rounded border-surface-300 text-primary-600" />
              Allow Restaurant Registration
            </label>
            <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input type="checkbox" checked={generalForm.maintenanceMode || false} onChange={(e) => setGeneralForm({ ...generalForm, maintenanceMode: e.target.checked })} className="rounded border-surface-300 text-primary-600" />
              Maintenance Mode
            </label>
            <Input label="Timezone" value={generalForm.timezone || ''} onChange={(e) => setGeneralForm({ ...generalForm, timezone: e.target.value })} />
            <Input label="Language" value={generalForm.language || ''} onChange={(e) => setGeneralForm({ ...generalForm, language: e.target.value })} />
            <div className="flex justify-end"><Button onClick={() => updateGeneral.mutate()} loading={updateGeneral.isPending}>Save General Settings</Button></div>
          </>
        )}
      </SettingsSection>
    </div>
  )
}

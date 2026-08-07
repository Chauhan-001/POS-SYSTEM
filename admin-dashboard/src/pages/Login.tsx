/**
 * =============================================================================
 *  Login.tsx — Admin Dashboard Login Page
 * =============================================================================
 *
 * Flow:
 *   User enters userId + password + rememberMe
 *   → AuthContext.login() → POST /api/auth/admin/login
 *   → On success: redirect to redirect path (or /dashboard)
 *   → On failure: show error message
 *
 * Features:
 *   - Show/hide password toggle (Eye icon)
 *   - Remember Me checkbox (localStorage vs sessionStorage)
 *   - Form validation via react-hook-form
 *   - Auto-redirect if already authenticated
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Building2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import type { LoginCredentials } from '../types'

export default function Login() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const from = (location.state as any)?.from?.pathname || '/dashboard'

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginCredentials>({
    defaultValues: { userId: '', password: '', rememberMe: false },
  })

  if (isAuthenticated) {
    navigate(from, { replace: true })
    return null
  }

  async function onSubmit(data: LoginCredentials) {
    setLoading(true)
    setError('')
    try {
      await login(data)
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invalid userId or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 p-4 dark:bg-surface-950">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600">
            <Building2 size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Sign in to manage your platform</p>
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-700 dark:bg-surface-800">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <Input
              label="User ID"
              type="text"
              placeholder="Enter your user ID"
              error={errors.userId?.message}
              {...register('userId', { required: 'User ID is required' })}
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                error={errors.password?.message}
                {...register('password', { required: 'Password is required' })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[38px] text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                <input
                  type="checkbox"
                  className="rounded border-surface-300 text-primary-600 focus:ring-primary-500 dark:border-surface-600"
                  {...register('rememberMe')}
                />
                Remember me
              </label>
              <button type="button" className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
                Forgot password?
              </button>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              Sign In
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-surface-400 dark:text-surface-500">
          Only SUPER_ADMIN accounts can access this dashboard.
        </p>
      </div>
    </div>
  )
}

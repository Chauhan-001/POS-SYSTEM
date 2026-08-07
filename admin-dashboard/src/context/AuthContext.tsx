/**
 * =============================================================================
 *  AuthContext.tsx — Authentication State Provider
 * =============================================================================
 *
 * Purpose:
 *   Manages admin authentication state across the dashboard.
 *   Persists JWT token + user profile to localStorage or sessionStorage
 *   based on "Remember Me" preference.
 *
 * Flow:
 *   App mount → Check stored token → Validate with backend (/auth/admin/profile)
 *   Login    → POST credentials → Store token + user → Update state
 *   Logout   → Clear storage → Set user to null
 *
 * Exports:
 *   AuthProvider  — Wrap root of app to provide auth context
 *   useAuth       — Hook to access auth state and actions
 *
 * Storage Keys:
 *   auth_token  — JWT access token
 *   auth_user   — Serialized User object
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { User, LoginCredentials } from '../types'
import * as authApi from '../api/auth'

// ─── Types ───────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

// ─── Storage Helpers ─────────────────────────────────────────────

function getStoredToken(): string | null {
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token')
}

function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem('auth_user') || sessionStorage.getItem('auth_user')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = getStoredToken()
    if (token) {
      authApi
        .getProfile()
        .then((profile) => {
          setUser(profile)
          localStorage.setItem('auth_user', JSON.stringify(profile))
        })
        .catch(() => {
          localStorage.removeItem('auth_token')
          sessionStorage.removeItem('auth_token')
          localStorage.removeItem('auth_user')
          setUser(null)
        })
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await authApi.login(credentials)
    const storage = credentials.rememberMe ? localStorage : sessionStorage
    storage.setItem('auth_token', response.token)
    storage.setItem('auth_user', JSON.stringify(response.user))
    setUser(response.user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    sessionStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    sessionStorage.removeItem('auth_user')
    setUser(null)
  }, [])

  const updateUser = useCallback((updated: User) => {
    setUser(updated)
    const storage = localStorage.getItem('auth_user') ? localStorage : sessionStorage
    storage.setItem('auth_user', JSON.stringify(updated))
  }, [])

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

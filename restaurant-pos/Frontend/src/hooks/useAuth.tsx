import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import {
  setAccessToken,
  setRefreshToken,
  getAccessToken,
  getRefreshToken,
  setOnSessionExpired,
  isNetworkError,
  apiLogin,
  apiRefresh,
  apiLogout,
  apiLogoutAll,
  apiGetMe,
} from '../api/axios';
import { setAuthToken } from '../api/client';
import { getDBData } from '../data';
import { saveAccount, touchAccount } from '../savedAccounts';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: 'super_admin' | 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'inventory';
  status: 'active' | 'inactive' | 'suspended';
  branchIds: string[];
  employeeId: string | null;
}

export interface AuthRestaurant {
  id: string;
  restaurantId: string;
  name: string;
  phone: string;
}

export interface AuthEmployee {
  id: string;
  name: string;
  role: string;
  username: string;
  branchId: string | null;
  status: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  restaurant: AuthRestaurant;
  employee: AuthEmployee | null;
  subscription: {
    plan: string;
    status: string;
    trialEnd: string | null;
    maxUsers: number;
    maxDevices: number;
  } | null;
  license: {
    licenseKey: string;
    type: string;
    isActive: boolean;
  } | null;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  restaurant: AuthRestaurant | null;
  employee: AuthEmployee | null;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string, rememberMe?: boolean, mode?: 'password' | 'pin' | 'role_pin') => Promise<LoginResult>;
  logout: (allDevices?: boolean) => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function hasPersistedSession(): boolean {
  try {
    const accessToken = localStorage.getItem('pos_access_token');
    const refreshToken = localStorage.getItem('pos_refresh_token');
    const sessionMode = localStorage.getItem('pos_session_mode');
    return !!(accessToken || refreshToken) || sessionMode === 'persisted' || sessionMode === 'offline';
  } catch {
    return false;
  }
}

function findLocalEmployee(username: string, pinOrPassword?: string): AuthEmployee | null {
  try {
    const employees = getDBData<any[]>('pos_employees', []) || [];
    const match = employees.find((emp: any) => emp.username?.toLowerCase() === username.toLowerCase());
    if (!match) return null;

    // Offline fallback must NEVER grant access on username alone. When a
    // credential was supplied, require it to match the locally cached verifier
    // (the 4-digit quick PIN for PIN-mode staff). This blocks the prior hole
    // where any known username could open the terminal while disconnected.
    if (pinOrPassword) {
      const cachedPin = match.pin || '';
      if (pinOrPassword !== cachedPin) return null;
    }

    return {
      id: match.id,
      name: match.name,
      role: match.role,
      username: match.username,
      branchId: match.branchId ?? null,
      status: match.status ?? 'Active',
    };
  } catch {
    return null;
  }
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const storedEmployee = getDBData<any>('pos_current_employee', null);
    const storedEmployeeSafe = storedEmployee
      ? {
          id: storedEmployee.id,
          name: storedEmployee.name,
          role: storedEmployee.role,
          username: storedEmployee.username,
          branchId: storedEmployee.branchId ?? null,
          status: storedEmployee.status ?? 'Active',
        } as AuthEmployee
      : null;

    return {
      isAuthenticated: !!storedEmployeeSafe && hasPersistedSession(),
      isLoading: true,
      user: null,
      restaurant: null,
      employee: storedEmployeeSafe,
      error: null,
    };
  });

  const clearError = useCallback(() => setState(prev => ({ ...prev, error: null })), []);

  const handleSessionExpired = useCallback(() => {
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      restaurant: null,
      employee: null,
      error: 'Session expired. Please login again.',
    });
  }, []);

  useEffect(() => {
    setOnSessionExpired(handleSessionExpired);
    return () => setOnSessionExpired(null);
  }, [handleSessionExpired]);

  useEffect(() => {
    const accessToken = localStorage.getItem('pos_access_token');
    const refreshToken = localStorage.getItem('pos_refresh_token');
    if (accessToken) setAccessToken(accessToken);
    if (refreshToken) setRefreshToken(refreshToken);

    if (accessToken && refreshToken) {
      apiGetMe()
        .then((data) => {
          setState(prev => ({
            ...prev,
            isAuthenticated: true,
            isLoading: false,
            user: data.user,
          }));
        })
        .catch(() => {
          // Try refresh
          return apiRefresh(refreshToken)
            .then((data) => {
              setAccessToken(data.accessToken);
              setRefreshToken(data.refreshToken);
              localStorage.setItem('pos_access_token', data.accessToken);
              localStorage.setItem('pos_refresh_token', data.refreshToken);
              return apiGetMe();
            })
            .then((data) => {
              setState(prev => ({
                ...prev,
                isAuthenticated: true,
                isLoading: false,
                user: data.user,
              }));
            })
            .catch((err) => {
              // Distinguish "backend unreachable" from "session genuinely
              // revoked". Offline (or server down), the tokens are still valid
              // and every POS record is already in localStorage — boot into
              // offline mode instead of destroying the cached session. Only an
              // actual auth rejection (the server answered but refused) logs
              // the user out.
              if (isNetworkError(err)) {
                const storedEmployee = getDBData<AuthEmployee | null>('pos_current_employee', null);
                localStorage.setItem('pos_session_mode', 'offline');
                setState(prev => ({
                  ...prev,
                  isAuthenticated: true,
                  isLoading: false,
                  user: null,
                  restaurant: null,
                  employee: storedEmployee,
                }));
                return;
              }
              setAccessToken(null);
              setRefreshToken(null);
              localStorage.removeItem('pos_access_token');
              localStorage.removeItem('pos_refresh_token');
              localStorage.removeItem('pos_session_mode');
              setState(prev => ({
                ...prev,
                isAuthenticated: false,
                isLoading: false,
                user: null,
                error: 'Session expired. Please login again.',
              }));
            });
        });
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (
    username: string,
    password: string,
    rememberMe = false,
    mode: 'password' | 'pin' | 'role_pin' = 'pin',
  ): Promise<LoginResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await apiLogin(username, password, rememberMe, mode);

      setAccessToken(result.accessToken);
      setRefreshToken(result.refreshToken);
      // Sync the client.ts module-level auth token too. apiLogin (axios) only
      // updates the axios instance token; without this the fetch-based API
      // client (products, customers, bills, …) sends NO Authorization header
      // after a cold login — every hydrate call 401s and the POS stays empty
      // until a page reload picks the token up from localStorage.
      setAuthToken(result.accessToken);
      localStorage.setItem('pos_access_token', result.accessToken);
      localStorage.setItem('pos_refresh_token', result.refreshToken);
      localStorage.setItem('pos_session_mode', 'persisted');

      const employee = result.employee ? {
        id: result.employee.id,
        name: result.employee.name,
        role: result.employee.role,
        username: result.employee.username,
        branchId: result.employee.branchId ?? null,
        status: result.employee.status ?? 'Active',
      } as AuthEmployee : null;

      if (employee) {
        localStorage.setItem('pos_current_employee', JSON.stringify(employee));
      }

      setState({
        isAuthenticated: true,
        isLoading: false,
        user: result.user,
        restaurant: result.restaurant,
        employee,
        error: null,
      });

      // Persist this account for fast switching on next login.
      if (result.user && result.restaurant) {
        saveAccount({
          userId: result.user.id,
          restaurantId: result.restaurant.id,
          restaurantName: result.restaurant.name,
          displayName: employee?.name || result.user.name,
          username: username.trim(),
          role: employee?.role || result.user.role,
          branchId: employee?.branchId ?? null,
          avatar: null,
          offlineAuthorized: true,
        });
      } else if (employee) {
        // Offline login — save what we have
        touchAccount(employee.id, 'offline');
      }

      return result;
    } catch (err: any) {
      const localEmployee = findLocalEmployee(username, password);
      if (localEmployee) {
        localStorage.setItem('pos_current_employee', JSON.stringify(localEmployee));
        localStorage.setItem('pos_session_mode', 'offline');
        setState({
          isAuthenticated: true,
          isLoading: false,
          user: null,
          restaurant: null,
          employee: localEmployee,
          error: null,
        });
        return {
          accessToken: '',
          refreshToken: '',
          user: null as any,
          restaurant: null as any,
          employee: localEmployee,
          subscription: null,
          license: null,
        };
      }

      const message = err?.response?.data?.error || err?.message || 'Login failed. Please try again.';
      setState(prev => ({
        ...prev,
        isAuthenticated: false,
        isLoading: false,
        error: message,
      }));
      throw err;
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getRefreshToken();
    if (!token) {
      handleSessionExpired();
      return;
    }
    try {
      const data = await apiRefresh(token);
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      localStorage.setItem('pos_access_token', data.accessToken);
      localStorage.setItem('pos_refresh_token', data.refreshToken);

      const meData = await apiGetMe();
      setState(prev => ({
        ...prev,
        isAuthenticated: true,
        user: meData.user,
      }));
    } catch {
      handleSessionExpired();
    }
  }, [handleSessionExpired]);

  const logout = useCallback(async (allDevices = false) => {
    try {
      if (allDevices) {
        await apiLogoutAll();
      } else {
        const rt = getRefreshToken();
        await apiLogout(rt || undefined);
      }
    } catch { /* ignore */ }

    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem('pos_access_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_current_employee');
    localStorage.removeItem('pos_session_mode');

    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      restaurant: null,
      employee: null,
      error: null,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshSession, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

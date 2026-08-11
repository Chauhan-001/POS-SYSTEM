import axios from 'axios';
import { debugWarn } from '../utils/debugLog';

const BASE = '/api';

const apiClient = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
});

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _onSessionExpired: (() => void) | null = null;
let _isRefreshing = false;
let _refreshSubscribers: Array<(token: string) => void> = [];

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setRefreshToken(token: string | null) {
  _refreshToken = token;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

export function setOnSessionExpired(cb: (() => void) | null) {
  _onSessionExpired = cb;
}

/**
 * True when an axios error is a network-level failure — the server never
 * answered (no HTTP response). Distinct from an HTTP error like 401, where the
 * server DID respond. Used to keep a cached session alive while offline instead
 * of treating an unreachable backend as a revoked session.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { response?: unknown }).response === undefined;
}

function onRefreshed(token: string) {
  _refreshSubscribers.forEach((cb) => cb(token));
  _refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  _refreshSubscribers.push(cb);
}

apiClient.interceptors.request.use(
  (config) => {
    if (_accessToken) {
      config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (_isRefreshing) {
        return new Promise((resolve) => {
          addRefreshSubscriber((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      _isRefreshing = true;

      try {
        if (!_refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE}/auth/refresh`, {
          refreshToken: _refreshToken,
          deviceId: getOrCreateDeviceId(),
        });
        const newAccessToken = data.accessToken;
        const newRefreshToken = data.refreshToken;

        setAccessToken(newAccessToken);
        setRefreshToken(newRefreshToken);
        localStorage.setItem('pos_access_token', newAccessToken);
        localStorage.setItem('pos_refresh_token', newRefreshToken);

        onRefreshed(newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        if (isNetworkError(refreshError)) {
          // Backend unreachable while refreshing — keep the cached session.
          // The app is offline; logging the user out would lose the local
          // data they can already see. The original request simply fails and
          // the caller surfaces the offline state.
          return Promise.reject(refreshError);
        }
        setAccessToken(null);
        setRefreshToken(null);
        localStorage.removeItem('pos_access_token');
        localStorage.removeItem('pos_refresh_token');
        localStorage.removeItem('pos_current_employee');
        _onSessionExpired?.();
        debugWarn('Axios', 'Session expired, redirecting to login');
        return Promise.reject(refreshError);
      } finally {
        _isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Get or create the stable per-install device identifier used by the backend
 * device policy (blocked-device rejection + plan maxDevices enforcement).
 * The same key is used by App.tsx's registerDevice call, so both stay in sync.
 */
export function getOrCreateDeviceId(): string {
  try {
    let deviceId = localStorage.getItem('pos_device_id');
    if (!deviceId) {
      deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      localStorage.setItem('pos_device_id', deviceId);
    }
    return deviceId;
  } catch {
    return `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

/** Device metadata sent with login so the backend can enforce device policy. */
function getDeviceInfo() {
  return {
    deviceId: getOrCreateDeviceId(),
    deviceName: typeof navigator !== 'undefined' ? navigator.platform || 'Unknown' : 'Unknown',
    os: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
    // Backend schema caps osVersion at 80 chars — truncate the userAgent so
    // login-time device registration doesn't 400 (which would break device
    // counting/limits shown on the Subscription page).
    osVersion: typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, 80) : '',
    appVersion: '1.0.0',
  };
}

export default apiClient;

export async function apiLogin(username: string, password: string, rememberMe = false, mode: 'password' | 'pin' | 'role_pin' = 'pin') {
  const { data } = await apiClient.post('/auth/login', {
    username, password, rememberMe, mode, deviceInfo: getDeviceInfo(),
  });
  return data;
}

export async function apiRefresh(refreshToken: string) {
  const { data } = await apiClient.post('/auth/refresh', {
    refreshToken, deviceId: getOrCreateDeviceId(),
  });
  return data;
}

export async function apiLogout(refreshToken?: string) {
  await apiClient.post('/auth/logout', { refreshToken });
}

export async function apiLogoutAll() {
  await apiClient.post('/auth/logout', { allDevices: true });
}

export async function apiGetMe() {
  const { data } = await apiClient.get('/auth/me');
  return data;
}

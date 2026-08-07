/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI API Client — Shared caller for all /api/ai/* endpoints.
 * Handles auth headers, error handling, and graceful fallback.
 *
 * Usage:
 *   import { aiPost, setAiAuth } from './aiClient';
 *   setAiAuth(employeeId, employeeRole);  // Call once after login
 *   const result = await aiPost('/inventory-health', { items, wasteTotal });
 */

const BASE = '/api/ai';

interface AiResponse<T = any> {
  success: boolean;
  data: T;
  latency: number;
  fallback: boolean;
  cached?: boolean;
  error?: string;
}

// ─── Auth state ────────────────────────────────────────────────────
let _employeeId: string | null = null;
let _employeeRole: string | null = null;
let _authToken: string | null = null;

export function setAiAuth(employeeId: string | null, employeeRole: string | null) {
  _employeeId = employeeId;
  _employeeRole = employeeRole;
}

/**
 * Set the JWT auth token for API requests.
 * Called from App.tsx after login or from localStorage restore.
 */
export function setAiToken(token: string | null) {
  _authToken = token;
}

export function getAiAuth() {
  return { employeeId: _employeeId, employeeRole: _employeeRole };
}

export function getAiToken() {
  return _authToken;
}

/**
 * Resolve the JWT to use for AI requests. Prefers the in-memory token synced
 * by App.tsx; falls back to localStorage so the AI client also picks up tokens
 * rotated by the axios refresh interceptor (which only writes localStorage and
 * never calls setAiToken).
 */
function getEffectiveToken(): string | null {
  if (_authToken) return _authToken;
  try {
    return localStorage.getItem('pos_access_token') || localStorage.getItem('pos_auth_token');
  } catch {
    return null;
  }
}

// ─── Generic AI POST ───────────────────────────────────────────────

export async function aiPost<T = any>(
  endpoint: string,
  body: Record<string, any>,
  signal?: AbortSignal,
): Promise<AiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add JWT auth token if available (preferred)
  const effectiveToken = getEffectiveToken();
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  } else {
    // Fallback: legacy header-based auth
    if (_employeeId) headers['x-employee-id'] = _employeeId;
    if (_employeeRole) headers['x-employee-role'] = _employeeRole;
  }

  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[AiClient] POST ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`);
      return { success: false, data: null as any, latency: 0, fallback: true, error: `HTTP ${res.status}` };
    }

    const json: AiResponse<T> = await res.json();
    return json;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`[AiClient] POST ${endpoint} aborted`);
      return { success: false, data: null as any, latency: 0, fallback: true, error: 'Request aborted' };
    }
    console.warn(`[AiClient] POST ${endpoint} failed:`, err.message);
    return { success: false, data: null as any, latency: 0, fallback: true, error: err.message };
  }
}

// ─── AI STATUS CHECK ───────────────────────────────────────────────

export async function checkAiStatus(): Promise<{
  enabled: boolean;
  provider: string;
  features: string[];
}> {
  try {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return { enabled: false, provider: 'unavailable', features: [] };
    return await res.json();
  } catch {
    return { enabled: false, provider: 'unavailable', features: [] };
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ownerRecommendationSetup.ts — HTTP test helpers for the
 * Owner → Recommendation → Offer → Customer E2E suite.
 *
 * REUSES the existing Recommendation Accuracy Audit tenants (see
 * backend/scripts/audit-recommendations.mjs) — no second dataset is created.
 * All backend calls here are TEST SETUP / STATE VERIFICATION only; the owner
 * journey itself is exercised through the real POS UI by the spec.
 *
 * The tenants must be seeded first (see backend/):  npm run audit:recommendations
 * If they are missing, discovery fails with a clear message.
 */

export const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:3002/api';
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '1008';
export const PIN_A = process.env.E2E_TENANT_A_PIN || '1010';
export const PIN_B = process.env.E2E_TENANT_B_PIN || '2020';
export const NAME_A = 'AI Recommendation Accuracy Test Restaurant';
export const NAME_B = 'Isolation Test Restaurant B';

export interface TenantInfo {
  id: string;
  name: string;
  ownerUsername: string;
  pin: string;
  publicToken: string;
  accessToken: string;
}

export interface ApiResult {
  status: number;
  json: any;
  ok: boolean;
}

/** Tiny fetch wrapper with auth + status capture (never throws on HTTP errors). */
export async function api(
  path: string,
  opts: { method?: string; token?: string; body?: any } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e: any) {
    return { status: 0, ok: false, json: { error: `network: ${e?.message || e}` } };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, json };
}

async function adminLogin(): Promise<string> {
  const r = await api('/auth/admin/login', { method: 'POST', body: { userId: ADMIN_USER, password: ADMIN_PASS } });
  if (!r.ok) throw new Error(`Admin login failed (${r.status}) — is the backend running on ${BACKEND_URL}?`);
  return r.json.token;
}

/**
 * Discover the two audit tenants through the real admin API (no direct DB
 * access). Fails with actionable guidance if they have not been seeded.
 */
export async function discoverTenants(): Promise<{ a: TenantInfo; b: TenantInfo }> {
  const health = await api('/health');
  if (!health.ok) throw new Error(`Backend not healthy at ${BACKEND_URL} (status ${health.status}). Start it first.`);

  const adminToken = await adminLogin();
  const list = await api('/admin/restaurants?search=accuracy', { token: adminToken });
  const arr = Array.isArray(list.json) ? list.json : list.json?.restaurants || list.json?.data || [];

  const find = (name: string): any => arr.find((r: any) => r?.name === name);
  const ra = find(NAME_A);
  const rb = find(NAME_B);
  if (!ra || !rb) {
    throw new Error(
      'Audit tenants not found. Seed them first (from backend/):  npm run audit:recommendations\n' +
        `Looked for "${NAME_A}" and "${NAME_B}" via the admin API.`,
    );
  }

  const login = async (owner: any, pin: string): Promise<TenantInfo> => {
    const r = await api('/auth/login', { method: 'POST', body: { username: owner.ownerUserId, password: pin } });
    if (!r.ok) throw new Error(`Owner login failed for ${owner.ownerUserId} (${r.status}) — ${JSON.stringify(r.json).slice(0, 160)}`);
    return {
      id: String(owner._id || owner.id),
      name: owner.name,
      ownerUsername: owner.ownerUserId,
      pin,
      publicToken: owner.publicToken,
      accessToken: r.json.accessToken,
    };
  };

  const [a, b] = await Promise.all([login(ra, PIN_A), login(rb, PIN_B)]);
  return { a, b };
}

/** Normalize GET /offers responses ({ offers: [] } | [] | { data: [] }). */
export function normalizeOffers(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.offers)) return json.offers;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

export async function fetchOffers(token: string): Promise<any[]> {
  const r = await api('/offers', { token });
  if (!r.ok) throw new Error(`GET /offers failed (${r.status})`);
  return normalizeOffers(r.json);
}

export async function fetchRecommendations(token: string, limit = 30): Promise<any[]> {
  const r = await api('/offers/recommendations', { method: 'POST', token, body: { limit } });
  if (!r.ok) throw new Error(`POST /offers/recommendations failed (${r.status})`);
  return r.json?.suggestions || [];
}

/** Publish (activate) an offer — the exact endpoint the Offers-page UI calls. */
export async function publishOffer(token: string, offerId: string): Promise<ApiResult> {
  return api(`/offers/${offerId}/status`, { method: 'PATCH', token, body: { status: 'active' } });
}

export async function deleteOffer(token: string, offerId: string): Promise<ApiResult> {
  return api(`/offers/${offerId}`, { method: 'DELETE', token });
}

/** Customer-facing public-store offers for a restaurant public token. */
export async function fetchPublicOffers(publicToken: string): Promise<any[]> {
  const r = await api(`/public-store/${publicToken}/offers`);
  if (!r.ok) return [];
  const json = r.json;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.offers)) return json.offers;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

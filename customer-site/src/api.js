import axios from 'axios';

/**
 * Customer QR ordering site — API client pinned to ONE public-store token.
 *
 * The token comes from the QR sticker URL and is set once at boot
 * (SessionProvider). Every request is then scoped to that restaurant:
 *   GET  {token}                    → store config
 *   GET  {token}/menu               → menu with SOLD OUT states
 *   POST {token}/orders/precheck    → validate a cart (no side effects)
 *   POST {token}/orders             → place an order (authoritative)
 *   GET  {token}/orders/:clientRef  → live tracking
 *   POST {token}/requests           → call waiter / water / bill / assistance
 *
 * Dev default points at the POS backend on :3002. When no VITE_API_URL is
 * set, the backend origin is derived from the page's own hostname — so a QR
 * sticker scanned from a phone on the LAN (http://<lan-ip>:5177) also reaches
 * the backend at http://<lan-ip>:3002 instead of the phone's localhost.
 * Production can build with VITE_API_URL='/api/public-store' for same-origin.
 */
const API_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:3002/api/public-store`;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

let token = null;
export function setToken(t) {
  token = t || null;
}

// Every request is scoped to the QR's restaurant token.
api.interceptors.request.use((config) => {
  if (token) {
    config.url = `/${token}${config.url || ''}`;
  }
  return config;
});

/** Pull a human-readable message out of an axios error. */
export function errMsg(err, fallback = 'Something went wrong') {
  return err?.response?.data?.error || err?.message || fallback;
}

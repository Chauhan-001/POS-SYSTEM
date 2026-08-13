import { io } from 'socket.io-client';

/**
 * Live order updates from the POS backend (Socket.IO).
 * The track page joins the `order:<clientRef>` room — a capability URL that
 * only the customer who placed the order knows — and hears `order:updated`
 * pushes instantly. Polling remains as a safety net.
 */
// Mirrors api.js: without VITE_API_URL the backend origin follows the page's
// own hostname, so LAN-scanned stickers reach the backend via the LAN IP.
const API_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:3002/api/public-store`;
const BACKEND_ORIGIN = API_URL.startsWith('/')
  ? window.location.origin
  : new URL(API_URL).origin;

let socket = null;
let currentRef = null;

/** Lazy singleton socket pinned to one clientRef (reconnects when it changes). */
export function getSocket(clientRef) {
  if (socket && currentRef === clientRef) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentRef = clientRef || null;
  socket = io(BACKEND_ORIGIN, {
    transports: ['websocket', 'polling'],
    query: currentRef ? { clientRef: currentRef } : {},
  });
  return socket;
}

/** Force a fresh socket (tests / token change). */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
  currentRef = null;
}

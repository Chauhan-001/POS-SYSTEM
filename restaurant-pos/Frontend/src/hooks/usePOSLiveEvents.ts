/**
 * usePOSLiveEvents — live Socket.IO bridge between the POS and the backend.
 *
 * Joins the restaurant's socket room (auth via the POS JWT) and surfaces:
 *   - `order:created`  → toast for every new online/QR order (the order list
 *                        already polls, this makes it feel instant)
 *   - `order:updated`  → toast when a customer-tracked order hits Ready
 *   - `waiter:call`    → toast for customer service requests (water/bill/…)
 *
 * Fully best-effort: if the backend has no socket layer, the socket fails to
 * connect and the POS simply falls back to its existing polling — nothing here
 * ever throws or blocks rendering.
 */
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthToken } from '../api/client';

/** Backend origin: same-origin in production/Electron; localhost:3002 in dev. */
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://localhost:3002' : window.location.origin);

export function usePOSLiveEvents(
  showToast?: (message: string, type?: 'success' | 'info' | 'warning') => void,
  onOrderAdjusted?: (orderId: string) => void
) {
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const adjustedRef = useRef(onOrderAdjusted);
  adjustedRef.current = onOrderAdjusted;
  const lastReadyOrderRef = useRef<string | null>(null);

  useEffect(() => {
    let socket: Socket | null = null;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    /** Token the current socket was created with (to detect login/logout). */
    let connectedToken: string | null = null;

    const connect = () => {
      if (disposed) return;
      const token = getAuthToken();
      // Not signed in (the effect runs on App mount, before login; also after
      // logout). Drop any live socket and poll for the token so the socket
      // comes up again as soon as the user signs in — otherwise the
      // new-online-order toast would never fire after a fresh login.
      if (!token) {
        if (socket) {
          socket.disconnect();
          socket = null;
          connectedToken = null;
        }
        retry = setTimeout(connect, 1500);
        return;
      }
      // Already live with this exact token — nothing to do.
      if (socket && connectedToken === token) return;
      // Token changed (logout → login as a different user): drop the old room.
      connectedToken = token;
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 4000,
      });

      // If socket.io exhausts its reconnect attempts (e.g. backend was down
      // for a while), drop the dead socket and re-enter the poll loop so a
      // backend restart still reconnects instead of going silent forever.
      socket.on('disconnect', (reason: string) => {
        if (disposed || !socket) return;
        if (reason === 'io client disconnect' || reason === 'io server disconnect') return;
        socket.disconnect();
        socket = null;
        connectedToken = null;
        retry = setTimeout(connect, 3000);
      });

      socket.on('order:created', (payload: any) => {
        if (!payload?.orderNumber) return;
        const mode = payload.mode ? ` · ${String(payload.mode).toLowerCase()}` : '';
        const where = payload.parkingSlot
          ? ` · Slot ${payload.parkingSlot}`
          : payload.tableNumber
            ? ` · Table ${payload.tableNumber}`
            : '';
        toastRef.current?.(`🛒 New online order #${payload.orderNumber}${mode}${where}`, 'success');
      });

      socket.on('order:updated', (payload: any) => {
        // Adjustments push an `adjusted: true` flag — other terminals must
        // refetch orders so the KDS shows cancelled KOT lines immediately.
        if (payload?.adjusted && payload?.orderId) {
          adjustedRef.current?.(payload.orderId);
        }
        if (payload?.status === 'Ready' && payload?.orderId && lastReadyOrderRef.current !== payload.orderId) {
          lastReadyOrderRef.current = payload.orderId;
          toastRef.current?.(`🔔 Order #${payload.orderNumber ?? payload.orderId.slice(-4)} is ready`, 'info');
        }
      });

      socket.on('waiter:call', (payload: any) => {
        const labels: Record<string, string> = {
          WATER: '💧 Water',
          BILL: '🧾 Bill',
          ASSISTANCE: '🙋 Assistance',
          CLEANING: '🧻 Cleaning',
          CALL_WAITER: '🛎️ Call waiter',
        };
        const what = labels[payload?.type] || '🛎️ Waiter call';
        const where = payload?.parkingSlot
          ? `Slot ${payload.parkingSlot}`
          : payload?.carPlate
            ? `Car ${payload.carPlate}`
            : payload?.tableId
              ? 'Table'
              : '';
        toastRef.current?.(`${what}${where ? ` · ${where}` : ''}`, 'info');
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.disconnect();
    };
  }, []);
}

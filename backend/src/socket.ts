/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * socket.ts — Socket.IO live layer for the QR ordering ecosystem.
 *
 * Rooms (server-side routing, no client-managed state):
 *   - `restaurant:<restaurantId>`  → POS terminals. Joining requires a valid
 *     POS access token (handed in `auth.token` at connect time).
 *   - `order:<clientRef>`          → the customer track page for one order.
 *     The clientRef is an opaque 80-char-max capability that only the customer
 *     who placed the order knows, so no auth is required to follow it.
 *
 * Events (all emitted server-side; see the public-store service + orderService):
 *   - `order:created` → { orderId, orderNumber, clientRef, status, grandTotal,
 *                         mode, items } — POS new-online-order banner.
 *   - `order:updated` → { orderId, clientRef, status, timeline? } — POS badge
 *                        + customer live tracking.
 *   - `waiter:call`   → { id, type, tableId, tableNumber, parkingSlot,
 *                         carPlate, message, createdAt } — POS service bell.
 */

import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { config } from './config';
import { verifyAccessToken } from './utils/jwt';

let io: Server | null = null;

const CLIENT_REF_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;

/** Attach Socket.IO to the HTTP server. Call once during startup. */
export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: config.nodeEnv === 'development' ? true : [config.corsOrigin, ...config.adminCorsOrigins],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    // POS terminals: auth.token → restaurant room.
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) {
      const payload = verifyAccessToken(authToken);
      if (payload?.restaurantId) {
        socket.join(`restaurant:${payload.restaurantId}`);
      }
    }
    // Customer track page: order:<clientRef> room (capability URL = auth).
    const clientRef = socket.handshake.query?.clientRef;
    if (typeof clientRef === 'string' && CLIENT_REF_PATTERN.test(clientRef)) {
      socket.join(`order:${clientRef}`);
    }
  });

  return io;
}

/** Broadcast an event to every POS terminal of one restaurant. */
export function emitToRestaurant(
  restaurantId: string | mongoose.Types.ObjectId | undefined | null,
  event: string,
  payload: unknown
): void {
  if (!restaurantId) return;
  io?.to(`restaurant:${String(restaurantId)}`).emit(event, payload);
}

/** Broadcast an event to the customer track page following one order. */
export function emitToOrder(clientRef: string | undefined | null, event: string, payload: unknown): void {
  if (!clientRef || !CLIENT_REF_PATTERN.test(clientRef)) return;
  io?.to(`order:${clientRef}`).emit(event, payload);
}

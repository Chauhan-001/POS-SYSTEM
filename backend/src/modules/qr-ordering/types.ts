/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Ordering Module Types
 */

export interface IQRRequest {
  id: string;
  sessionId: string;
  restaurantId: string;
  branchId?: string;
  orderType: 'TABLE' | 'CAR' | 'TAKEAWAY' | 'PICKUP';
  tableId?: string;
  carId?: string;
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  type: 'CALL_WAITER' | 'WATER' | 'BILL' | 'CLEANING' | 'PLATE' | 'SPOON' | 'ASSISTANCE' | 'ORDER_READY';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'SEEN' | 'ACCEPTED' | 'COMPLETED' | 'ARCHIVED';
  message?: string;
  items?: string;
  quantity?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IQRNotification extends IQRRequest {
  sound?: string;
  badge?: number;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface IQRSession {
  sessionId: string;
  restaurantId: string;
  branchId?: string;
  tableId?: string;
  carId?: string;
  orderType: 'TABLE' | 'CAR' | 'TAKEAWAY' | 'PICKUP';
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  cart?: {
    items: Array<Record<string, any>>;
    subtotal: number;
    discount?: number;
    gst?: number;
    grandTotal: number;
  };
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IQRSettings {
  enableQROrdering?: boolean;
  enableGuestOrdering?: boolean;
  guestOrderingRequireMobileNumber?: 'NEVER' | 'OPTIONAL' | 'MANDATORY';
  allowOnlinePayment?: boolean;
  acceptCashAtCounter?: boolean;
  maxActiveSessions?: number;
  sessionTimeout?: number;
  qrBaseUrl?: string;
}

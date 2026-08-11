/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Ordering Routes — API endpoints for the QR ordering module
 *
 * Route prefix: /api/qr-ordering
 *
 * All endpoints require authentication. Note: the 'qr_ordering' plan feature
 * gate was removed — customer self-ordering now flows through the public-store
 * module (no subscription gate, same as online ordering) and the POS-side
 * session/request management must work for every restaurant with the module
 * enabled. Rate limiting applies to prevent abuse.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  createCustomerRequest,
  listCustomerRequests,
  getCustomerRequest,
  updateCustomerRequest,
  deleteCustomerRequest,
  assignRequest,
  completeRequest,
  heartbeatSession,
  getExpiredSessions,
} from '../controllers/qrOrderingController';

// Request validation schemas (zod — validated before the controller runs)
const orderTypeEnum = z.enum(['TABLE', 'CAR', 'TAKEAWAY', 'PICKUP']);
const customerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
}).optional();
const cartSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  subtotal: z.number().optional(),
  discount: z.number().optional(),
  gst: z.number().optional(),
  grandTotal: z.number().optional(),
}).optional();

const sessionCreateSchema = z.object({
  sessionId: z.string().min(1).trim(),
  restaurantId: z.string().min(1),
  branchId: z.string().optional(),
  tableId: z.string().optional(),
  carId: z.string().optional(),
  orderType: orderTypeEnum,
  customer: customerSchema,
  cart: cartSchema,
  expiresAt: z.string().optional(),
});

const customerRequestCreateSchema = z.object({
  sessionId: z.string().min(1),
  restaurantId: z.string().min(1),
  branchId: z.string().optional(),
  tableId: z.string().optional(),
  carId: z.string().optional(),
  orderType: orderTypeEnum,
  customer: customerSchema,
  type: z.enum(['CALL_WAITER', 'WATER', 'BILL', 'CLEANING', 'PLATE', 'SPOON', 'ASSISTANCE', 'ORDER_READY']),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  message: z.string().optional(),
  items: z.string().optional(),
  quantity: z.number().optional(),
});

// Partial schemas for updates — clients may send a subset of fields.
const sessionUpdateSchema = sessionCreateSchema.partial();
const requestUpdateSchema = customerRequestCreateSchema.partial();

const sessionIdSchema = z.object({ sessionId: z.string().min(1) });
const requestIdSchema = z.object({ id: z.string().min(1) });
const requestAssignSchema = z.object({ assignedTo: z.string().min(1) });
const requestCompleteSchema = z.object({ completedBy: z.string().optional() });
const sessionHeartbeatSchema = z.object({ sessionId: z.string().min(1) });

const router = Router();

// ============================================================================
// SESSION ENDPOINTS
// ============================================================================

/**
 * POST /api/qr-ordering/sessions
 * Create a new QR ordering session
 */
router.post(
  '/sessions',
  requireAuth,
  validate({ body: sessionCreateSchema }),
  createSession
);

/**
 * GET /api/qr-ordering/sessions/expired
 * Get all expired sessions for cleanup (admin endpoint)
 * NOTE: must be registered BEFORE /sessions/:sessionId so "expired" is not
 * captured as a sessionId parameter.
 */
router.get(
  '/sessions/expired',
  requireAuth,
  getExpiredSessions
);

/**
 * GET /api/qr-ordering/sessions/:sessionId
 * Get QR ordering session by session ID
 */
router.get(
  '/sessions/:sessionId',
  requireAuth,
  validate({ params: sessionIdSchema }),
  getSession
);

/**
 * PUT /api/qr-ordering/sessions/:sessionId
 * Update QR ordering session (partial update allowed)
 */
router.put(
  '/sessions/:sessionId',
  requireAuth,
  validate({ params: sessionIdSchema, body: sessionUpdateSchema }),
  updateSession
);

/**
 * DELETE /api/qr-ordering/sessions/:sessionId
 * Delete QR ordering session
 */
router.delete(
  '/sessions/:sessionId',
  requireAuth,
  validate({ params: sessionIdSchema }),
  deleteSession
);

/**
 * POST /api/qr-ordering/sessions/:sessionId/heartbeat
 * Send heartbeat to keep session alive
 */
router.post(
  '/sessions/:sessionId/heartbeat',
  requireAuth,
  validate({ params: sessionHeartbeatSchema }),
  heartbeatSession
);

// ============================================================================
// CUSTOMER REQUEST ENDPOINTS
// ============================================================================

/**
 * POST /api/qr-ordering/requests
 * Create a customer request
 */
router.post(
  '/requests',
  requireAuth,
  validate({ body: customerRequestCreateSchema }),
  createCustomerRequest
);

/**
 * GET /api/qr-ordering/requests
 * List customer requests with filtering
 */
router.get(
  '/requests',
  requireAuth,
  listCustomerRequests
);

/**
 * GET /api/qr-ordering/requests/:id
 * Get customer request by ID
 */
router.get(
  '/requests/:id',
  requireAuth,
  validate({ params: requestIdSchema }),
  getCustomerRequest
);

/**
 * PUT /api/qr-ordering/requests/:id
 * Update customer request (partial update allowed)
 */
router.put(
  '/requests/:id',
  requireAuth,
  validate({ params: requestIdSchema, body: requestUpdateSchema }),
  updateCustomerRequest
);

/**
 * DELETE /api/qr-ordering/requests/:id
 * Delete customer request
 */
router.delete(
  '/requests/:id',
  requireAuth,
  validate({ params: requestIdSchema }),
  deleteCustomerRequest
);

/**
 * POST /api/qr-ordering/requests/:id/assign
 * Assign customer request to an employee
 */
router.post(
  '/requests/:id/assign',
  requireAuth,
  validate({ params: requestIdSchema, body: requestAssignSchema }),
  assignRequest
);

/**
 * POST /api/qr-ordering/requests/:id/complete
 * Mark customer request as completed
 */
router.post(
  '/requests/:id/complete',
  requireAuth,
  validate({ params: requestIdSchema, body: requestCompleteSchema }),
  completeRequest
);

export default router;

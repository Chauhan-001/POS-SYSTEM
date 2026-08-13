/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Ordering Controller — REST API endpoints for the QR ordering module
 *
 * All endpoints are prefixed with /api/qr-ordering
 * Public endpoints require feature flag validation (requireFeature('qr_ordering'))
 * Rate limiting applies to prevent abuse
 * Session IDs are validated and sanitized
 */

import { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import mongoose from 'mongoose';
import Branch from '../../../models/Branch';
import QROrderingSession from '../models/QROrderingSession';
import CustomerRequest from '../models/CustomerRequest';
import type { IQRRequest, IQRSession } from '../types';

// ====================================================================
// SESSION ENDPOINTS
// ====================================================================

/**
 * POST /api/qr-ordering/sessions
 * Create a new QR ordering session for a customer
 */
export async function createSession(req: Request, res: Response): Promise<void> {
  try {
    const sessionData = req.body as IQRSession;
    
    // Validate session ID format
    if (!sessionData.sessionId || typeof sessionData.sessionId !== 'string') {
      res.status(400).json({ success: false, error: 'Valid sessionId is required' });
      return;
    }
    
    // Check if session already exists
    const existingSession = await QROrderingSession.findOne({ sessionId: sessionData.sessionId });
    if (existingSession) {
      res.status(409).json({ success: false, error: 'Session already exists' });
      return;
    }
    
    // Create new session
    const newSession = new QROrderingSession({
      ...sessionData,
      restaurantId: new mongoose.Types.ObjectId(sessionData.restaurantId),
      branchId: sessionData.branchId ? new mongoose.Types.ObjectId(sessionData.branchId) : undefined,
      tableId: sessionData.tableId ? new mongoose.Types.ObjectId(sessionData.tableId) : undefined,
      expiresAt: new Date(Date.now() + (sessionData.expiresAt ? new Date(sessionData.expiresAt).getTime() - Date.now() : 30 * 60 * 1000)), // Default 30 minutes
    });
    
    await newSession.save();
    
    res.status(201).json({
      success: true,
      data: newSession,
      message: 'QR ordering session created successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Create session error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create QR ordering session',
    });
  }
}

/**
 * GET /api/qr-ordering/sessions/:sessionId
 * Get QR ordering session by session ID
 */
export async function getSession(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    
    const session = await QROrderingSession.findOne({ sessionId });
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error('[QR Ordering] Get session error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve QR ordering session',
    });
  }
}

/**
 * PUT /api/qr-ordering/sessions/:sessionId
 * Update QR ordering session
 */
export async function updateSession(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const updateData = req.body as Partial<IQRSession>;
    
    const updatedSession = await QROrderingSession.findOneAndUpdate(
      { sessionId },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (!updatedSession) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    
    res.json({
      success: true,
      data: updatedSession,
      message: 'QR ordering session updated successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Update session error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update QR ordering session',
    });
  }
}

/**
 * DELETE /api/qr-ordering/sessions/:sessionId
 * Delete QR ordering session
 */
export async function deleteSession(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    
    const deletedSession = await QROrderingSession.findOneAndDelete({ sessionId });
    if (!deletedSession) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    
    res.json({
      success: true,
      message: 'QR ordering session deleted successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Delete session error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete QR ordering session',
    });
  }
}

// ====================================================================
// CUSTOMER REQUEST ENDPOINTS
// ====================================================================

/**
 * POST /api/qr-ordering/requests
 * Create a customer request
 */
export async function createCustomerRequest(req: Request, res: Response): Promise<void> {
  try {
    const requestData = req.body as IQRRequest;
    
    // Validate session exists
    const session = await QROrderingSession.findOne({ sessionId: requestData.sessionId });
    if (!session) {
      res.status(404).json({ success: false, error: 'QR ordering session not found' });
      return;
    }
    
    // Create new request
    const newRequest = new CustomerRequest({
      ...requestData,
      restaurantId: new mongoose.Types.ObjectId(requestData.restaurantId),
      branchId: requestData.branchId ? new mongoose.Types.ObjectId(requestData.branchId) : undefined,
      tableId: requestData.tableId ? new mongoose.Types.ObjectId(requestData.tableId) : undefined,
    });
    
    await newRequest.save();
    
    res.status(201).json({
      success: true,
      data: newRequest,
      message: 'Customer request created successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Create customer request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create customer request',
    });
  }
}

/**
 * GET /api/qr-ordering/requests
 * List customer requests with filtering
 */
export async function listCustomerRequests(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { sessionId, restaurantId, status, type, priority, assignedTo, branchId, limit } = req.query;

    // Build filter — tenant isolation: the authenticated restaurant is the
    // default scope; a client-supplied restaurantId is only honored for
    // super_admin (platform console). Ordinary staff can never read another
    // tenant's service requests. Optional branchId narrows to one location
    // (multi-branch POS bell) — validated to belong to the tenant.
    const filter: any = {
      restaurantId: new mongoose.Types.ObjectId(
        String(auth.user?.role === 'super_admin' && restaurantId ? restaurantId : auth.user?.restaurantId || '')
      ),
    };
    if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
      // Never trust a client-supplied branchId across tenants: a branch that
      // doesn't belong to the authenticated restaurant simply matches nothing.
      const branch = await Branch.exists({ _id: new mongoose.Types.ObjectId(String(branchId)), restaurantId: filter.restaurantId, isDeleted: { $ne: true } });
      if (branch) filter.branchId = new mongoose.Types.ObjectId(String(branchId));
    }
    if (sessionId) filter.sessionId = sessionId as string;
    if (status) filter.status = status as string;
    if (type) filter.type = type as string;
    if (priority) filter.priority = priority as string;
    if (assignedTo) filter.assignedTo = new mongoose.Types.ObjectId(assignedTo as string);
    
    const requests = await CustomerRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(parseInt(String(limit || '0'), 10) || 0, 0), 500))
      .populate('assignedTo', 'name role')
      .lean();
    
    res.json({
      success: true,
      data: requests,
      count: requests.length,
    });
  } catch (error: any) {
    console.error('[QR Ordering] List customer requests error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to list customer requests',
    });
  }
}

/**
 * GET /api/qr-ordering/requests/:id
 * Get customer request by ID
 */
export async function getCustomerRequest(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { id } = req.params;

    // Tenant isolation: only the owning restaurant can fetch a request.
    const request = await CustomerRequest.findOne({
      _id: id,
      restaurantId: new mongoose.Types.ObjectId(String(auth.user?.restaurantId || '')),
    }).populate('assignedTo', 'name role').lean();
    if (!request) {
      res.status(404).json({ success: false, error: 'Customer request not found' });
      return;
    }
    
    res.json({
      success: true,
      data: request,
    });
  } catch (error: any) {
    console.error('[QR Ordering] Get customer request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve customer request',
    });
  }
}

/**
 * PUT /api/qr-ordering/requests/:id
 * Update customer request
 */
export async function updateCustomerRequest(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { id } = req.params;
    const updateData = req.body as Partial<IQRRequest>;

    // Tenant isolation: only the owning restaurant can update a request.
    const updatedRequest = await CustomerRequest.findOneAndUpdate(
      {
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(String(auth.user?.restaurantId || '')),
      },
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name role').lean();
    
    if (!updatedRequest) {
      res.status(404).json({ success: false, error: 'Customer request not found' });
      return;
    }
    
    res.json({
      success: true,
      data: updatedRequest,
      message: 'Customer request updated successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Update customer request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer request',
    });
  }
}

/**
 * DELETE /api/qr-ordering/requests/:id
 * Delete customer request
 */
export async function deleteCustomerRequest(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { id } = req.params;

    // Tenant isolation: only the owning restaurant can delete a request.
    const deletedRequest = await CustomerRequest.findOneAndDelete({
      _id: id,
      restaurantId: new mongoose.Types.ObjectId(String(auth.user?.restaurantId || '')),
    });
    if (!deletedRequest) {
      res.status(404).json({ success: false, error: 'Customer request not found' });
      return;
    }
    
    res.json({
      success: true,
      message: 'Customer request deleted successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Delete customer request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete customer request',
    });
  }
}

/**
 * POST /api/qr-ordering/requests/:id/assign
 * Assign customer request to an employee
 */
export async function assignRequest(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { id } = req.params;
    const { assignedTo } = req.body;
    
    if (!assignedTo) {
      res.status(400).json({ success: false, error: 'assignedTo is required' });
      return;
    }

    // Tenant isolation: only the owning restaurant can assign a request.
    const request = await CustomerRequest.findOneAndUpdate(
      {
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(String(auth.user?.restaurantId || '')),
      },
      {
        $set: {
          assignedTo: new mongoose.Types.ObjectId(assignedTo),
          assignedAt: new Date(),
          status: 'SEEN',
        },
      },
      { new: true }
    ).populate('assignedTo', 'name role').lean();
    
    if (!request) {
      res.status(404).json({ success: false, error: 'Customer request not found' });
      return;
    }
    
    res.json({
      success: true,
      data: request,
      message: 'Customer request assigned successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Assign request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to assign customer request',
    });
  }
}

/**
 * POST /api/qr-ordering/requests/:id/complete
 * Mark customer request as completed
 */
export async function completeRequest(req: Request, res: Response): Promise<void> {
  try {
    const auth = req as AuthenticatedRequest;
    const { id } = req.params;
    const { completedBy } = req.body;

    // Tenant isolation: only the owning restaurant can complete a request.
    const request = await CustomerRequest.findOneAndUpdate(
      {
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(String(auth.user?.restaurantId || '')),
      },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedBy: typeof completedBy === 'string' && completedBy.trim() ? completedBy.trim() : undefined,
        },
      },
      { new: true }
    ).populate('assignedTo', 'name role').lean();
    
    if (!request) {
      res.status(404).json({ success: false, error: 'Customer request not found' });
      return;
    }
    
    res.json({
      success: true,
      data: request,
      message: 'Customer request completed successfully',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Complete request error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to complete customer request',
    });
  }
}

/**
 * POST /api/qr-ordering/sessions/:sessionId/heartbeat
 * Send heartbeat to keep session alive
 */
export async function heartbeatSession(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    
    const updatedSession = await QROrderingSession.findOneAndUpdate(
      { sessionId, status: 'ACTIVE' },
      {
        $set: {
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // Extend expiration by 30 minutes
        },
      },
      { new: true }
    );
    
    if (!updatedSession) {
      res.status(404).json({ success: false, error: 'Active session not found' });
      return;
    }
    
    res.json({
      success: true,
      message: 'Session heartbeat received',
    });
  } catch (error: any) {
    console.error('[QR Ordering] Heartbeat session error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process session heartbeat',
    });
  }
}

/**
 * GET /api/qr-ordering/sessions/expired
 * Get all expired sessions for cleanup
 */
export async function getExpiredSessions(req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    
    const expiredSessions = await QROrderingSession.find({
      status: 'ACTIVE',
      expiresAt: { $lt: now },
    });
    
    res.json({
      success: true,
      data: expiredSessions,
      count: expiredSessions.length,
    });
  } catch (error: any) {
    console.error('[QR Ordering] Get expired sessions error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve expired sessions',
    });
  }
}

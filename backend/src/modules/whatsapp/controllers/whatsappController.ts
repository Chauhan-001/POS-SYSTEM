/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * whatsappController.ts — Admin endpoints for WhatsApp integration management.
 *
 * Endpoints:
 *   GET    /api/admin/restaurants/:restaurantId/integrations/whatsapp     → get status/details
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/connect → start OAuth
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/oauth/callback → complete OAuth
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/test  → test connection
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/send-test → send test message
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/disconnect → disconnect
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/change-number → change number
 *   GET    /api/integrations/whatsapp/status                            → POS-safe status
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { whatsappService, whatsappWebhookService } from '../services';
import { audit } from '../../../utils/audit';

// restaurantId MUST come from the URL params (validated by middleware).
// It MUST NOT be trusted from req.body for authorization.
function restaurantIdFrom(req: Request): string {
  return (req.params.restaurantId || '') as string;
}

export async function getWhatsAppIntegration(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const data = await whatsappService.getIntegration(restaurantId);
    if (!data) {
      res.status(404).json({ message: 'WhatsApp integration not found' });
      return;
    }
    res.json({ data });
  } catch (error) {
    console.error('[WhatsAppController] get error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function connectWhatsApp(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const result = await whatsappService.connect(req, restaurantId);
    res.json(result);
  } catch (error: any) {
    console.error('[WhatsAppController] connect error:', error);
    res.status(400).json({ message: error?.message || 'Failed to start WhatsApp connection' });
  }
}

export async function completeOAuth(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) {
      res.status(400).json({ message: 'Authorization code is required' });
      return;
    }
    const status = await whatsappService.completeOAuth(req, restaurantId, code);
    res.json({ status });
  } catch (error: any) {
    console.error('[WhatsAppController] oauth callback error:', error);
    res.status(400).json({ message: error?.message || 'Failed to complete WhatsApp onboarding' });
  }
}

export async function testWhatsAppConnection(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const result = await whatsappService.testConnection(restaurantId);
    res.json(result);
  } catch (error) {
    console.error('[WhatsAppController] test error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function sendTestMessage(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const { to } = req.body as { to?: string };
    if (!to) {
      res.status(400).json({ message: 'Recipient phone number is required' });
      return;
    }
    const result = await whatsappService.sendTestMessage(restaurantId, to);
    if (!result.accepted) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (error: any) {
    console.error('[WhatsAppController] send test error:', error);
    res.status(400).json({ message: error?.message || 'Failed to send test message' });
  }
}

export async function disconnectWhatsApp(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    await whatsappService.disconnect(req, restaurantId);
    res.json({ message: 'WhatsApp disconnected successfully' });
  } catch (error: any) {
    console.error('[WhatsAppController] disconnect error:', error);
    res.status(400).json({ message: error?.message || 'Failed to disconnect WhatsApp' });
  }
}

export async function changeNumber(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = restaurantIdFrom(req);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
      res.status(400).json({ message: 'Invalid restaurantId' });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) {
      res.status(400).json({ message: 'Authorization code is required' });
      return;
    }
    const result = await whatsappService.changeNumber(req, restaurantId, code);
    res.json(result);
  } catch (error: any) {
    console.error('[WhatsAppController] change number error:', error);
    res.status(400).json({ message: error?.message || 'Failed to change WhatsApp number' });
  }
}

export async function getWhatsAppStatus(req: Request, res: Response): Promise<void> {
  try {
    // POS-safe endpoint: restaurantId from authenticated JWT, NEVER from query/body.
    const restaurantId = (req as any).user?.restaurantId;
    if (!restaurantId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    const status = await whatsappService.getStatus(restaurantId);
    res.json(status);
  } catch (error) {
    console.error('[WhatsAppController] status error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

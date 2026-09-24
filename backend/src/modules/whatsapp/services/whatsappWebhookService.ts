/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * whatsappWebhookService.ts — Webhook handling for Meta WhatsApp Business Platform.
 *
 * Responsibilities:
 *   - Webhook verification (GET /webhook)
 *   - Event processing (POST /webhook)
 *   - Signature verification using app secret
 *   - Status update persistence (sent, delivered, read, failed)
 *   - Idempotent processing via webhook event deduplication
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { config } from '../../../config';
import { WhatsAppIntegration } from '../../../models';
import { WebhookEvent } from '../../../models';
import { audit } from '../../../utils/audit';
import type { Request, Response } from 'express';

export class WhatsAppWebhookService {
  /**
   * Verify webhook subscription request from Meta.
   */
  verify(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken && typeof challenge === 'string') {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send('Forbidden');
  }

  /**
   * Process incoming webhook events from Meta.
   */
  async process(req: Request, res: Response): Promise<void> {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (config.whatsapp.appSecret) {
      if (!signature) {
        res.status(403).json({ error: 'Missing webhook signature' });
        return;
      }
      const expectedSignature = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(JSON.stringify(req.body)).digest('hex')}`;
      if (signature !== expectedSignature) {
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }
    }

    const body = req.body;
    const entries = body?.entry || [];
    const webhookId = body?.object || 'whatsapp';

    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const value = change?.value;
        if (!value) continue;

        const eventId = value?.message_id || `${webhookId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const existing = await WebhookEvent.findOne({ eventId }).lean().exec();
        if (existing) {
          // Duplicate event — skip but continue processing other events in the payload.
          continue;
        }

        await WebhookEvent.create({
          eventId,
          eventType: 'whatsapp.message',
          gateway: 'whatsapp',
          payload: JSON.stringify(req.body),
          status: 'received',
        });

        if (value?.messages) {
          for (const message of value.messages) {
            await this.handleMessage(value, message);
          }
        }

        if (value?.statuses) {
          for (const status of value.statuses) {
            await this.handleStatus(status);
          }
        }
      }
    }

    res.status(200).json({ status: 'ok' });
  }

  private async handleMessage(value: any, message: any): Promise<void> {
    const phoneNumberId = value?.metadata?.phone_number_id;
    const from = message?.from;

    if (!phoneNumberId || !from) return;

    const integration = await WhatsAppIntegration.findOne({ phoneNumberId }).lean().exec();
    if (!integration) return;

    await WhatsAppUsage.create({
      restaurantId: integration.restaurantId,
      to: from,
      category: 'utility',
      status: 'delivered',
      timestamp: new Date(),
      metaMessageId: message?.id,
      metadata: { type: message?.type, direction: 'inbound' },
    });
  }

  private async handleStatus(status: any): Promise<void> {
    const metaMessageId = status?.id;
    const statusVal = status?.status;
    const recipientId = status?.recipient_id;

    if (!metaMessageId || !recipientId) return;

    const normalizedStatus = statusVal === 'sent' ? 'sent' :
      statusVal === 'delivered' ? 'delivered' :
      statusVal === 'read' ? 'read' :
      statusVal === 'failed' ? 'failed' : null;

    if (!normalizedStatus) return;

    await WhatsAppUsage.findOneAndUpdate(
      { metaMessageId },
      {
        status: normalizedStatus,
        errorCode: status?.errors?.[0]?.code,
        errorMessage: status?.errors?.[0]?.title,
      }
    ).exec();
  }
}

export const whatsappWebhookService = new WhatsAppWebhookService();

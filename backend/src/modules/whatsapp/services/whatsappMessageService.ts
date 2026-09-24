/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * whatsappMessageService.ts — Message sending abstraction for WhatsApp.
 *
 * Responsibilities:
 *   - Message validation
 *   - Meta API request construction
 *   - Rate/error handling
 *   - Usage recording
 *   - Error sanitization (no secrets exposed)
 *
 * This service is the ONLY place that should construct and send WhatsApp
 * messages to Meta. Campaign/bulk flows should call this service, not the
 * raw Meta API directly.
 */

import { AppError } from '../../../utils/AppError';
import { config } from '../../../config';
import { decrypt } from './credentialCrypto';
import { WhatsAppIntegration, WhatsAppUsage } from '../../../models';
import mongoose from 'mongoose';

export type WhatsAppMessageCategory = 'marketing' | 'utility' | 'authentication';

export interface SendWhatsAppMessageInput {
  restaurantId: string;
  to: string;
  body: string;
  category?: WhatsAppMessageCategory;
  campaignId?: string;
  campaignHistoryId?: string;
  messageId?: string;
}

export interface SendWhatsAppMessageResult {
  accepted: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
}

export class WhatsAppMessageService {
  async send(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    const restaurantId = new mongoose.Types.ObjectId(input.restaurantId);

    const integration = await WhatsAppIntegration.findOne({
      restaurantId,
      provider: 'whatsapp',
      status: 'active',
    }).lean().exec();

    if (!integration) {
      return { accepted: false, error: 'INTEGRATION_DISABLED' };
    }

    const accessToken = decrypt(integration.credentialReference);

    const recipient = input.to.replace(/\D/g, '');
    if (!recipient || recipient.length < 7) {
      return { accepted: false, error: 'RECIPIENT_INVALID' };
    }

    const messageBody = (input.body || '').trim();
    if (!messageBody) {
      return { accepted: false, error: 'Message body is required' };
    }

    try {
      const url = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${integration.phoneNumberId}/messages`;
      const body = JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: messageBody },
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      const text = await res.text().catch(() => '');

      if (!res.ok) {
        let metaErrorCode: string | undefined;
        let metaErrorMessage: string | undefined;

        try {
          const errJson = JSON.parse(text);
          metaErrorCode = String(errJson.error?.code || errJson.error?.error_subcode || res.status);
          metaErrorMessage = errJson.error?.message || text.slice(0, 200);
        } catch {
          metaErrorCode = String(res.status);
          metaErrorMessage = text.slice(0, 200);
        }

        await WhatsAppUsage.create({
          restaurantId,
          to: input.to,
          category: input.category || 'utility',
          status: 'failed',
          timestamp: new Date(),
          messageId: input.messageId,
          campaignId: input.campaignId,
          campaignHistoryId: input.campaignHistoryId,
          errorCode: metaErrorCode,
          errorMessage: this.sanitizeError(metaErrorMessage),
          metadata: { direction: 'outbound' },
        });

        return {
          accepted: false,
          error: this.mapMetaError(metaErrorCode, metaErrorMessage),
          errorCode: metaErrorCode,
        };
      }

      const data = JSON.parse(text);
      const metaMessageId = data?.messages?.[0]?.id;

      await WhatsAppUsage.create({
        restaurantId,
        to: input.to,
        category: input.category || 'utility',
        status: 'sent',
        timestamp: new Date(),
        messageId: input.messageId,
        campaignId: input.campaignId,
        campaignHistoryId: input.campaignHistoryId,
        metaMessageId,
        metadata: { direction: 'outbound' },
      });

      return { accepted: true, messageId: metaMessageId };
    } catch (err: any) {
      const errorMessage = err?.message || 'Network error';
      await WhatsAppUsage.create({
        restaurantId,
        to: input.to,
        category: input.category || 'utility',
        status: 'failed',
        timestamp: new Date(),
        messageId: input.messageId,
        campaignId: input.campaignId,
        campaignHistoryId: input.campaignHistoryId,
        errorMessage: this.sanitizeError(errorMessage),
        metadata: { direction: 'outbound' },
      });

      return {
        accepted: false,
        error: this.mapNetworkError(err),
      };
    }
  }

  private sanitizeError(message: string): string {
    if (!message) return 'Unknown error';
    // Never log or return raw tokens, secrets, or authorization codes.
    const sanitized = message
      .replace(/access_token\s*[=:]\s*[^\s&"']+/gi, 'access_token=REDACTED')
      .replace(/access_token\s+[^\s&"']+/gi, 'access_token=REDACTED')
      .replace(/client_secret\s*[=:]\s*[^\s&"']+/gi, 'client_secret=REDACTED')
      .replace(/client_secret\s+[^\s&"']+/gi, 'client_secret=REDACTED')
      .replace(/authorization_code\s*[=:]\s*[^\s&"']+/gi, 'authorization_code=REDACTED')
      .replace(/authorization_code\s+[^\s&"']+/gi, 'authorization_code=REDACTED');
    return sanitized.slice(0, 500);
  }

  private mapMetaError(code: string | undefined, rawMessage: string | undefined): string {
    const codeNum = Number(code);
    if (codeNum === 190 || codeNum === 100 || codeNum === 101) return 'TOKEN_INVALID';
    if (codeNum === 131047) return 'PHONE_NUMBER_INVALID';
    if (codeNum === 131026) return 'WABA_NOT_FOUND';
    if (codeNum === 131000) return 'META_PERMISSION_ERROR';
    if (codeNum === 4 || codeNum === 17 || codeNum === 32 || codeNum === 613) return 'META_RATE_LIMIT';
    if (codeNum === 100 || codeNum === 200) return 'META_API_ERROR';
    return rawMessage ? `META_API_ERROR: ${rawMessage.slice(0, 200)}` : 'META_API_ERROR';
  }

  private mapNetworkError(err: any): string {
    if (err?.name === 'TimeoutError' || err?.code === 'ETIMEDOUT') return 'META_API_TIMEOUT';
    if (err?.code === 'ECONNREFUSED') return 'META_API_UNREACHABLE';
    return `Network error: ${err?.message || 'unknown'}`;
  }
}

export const whatsappMessageService = new WhatsAppMessageService();

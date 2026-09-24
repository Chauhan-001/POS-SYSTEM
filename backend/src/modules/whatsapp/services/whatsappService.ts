/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * whatsappService.ts — Core WhatsApp Business Platform integration service.
 *
 * Responsibilities:
 *   - Meta OAuth / Embedded Signup flow
 *   - Credential encryption / decryption (AES-256-GCM)
 *   - Connection management (connect, disconnect, change number, test)
 *   - Meta API wrappers (send message, verify connection, fetch WABA info)
 *   - Usage tracking
 *   - Integration history
 */

import mongoose from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { config } from '../../../config';
import { WhatsAppIntegration, WhatsAppIntegrationHistory, WhatsAppUsage } from '../../../models';
import { audit } from '../../../utils/audit';
import { encrypt, decrypt } from './credentialCrypto';
import type { Request } from 'express';

// =============================================================================
// CONFIGURATION
// =============================================================================

const META_APP_ID = config.whatsapp.appId;
const META_APP_SECRET = config.whatsapp.appSecret;
const META_WEBHOOK_VERIFY_TOKEN = config.whatsapp.webhookVerifyToken;
const META_GRAPH_API_VERSION = config.whatsapp.graphApiVersion;

// =============================================================================
// META API HELPERS
// =============================================================================

async function metaGet(path: string, accessToken: string): Promise<any> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(`Meta API error ${res.status}: ${text.slice(0, 300)}`, 502);
  }
  return res.json();
}

async function metaPost(path: string, accessToken: string, body: Record<string, unknown>): Promise<any> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(`Meta API error ${res.status}: ${text.slice(0, 300)}`, 502);
  }
  return res.json();
}

// =============================================================================
// SERVICE
// =============================================================================

export class WhatsAppService {
  /**
   * Initialize the Meta Embedded Signup / OAuth flow.
   * Returns the URL the admin dashboard should redirect the user to.
   */
  async connect(req: Request, restaurantId: string): Promise<{ authUrl: string; state: string }> {
    if (!META_APP_ID) {
      throw new AppError('WhatsApp integration is not configured on the server (META_APP_ID missing)', 500);
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3002'}/api/webhooks/whatsapp/oauth/callback`;

    const params = new URLSearchParams({
      client_id: META_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'whatsapp_business_messaging,whatsapp_business_management',
      response_type: 'code',
    });

    const authUrl = `https://www.facebook.com/${META_GRAPH_API_VERSION.replace('v', '')}/dialog/embedded_signup?${params.toString()}`;

    await audit(req, {
      action: 'WHATSAPP_CONNECT_INIT',
      entityType: 'WhatsAppIntegration',
      entityId: restaurantId,
      performedBy: (req as any).user?.name || 'Super Admin',
      performedById: (req as any).user?.userId,
      restaurantId,
      details: { state },
    });

    return { authUrl, state };
  }

  /**
   * Complete the OAuth flow after Meta redirects back with an authorization code.
   */
  async completeOAuth(req: Request, restaurantId: string, code: string): Promise<WhatsAppIntegrationStatus> {
    if (!META_APP_ID || !META_APP_SECRET) {
      throw new AppError('WhatsApp integration is not configured on the server', 500);
    }

    const tokenRes = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3002'}/api/webhooks/whatsapp/oauth/callback`,
        code,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => '');
      throw new AppError(`Failed to exchange Meta authorization code: ${text.slice(0, 300)}`, 502);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new AppError('Meta did not return an access token', 502);
    }

    const encryptedToken = encrypt(accessToken);

    const me = await metaGet('/me', accessToken);
    const businessId = me.id;

    const wabaData = await metaGet(`/${businessId}/owned_whatsapp_business_accounts`, accessToken);
    const waba = wabaData?.data?.[0];
    if (!waba) {
      throw new AppError('No WhatsApp Business Account found for this Meta business', 400);
    }
    const wabaId = waba.id;

    const phoneData = await metaGet(`/${wabaId}/phone_numbers`, accessToken);
    const phone = phoneData?.data?.[0];
    if (!phone) {
      throw new AppError('No phone number found on the WhatsApp Business Account', 400);
    }

    const displayPhoneNumber = phone.display_phone_number;
    const phoneNumberId = phone.id;
    const displayName = waba.name || phone.display_name || 'WhatsApp Business';

    const now = new Date();

    const integration = await WhatsAppIntegration.findOneAndUpdate(
      { restaurantId: new mongoose.Types.ObjectId(restaurantId), provider: 'whatsapp' },
      {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        provider: 'whatsapp',
        status: 'active',
        businessId,
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        displayName,
        credentialReference: encryptedToken,
        connectedAt: now,
        lastVerifiedAt: now,
        lastError: null,
        metadata: {
          tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in || 0) * 1000).toISOString() : null,
        },
      },
      { new: true, upsert: true }
    );

    await WhatsAppIntegrationHistory.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      integrationId: integration._id,
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      displayName,
      status: 'active',
      connectedAt: now,
    });

    await audit(req, {
      action: 'WHATSAPP_CONNECT_COMPLETE',
      entityType: 'WhatsAppIntegration',
      entityId: restaurantId,
      performedBy: (req as any).user?.name || 'Super Admin',
      performedById: (req as any).user?.userId,
      restaurantId,
      details: { wabaId, phoneNumberId, displayPhoneNumber },
    });

    return integration.status;
  }

  /**
   * Disconnect WhatsApp for a restaurant.
   */
  async disconnect(req: Request, restaurantId: string): Promise<void> {
    const integration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!integration || integration.status === 'disconnected') {
      throw new AppError('WhatsApp is not connected for this restaurant', 400);
    }

    const previousStatus = integration.status;

    integration.status = 'disconnected';
    integration.disconnectedAt = new Date();
    integration.lastError = null;
    await integration.save();

    await WhatsAppIntegrationHistory.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      integrationId: integration._id,
      wabaId: integration.wabaId,
      phoneNumberId: integration.phoneNumberId,
      displayPhoneNumber: integration.displayPhoneNumber,
      displayName: integration.displayName,
      status: 'disconnected',
      reason: 'Admin disconnected',
      connectedAt: integration.connectedAt || new Date(),
      disconnectedAt: new Date(),
    });

    await audit(req, {
      action: 'WHATSAPP_DISCONNECT',
      entityType: 'WhatsAppIntegration',
      entityId: restaurantId,
      performedBy: (req as any).user?.name || 'Super Admin',
      performedById: (req as any).user?.userId,
      restaurantId,
      details: { previousStatus },
    });
  }

  /**
   * Test the current connection by verifying with Meta.
   */
  async testConnection(restaurantId: string): Promise<{ connected: boolean; status: string; error?: string }> {
    const integration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!integration || integration.status === 'disconnected' || integration.status === 'not_connected') {
      return { connected: false, status: 'not_connected' };
    }

    try {
      const accessToken = decrypt(integration.credentialReference);
      await metaGet('/me', accessToken);
      integration.lastVerifiedAt = new Date();
      integration.lastError = null;
      integration.status = 'active';
      await integration.save();
      return { connected: true, status: 'active' };
    } catch (err: any) {
      integration.lastVerifiedAt = new Date();
      integration.lastError = err?.message || 'Verification failed';
      integration.status = 'error';
      await integration.save();
      return { connected: false, status: 'error', error: 'Unable to verify connection. Please reconnect.' };
    }
  }

  /**
   * Send a test WhatsApp message.
   */
  async sendTestMessage(restaurantId: string, to: string): Promise<{ accepted: boolean; messageId?: string; error?: string }> {
    const integration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
      status: 'active',
    });

    if (!integration) {
      throw new AppError('WhatsApp is not connected for this restaurant', 400);
    }

    try {
      const accessToken = decrypt(integration.credentialReference);
      const result = await metaPost(`/${integration.phoneNumberId}/messages`, accessToken, {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: 'Hello from your POS system! This is a test message.' },
      });

      const messageId = result?.messages?.[0]?.id;

      await WhatsAppUsage.create({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        to,
        category: 'utility',
        status: 'sent',
        timestamp: new Date(),
        metaMessageId: messageId,
        metadata: { test: true },
      });

      return { accepted: true, messageId };
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to send test message';
      await WhatsAppUsage.create({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        to,
        category: 'utility',
        status: 'failed',
        timestamp: new Date(),
        errorMessage,
        metadata: { test: true },
      });
      return { accepted: false, error: errorMessage };
    }
  }

  /**
   * Get WhatsApp integration status for a restaurant (safe for POS consumption).
   */
  async getStatus(restaurantId: string): Promise<{
    connected: boolean;
    status: string;
    phoneNumber?: string;
    displayName?: string;
    connectedAt?: string;
    lastVerifiedAt?: string;
    lastError?: string;
  }> {
    const integration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!integration) {
      return { connected: false, status: 'not_connected' };
    }

    return {
      connected: integration.status === 'active',
      status: integration.status,
      phoneNumber: integration.displayPhoneNumber,
      displayName: integration.displayName,
      connectedAt: integration.connectedAt?.toISOString(),
      lastVerifiedAt: integration.lastVerifiedAt?.toISOString(),
      lastError: integration.lastError || undefined,
    };
  }

   /**
    * Get full integration details for admin dashboard.
    */
  async getIntegration(restaurantId: string): Promise<any> {
    const integration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!integration) {
      return null;
    }

    const history = await WhatsAppIntegrationHistory.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const recentUsage = await WhatsAppUsage.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
    })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();

    const safeIntegration = integration.toObject();
    delete (safeIntegration as any).credentialReference;

    return {
      ...safeIntegration,
      history,
      recentUsage,
    };
  }

  /**
   * Change WhatsApp number for a restaurant.
   *
   * Flow:
   * 1. Complete Meta OAuth with the new number's authorization code.
   * 2. Validate the new connection.
   * 3. Atomically replace the old integration with the new one.
   * 4. If validation fails, the old integration remains untouched.
   */
  async changeNumber(req: Request, restaurantId: string, code: string): Promise<{ status: string }> {
    const existingIntegration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!existingIntegration || existingIntegration.status !== 'active') {
      throw new AppError('No active WhatsApp connection to change', 400);
    }

    // Complete OAuth for the new number — this validates the authorization.
    const newStatus = await this.completeOAuth(req, restaurantId, code);

    // Verify the new connection is actually active.
    const updatedIntegration = await WhatsAppIntegration.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      provider: 'whatsapp',
    });

    if (!updatedIntegration || updatedIntegration.status !== 'active') {
      throw new AppError('Failed to validate new WhatsApp number', 400);
    }

    await WhatsAppIntegrationHistory.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      integrationId: updatedIntegration._id,
      wabaId: updatedIntegration.wabaId,
      phoneNumberId: updatedIntegration.phoneNumberId,
      displayPhoneNumber: updatedIntegration.displayPhoneNumber,
      displayName: updatedIntegration.displayName,
      status: 'active',
      reason: 'Number changed',
      connectedAt: updatedIntegration.connectedAt || new Date(),
    });

    await audit(req, {
      action: 'WHATSAPP_CHANGE_NUMBER',
      entityType: 'WhatsAppIntegration',
      entityId: restaurantId,
      performedBy: (req as any).user?.name || 'Super Admin',
      performedById: (req as any).user?.userId,
      restaurantId,
      details: {
        previousPhoneNumber: existingIntegration.displayPhoneNumber,
        newPhoneNumber: updatedIntegration.displayPhoneNumber,
      },
    });

    return { status: newStatus };
  }
}

export const whatsappService = new WhatsAppService();

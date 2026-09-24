/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WhatsApp module tests — credential crypto, error handling, and webhook dedup.
 */

import { describe, it, expect, vi } from 'vitest';
import { encrypt, decrypt } from '../services/credentialCrypto';
import { WhatsAppIntegration } from '../../../models';
import WebhookEvent from '../../../models/WebhookEvent';

// ---------------------------------------------------------------------------
// 1. Credential crypto
// ---------------------------------------------------------------------------

describe('credentialCrypto', () => {
  it('encrypts and decrypts a token', () => {
    const plaintext = 'EAA_TEST_ACCESS_TOKEN_12345';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':').length).toBe(3);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for each encryption (random IV)', () => {
    const token = 'EAA_TEST_TOKEN';
    const enc1 = encrypt(token);
    const enc2 = encrypt(token);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(token);
    expect(decrypt(enc2)).toBe(token);
  });

  it('throws on malformed ciphertext', () => {
    expect(() => decrypt('not-a-valid-format')).toThrow();
    expect(() => decrypt('a:b')).toThrow();
    expect(() => decrypt('a:b:c:d')).toThrow();
  });

  it('throws when decrypting tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const [iv, tag] = encrypted.split(':');
    const tampered = `${iv}:${tag}:${btoa('tampered')}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Webhook deduplication
// ---------------------------------------------------------------------------

describe('WhatsAppWebhookService deduplication', () => {
  it('continues processing other events when one is a duplicate', async () => {
    const { WhatsAppWebhookService } = await import('../services/whatsappWebhookService');
    const service = new WhatsAppWebhookService();

    const mockFindOne = vi.fn()
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve({ _id: 'existing' }) }) })
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) });

    vi.spyOn(WebhookEvent, 'findOne').mockImplementation(mockFindOne as any);
    vi.spyOn(WebhookEvent, 'create').mockResolvedValue({} as any);

    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  message_id: 'duplicate-event-id',
                  messages: [{ from: '919999999999', id: 'msg1', type: 'text' }],
                },
              },
              {
                value: {
                  message_id: 'new-event-id',
                  messages: [{ from: '919888888888', id: 'msg2', type: 'text' }],
                },
              },
            ],
          },
        ],
      },
      headers: {},
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await service.process(req, res);

    expect(mockFindOne).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// 3. WhatsAppMessageService — error handling and sanitization
// ---------------------------------------------------------------------------

describe('WhatsAppMessageService error handling', () => {
  it('sanitizes access tokens from error messages', async () => {
    const { WhatsAppMessageService } = await import('../services/whatsappMessageService');
    const service = new WhatsAppMessageService();
    const sanitize = (service as any).sanitizeError.bind(service);

    const result = sanitize('OAuthException: Invalid access_token EAAABC123XYZ');
    expect(result).not.toContain('EAAABC123XYZ');
    expect(result).toContain('REDACTED');
  });

  it('maps Meta error codes to application errors', async () => {
    const { WhatsAppMessageService } = await import('../services/whatsappMessageService');
    const service = new WhatsAppMessageService();
    const mapError = (service as any).mapMetaError.bind(service);

    expect(mapError('190', '')).toBe('TOKEN_INVALID');
    expect(mapError('131047', '')).toBe('PHONE_NUMBER_INVALID');
    expect(mapError('131026', '')).toBe('WABA_NOT_FOUND');
    expect(mapError('131000', '')).toBe('META_PERMISSION_ERROR');
    expect(mapError('4', '')).toBe('META_RATE_LIMIT');
  });

  it('maps network timeouts correctly', async () => {
    const { WhatsAppMessageService } = await import('../services/whatsappMessageService');
    const service = new WhatsAppMessageService();
    const mapNet = (service as any).mapNetworkError.bind(service);

    expect(mapNet({ name: 'TimeoutError', message: 'deadline exceeded' })).toBe('META_API_TIMEOUT');
    expect(mapNet({ code: 'ECONNREFUSED', message: 'connection refused' })).toBe('META_API_UNREACHABLE');
    expect(mapNet({ message: 'unknown' })).toBe('Network error: unknown');
  });
});

// ---------------------------------------------------------------------------
// 4. Tenant isolation — service methods enforce restaurantId scoping
// ---------------------------------------------------------------------------

describe('WhatsApp tenant isolation', () => {
  it('getStatus uses restaurantId in query filter', async () => {
    const { WhatsAppService } = await import('../services/whatsappService');
    const service = new WhatsAppService();

    vi.spyOn(WhatsAppIntegration, 'findOne').mockResolvedValue(null);

    await service.getStatus('000000000000000000000000');

    expect(WhatsAppIntegration.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: expect.any(Object),
        provider: 'whatsapp',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Change number validates active integration exists
// ---------------------------------------------------------------------------

describe('WhatsAppService changeNumber', () => {
  it('throws if no active integration exists', async () => {
    const { WhatsAppService } = await import('../services/whatsappService');
    const service = new WhatsAppService();

    vi.spyOn(WhatsAppIntegration, 'findOne').mockResolvedValue(null);

    const result = service.changeNumber({} as any, '000000000000000000000000', 'code');
    await expect(result).rejects.toThrow();
  });
});

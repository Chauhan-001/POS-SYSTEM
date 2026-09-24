/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * whatsappRoutes.ts — Admin + public WhatsApp integration routes.
 *
 * Admin routes (require admin auth):
 *   GET    /api/admin/restaurants/:restaurantId/integrations/whatsapp
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/connect
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/oauth/callback
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/test
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/send-test
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/disconnect
 *   POST   /api/admin/restaurants/:restaurantId/integrations/whatsapp/change-number
 *
 * Public/POS route (no admin auth):
 *   GET    /api/integrations/whatsapp/status
 *
 * Webhook routes (public, signature-verified):
 *   GET    /api/webhooks/whatsapp
 *   POST   /api/webhooks/whatsapp
 *   GET    /api/webhooks/whatsapp/oauth/callback
 */

import { Router } from 'express';
import { requireAdminAuth } from '../../../middleware/authMiddleware';
import { requireCollectionAccess } from '../../../middleware/authorizationMiddleware';
import { validate } from '../../../middleware/validate';
import {
  getWhatsAppIntegration,
  connectWhatsApp,
  completeOAuth,
  testWhatsAppConnection,
  sendTestMessage,
  disconnectWhatsApp,
  changeNumber,
  getWhatsAppStatus,
} from '../controllers';
import {
  restaurantIdSchema,
  sendTestSchema,
  oauthCallbackSchema,
  changeNumberSchema,
} from '../validation';
import { whatsappWebhookService } from '../services';

const router = Router();

// ─── Admin Integration Management ─────────────────────────────────────────────

router.get('/admin/restaurants/:restaurantId/integrations/whatsapp',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'read'),
  validate({ params: restaurantIdSchema }),
  getWhatsAppIntegration
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/connect',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'update'),
  validate({ params: restaurantIdSchema }),
  connectWhatsApp
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/oauth/callback',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'update'),
  validate({ params: restaurantIdSchema, body: oauthCallbackSchema }),
  completeOAuth
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/test',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'read'),
  validate({ params: restaurantIdSchema }),
  testWhatsAppConnection
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/send-test',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'update'),
  validate({ params: restaurantIdSchema, body: sendTestSchema }),
  sendTestMessage
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/disconnect',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'update'),
  validate({ params: restaurantIdSchema }),
  disconnectWhatsApp
);

router.post('/admin/restaurants/:restaurantId/integrations/whatsapp/change-number',
  requireAdminAuth,
  requireCollectionAccess('Restaurant', 'update'),
  validate({ params: restaurantIdSchema, body: changeNumberSchema }),
  changeNumber
);

// ─── POS-Safe Status Endpoint ─────────────────────────────────────────────────

router.get('/integrations/whatsapp/status', getWhatsAppStatus);

// ─── Webhook Routes ───────────────────────────────────────────────────────────

const webhookRouter = Router();

webhookRouter.get('/', whatsappWebhookService.verify.bind(whatsappWebhookService));
webhookRouter.post('/', whatsappWebhookService.process.bind(whatsappWebhookService));

// OAuth callback for Meta Embedded Signup.
// Meta redirects the popup to this endpoint with ?code=...&state=...
// We return a minimal HTML page that forwards the code to the opener
// window via postMessage and then closes itself.
webhookRouter.get('/oauth/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';
  const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : '';

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>WhatsApp Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: #fff; border-radius: 12px; padding: 24px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); text-align: center; max-width: 360px; }
    h1 { font-size: 16px; margin: 0 0 8px; color: #0f172a; }
    p { font-size: 13px; color: #475569; margin: 0; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WhatsApp Authorization</h1>
    <p id="status">Returning to admin dashboard…</p>
  </div>
  <script>
    (function() {
      const params = new URLSearchParams(window.location.search);
      const data = {
        type: 'whatsapp-oauth-callback',
        code: params.get('code') || '',
        state: params.get('state') || '',
        error: params.get('error') || '',
        errorDescription: params.get('error_description') || ''
      };
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(data, window.location.origin);
      }
      setTimeout(function() { window.close(); }, 250);
    })();
  </script>
</body>
</html>`);
});

router.use('/webhooks/whatsapp', webhookRouter);

export default router;

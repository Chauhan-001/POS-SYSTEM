/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Security Headers Middleware — centralized helmet configuration.
 *
 * Extracted from server.ts so the exact production config is unit-testable
 * (header presence + CSP values) without duplicating it in tests.
 *
 * Tuning notes:
 *  - CSP allows Google Fonts (https: style/font), React inline style
 *    attributes, and images from self/data/blob/https.
 *  - Razorpay payment checkout is whitelisted: checkout.js is loaded from
 *    checkout.razorpay.com (script-src), the payment modal is hosted on
 *    checkout.razorpay.com / api.razorpay.com (frame-src), and the checkout
 *    page + telemetry talk to api.razorpay.com / lumberjack.razorpay.com
 *    (connect-src). Without these, Settings → Subscription → Upgrade Plan
 *    fails in the built app with "Failed to load payment gateway".
 *  - `upgrade-insecure-requests` is disabled so LAN/HTTP deployments (common
 *    for POS terminals) keep working.
 *  - CORP is `cross-origin` (not helmet's `same-origin` default) because media
 *    (logos / covers / product images) is served from this API but displayed
 *    by cross-origin frontends (admin :5174, POS :5175, Electron).
 */

import helmet from 'helmet';

const RAZORPAY_DOMAINS = [
  'https://checkout.razorpay.com',
  'https://api.razorpay.com',
];

export function securityHeaders() {
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'script-src': ["'self'", 'https://checkout.razorpay.com'],
        'frame-src': ["'self'", ...RAZORPAY_DOMAINS],
        'connect-src': ["'self'", ...RAZORPAY_DOMAINS, 'https://lumberjack.razorpay.com'],
        'upgrade-insecure-requests': null,
      },
    },
  });
}

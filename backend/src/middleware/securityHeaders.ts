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
 *  - `upgrade-insecure-requests` is disabled so LAN/HTTP deployments (common
 *    for POS terminals) keep working.
 *  - CORP is `cross-origin` (not helmet's `same-origin` default) because media
 *    (logos / covers / product images) is served from this API but displayed
 *    by cross-origin frontends (admin :5174, POS :5175, Electron).
 */

import helmet from 'helmet';

export function securityHeaders() {
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'upgrade-insecure-requests': null,
      },
    },
  });
}

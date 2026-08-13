/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global Branded QR Design System — public API.
 *
 * Any feature in the POS that needs a QR (sticker, receipt, loyalty card,
 * offer, review card, WhatsApp… ) does this:
 *
 *     <BrandedQRCode
 *       value={url}
 *       purpose="table"        // drives CTA + minimum size
 *       placement="table-card" // drives composition + sizing
 *       restaurant={{ name, logo, primaryColor }}
 *       config={settings.qrBranding}
 *     />
 *
 * The business feature produces the URL. This system renders it. One renderer,
 * many data sources, one branding system — never another ad-hoc QR
 * implementation.
 */

export * from './types';
export * from './encoder';
export * from './contrast';
export * from './presets';
export * from './renderer';
export * from './validator';

export { DEFAULT_QR_DARK } from './presets';

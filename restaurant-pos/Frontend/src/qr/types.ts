/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global Branded QR Design System — types.
 *
 * ONE system for every QR in the POS (stickers, loyalty, receipts, offers,
 * menus, reviews, WhatsApp, parking…). Business features only produce QR
 * *data* (a URL); the design system renders it. Nothing here knows business
 * logic — purpose/placement only drive presentation defaults.
 */

/** Supported QR purposes. Each maps to a default CTA + recommended sizing. */
export type QrPurpose =
  | 'loyalty'
  | 'menu'
  | 'offer'
  | 'coupon'
  | 'review'
  | 'whatsapp'
  | 'parking'
  | 'table'
  | 'ordering'
  | 'receipt'
  | 'custom';

/** Physical/digital environment the QR will be placed in. */
export type QrPlacement =
  | 'receipt'
  | 'table-card'
  | 'counter-card'
  | 'poster'
  | 'parking'
  | 'packaging'
  | 'menu-board'
  | 'digital'
  | 'custom';

/** Module rendering styles. 'brand' is the default when branding exists. */
export type QrStyle = 'classic' | 'rounded' | 'dots' | 'brand';

/** Finder-pattern corner treatment. Structure is never distorted. */
export type QrFinderStyle = 'square' | 'rounded' | 'soft-rounded';

/** QR error-correction level exposed to advanced users. */
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Restaurant-level QR branding configuration, persisted in SystemSettings
 * (flows through the existing tenant-scoped settings PATCH — no backend
 * schema change). Purpose/placement overrides are resolved at render time.
 */
export interface QrBrandingConfig {
  /** Default module style for every QR (overridable per-purpose later). */
  style: QrStyle;
  /** Finder-pattern corner treatment. */
  finderStyle: QrFinderStyle;
  /** Module color (auto-darkened when too light to scan safely). */
  primaryColor: string;
  /** Secondary brand color used for accents (optional). */
  secondaryColor?: string;
  /** Show the restaurant logo in the QR centre (auto-uses high EC). */
  logoEnabled: boolean;
  /** Whether to draw a soft rounded frame around digital QRs. */
  frameEnabled: boolean;
  /** Override error-correction level (auto: H when logo, M otherwise). */
  errorCorrectionLevel?: QrEcLevel;
  /** CTA text overrides per purpose (fall back to purpose defaults). */
  ctaOverrides?: Partial<Record<QrPurpose, string>>;
}

/** Branding snapshot passed to the renderer (never business logic). */
export interface QrRestaurantBranding {
  name: string;
  logo?: string | null;
  primaryColor: string;
  secondaryColor?: string;
}

/** Full render request. `value` is the exact string that must decode. */
export interface BrandedQrRequest {
  value: string;
  purpose?: QrPurpose;
  placement?: QrPlacement;
  restaurant: QrRestaurantBranding;
  config?: Partial<QrBrandingConfig>;
  /** Hard overrides win over everything (used by the designer preview). */
  style?: QrStyle;
  finderStyle?: QrFinderStyle;
  primaryColor?: string;
  logo?: string | null;
  logoEnabled?: boolean;
  errorCorrectionLevel?: QrEcLevel;
  /** Quiet zone in modules (QR spec requires ≥ 4; clamped to ≥ 2). */
  margin?: number;
}

/** Resolved render options after merging presets + branding + overrides. */
export interface ResolvedQrOptions {
  value: string;
  purpose: QrPurpose;
  placement: QrPlacement;
  style: QrStyle;
  finderStyle: QrFinderStyle;
  dark: string;
  light: string;
  accent: string;
  logo: string | null;
  logoEnabled: boolean;
  errorCorrectionLevel: QrEcLevel;
  margin: number;
  frameEnabled: boolean;
  cta: string;
  showName: boolean;
  showCta: boolean;
  nameSize: 'sm' | 'md' | 'lg';
  qrSize: number;
  compact: boolean;
}

/** Purpose presentation defaults. */
export interface QrPurposePreset {
  cta: string;
  /** Recommended minimum QR width in CSS px. */
  minSize: number;
}

/** Placement composition defaults. */
export interface QrPlacementPreset {
  /** Show the restaurant name above the QR. */
  showName: boolean;
  /** Show the purpose CTA under the QR. */
  showCta: boolean;
  nameSize: 'sm' | 'md' | 'lg';
  qrSize: number;
  /** Compact layouts (receipts, packaging) drop frames + big padding. */
  compact: boolean;
}

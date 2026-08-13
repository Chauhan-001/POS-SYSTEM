/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR purpose + placement presets. Purposes control messaging and minimum size;
 * placements control composition (what text surrounds the QR, sizing, frames).
 * These are pure presentation defaults — overridable per request.
 */

import type {
  BrandedQrRequest,
  QrPlacement,
  QrPlacementPreset,
  QrPurpose,
  QrPurposePreset,
  ResolvedQrOptions,
} from './types';

export const PURPOSE_PRESETS: Record<QrPurpose, QrPurposePreset> = {
  loyalty: { cta: 'Scan & Earn Rewards', minSize: 160 },
  menu: { cta: 'Scan to View Menu', minSize: 160 },
  offer: { cta: 'Scan to Redeem', minSize: 160 },
  coupon: { cta: 'Scan to Redeem', minSize: 160 },
  review: { cta: 'Share Your Feedback', minSize: 160 },
  whatsapp: { cta: 'Order on WhatsApp', minSize: 160 },
  parking: { cta: 'Scan for Parking', minSize: 140 },
  table: { cta: 'Scan to Order', minSize: 160 },
  ordering: { cta: 'Scan to Order', minSize: 160 },
  receipt: { cta: 'Scan & Earn', minSize: 64 },
  custom: { cta: '', minSize: 160 },
};

export const PLACEMENT_PRESETS: Record<QrPlacement, QrPlacementPreset> = {
  receipt: { showName: true, showCta: true, nameSize: 'sm', qrSize: 88, compact: true },
  'table-card': { showName: true, showCta: true, nameSize: 'lg', qrSize: 240, compact: false },
  'counter-card': { showName: true, showCta: true, nameSize: 'md', qrSize: 200, compact: false },
  poster: { showName: true, showCta: true, nameSize: 'lg', qrSize: 320, compact: false },
  parking: { showName: true, showCta: true, nameSize: 'md', qrSize: 200, compact: false },
  packaging: { showName: true, showCta: true, nameSize: 'sm', qrSize: 100, compact: true },
  'menu-board': { showName: true, showCta: true, nameSize: 'md', qrSize: 220, compact: false },
  digital: { showName: true, showCta: true, nameSize: 'md', qrSize: 180, compact: false },
  custom: { showName: true, showCta: true, nameSize: 'md', qrSize: 180, compact: false },
};

/** Default brand module color when the restaurant has no configured color. */
export const DEFAULT_QR_DARK = '#1a1a2e';

/**
 * Resolve a BrandedQrRequest into fully-concrete render options by merging
 * (in order): placement preset → purpose preset → restaurant branding →
 * persisted qrBranding config → per-request overrides. The result is a plain
 * value object, safe to use as a React memo dependency.
 */
export function resolveQrOptions(req: BrandedQrRequest): ResolvedQrOptions {
  const purpose: QrPurpose = req.purpose || 'custom';
  const placement: QrPlacement = req.placement || 'digital';
  const purposePreset = PURPOSE_PRESETS[purpose] || PURPOSE_PRESETS.custom;
  const placementPreset = PLACEMENT_PRESETS[placement] || PLACEMENT_PRESETS.custom;

  const brandColor = req.primaryColor || req.restaurant?.primaryColor || req.config?.primaryColor || DEFAULT_QR_DARK;
  const accent = req.restaurant?.secondaryColor || req.config?.secondaryColor || brandColor;
  const style = req.style || req.config?.style || 'brand';
  const finderStyle = req.finderStyle || req.config?.finderStyle || 'rounded';
  const logo = req.logoEnabled !== undefined ? req.logo : req.config?.logoEnabled ? req.restaurant?.logo || null : null;
  const logoEnabled = req.logoEnabled !== undefined ? req.logoEnabled : !!(req.config?.logoEnabled && logo);

  const ctaOverride = req.config?.ctaOverrides?.[purpose];
  const cta = ctaOverride ?? purposePreset.cta;

  return {
    value: req.value,
    purpose,
    placement,
    style,
    finderStyle,
    dark: brandColor,
    light: '#ffffff',
    accent,
    logo,
    logoEnabled,
    errorCorrectionLevel: req.errorCorrectionLevel || req.config?.errorCorrectionLevel || (logoEnabled ? 'H' : 'M'),
    margin: req.margin ?? 4,
    frameEnabled: req.config?.frameEnabled ?? !placementPreset.compact,
    cta,
    showName: placementPreset.showName,
    showCta: placementPreset.showCta,
    nameSize: placementPreset.nameSize,
    qrSize: Math.max(placementPreset.qrSize, purposePreset.minSize),
    compact: placementPreset.compact,
  };
}

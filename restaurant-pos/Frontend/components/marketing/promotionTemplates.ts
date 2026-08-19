/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * promotionTemplates.ts — the reusable, structured template catalog for the
 * Promotion Studio (Phase C). A template is a CONFIG, never free HTML/CSS —
 * the renderer draws from these fields only, so arbitrary client markup can
 * never be stored as trusted content.
 *
 * Adding a future channel (WhatsApp story, Instagram post, flyer) is a new
 * entry here + a renderer variant, not a new component per design.
 */

export interface PromoTemplate {
  id: string;
  name: string;
  category: string;
  /** Render aspect — used by the preview to scale. */
  aspectRatio: string;          // 'wide' | 'card' | 'square' | 'tall'
  layout: 'hero' | 'split' | 'badge' | 'minimal' | 'fullimage';
  supportsProductImage: boolean;
  supportsLogo: boolean;
  supportsPrice: boolean;
  supportsDiscount: boolean;
  supportsCTA: boolean;
  /** Tailwind shape classes for the renderer. */
  frame: string;
  previewHint: string;
}

export const PROMO_TEMPLATES: PromoTemplate[] = [
  {
    id: 'full-image',
    name: 'Full Image',
    category: 'Simple whole image',
    aspectRatio: 'wide',
    layout: 'fullimage',
    supportsProductImage: true,
    supportsLogo: false,
    supportsPrice: false,
    supportsDiscount: false,
    supportsCTA: false,
    frame: 'aspect-[16/7] w-full rounded-2xl overflow-hidden relative',
    previewHint: 'Your own finished design — the image fills the whole banner, exactly as you made it.',
  },
  {
    id: 'hero-banner',
    name: 'Hero Banner',
    category: 'Website banner',
    aspectRatio: 'wide',
    layout: 'hero',
    supportsProductImage: true,
    supportsLogo: true,
    supportsPrice: true,
    supportsDiscount: true,
    supportsCTA: true,
    frame: 'aspect-[16/7] w-full rounded-2xl overflow-hidden relative',
    previewHint: 'Great for the top of your customer website.',
  },
  {
    id: 'offer-card',
    name: 'Offer Card',
    category: 'Menu / website',
    aspectRatio: 'card',
    layout: 'split',
    supportsProductImage: true,
    supportsLogo: true,
    supportsPrice: true,
    supportsDiscount: true,
    supportsCTA: true,
    frame: 'aspect-[4/3] w-full rounded-2xl overflow-hidden relative',
    previewHint: 'A compact card that sits next to your menu items.',
  },
  {
    id: 'square-creative',
    name: 'Square Creative',
    category: 'Social / WhatsApp',
    aspectRatio: 'square',
    layout: 'badge',
    supportsProductImage: true,
    supportsLogo: true,
    supportsPrice: true,
    supportsDiscount: true,
    supportsCTA: true,
    frame: 'aspect-square w-full rounded-2xl overflow-hidden relative',
    previewHint: 'Perfect for WhatsApp status and social posts.',
  },
  {
    id: 'mobile-banner',
    name: 'Mobile Banner',
    category: 'QR ordering',
    aspectRatio: 'tall',
    layout: 'minimal',
    supportsProductImage: true,
    supportsLogo: true,
    supportsPrice: true,
    supportsDiscount: true,
    supportsCTA: true,
    frame: 'aspect-[3/4] w-full rounded-2xl overflow-hidden relative',
    previewHint: 'Shown at the top of your QR ordering screen.',
  },
];

export const TEMPLATE_BY_ID: Record<string, PromoTemplate> = Object.fromEntries(
  PROMO_TEMPLATES.map((t) => [t.id, t]),
);

export const TEMPLATE_IDS = PROMO_TEMPLATES.map((t) => t.id);

export function templateById(id: string): PromoTemplate {
  return TEMPLATE_BY_ID[id] || PROMO_TEMPLATES[0];
}

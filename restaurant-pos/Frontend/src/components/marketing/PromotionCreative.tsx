/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionCreative — renders a promotion creative (banner / card / QR
 * creative) from a structured template config + creative content. The
 * renderer is the ONLY place layout is applied; templates are data, and the
 * offer's authoritative discount is always injected by the parent (the
 * creative never invents pricing — the studio shows a mismatch banner when
 * the live offer disagrees with the snapshot).
 */

import React from 'react';
import { templateById } from './promotionTemplates';

export interface CreativeProps {
  creative: {
    title: string;
    subtitle: string;
    description: string;
    cta: string;
    language: string;
    tone: string;
    colors: { background: string; text: string; accent: string };
    image?: { key?: string; source?: string } | null;
    logoKey?: string | null;
    productImageKeys?: string[];
    layout?: string;
  };
  templateId: string;
  /** Authoritative discount text from the live offer (e.g. "20% OFF"). */
  discountLabel?: string;
  restaurantName?: string;
  /** Scale factor for preview thumbnails (1 = full). */
  scale?: number;
  /** When false, hides the discount badge (e.g. no live offer yet). */
  showDiscount?: boolean;
}

export function CreativeFrame({ templateId, children }: { templateId: string; children: React.ReactNode }) {
  const t = templateById(templateId);
  return (
    <div className={t.frame} style={{ fontFamily: 'inherit' }}>
      {children}
    </div>
  );
}

export default function PromotionCreative({
  creative, templateId, discountLabel, restaurantName, scale = 1, showDiscount = true,
}: CreativeProps) {
  const t = templateById(templateId);
  const { colors } = creative;
  const bg = colors.background || '#0b2a5b';
  const text = colors.text || '#ffffff';
  const accent = colors.accent || '#f59e0b';
  const imageKey = creative.image?.key || creative.productImageKeys?.[0] || null;
  const title = creative.title || 'Special offer';
  const subtitle = creative.subtitle || '';
  const cta = creative.cta || 'Order Now';
  const logoKey = creative.logoKey || null;

  const fontSize = (base: number) => `${Math.round(base * scale)}px`;

  // Layout variants — each is a pure function of the template config.
  const hero = (
    <>
      {imageKey && (
        <img src={imageKey} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      )}
      <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${bg} 0%, ${bg}CC 45%, ${bg}22 100%)` }} />
      <div className="absolute inset-0 flex flex-col justify-center px-[5%] py-[4%]">
        {logoKey ? (
          <img src={logoKey} alt={restaurantName || 'Restaurant'} className="w-[14%] h-auto max-h-[18%] object-contain mb-1" loading="lazy" />
        ) : (
          restaurantName && <p style={{ color: text, opacity: 0.85, fontSize: fontSize(10), fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{restaurantName}</p>
        )}
        {showDiscount && discountLabel && (
          <p className="font-black" style={{ color: accent, fontSize: fontSize(30), letterSpacing: '-0.02em' }}>{discountLabel}</p>
        )}
        <h3 className="font-black leading-tight" style={{ color: text, fontSize: fontSize(24), maxWidth: '70%' }}>{title}</h3>
        {subtitle && <p style={{ color: text, opacity: 0.9, fontSize: fontSize(12), maxWidth: '65%' }}>{subtitle}</p>}
        <div className="mt-[2%]">
          <span className="inline-flex items-center font-black rounded-lg" style={{ background: accent, color: bg, fontSize: fontSize(11), padding: `${scale * 8}px ${scale * 16}px` }}>
            {cta}
          </span>
        </div>
      </div>
    </>
  );

  const split = (
    <div className="absolute inset-0 grid grid-cols-2" style={{ background: bg }}>
      <div className="flex flex-col justify-center px-[8%] py-[6%] min-w-0">
        {logoKey ? (
          <img src={logoKey} alt={restaurantName || 'Restaurant'} className="w-[36%] h-auto object-contain mb-1" loading="lazy" />
        ) : (
          restaurantName && <p style={{ color: text, opacity: 0.8, fontSize: fontSize(8), fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{restaurantName}</p>
        )}
        {showDiscount && discountLabel && (
          <p className="font-black" style={{ color: accent, fontSize: fontSize(22) }}>{discountLabel}</p>
        )}
        <h3 className="font-black leading-tight" style={{ color: text, fontSize: fontSize(16) }}>{title}</h3>
        {subtitle && <p style={{ color: text, opacity: 0.9, fontSize: fontSize(9) }}>{subtitle}</p>}
        <div className="mt-[4%]">
          <span className="inline-flex items-center font-black rounded-lg" style={{ background: accent, color: bg, fontSize: fontSize(9), padding: `${scale * 6}px ${scale * 12}px` }}>
            {cta}
          </span>
        </div>
      </div>
      <div className="relative">
        {imageKey ? (
          <img src={imageKey} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${accent}22` }}>
            <span style={{ color: accent, fontSize: fontSize(40) }}>🍽️</span>
          </div>
        )}
      </div>
    </div>
  );

  const badge = (
    <div className="absolute inset-0" style={{ background: bg }}>
      <div className="absolute -right-[18%] -top-[22%] w-[70%] h-[70%] rounded-full" style={{ background: `${accent}26` }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-[10%] py-[8%]">
        {logoKey ? (
          <img src={logoKey} alt={restaurantName || 'Restaurant'} className="w-[26%] h-auto object-contain mb-1" loading="lazy" />
        ) : (
          restaurantName && <p style={{ color: text, opacity: 0.8, fontSize: fontSize(8), fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{restaurantName}</p>
        )}
        {showDiscount && discountLabel && (
          <p className="font-black" style={{ color: accent, fontSize: fontSize(26) }}>{discountLabel}</p>
        )}
        <h3 className="font-black leading-tight" style={{ color: text, fontSize: fontSize(15) }}>{title}</h3>
        {subtitle && <p style={{ color: text, opacity: 0.9, fontSize: fontSize(9) }}>{subtitle}</p>}
        {imageKey && <img src={imageKey} alt="" className="w-[40%] h-auto object-cover rounded-lg mt-1" loading="lazy" />}
        <div className="mt-[4%]">
          <span className="inline-flex items-center font-black rounded-full" style={{ background: accent, color: bg, fontSize: fontSize(9), padding: `${scale * 6}px ${scale * 14}px` }}>
            {cta}
          </span>
        </div>
      </div>
    </div>
  );

  // Whole-image layout — the user's own finished design fills the entire frame.
  // When no text is supplied the image shows exactly as-is; a short title adds
  // a slim bottom gradient with the title over the image.
  const fullimage = (
    <div className="absolute inset-0">
      {imageKey ? (
        <img src={imageKey} alt={title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: bg }}>
          <span style={{ color: `${accent}66`, fontSize: fontSize(44) }}>🖼️</span>
          <p style={{ color: text, opacity: 0.8, fontSize: fontSize(10), fontWeight: 700 }}>Upload your finished design</p>
        </div>
      )}
      {title && (
        <div className="absolute inset-x-0 bottom-0 px-[4%] pb-[3%] pt-[18%]" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)' }}>
          <h3 className="font-black leading-tight text-white" style={{ fontSize: fontSize(18) }}>{title}</h3>
        </div>
      )}
    </div>
  );

  const minimal = (
    <div className="absolute inset-0 flex flex-col" style={{ background: bg }}>
      <div className="flex-1 flex items-center justify-center p-[8%]">
        {imageKey ? (
          <img src={imageKey} alt="" className="w-full h-full object-cover rounded-t-2xl" loading="lazy" />
        ) : (
          <span style={{ color: `${accent}55`, fontSize: fontSize(56) }}>🎉</span>
        )}
      </div>
      <div className="px-[8%] py-[5%]" style={{ background: bg }}>
        {showDiscount && discountLabel && (
          <p className="font-black" style={{ color: accent, fontSize: fontSize(20) }}>{discountLabel}</p>
        )}
        <h3 className="font-black leading-tight" style={{ color: text, fontSize: fontSize(14) }}>{title}</h3>
        {subtitle && <p style={{ color: text, opacity: 0.9, fontSize: fontSize(9) }}>{subtitle}</p>}
        {restaurantName && <p style={{ color: text, opacity: 0.7, fontSize: fontSize(7), fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{restaurantName}</p>}
        <div className="mt-[3%]">
          <span className="inline-flex items-center font-black rounded-lg" style={{ background: accent, color: bg, fontSize: fontSize(9), padding: `${scale * 6}px ${scale * 12}px` }}>
            {cta}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative w-full" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      <CreativeFrame templateId={templateId}>
        {t.layout === 'hero' && hero}
        {t.layout === 'split' && split}
        {t.layout === 'badge' && badge}
        {t.layout === 'minimal' && minimal}
        {t.layout === 'fullimage' && fullimage}
      </CreativeFrame>
    </div>
  );
}

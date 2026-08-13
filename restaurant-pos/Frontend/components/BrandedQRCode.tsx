/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BrandedQRCode — the ONE React component for every QR in the POS.
 *
 * Renders a branded composition: restaurant name (optional per placement),
 * the stylized QR (generated locally from the real encoder), and a
 * purpose-specific CTA. Pure client-side — works fully offline.
 *
 * Business features pass a URL in `value`; the component never knows what the
 * QR is for beyond the presentation defaults its `purpose`/`placement` imply.
 */

import { useEffect, useMemo } from 'react';
import type { BrandedQrRequest } from '../src/qr';
import { resolveQrOptions, renderQrSvg, svgToDataUrl, ensureScanSafeDark, contrastNotice } from '../src/qr';

interface BrandedQRCodeProps {
  value: string;
  purpose?: BrandedQrRequest['purpose'];
  placement?: BrandedQrRequest['placement'];
  restaurant: { name: string; logo?: string | null; primaryColor: string; secondaryColor?: string };
  config?: BrandedQrRequest['config'];
  /** CSS width override (defaults to the placement preset). */
  size?: number;
  /** Show the CTA even when the placement hides it (e.g. compact print). */
  forceCta?: boolean;
  className?: string;
  /** Alt text override — defaults to "{name} {purpose} QR code". */
  alt?: string;
  /** Called with the rendered SVG string (used by print flows). */
  onSvgReady?: (svg: string) => void;
}

const PURPOSE_LABEL: Record<string, string> = {
  loyalty: 'loyalty',
  menu: 'menu',
  offer: 'offer',
  coupon: 'coupon',
  review: 'review',
  whatsapp: 'WhatsApp ordering',
  parking: 'parking',
  table: 'table ordering',
  ordering: 'ordering',
  receipt: 'receipt',
  custom: '',
};

export default function BrandedQRCode({
  value, purpose = 'custom', placement = 'digital', restaurant, config,
  size, forceCta, className, alt, onSvgReady,
}: BrandedQRCodeProps) {
  const resolved = useMemo(
    () => resolveQrOptions({ value, purpose, placement, restaurant, config }),
    [value, purpose, placement, restaurant?.name, restaurant?.logo, restaurant?.primaryColor, restaurant?.secondaryColor, config],
  );

  const rendered = useMemo(
    () => renderQrSvg({
      value: resolved.value,
      style: resolved.style,
      finderStyle: resolved.finderStyle,
      dark: resolved.dark,
      light: resolved.light,
      logo: resolved.logoEnabled ? resolved.logo : null,
      logoEnabled: resolved.logoEnabled,
      errorCorrectionLevel: resolved.errorCorrectionLevel,
      margin: resolved.margin,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved.value, resolved.style, resolved.finderStyle, resolved.dark, resolved.light, resolved.logo, resolved.logoEnabled, resolved.errorCorrectionLevel, resolved.margin],
  );

  const qrSize = size ?? resolved.qrSize;
  const darkSafe = useMemo(() => ensureScanSafeDark(resolved.dark), [resolved.dark]);
  const notice = contrastNotice(resolved.dark, darkSafe.adjusted);

  // Surface the raw SVG string to callers that need it (print flows).
  // Called in an effect (not during render) so it can't fire mid-render.
  useEffect(() => {
    onSvgReady?.(rendered.svg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.svg]);

  const showCta = forceCta ?? resolved.showCta;
  const altText = alt || `${restaurant.name || 'Restaurant'} ${PURPOSE_LABEL[purpose] || ''} QR code`.trim();

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: resolved.compact ? 4 : 8 }}
      role="img"
      aria-label={altText}
    >
      {resolved.showName && restaurant.name && (
        <span
          style={{
            fontWeight: resolved.nameSize === 'lg' ? 900 : resolved.nameSize === 'md' ? 800 : 700,
            fontSize: resolved.nameSize === 'lg' ? 20 : resolved.nameSize === 'md' ? 15 : 10,
            letterSpacing: 0.5,
            lineHeight: 1.1,
            color: '#111827',
          }}
        >
          {restaurant.name}
        </span>
      )}

      {/* The QR itself — real encoder output, inline SVG for crisp printing. */}
      <div
        style={{
          width: qrSize,
          height: qrSize,
          padding: resolved.frameEnabled ? 8 : 0,
          background: resolved.frameEnabled ? '#ffffff' : 'transparent',
          border: resolved.frameEnabled ? `2px solid ${darkSafe.adjusted}` : 'none',
          borderRadius: resolved.frameEnabled ? 16 : 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={svgToDataUrl(rendered.svg)}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
          draggable={false}
        />
      </div>

      {showCta && resolved.cta && (
        <span style={{ fontSize: resolved.compact ? 8 : 11, fontWeight: 600, color: '#4b5563', letterSpacing: 0.4 }}>
          {resolved.cta}
        </span>
      )}

      {notice && (
        <span style={{ fontSize: 9, color: '#b45309', maxWidth: qrSize, lineHeight: 1.2 }}>{notice}</span>
      )}
    </div>
  );
}

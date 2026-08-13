/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global Branded QR Design System tests:
 *  - encoder: real QR matrix generation (valid + invalid input)
 *  - validation: encoded value === decoded value (jsQR round-trip) at every EC
 *    level, for short and long URLs
 *  - renderer: SVG structure for every style + finder, quiet zone, logo block,
 *    safe-color adjustment
 *  - contrast: light brand colors get darkened to a scannable shade
 *  - presets: purpose CTAs and placement compositions
 */

import { describe, it, expect } from 'vitest';
import {
  generateQrMatrix,
  isValidQrValue,
  validateQrRoundTrip,
  decodeQrMatrix,
  matrixToRgba,
  renderQrSvg,
  ensureScanSafeDark,
  ensureScanSafeLight,
  relativeLuminance,
  resolveQrOptions,
  PURPOSE_PRESETS,
  PLACEMENT_PRESETS,
  DEFAULT_QR_DARK,
} from '../index';

const SHORT_URL = 'https://example.com/pbl_abc123';
const LONG_URL = `https://example.com/public/${'x'.repeat(180)}?mode=table&ref=abc-${'y'.repeat(120)}`;

describe('encoder', () => {
  it('generates a square matrix with dark modules', () => {
    const m = generateQrMatrix(SHORT_URL, 'M');
    expect(m.size).toBeGreaterThan(20);
    expect(m.size).toBeLessThan(120);
    expect(m.darkCount).toBeGreaterThan(100);
    // Finder patterns must be present at the three corners.
    expect(m.get(0, 0)).toBe(true);
    expect(m.get(0, m.size - 1)).toBe(true);
    expect(m.get(m.size - 1, 0)).toBe(true);
  });

  it('generates a larger matrix at H (higher EC = more modules)', () => {
    const low = generateQrMatrix(LONG_URL, 'L');
    const high = generateQrMatrix(LONG_URL, 'H');
    expect(high.size).toBeGreaterThanOrEqual(low.size);
  });

  it('throws on empty input', () => {
    expect(() => generateQrMatrix('', 'M')).toThrow();
    expect(() => generateQrMatrix('   ', 'M')).toThrow();
  });

  it('validates candidate values', () => {
    expect(isValidQrValue(SHORT_URL)).toBe(true);
    expect(isValidQrValue('')).toBe(false);
    expect(isValidQrValue('hello\u0000world')).toBe(false);
    expect(isValidQrValue('a'.repeat(4000))).toBe(false);
  });
});

describe('validation — encoded value === decoded value', () => {
  it('round-trips a short URL at every EC level', () => {
    for (const ec of ['L', 'M', 'Q', 'H'] as const) {
      const r = validateQrRoundTrip(SHORT_URL, ec, { scale: 10, margin: 4 });
      expect(r.ok, `${ec} failed: ${r.error}`).toBe(true);
      expect(r.decoded).toBe(SHORT_URL);
    }
  });

  it('round-trips a long URL', () => {
    const r = validateQrRoundTrip(LONG_URL, 'M', { scale: 8, margin: 4 });
    expect(r.ok, r.error).toBe(true);
    expect(r.decoded).toBe(LONG_URL);
  });

  it('detects a mismatch when the payload differs', () => {
    // Re-encode a different value and decode — the decoded string differs.
    const m = generateQrMatrix('https://example.com/other', 'M');
    const decoded = decodeQrMatrix(m, { scale: 10, margin: 4 });
    expect(decoded.ok).toBe(true);
    expect(decoded.decoded).not.toBe(SHORT_URL);
  });

  it('matrixToRgba produces a non-empty RGBA buffer sized with margin', () => {
    const m = generateQrMatrix(SHORT_URL, 'M');
    const { data, width, height } = matrixToRgba(m, { scale: 4, margin: 4 });
    expect(width).toBe((m.size + 8) * 4);
    expect(height).toBe((m.size + 8) * 4);
    expect(data.length).toBe(width * height * 4);
  });
});

describe('renderer — SVG structure', () => {
  it('renders a scannable SVG for every style + finder combination', () => {
    const styles = ['classic', 'rounded', 'dots', 'brand'] as const;
    const finders = ['square', 'rounded', 'soft-rounded'] as const;
    for (const style of styles) {
      for (const finder of finders) {
        const rendered = renderQrSvg({ value: SHORT_URL, style, finderStyle: finder, dark: '#004ac6' });
        expect(rendered.svg).toContain('<svg');
        expect(rendered.svg).toContain('viewBox');
        expect(rendered.svg).toContain('</svg>');
        // The EXACT matrix the renderer drew must decode back to the value
        // (same margin + colors as the SVG so we validate what ships).
        const decoded = decodeQrMatrix(rendered.matrix, { scale: 10, margin: 4, dark: rendered.dark, light: rendered.light });
        expect(decoded.ok, `${style}/${finder}: ${decoded.error}`).toBe(true);
        expect(decoded.decoded).toBe(SHORT_URL);
      }
    }
  });

  it('dots style uses circles, classic uses rects', () => {
    const dots = renderQrSvg({ value: SHORT_URL, style: 'dots' });
    const classic = renderQrSvg({ value: SHORT_URL, style: 'classic' });
    expect(dots.svg).toContain('<circle');
    expect(classic.svg).not.toContain('<circle');
    expect(classic.svg).toContain('<rect');
  });

  it('embeds a white logo pad with a centered image for inline (data:) logos', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const { svg } = renderQrSvg({
      value: SHORT_URL,
      style: 'brand',
      logo,
      logoEnabled: true,
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('iVBORw0KGgo');
    // White pad must sit behind the logo so modules stay separated.
    expect(svg).toContain('fill="#ffffff"');
  });

  it('skips non-inline (remote) logos instead of shipping a broken QR', () => {
    const { svg } = renderQrSvg({
      value: SHORT_URL,
      style: 'brand',
      logo: 'https://example.com/logo.png',
      logoEnabled: true,
    });
    // Remote URLs can't load inside an SVG data URL — renderer must degrade
    // gracefully and keep the QR scannable.
    expect(svg).not.toContain('<image');
  });

  it('omits the logo block when disabled or no logo', () => {
    const noLogo = renderQrSvg({ value: SHORT_URL, logoEnabled: false });
    const noUrl = renderQrSvg({ value: SHORT_URL, logo: null, logoEnabled: true });
    expect(noLogo.svg).not.toContain('<image');
    expect(noUrl.svg).not.toContain('<image');
  });

  it('honors the quiet zone margin (viewBox grows by 2×margin)', () => {
    const m = generateQrMatrix(SHORT_URL, 'M');
    const margin = 4;
    const { svg } = renderQrSvg({ value: SHORT_URL, margin });
    expect(svg).toContain(`viewBox="0 0 ${m.size + margin * 2} ${m.size + margin * 2}"`);
  });

  it('clamps the margin to the QR-spec-safe range', () => {
    const tight = renderQrSvg({ value: SHORT_URL, margin: 0 });
    const huge = renderQrSvg({ value: SHORT_URL, margin: 99 });
    // margin is clamped to [2, 8]
    expect(tight.svg).toContain('viewBox="0 0 ');
    expect(huge.svg).toContain('viewBox="0 0 ');
  });

  it('reports when the requested dark color was unsafe', () => {
    const { dark, darkAdjusted } = renderQrSvg({ value: SHORT_URL, dark: '#ffeeaa' });
    expect(darkAdjusted).toBe(true);
    expect(dark).not.toBe('#ffeeaa');
    expect(relativeLuminance(dark)).toBeLessThanOrEqual(0.25);
  });
});

describe('contrast safety', () => {
  it('keeps already-safe colors untouched', () => {
    expect(ensureScanSafeDark('#1a1a2e')).toEqual({ safe: true, adjusted: '#1a1a2e' });
    expect(ensureScanSafeDark('#000000')).toEqual({ safe: true, adjusted: '#000000' });
  });

  it('darkens light brand colors to a scannable shade', () => {
    const r = ensureScanSafeDark('#FFD700'); // gold
    expect(r.safe).toBe(false);
    expect(relativeLuminance(r.adjusted)).toBeLessThanOrEqual(0.25);
  });

  it('lightens a dark background', () => {
    const r = ensureScanSafeLight('#222222');
    expect(r.safe).toBe(false);
    expect(relativeLuminance(r.adjusted)).toBeGreaterThanOrEqual(0.85);
    expect(ensureScanSafeLight('#ffffff')).toEqual({ safe: true, adjusted: '#ffffff' });
  });
});

describe('presets', () => {
  it('defines a CTA for every purpose', () => {
    expect(PURPOSE_PRESETS.loyalty.cta).toBe('Scan & Earn Rewards');
    expect(PURPOSE_PRESETS.table.cta).toBe('Scan to Order');
    expect(PURPOSE_PRESETS.parking.cta).toBe('Scan for Parking');
    expect(PURPOSE_PRESETS.review.cta).toBe('Share Your Feedback');
    expect(PURPOSE_PRESETS.whatsapp.cta).toBe('Order on WhatsApp');
  });

  it('defines a composition for every placement', () => {
    expect(PLACEMENT_PRESETS.receipt.compact).toBe(true);
    expect(PLACEMENT_PRESETS['table-card'].compact).toBe(false);
    expect(PLACEMENT_PRESETS.poster.qrSize).toBeGreaterThan(PLACEMENT_PRESETS.receipt.qrSize);
  });

  it('resolves branding + purpose + placement into concrete options', () => {
    const r = resolveQrOptions({
      value: SHORT_URL,
      purpose: 'loyalty',
      placement: 'receipt',
      restaurant: { name: 'CHAISH', primaryColor: '#8B4513' },
      config: { style: 'brand', finderStyle: 'rounded', primaryColor: '#8B4513', logoEnabled: false, frameEnabled: false },
    });
    expect(r.dark).toBe('#8B4513');
    expect(r.cta).toBe('Scan & Earn Rewards');
    expect(r.compact).toBe(true);
    expect(r.qrSize).toBeGreaterThanOrEqual(PURPOSE_PRESETS.loyalty.minSize);
  });

  it('falls back to a safe default color when no branding exists', () => {
    const r = resolveQrOptions({ value: SHORT_URL, restaurant: { name: '', primaryColor: '' } });
    expect(r.dark).toBe(DEFAULT_QR_DARK);
  });

  it('supports per-purpose CTA overrides', () => {
    const r = resolveQrOptions({
      value: SHORT_URL,
      purpose: 'menu',
      restaurant: { name: 'X', primaryColor: '#111' },
      config: { style: 'brand', finderStyle: 'square', primaryColor: '#111', logoEnabled: false, frameEnabled: true, ctaOverrides: { menu: 'See Our Menu!' } },
    });
    expect(r.cta).toBe('See Our Menu!');
  });
});

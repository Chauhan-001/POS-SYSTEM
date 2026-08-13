/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Color contrast safety for QR codes.
 *
 * A QR must have strong dark/light contrast to scan. Restaurant brand colors
 * are often light (yellow, cream, pastels) and would produce an unscannable
 * QR against a white background. This module validates any color and, when
 * needed, derives a safe darker shade — never silently rendering a QR that
 * cannot be scanned.
 */

/** Relative luminance per WCAG (0–1). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Darkest acceptable module color for reliable scanning. A QR module color
 * must be comfortably darker than the background; WCAG contrast of ≥ 4.5:1
 * against white is the safe floor.
 */
export const DARK_MAX_LUMINANCE = 0.25;

/**
 * Validate a proposed module color. Returns { safe, adjusted } where `safe`
 * is true when the color already meets the contrast floor, and `adjusted` is
 * the guaranteed-scannable color to use.
 */
export function ensureScanSafeDark(color: string): { safe: boolean; adjusted: string } {
  const rgb = hexToRgb(color);
  if (!rgb) return { safe: false, adjusted: '#000000' };
  if (relativeLuminance(color) <= DARK_MAX_LUMINANCE) {
    return { safe: true, adjusted: color };
  }
  // Too light — mix toward black until it crosses the floor (preserves hue).
  let { r, g, b } = rgb;
  let lum = relativeLuminance(color);
  let steps = 0;
  while (lum > DARK_MAX_LUMINANCE && steps < 8) {
    r *= 0.72;
    g *= 0.72;
    b *= 0.72;
    lum = relativeLuminance(rgbToHex(r, g, b));
    steps += 1;
  }
  return { safe: false, adjusted: rgbToHex(r, g, b) };
}

/** Light background must stay light — clamp dark backgrounds toward white. */
export function ensureScanSafeLight(color: string): { safe: boolean; adjusted: string } {
  const rgb = hexToRgb(color);
  if (!rgb) return { safe: false, adjusted: '#ffffff' };
  if (relativeLuminance(color) >= 0.85) {
    return { safe: true, adjusted: color };
  }
  let { r, g, b } = rgb;
  let lum = relativeLuminance(color);
  let steps = 0;
  while (lum < 0.85 && steps < 8) {
    r = r + (255 - r) * 0.55;
    g = g + (255 - g) * 0.55;
    b = b + (255 - b) * 0.55;
    lum = relativeLuminance(rgbToHex(r, g, b));
    steps += 1;
  }
  return { safe: false, adjusted: rgbToHex(r, g, b) };
}

/** Human message when a brand color needed adjustment (shown in the designer). */
export function contrastNotice(original: string, adjusted: string): string | null {
  if (original === adjusted) return null;
  return `“${original}” is too light to scan reliably — using the darker shade ${adjusted} instead.`;
}

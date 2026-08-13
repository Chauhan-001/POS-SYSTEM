/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stylized QR renderer — draws the raw QR matrix (from encoder.ts) as SVG with
 * restaurant branding: Classic / Rounded / Dots / Brand module styles, finder
 * pattern corner treatments, optional centered logo, enforced quiet zone and
 * scan-safe colors.
 *
 * The renderer NEVER knows business logic. It receives a value + resolved
 * presentation options and returns an SVG string. The QR structure is always
 * the mathematically valid matrix from the `qrcode` encoder — styling never
 * moves, deletes or overlaps modules, and the quiet zone is never invaded.
 */

import type { QrEcLevel, QrFinderStyle, QrStyle } from './types';
import type { QrMatrix } from './encoder';
import { generateQrMatrix } from './encoder';
import { ensureScanSafeDark, ensureScanSafeLight } from './contrast';

/** Recommended EC level: H when a center logo covers modules, else M. */
export function autoErrorCorrection(logoEnabled: boolean, override?: QrEcLevel): QrEcLevel {
  if (override) return override;
  return logoEnabled ? 'H' : 'M';
}

const ESC = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface QrRenderOptions {
  value: string;
  style?: QrStyle;
  finderStyle?: QrFinderStyle;
  /** Module color (auto-darkened when unsafe). */
  dark?: string;
  /** Background color (auto-lightened when unsafe). */
  light?: string;
  logo?: string | null;
  logoEnabled?: boolean;
  errorCorrectionLevel?: QrEcLevel;
  /** Quiet zone in modules. Clamped to [2, 8]; default 4 (QR spec). */
  margin?: number;
}

export interface QrRenderResult {
  svg: string;
  /** Colors actually used (after safety adjustment). */
  dark: string;
  light: string;
  /** True when the requested dark color was too light and got darkened. */
  darkAdjusted: boolean;
  matrix: QrMatrix;
}

const FINDER_BLOCK = 7;

function isInFinder(size: number, row: number, col: number): boolean {
  const zones: Array<[number, number]> = [
    [0, 0],
    [0, size - FINDER_BLOCK],
    [size - FINDER_BLOCK, 0],
  ];
  return zones.some(([r0, c0]) => row >= r0 && row < r0 + FINDER_BLOCK && col >= c0 && col < c0 + FINDER_BLOCK);
}

function finderCornerRadius(finderStyle: QrFinderStyle | undefined, unit: number): number {
  switch (finderStyle) {
    case 'rounded': return unit * 0.45;
    case 'soft-rounded': return unit * 0.7;
    default: return 0;
  }
}

/**
 * Render one finder pattern (7×7) at (r0, c0): dark outer ring, 1-module light
 * ring, 3×3 dark core — exactly the QR spec. Only the corner radius changes.
 */
function renderFinder(r0: number, c0: number, unit: number, dark: string, light: string, radius: number): string {
  const rx = Math.max(0, Math.min(radius, unit * 0.7));
  const x = c0 * unit;
  const y = r0 * unit;
  // Outer dark ring.
  const outer = `<rect x="${x}" y="${y}" width="${FINDER_BLOCK * unit}" height="${FINDER_BLOCK * unit}" rx="${rx}" fill="${dark}"/>`;
  // Punch the light 5×5 ring (leaves the 1-module border dark).
  const punch = `<rect x="${(c0 + 1) * unit}" y="${(r0 + 1) * unit}" width="${5 * unit}" height="${5 * unit}" fill="${light}"/>`;
  // Inner dark 3×3 core.
  const inner = `<rect x="${(c0 + 2) * unit}" y="${(r0 + 2) * unit}" width="${3 * unit}" height="${3 * unit}" rx="${rx}" fill="${dark}"/>`;
  return `<g>${outer}${punch}${inner}</g>`;
}

/** Build the full SVG for a QR value with styling. */
export function renderQrSvg(options: QrRenderOptions): QrRenderResult {
  const darkCheck = ensureScanSafeDark(options.dark || '#1a1a2e');
  const lightCheck = ensureScanSafeLight(options.light || '#ffffff');
  const dark = darkCheck.adjusted;
  const light = lightCheck.adjusted;
  const ec = autoErrorCorrection(!!options.logoEnabled && !!options.logo, options.errorCorrectionLevel);
  const matrix = generateQrMatrix(options.value, ec);
  const { size } = matrix;
  const margin = Math.max(2, Math.min(8, options.margin ?? 4));
  const style: QrStyle = options.style || 'brand';
  const finderStyle = options.finderStyle || 'rounded';

  const total = size + margin * 2;
  const unit = 1;
  const shapes: string[] = [];
  const rx = unit * 0.3;
  const radius = finderCornerRadius(finderStyle, unit);

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!matrix.get(r, c)) continue;
      if (isInFinder(size, r, c)) continue;
      const x = (c + margin) * unit;
      const y = (r + margin) * unit;
      if (style === 'dots') {
        shapes.push(`<circle cx="${x + unit / 2}" cy="${y + unit / 2}" r="${unit * 0.42}" fill="${dark}"/>`);
      } else if (style === 'rounded') {
        shapes.push(`<rect x="${x}" y="${y}" width="${unit}" height="${unit}" rx="${rx}" fill="${dark}"/>`);
      } else {
        // classic / brand — crisp squares (brand still uses the safe brand color).
        shapes.push(`<rect x="${x}" y="${y}" width="${unit}" height="${unit}" fill="${dark}"/>`);
      }
    }
  }

  const finders = [
    [0, 0],
    [0, size - FINDER_BLOCK],
    [size - FINDER_BLOCK, 0],
  ]
    .map(([r0, c0]) => renderFinder(r0 + margin, c0 + margin, unit, dark, light, radius))
    .join('');

  const logoBlock = options.logoEnabled && options.logo ? embedLogo(options.logo, total, unit) : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} ${total}" role="img" aria-label="QR code">` +
    `<rect x="0" y="0" width="${total}" height="${total}" fill="${light}"/>` +
    `<g>${finders}${shapes.join('')}</g>` +
    logoBlock +
    `</svg>`;

  return { svg, dark, light, darkAdjusted: !darkCheck.safe, matrix };
}

/**
 * True when a logo URL is safe to embed inside an SVG data URL. The QR SVG is
 * consumed via <img src="data:image/svg+xml;…">, where browsers refuse to load
 * external (http/https) resources — a remote logo would silently not render
 * and would taint the canvas during Test Scan rasterization. Only self-
 * contained data:/blob: URLs (what the settings logo upload produces) embed
 * reliably.
 */
export function isSafeInlineLogo(logo: string | null | undefined): boolean {
  if (!logo) return false;
  return logo.startsWith('data:') || logo.startsWith('blob:');
}

/**
 * Optional centered logo. Size is capped at ~20% of the QR width so it never
 * destroys scannability, and EC is forced to H (see autoErrorCorrection). A
 * white rounded "stamp" pad sits under the logo so modules stay separated.
 * Non-inline (remote) logos are skipped rather than shipped broken — the QR
 * remains fully scannable without them.
 */
function embedLogo(logo: string, total: number, unit: number): string {
  if (!isSafeInlineLogo(logo)) {
    // Remote logos can't render inside an SVG data URL — degrade gracefully
    // instead of shipping a QR that silently lost its center graphic.
    console.warn('[QR] Skipping non-inline logo (only data:/blob: URLs render inside QR SVGs).');
    return '';
  }
  const logoSize = Math.max(3, Math.round(total * 0.2));
  const pad = Math.round(logoSize * 0.14) + 1;
  const x = (total - logoSize) / 2;
  const y = (total - logoSize) / 2;
  const px = x - pad;
  const py = y - pad;
  const pSize = logoSize + pad * 2;
  const r = Math.max(1, unit);
  return (
    `<rect x="${px}" y="${py}" width="${pSize}" height="${pSize}" rx="${r * 2}" fill="#ffffff"/>` +
    `<image href="${ESC(logo)}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" clip-path="inset(0 round ${r * 2}px)"/>`
  );
}

/** Encode an SVG string as a data URL usable in <img src>. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

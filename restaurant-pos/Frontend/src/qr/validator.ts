/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR validation — decodes a rendered QR back to its intended value using jsQR
 * (the standard client-side decoder). Used by the Test Scan button in the QR
 * designer and by unit tests: "decoded value === original value".
 *
 * Decoding works from either the raw matrix (rendered to RGBA pixels locally,
 * no DOM needed — used in tests) or an SVG rasterized to a canvas (browser).
 */

import jsQR from 'jsqr';
import { generateQrMatrix, type QrMatrix } from './encoder';
import type { QrEcLevel } from './types';

export interface DecodeResult {
  ok: boolean;
  decoded?: string;
  error?: string;
}

/** Render a QR matrix to an RGBA pixel buffer (scale px per module). */
export function matrixToRgba(
  matrix: QrMatrix,
  opts: { scale?: number; margin?: number; dark?: string; light?: string } = {},
): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = opts.scale ?? 8;
  const margin = Math.max(0, opts.margin ?? 4);
  const dark = opts.dark ?? '#000000';
  const light = opts.light ?? '#ffffff';
  const toRgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [dr, dg, db] = toRgb(dark);
  const [lr, lg, lb] = toRgb(light);
  const { size } = matrix;
  const dim = (size + margin * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * dim + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      const mRow = Math.floor(y / scale) - margin;
      const mCol = Math.floor(x / scale) - margin;
      const darkModule = mRow >= 0 && mCol >= 0 && mRow < size && mCol < size && matrix.get(mRow, mCol);
      set(x, y, darkModule ? dr : lr, darkModule ? dg : lg, darkModule ? db : lb);
    }
  }
  return { data, width: dim, height: dim };
}

/**
 * Decode a QR matrix with jsQR. Returns { ok, decoded } where decoded is the
 * exact string the QR encodes. This is the deterministic, DOM-free check used
 * by tests and by the designer's Test Scan.
 */
export function decodeQrMatrix(
  matrix: QrMatrix,
  opts: { scale?: number; margin?: number; dark?: string; light?: string } = {},
): DecodeResult {
  try {
    const { data, width, height } = matrixToRgba(matrix, opts);
    const code = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
    if (!code || !code.data) return { ok: false, error: 'No QR found in the rendered code.' };
    return { ok: true, decoded: code.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Encode → decode → compare. The one-liner used by tests and Test Scan. */
export function validateQrRoundTrip(
  value: string,
  ecLevel: QrEcLevel = 'M',
  opts: { scale?: number; margin?: number } = {},
): DecodeResult {
  try {
    const matrix = generateQrMatrix(value, ecLevel);
    const result = decodeQrMatrix(matrix, opts);
    if (result.ok) {
      if (result.decoded === value) return { ok: true, decoded: result.decoded };
      return { ok: false, error: `Decoded value differs from intended value.` };
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Decode a browser-rendered SVG (designer Test Scan). Requires a DOM/canvas. */
export async function decodeQrSvg(svg: string): Promise<DecodeResult> {
  try {
    const canvas = document.createElement('canvas');
    const img = new Image();
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterize the QR.'));
      img.src = dataUrl;
    });
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, error: 'Canvas is not available in this browser.' };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const code = jsQR(data, size, size, { inversionAttempts: 'dontInvert' });
    if (!code || !code.data) return { ok: false, error: 'No QR found — try again with a simpler style.' };
    // The SVG doesn't embed the value — callers (Test Scan) compare `decoded`
    // against the value they encoded.
    return { ok: true, decoded: code.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

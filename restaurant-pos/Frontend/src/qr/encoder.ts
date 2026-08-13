/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR encoder — thin wrapper over the `qrcode` library (the one the POS already
 * uses). Exposes the raw module matrix so the stylized renderer can draw its
 * own SVG shapes (rounded/dots/brand/finder styles) while the underlying QR is
 * the exact, mathematically valid code the library computes.
 *
 * Purely local — never a network call, so QR generation works fully offline.
 */

import * as QRCode from 'qrcode';
import type { QrEcLevel } from './types';

/** The QR matrix: size × size boolean grid (true = dark module). */
export interface QrMatrix {
  size: number;
  get: (row: number, col: number) => boolean;
  /** Number of dark modules (diagnostics). */
  darkCount: number;
}

/** Generate the QR matrix for a value. Throws on empty/invalid input. */
export function generateQrMatrix(value: string, errorCorrectionLevel: QrEcLevel = 'M'): QrMatrix {
  if (!value || !String(value).trim()) {
    throw new Error('QR value is empty — nothing to encode.');
  }
  const qr = QRCode.create(String(value), { errorCorrectionLevel });
  const { size } = qr.modules;
  let darkCount = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (qr.modules.get(r, c) === 1) darkCount += 1;
    }
  }
  return { size, get: (row: number, col: number) => qr.modules.get(row, col) === 1, darkCount };
}

/** Validates a QR value is a sane URL/string (non-empty, no control chars). */
export function isValidQrValue(value: string): boolean {
  if (!value || !String(value).trim()) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  return value.length <= 3000;
}

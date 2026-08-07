/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mediaTypes.ts — Shared types & binary validation for the media module.
 *
 * This module is the single canonical upload system for the platform.
 * Future upload features (documents, product images, receipts, ...) should
 * reuse MediaService + these validators instead of creating their own.
 *
 * Security:
 *   - MIME allowlist (declared by the client, checked by multer)
 *   - Magic-byte signature detection (verifies the payload actually matches
 *     the declared type — rejects corrupted / spoofed uploads)
 *   - Extensions are derived from the verified signature, never from the
 *     client-provided filename (no arbitrary extensions, no path traversal).
 */

import { AppError } from '../../utils/AppError';

export type RestaurantMediaKind = 'logo' | 'cover';
export type RestaurantMediaField = 'logoUrl' | 'coverImageUrl';

export interface ImageSignature {
  ext: string;
  mimes: string[];
  /** Magic-byte check — returns true when the buffer matches this format. */
  check: (buffer: Buffer) => boolean;
}

/** Canonical image signature table. Extension is ONLY ever derived from here. */
export const IMAGE_SIGNATURES: ImageSignature[] = [
  {
    ext: '.jpg',
    mimes: ['image/jpeg'],
    check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: '.png',
    mimes: ['image/png'],
    check: (b) => b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a,
  },
  {
    ext: '.webp',
    mimes: ['image/webp'],
    check: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
  {
    ext: '.gif',
    mimes: ['image/gif'],
    check: (b) => b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8',
  },
];

/** All MIME types the platform accepts for image uploads. */
export const ALLOWED_IMAGE_MIMES: string[] = IMAGE_SIGNATURES.flatMap((s) => s.mimes);

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_IMAGE_MIMES.includes(mime);
}

/**
 * Detect the real file extension from magic bytes.
 * Returns null when the payload does not match any supported image format
 * (empty uploads, corrupted files, non-image files with a spoofed MIME type).
 */
export function detectImageExtension(buffer: Buffer): string | null {
  if (!buffer || buffer.length === 0) return null;
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.check(buffer)) return sig.ext;
  }
  return null;
}

/** Validate a buffer is a non-empty image matching an allowed signature. */
export function assertValidImage(buffer: Buffer, mimetype: string): string {
  if (!buffer || buffer.length === 0) {
    throw new AppError(400, 'Empty upload rejected — no image data received');
  }
  if (!isAllowedImageMime(mimetype)) {
    throw new AppError(400, `Unsupported file type '${mimetype}'. Allowed: ${ALLOWED_IMAGE_MIMES.join(', ')}`);
  }
  const ext = detectImageExtension(buffer);
  if (!ext) {
    throw new AppError(400, 'Invalid or corrupted image file — payload does not match the declared image type');
  }
  return ext;
}

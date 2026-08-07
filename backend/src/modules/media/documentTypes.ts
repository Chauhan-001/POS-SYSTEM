/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * documentTypes.ts — Magic-byte validation for document uploads.
 *
 * Extends the platform's single media-module upload system (see mediaTypes.ts)
 * so the Support module can attach documents (PDF / Office / text / CSV) in
 * addition to the images already supported by restaurant media.
 *
 * Security: same rules as mediaTypes — extensions are derived ONLY from the
 * verified signature, never from the client filename; payloads that do not
 * match their declared MIME type are rejected. Microformats that share the
 * ZIP container (docx / xlsx / pptx) are disambiguated by the declared MIME.
 */

import { AppError } from '../../utils/AppError';

export interface DocumentSignature {
  ext: string;
  mimes: string[];
  /** Magic-byte check — true when the buffer matches this format. */
  check: (buffer: Buffer) => boolean;
}

/** ZIP local-file container (docx / xlsx / pptx all share this prefix). */
function isZipContainer(b: Buffer): boolean {
  if (b.length < 4) return false;
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
}

/** Old binary OLE compound container (doc / xls). */
function isOleContainer(b: Buffer): boolean {
  return b.length >= 8 && b.readUInt32LE(0) === 0xe011cfd0 && b.readUInt32LE(4) === 0xe11ab1a1;
}

/** Plain-text check: non-empty and binary-null-free in the header region. */
function isPlainText(b: Buffer): boolean {
  if (b.length === 0) return false;
  const head = b.length < 512 ? b : b.subarray(0, 512);
  return !head.includes(0);
}

/** Canonical document signature table. Extension is ONLY derived from here. */
export const DOCUMENT_SIGNATURES: DocumentSignature[] = [
  {
    ext: '.pdf',
    mimes: ['application/pdf'],
    check: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    ext: '.docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    check: isZipContainer,
  },
  {
    ext: '.xlsx',
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    check: isZipContainer,
  },
  {
    ext: '.pptx',
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    check: isZipContainer,
  },
  {
    ext: '.doc',
    mimes: ['application/msword'],
    check: isOleContainer,
  },
  {
    ext: '.xls',
    mimes: ['application/vnd.ms-excel'],
    check: isOleContainer,
  },
  {
    ext: '.csv',
    mimes: ['text/csv'],
    check: isPlainText,
  },
  {
    ext: '.txt',
    mimes: ['text/plain'],
    check: isPlainText,
  },
];

/** All MIME types the platform accepts for document uploads. */
export const ALLOWED_DOCUMENT_MIMES: string[] = DOCUMENT_SIGNATURES.flatMap((s) => s.mimes);

export function isAllowedDocumentMime(mime: string): boolean {
  return ALLOWED_DOCUMENT_MIMES.includes(mime);
}

/**
 * Detect the real extension from magic bytes for a DECLARED mime.
 * Returns null when the payload does not match the declared document format.
 */
export function detectDocumentExtension(buffer: Buffer, mimetype: string): string | null {
  if (!buffer || buffer.length === 0) return null;
  for (const sig of DOCUMENT_SIGNATURES) {
    if (sig.mimes.includes(mimetype) && sig.check(buffer)) return sig.ext;
  }
  return null;
}

/** Validate a buffer is a non-empty document matching the declared type. */
export function assertValidDocument(buffer: Buffer, mimetype: string): string {
  if (!buffer || buffer.length === 0) {
    throw new AppError(400, 'Empty upload rejected — no document data received');
  }
  if (!isAllowedDocumentMime(mimetype)) {
    throw new AppError(400, `Unsupported file type '${mimetype}'. Allowed: ${ALLOWED_DOCUMENT_MIMES.join(', ')}`);
  }
  const ext = detectDocumentExtension(buffer, mimetype);
  if (!ext) {
    throw new AppError(400, 'Invalid or corrupted document file — payload does not match the declared type');
  }
  return ext;
}
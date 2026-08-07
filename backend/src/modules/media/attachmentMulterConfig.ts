/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * attachmentMulterConfig.ts — Shared multer configuration for support
 * attachments (images AND documents).
 *
 * Uses memory storage so the service keeps full control over filenames, paths
 * and validation (client filenames never touch the disk). The size limit comes
 * from the central config; the MIME allowlist is images ∪ documents.
 */

import multer from 'multer';
import { AppError } from '../../utils/AppError';
import { config } from '../../config';
import { isAllowedImageMime } from './mediaTypes';
import { isAllowedDocumentMime } from './documentTypes';

export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxFileSizeMB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageMime(file.mimetype) || isAllowedDocumentMime(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(
      400,
      `Unsupported file type '${file.mimetype}'. Allowed: images or PDF/Office/CSV/TXT documents`,
    ));
  },
});
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * multerConfig.ts — Shared multer configuration for image uploads.
 *
 * Uses memory storage so the service keeps full control over filenames,
 * paths and validation (client filenames never touch the disk).
 * Size limits and MIME allowlist come from the central config.
 */

import multer from 'multer';
import { AppError } from '../../utils/AppError';
import { config } from '../../config';
import { isAllowedImageMime } from './mediaTypes';

export const restaurantImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxFileSizeMB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageMime(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(
      400,
      `Unsupported file type '${file.mimetype}'. Allowed: ${config.uploads.allowedMimeTypes.join(', ')}`,
    ));
  },
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Media API routes — tenant-scoped image upload for the POS.
 *
 * Any authenticated staff member can upload an image for their own
 * restaurant. The file is validated (MIME + magic bytes + size), written
 * under {uploadsDir}/restaurants/{restaurantId}/ with a safe generated
 * filename, and served by the static /uploads route. The returned URL is
 * stored by the client on its own resource (offer, product, banner, …).
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { restaurantImageUpload, mediaService } from '../modules/media';
import { toAbsoluteMediaUrl, handleMediaError } from '../modules/media/restaurantMediaController';

const router = Router();

/** POST /api/media/upload — single image, scoped to the JWT restaurant. */
router.post('/media/upload', requireAuth, restaurantImageUpload.single('file'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).user;
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded — expected a single image under the "file" field' });
    return;
  }
  if (!auth?.restaurantId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const result = await mediaService.saveStandalone({
      restaurantId: auth.restaurantId,
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname || '',
      actor: {
        id: (auth as any)?._id?.toString() || (auth as any)?.id || 'pos-staff',
        name: auth.name || 'Staff',
        ipAddress: req.ip || undefined,
      },
    });
    res.status(201).json({ url: toAbsoluteMediaUrl(req, result.url) });
  } catch (error) {
    handleMediaError(res, error, 'POS Media Upload');
  }
});

export default router;

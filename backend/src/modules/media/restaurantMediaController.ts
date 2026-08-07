/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * restaurantMediaController.ts — Admin API handlers for restaurant
 * logo / cover upload, replace, delete and storage metrics.
 *
 * Upload flow:
 *   UI → multer (memory storage, size + MIME gate) → controller → MediaService
 *   (magic-byte validation, unique filename, disk persist) → DB update →
 *   audit log → response with absolute media URL → frontend refresh.
 *
 * All routes are authenticated + collection-access checked in routes/admin.ts.
 */

import { Request, Response } from 'express';
import { mediaService } from './mediaService';
import { RestaurantMediaKind } from './mediaTypes';
import { config } from '../../config';

interface AdminIdentity { id: string; name: string; ipAddress?: string; }

function adminIdentity(req: Request): AdminIdentity {
  const user = (req as any).user;
  return {
    id: user?._id?.toString() || user?.id || 'system',
    name: user?.name || 'Super Admin',
    ipAddress: req.ip || undefined,
  };
}

/**
 * Build an absolute media URL. Prefers the configured public base URL;
 * otherwise derives the origin from the current request. Relative paths are
 * returned as-is only when no base can be determined (should not happen).
 */
export function toAbsoluteMediaUrl(req: Request, url?: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  const base = config.uploads.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}${url}`;
}

export function handleMediaError(res: Response, error: any, logPrefix: string): void {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error?.name === 'MulterError') {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `File exceeds the maximum size of ${config.uploads.maxFileSizeMB} MB`
      : `Upload failed: ${error.message}`;
    res.status(400).json({ error: message });
    return;
  }
  console.error(`[${logPrefix}]`, error);
  res.status(500).json({ error: 'Internal server error' });
}

async function handleUpload(req: Request, res: Response, kind: RestaurantMediaKind): Promise<void> {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded — expected a single image under the "file" field' });
    return;
  }
  try {
    const result = await mediaService.saveImage({
      restaurantId: req.params.id,
      kind,
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname || '',
      actor: adminIdentity(req),
    });
    res.status(201).json({
      message: `Restaurant ${kind === 'logo' ? 'logo' : 'cover image'} uploaded successfully`,
      kind,
      url: toAbsoluteMediaUrl(req, result.url),
      media: result.meta,
    });
  } catch (error) {
    handleMediaError(res, error, `AdminRestaurants Upload${kind === 'logo' ? 'Logo' : 'Cover'}`);
  }
}

async function handleDelete(req: Request, res: Response, kind: RestaurantMediaKind): Promise<void> {
  try {
    const out = await mediaService.deleteImage({
      restaurantId: req.params.id,
      kind,
      actor: adminIdentity(req),
    });
    res.json({ message: `Restaurant ${kind} removed`, removed: out.removed });
  } catch (error) {
    handleMediaError(res, error, `AdminRestaurants Delete${kind === 'logo' ? 'Logo' : 'Cover'}`);
  }
}

export async function uploadRestaurantLogo(req: Request, res: Response): Promise<void> {
  await handleUpload(req, res, 'logo');
}

export async function uploadRestaurantCover(req: Request, res: Response): Promise<void> {
  await handleUpload(req, res, 'cover');
}

export async function deleteRestaurantLogo(req: Request, res: Response): Promise<void> {
  await handleDelete(req, res, 'logo');
}

export async function deleteRestaurantCover(req: Request, res: Response): Promise<void> {
  await handleDelete(req, res, 'cover');
}

export async function getRestaurantStorage(req: Request, res: Response): Promise<void> {
  try {
    const metrics = await mediaService.getStorageMetrics(req.params.id);
    res.json(metrics);
  } catch (error) {
    handleMediaError(res, error, 'AdminRestaurants Storage');
  }
}

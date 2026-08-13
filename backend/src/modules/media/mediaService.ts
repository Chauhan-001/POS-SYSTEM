/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mediaService.ts — Reusable media persistence service.
 *
 * The single canonical upload implementation for the platform. Files are
 * written to disk under {uploadsDir}/restaurants/{restaurantId}/ so they
 * survive restarts and are served by the static /uploads route. Metadata is
 * mirrored on the Restaurant document (media.logo / media.cover) so storage
 * metrics are computed from the database — never by scanning the filesystem
 * on every request.
 *
 * Every mutation:
 *   - Validates size / MIME / magic bytes (see mediaTypes)
 *   - Generates a unique, safe filename (client filenames are NEVER used on disk)
 *   - Namespaces files by tenant (restaurant ObjectId) → cross-tenant access
 *     is impossible by construction
 *   - Writes an audit entry (AuditLog collection + embedded restaurant auditTrail)
 *   - Removes the replaced/deleted physical file after the DB write succeeds
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import Restaurant, { IRestaurantMediaMeta } from '../../models/Restaurant';
import Subscription from '../../models/Subscription';
import SubscriptionPlan from '../../models/SubscriptionPlan';
import { auditLogRepo } from '../../repositories';
import { AppError } from '../../utils/AppError';
import { config } from '../../config';
import {
  assertValidImage, RestaurantMediaKind, RestaurantMediaField,
} from './mediaTypes';
import { assertValidDocument } from './documentTypes';
import type { TicketAttachmentMeta } from '../../models';

export interface MediaActor {
  id?: string;
  name: string;
  ipAddress?: string;
}

export interface SaveImageInput {
  restaurantId: string;
  kind: RestaurantMediaKind;
  buffer: Buffer;
  mimetype: string;
  originalName: string;
  actor: MediaActor;
}

export interface DeleteImageInput {
  restaurantId: string;
  kind: RestaurantMediaKind;
  actor: MediaActor;
}

export interface StorageMetrics {
  usedBytes: number;
  usedMB: number;
  logoSizeBytes: number;
  coverSizeBytes: number;
  imageCount: number;
  documentCount: number;
  totalFiles: number;
  quotaBytes: number | null;
  quotaMB: number;
  isUnlimited: boolean;
  remainingBytes: number | null;
  remainingMB: number | null;
  usagePercent: number;
}

const MB = 1024 * 1024;

/**
 * Pure storage-metrics calculation from the Restaurant doc + subscription +
 * plan. Shared by mediaService.getStorageMetrics and restaurantService.statistics
 * so both surfaces report identical numbers.
 */
export function computeStorageMetrics(restaurant: any, sub: any, plan: any): StorageMetrics {
  // New canonical key is `maxStorageMB` (Phase 2.4); keep the legacy
  // `storageLimitMB` alias for rows persisted before the rename.
  const quotaMB = sub?.limits?.maxStorageMB ?? sub?.limits?.storageLimitMB
    ?? plan?.limits?.maxStorageMB ?? plan?.limits?.storageLimitMB ?? 500;
  const isUnlimited = quotaMB === 0;
  const quotaBytes = isUnlimited ? Infinity : quotaMB * MB;

  const logo = restaurant?.media?.logo;
  const cover = restaurant?.media?.cover;
  const usedBytes = (logo?.size || 0) + (cover?.size || 0);
  const imageCount = (logo ? 1 : 0) + (cover ? 1 : 0);
  const totalFiles = imageCount; // document uploads not supported yet
  // `Infinity` does not survive JSON serialization (becomes null), so unlimited
  // plans report null bytes consistently with quotaBytes.
  const remainingBytes = isUnlimited ? null : Math.max(0, quotaBytes - usedBytes);

  return {
    usedBytes,
    usedMB: Math.round((usedBytes / MB) * 100) / 100,
    logoSizeBytes: logo?.size || 0,
    coverSizeBytes: cover?.size || 0,
    imageCount,
    documentCount: 0,
    totalFiles,
    quotaBytes: isUnlimited ? null : quotaBytes,
    quotaMB,
    isUnlimited,
    remainingBytes,
    remainingMB: isUnlimited ? null : (remainingBytes === null ? null : Math.round((remainingBytes / MB) * 100) / 100),
    usagePercent: isUnlimited || quotaBytes === 0 ? 0 : Math.min(100, Math.round((usedBytes / quotaBytes) * 10000) / 100),
  };
}

export class MediaService {
  constructor(private readonly uploadsDir: string = config.uploads.dir) {}

  /** Resolve a stored relative key to an absolute, uploads-root-bound path. */
  private diskPathFor(key: string): string {
    // Stored keys are always /uploads/restaurants/<id>/<file>.
    const relative = key.replace(/^\/uploads\//, '');
    const resolved = path.resolve(this.uploadsDir, relative);
    const root = path.resolve(this.uploadsDir);
    // Defense-in-depth: a key can never escape the uploads root.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new AppError(400, 'Invalid media path');
    }
    return resolved;
  }

  /** Persist the buffer under the tenant namespace with a unique safe filename. */
  private async writeFile(restaurantId: string, kind: string, buffer: Buffer, ext: string): Promise<string> {
    const dir = path.join(this.uploadsDir, 'restaurants', restaurantId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${kind}_${restaurantId}_${crypto.randomBytes(8).toString('hex')}${ext}`;
    await fs.writeFile(path.join(dir, fileName), buffer);
    return `/uploads/restaurants/${restaurantId}/${fileName}`;
  }

  /**
   * Upload (or replace) a restaurant image.
   * Returns the relative public path + persisted metadata.
   */
  async saveImage(input: SaveImageInput): Promise<{ url: string; meta: IRestaurantMediaMeta }> {
    if (input.buffer.length > config.uploads.maxFileSizeMB * MB) {
      throw new AppError(400, `File exceeds the maximum size of ${config.uploads.maxFileSizeMB} MB`);
    }
    const ext = assertValidImage(input.buffer, input.mimetype);

    const restaurant = await Restaurant.findById(input.restaurantId).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    if (restaurant.isDeleted) {
      throw new AppError(400, 'Cannot upload media for a deleted restaurant');
    }

    const previous = restaurant.media?.[input.kind];
    const key = await this.writeFile(input.restaurantId, input.kind, input.buffer, ext);
    const meta: IRestaurantMediaMeta = {
      key,
      size: input.buffer.length,
      mimetype: input.mimetype,
      originalName: input.originalName?.slice(0, 255) || `${input.kind}.${ext.replace('.', '')}`,
      uploadedBy: input.actor.name,
      uploadedAt: new Date(),
    };

    // Persist the DB reference first — only remove the replaced file after the
    // DB write succeeds. If the DB write fails, clean up the just-written file
    // so it cannot linger on disk without a reference.
    restaurant.media = { ...(restaurant.media || {}), [input.kind]: meta };
    if (input.kind === 'logo') restaurant.logoUrl = key;
    else restaurant.coverImageUrl = key;
    restaurant.auditTrail = restaurant.auditTrail || [];
    restaurant.auditTrail.push({
      id: crypto.randomUUID(),
      action: `Restaurant ${input.kind === 'logo' ? 'Logo' : 'Cover'} ${previous ? 'Replaced' : 'Uploaded'}`,
      admin: input.actor.name,
      timestamp: new Date(),
    });
    try {
      await restaurant.save();
    } catch (error) {
      // DB persist failed — do not leave an unreferenced file on disk.
      await fs.rm(this.diskPathFor(key), { force: true }).catch(() => {});
      throw error;
    }

    await auditLogRepo.create({
      action: `RESTAURANT_${input.kind.toUpperCase()}_${previous ? 'REPLACED' : 'UPLOADED'}`,
      entityType: 'Restaurant',
      entityId: restaurant._id.toString(),
      performedBy: input.actor.name,
      performedById: input.actor.id,
      restaurantId: restaurant._id,
      ipAddress: input.actor.ipAddress,
      details: {
        restaurantId: restaurant.restaurantId,
        key,
        size: meta.size,
        mimetype: meta.mimetype,
        replacedKey: previous?.key || null,
      },
    } as any);

    if (previous?.key) {
      await fs.rm(this.diskPathFor(previous.key), { force: true }).catch(() => {
        console.warn(`[MediaService] Could not remove replaced file: ${previous.key}`);
      });
    }

    return { url: key, meta };
  }

  /**
   * Upload a standalone image for POS use (product / offer / recipe photos).
   * Kept deliberately decoupled from the Restaurant document — the returned
   * relative public URL is what the caller stores on its own entity.
   */
  async saveStandalone(input: SaveImageInput): Promise<{ url: string }> {
    if (input.buffer.length > config.uploads.maxFileSizeMB * MB) {
      throw new AppError(400, `File exceeds the maximum size of ${config.uploads.maxFileSizeMB} MB`);
    }
    const ext = assertValidImage(input.buffer, input.mimetype);
    const key = await this.writeFile(input.restaurantId, 'misc', input.buffer, ext);
    return { url: key };
  }

  /** Remove a restaurant image: DB reference + physical file + audit entry. */
  async deleteImage(input: DeleteImageInput): Promise<{ removed: string }> {
    const restaurant = await Restaurant.findById(input.restaurantId).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    const meta = restaurant.media?.[input.kind];
    if (!meta) throw new AppError(404, `No ${input.kind} image to delete`);

    const field: RestaurantMediaField = input.kind === 'logo' ? 'logoUrl' : 'coverImageUrl';

    await Restaurant.updateOne(
      { _id: restaurant._id },
      {
        $unset: { [`media.${input.kind}`]: 1, [field]: 1 },
        $push: {
          auditTrail: {
            id: crypto.randomUUID(),
            action: `Restaurant ${input.kind === 'logo' ? 'Logo' : 'Cover'} Deleted`,
            admin: input.actor.name,
            timestamp: new Date(),
          },
        },
      }
    ).exec();

    await auditLogRepo.create({
      action: `RESTAURANT_${input.kind.toUpperCase()}_DELETED`,
      entityType: 'Restaurant',
      entityId: restaurant._id.toString(),
      performedBy: input.actor.name,
      performedById: input.actor.id,
      restaurantId: restaurant._id,
      ipAddress: input.actor.ipAddress,
      details: { restaurantId: restaurant.restaurantId, removedKey: meta.key, size: meta.size },
    } as any);

    await fs.rm(this.diskPathFor(meta.key), { force: true }).catch(() => {
      console.warn(`[MediaService] Could not remove deleted file: ${meta.key}`);
    });

    return { removed: meta.key };
  }

  /**
   * Persist a document/image attachment for a support ticket (or any feature
   * that references files). Files are written under the same tenant namespace
   * as restaurant media, but to an `attachments/` subfolder so they are never
   * mistaken for restaurant branding. MIME, magic bytes and size are validated
   * here (not just by multer) — client filenames are never used on disk.
   *
   * Returns the relative public key plus metadata for embedding on the owning
   * document (ticket / reply).
   */
  async saveAttachment(input: {
    restaurantId: string;
    buffer: Buffer;
    mimetype: string;
    originalName: string;
    actor: MediaActor;
  }): Promise<{ key: string; meta: TicketAttachmentMeta }> {
    if (input.buffer.length > config.uploads.maxFileSizeMB * MB) {
      throw new AppError(400, `File exceeds the maximum size of ${config.uploads.maxFileSizeMB} MB`);
    }

    const restaurant = await Restaurant.findById(input.restaurantId).lean().exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    if (restaurant.isDeleted) {
      throw new AppError(400, 'Cannot attach files to a deleted restaurant');
    }

    // Accept either a verified image or a verified document (magic bytes).
    let ext: string;
    try {
      ext = assertValidImage(input.buffer, input.mimetype);
    } catch {
      ext = assertValidDocument(input.buffer, input.mimetype);
    }

    const key = await this.writeAttachment(input.restaurantId, input.buffer, ext);
    const meta: TicketAttachmentMeta = {
      id: crypto.randomUUID(),
      key,
      size: input.buffer.length,
      mimetype: input.mimetype,
      originalName: input.originalName?.slice(0, 255) || `attachment${ext}`,
      uploadedBy: input.actor.name,
      uploadedAt: new Date(),
    };

    try {
      await auditLogRepo.create({
        action: 'SUPPORT_ATTACHMENT_UPLOADED',
        entityType: 'SupportTicket',
        performedBy: input.actor.name,
        performedById: input.actor.id,
        restaurantId: restaurant._id,
        ipAddress: input.actor.ipAddress,
        details: { key, size: meta.size, mimetype: meta.mimetype, originalName: meta.originalName },
      } as any);
    } catch (error) {
      // Naming an attachment must never fail the upload — clean up the file.
      await fs.rm(this.diskPathFor(key), { force: true }).catch(() => {});
      throw error;
    }

    return { key, meta };
  }

  /** Write a validated attachment under the tenant's attachments/ namespace. */
  private async writeAttachment(restaurantId: string, buffer: Buffer, ext: string): Promise<string> {
    const dir = path.join(this.uploadsDir, 'restaurants', restaurantId, 'attachments');
    await fs.mkdir(dir, { recursive: true });
    const fileName = `att_${crypto.randomBytes(12).toString('hex')}${ext}`;
    await fs.writeFile(path.join(dir, fileName), buffer);
    return `/uploads/restaurants/${restaurantId}/attachments/${fileName}`;
  }

  /**
   * Remove a persisted attachment by key. Re-uses the uploads-root bounds check
   * so a crafted key can never delete files outside the uploads directory.
   */
  async deleteAttachment(key: string): Promise<{ removed: string }> {
    await fs.rm(this.diskPathFor(key), { force: true });
    return { removed: key };
  }

  /** Backend-driven storage metrics (quota-aware, no filesystem scan). */
  async getStorageMetrics(restaurantId: string): Promise<StorageMetrics> {
    const [restaurant, sub] = await Promise.all([
      Restaurant.findById(restaurantId).lean().exec(),
      Subscription.findOne({ restaurantId }).lean().exec(),
    ]);
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    const plan = sub?.plan
      ? await SubscriptionPlan.findOne({ planId: sub.plan }).lean().exec()
      : null;
    return computeStorageMetrics(restaurant, sub, plan);
  }
}

export const mediaService = new MediaService();

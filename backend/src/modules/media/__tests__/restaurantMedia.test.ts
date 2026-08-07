/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaService Integration Tests (Phase 2.2 extension)
 *
 * Uses mongodb-memory-server + a temporary uploads directory on disk so the
 * persistence layer (files survive restart) is exercised for real.
 *
 * Coverage:
 *   - Logo upload (file persisted, doc updated, audit entry)
 *   - Cover upload
 *   - Replace image (old physical file removed)
 *   - Delete image (DB ref + physical file + audit)
 *   - Validation failures: invalid MIME, corrupted image, empty upload, oversize
 *   - Unauthorized-style guards: nonexistent / deleted restaurant
 *   - Storage metrics calculation (used / counts / remaining / percent)
 *   - Storage quota from subscription plan limits
 *   - Audit log generation (AuditLog collection + embedded auditTrail)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MediaService } from '../mediaService';
import Restaurant from '../../../models/Restaurant';
import Subscription from '../../../models/Subscription';
import SubscriptionPlan from '../../../models/SubscriptionPlan';
import AuditLog from '../../../models/AuditLog';

let mongod: MongoMemoryServer;
let tmpDir: string;

const actor = { id: 'admin_1', name: 'Super Admin Test', ipAddress: '127.0.0.1' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pos-media-test-'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await fs.rm(tmpDir, { recursive: true, force: true });
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Restaurant.deleteMany({}).exec(),
    Subscription.deleteMany({}).exec(),
    SubscriptionPlan.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
  ]);
});

/** Minimal valid PNG payload (magic bytes + padding). */
function pngBuffer(size = 1024): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  return buf;
}

/** Minimal valid JPEG payload. */
function jpegBuffer(size = 1024): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

/** Minimal valid PDF payload (magic bytes + padding). */
function pdfBuffer(size = 512): Buffer {
  const buf = Buffer.alloc(size);
  buf.write('%PDF-1.7', 0, 'latin1');
  return buf;
}

/** Minimal valid DOCX payload (ZIP local-file magic). */
function docxBuffer(size = 512): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x50;
  buf[1] = 0x4b;
  buf[2] = 0x03;
  buf[3] = 0x04;
  return buf;
}

async function seedRestaurant(overrides: Record<string, any> = {}) {
  return Restaurant.create({
    restaurantId: 'MEDIA_TEST_001',
    name: 'Media Test Restaurant',
    phone: '9999999999',
    ...overrides,
  });
}

describe('restaurant media upload', () => {
  it('uploads a logo: file persisted to disk, doc updated, audit entry created', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const result = await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: pngBuffer(2048),
      mimetype: 'image/png',
      originalName: 'my-logo.png',
      actor,
    });

    // URL shape + disk persistence
    expect(result.url).toMatch(new RegExp(`^/uploads/restaurants/${restaurant._id}/logo_[a-f0-9]+_[a-f0-9]+\\.png$`));
    const onDisk = await fs.stat(path.join(tmpDir, result.url.replace(/^\/uploads\//, '')));
    expect(onDisk.size).toBe(2048);

    // DB reference + metadata
    const doc = await Restaurant.findById(restaurant._id).lean().exec();
    expect(doc!.logoUrl).toBe(result.url);
    expect(doc!.media!.logo).toMatchObject({ size: 2048, mimetype: 'image/png', originalName: 'my-logo.png', uploadedBy: actor.name });
    expect(doc!.coverImageUrl).toBeUndefined();

    // Audit log entry + embedded trail
    const audit = await AuditLog.findOne({ action: 'RESTAURANT_LOGO_UPLOADED' }).exec();
    expect(audit).toBeTruthy();
    expect(audit!.performedBy).toBe(actor.name);
    expect(audit!.ipAddress).toBe('127.0.0.1');
    expect(audit!.restaurantId?.toString()).toBe(restaurant._id.toString());
    expect(doc!.auditTrail!.some((e: any) => e.action === 'Restaurant Logo Uploaded')).toBe(true);
  });

  it('uploads a cover image', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'cover',
      buffer: jpegBuffer(4096),
      mimetype: 'image/jpeg',
      originalName: 'banner.jpg',
      actor,
    });

    const doc = await Restaurant.findById(restaurant._id).lean().exec();
    expect(doc!.coverImageUrl).toMatch(/^\/uploads\/restaurants\/.*\/cover_[a-f0-9]+_[a-f0-9]+\.jpg$/);
    expect(doc!.media!.cover!.size).toBe(4096);
    expect((await AuditLog.findOne({ action: 'RESTAURANT_COVER_UPLOADED' }).exec())).toBeTruthy();
  });

  it('replaces an existing logo: new file persisted, old physical file removed', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const first = await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: pngBuffer(1024),
      mimetype: 'image/png',
      originalName: 'logo-v1.png',
      actor,
    });
    const oldPath = path.join(tmpDir, first.url.replace(/^\/uploads\//, ''));
    expect((await fs.stat(oldPath)).size).toBe(1024);

    const second = await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: jpegBuffer(512),
      mimetype: 'image/jpeg',
      originalName: 'logo-v2.jpg',
      actor,
    });

    expect(second.url).not.toBe(first.url);
    const doc = await Restaurant.findById(restaurant._id).lean().exec();
    expect(doc!.logoUrl).toBe(second.url);
    expect(doc!.media!.logo!.mimetype).toBe('image/jpeg');
    // Old file must be gone from disk
    await expect(fs.stat(oldPath)).rejects.toThrow();
    // New file exists
    await expect(fs.stat(path.join(tmpDir, second.url.replace(/^\/uploads\//, '')))).resolves.toBeTruthy();
    expect((await AuditLog.findOne({ action: 'RESTAURANT_LOGO_REPLACED' }).exec())).toBeTruthy();
  });

  it('deletes an image: DB ref, physical file and audit entry all removed', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const { url } = await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: pngBuffer(1024),
      mimetype: 'image/png',
      originalName: 'logo.png',
      actor,
    });
    const filePath = path.join(tmpDir, url.replace(/^\/uploads\//, ''));

    const out = await svc.deleteImage({ restaurantId: restaurant._id.toString(), kind: 'logo', actor });
    expect(out.removed).toBe(url);

    const doc = await Restaurant.findById(restaurant._id).lean().exec();
    expect(doc!.logoUrl).toBeUndefined();
    expect(doc!.media!.logo).toBeUndefined();
    await expect(fs.stat(filePath)).rejects.toThrow();
    expect(doc!.auditTrail!.some((e: any) => e.action === 'Restaurant Logo Deleted')).toBe(true);
    expect((await AuditLog.findOne({ action: 'RESTAURANT_LOGO_DELETED' }).exec())).toBeTruthy();
  });

  it('rejects deletion when no image exists', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.deleteImage({ restaurantId: restaurant._id.toString(), kind: 'logo', actor })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects an invalid MIME type before touching the disk', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.saveImage({
        restaurantId: restaurant._id.toString(),
        kind: 'logo',
        buffer: Buffer.from('not an image'),
        mimetype: 'text/plain',
        originalName: 'evil.txt',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    // Nothing may be persisted for this restaurant (no directory created).
    await expect(fs.stat(path.join(tmpDir, 'restaurants', restaurant._id.toString()))).rejects.toThrow();
  });

  it('rejects a corrupted image (valid MIME, wrong magic bytes)', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.saveImage({
        restaurantId: restaurant._id.toString(),
        kind: 'logo',
        buffer: Buffer.from('this is definitely not a png even though we say so'),
        mimetype: 'image/png',
        originalName: 'fake.png',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an empty upload', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.saveImage({
        restaurantId: restaurant._id.toString(),
        kind: 'cover',
        buffer: Buffer.alloc(0),
        mimetype: 'image/png',
        originalName: '',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects files over the configured size limit', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    const oversized = pngBuffer(5 * 1024 * 1024 + 1); // > 5 MB default
    await expect(
      svc.saveImage({
        restaurantId: restaurant._id.toString(),
        kind: 'cover',
        buffer: oversized,
        mimetype: 'image/png',
        originalName: 'huge.png',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects uploads for a nonexistent restaurant', async () => {
    const svc = new MediaService(tmpDir);
    await expect(
      svc.saveImage({
        restaurantId: new mongoose.Types.ObjectId().toString(),
        kind: 'logo',
        buffer: pngBuffer(1024),
        mimetype: 'image/png',
        originalName: 'logo.png',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects uploads for a soft-deleted restaurant', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant({ isDeleted: true, deletedAt: new Date() });
    await expect(
      svc.saveImage({
        restaurantId: restaurant._id.toString(),
        kind: 'logo',
        buffer: pngBuffer(1024),
        mimetype: 'image/png',
        originalName: 'logo.png',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('document attachments', () => {
  it('persists a valid PDF attachment and writes an audit entry', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const { key, meta } = await svc.saveAttachment({
      restaurantId: restaurant._id.toString(),
      buffer: pdfBuffer(1024),
      mimetype: 'application/pdf',
      originalName: 'bill-issue.pdf',
      actor,
    });

    expect(key).toMatch(new RegExp(`^/uploads/restaurants/${restaurant._id}/attachments/att_[a-f0-9]+\\.pdf$`));
    const onDisk = await fs.stat(path.join(tmpDir, key.replace(/^\/uploads\//, '')));
    expect(onDisk.size).toBe(1024);
    expect(meta.originalName).toBe('bill-issue.pdf');
    expect(meta.id).toBeTruthy();
    expect((await AuditLog.findOne({ action: 'SUPPORT_ATTACHMENT_UPLOADED' }).exec())).toBeTruthy();
  });

  it('detects and assigns the right extension across shared ZIP container (docx vs xlsx)', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const docx = await svc.saveAttachment({
      restaurantId: restaurant._id.toString(),
      buffer: docxBuffer(768),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName: 'report.docx',
      actor,
    });
    const xlsx = await svc.saveAttachment({
      restaurantId: restaurant._id.toString(),
      buffer: docxBuffer(700),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalName: 'data.xlsx',
      actor,
    });

    expect(docx.key).toMatch(/\.docx$/);
    expect(xlsx.key).toMatch(/\.xlsx$/);
  });

  it('rejects a spoofed document (declared PDF, wrong magic bytes)', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.saveAttachment({
        restaurantId: restaurant._id.toString(),
        buffer: Buffer.from('definitely not a real pdf but we say it is'),
        mimetype: 'application/pdf',
        originalName: 'fake.pdf',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(fs.stat(path.join(tmpDir, 'restaurants', restaurant._id.toString()))).rejects.toThrow();
  });

  it('rejects an unsupported MIME type entirely', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    await expect(
      svc.saveAttachment({
        restaurantId: restaurant._id.toString(),
        buffer: Buffer.from('MZ....executable'),
        mimetype: 'application/x-msdownload',
        originalName: 'evil.exe',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('deletes an attachment: physical file removed', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    const { key } = await svc.saveAttachment({
      restaurantId: restaurant._id.toString(),
      buffer: pdfBuffer(512),
      mimetype: 'application/pdf',
      originalName: 'a.pdf',
      actor,
    });
    const filePath = path.join(tmpDir, key.replace(/^\/uploads\//, ''));
    expect((await fs.stat(filePath)).size).toBe(512);

    await svc.deleteAttachment(key);
    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  it('rejects a path-traversal attachment key on delete', async () => {
    const svc = new MediaService(tmpDir);
    await expect(svc.deleteAttachment('/uploads/../../../secret.txt'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('storage metrics', () => {
  it('calculates used storage, image count and remaining quota from metadata', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();

    const logo = await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: pngBuffer(2 * 1024 * 1024), // 2 MB
      mimetype: 'image/png',
      originalName: 'logo.png',
      actor,
    });
    await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'cover',
      buffer: jpegBuffer(512 * 1024), // 0.5 MB
      mimetype: 'image/jpeg',
      originalName: 'cover.jpg',
      actor,
    });

    const metrics = await svc.getStorageMetrics(restaurant._id.toString());
    expect(metrics.usedBytes).toBe(2 * 1024 * 1024 + 512 * 1024);
    expect(metrics.logoSizeBytes).toBe(logo.meta.size);
    expect(metrics.coverSizeBytes).toBe(512 * 1024);
    expect(metrics.imageCount).toBe(2);
    expect(metrics.documentCount).toBe(0);
    expect(metrics.totalFiles).toBe(2);
    expect(metrics.quotaMB).toBe(500); // platform default
    expect(metrics.quotaBytes).toBe(500 * 1024 * 1024);
    expect(metrics.isUnlimited).toBe(false);
    expect(metrics.remainingBytes).toBe(500 * 1024 * 1024 - (2 * 1024 * 1024 + 512 * 1024));
    expect(metrics.usagePercent).toBeGreaterThan(0);
    expect(metrics.usagePercent).toBeLessThan(100);
  });

  it('honours the storage quota from the assigned subscription plan limits', async () => {
    const svc = new MediaService(tmpDir);
    const plan = await SubscriptionPlan.create({
      planId: 'tiny_plan',
      name: 'Tiny Plan',
      price: 99,
      maxUsers: 2,
      maxDevices: 1,
      features: ['core_pos'],
      limits: { maxBranches: 1, maxDevices: 1, maxEmployees: 2, maxStorageMB: 2 },
    });
    const restaurant = await seedRestaurant();
    await Subscription.create({
      restaurantId: restaurant._id,
      plan: plan.planId,
      status: 'active',
      limits: plan.limits,
      features: plan.features,
    });

    await svc.saveImage({
      restaurantId: restaurant._id.toString(),
      kind: 'logo',
      buffer: pngBuffer(1024),
      mimetype: 'image/png',
      originalName: 'logo.png',
      actor,
    });

    const metrics = await svc.getStorageMetrics(restaurant._id.toString());
    expect(metrics.quotaMB).toBe(2);
    expect(metrics.quotaBytes).toBe(2 * 1024 * 1024);
    expect(metrics.remainingBytes).toBe(2 * 1024 * 1024 - 1024);
    expect(metrics.usagePercent).toBeCloseTo(1024 / (2 * 1024 * 1024) * 100, 2);
  });

  it('reports zero usage when no media exists', async () => {
    const svc = new MediaService(tmpDir);
    const restaurant = await seedRestaurant();
    const metrics = await svc.getStorageMetrics(restaurant._id.toString());
    expect(metrics.usedBytes).toBe(0);
    expect(metrics.imageCount).toBe(0);
    expect(metrics.totalFiles).toBe(0);
    expect(metrics.usagePercent).toBe(0);
  });

  it('throws 404 for storage metrics of a missing restaurant', async () => {
    const svc = new MediaService(tmpDir);
    await expect(svc.getStorageMetrics(new mongoose.Types.ObjectId().toString()))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

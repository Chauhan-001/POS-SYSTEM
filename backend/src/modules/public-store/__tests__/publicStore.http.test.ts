import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Restaurant from '../../../models/Restaurant';
import Reward from '../../../models/Reward';
import Offer from '../../../models/Offer';
import { securityHeaders } from '../../../middleware/securityHeaders';
import { publicLimiter } from '../../../middleware/rateLimiter';
import publicStoreRouter from '../routes/publicStore';
import { renderPublicStorePage } from '../publicStorePage';
import { generatePublicToken } from '../../../utils/publicToken';

let mongod: MongoMemoryServer;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

describe('PublicStore HTTP surface (Phase 62.1)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    // Boot the real route stack with the same middlewares server.ts uses.
    const app = express();
    app.use(securityHeaders());
    app.use('/api/public-store', publicLimiter, publicStoreRouter);
    app.get('/public/:token', renderPublicStorePage);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Restaurant.deleteMany({}).exec(),
      Reward.deleteMany({}).exec(),
      Offer.deleteMany({}).exec(),
    ]);
  });

  async function seed(token: string) {
    const restaurant = await Restaurant.create({
      restaurantId: 'http-rest',
      name: 'HTTP Kitchen',
      brandName: 'HTTP Kitchen',
      phone: '1234567890',
      area: 'Bandra',
      city: 'Mumbai',
      state: 'Maharashtra',
      currency: 'INR',
      loyaltyEnabled: true,
      isActive: true,
      publicToken: token,
    });
    await Reward.create({
      restaurantId: restaurant._id, title: 'Rs 100 off', pointsRequired: 1000, type: 'flat', value: 100, isActive: true,
    });
    await Offer.create({
      restaurantId: restaurant._id, title: 'Mon Combo', description: 'Monday combo', type: 'percentage', value: 20,
      status: 'active', couponCode: 'MNDAY', startDate: '2000-01-01', endDate: '2099-12-31',
    });
    return restaurant;
  }

  it('serves the public config JSON over HTTP with cache headers', async () => {
    const token = generatePublicToken();
    await seed(token);

    const res = await fetch(`${baseUrl}/api/public-store/${token}`, { headers: { 'Accept': 'application/json' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');

    const body = await res.json();
    expect(body.store.name).toBe('HTTP Kitchen');
    expect(body.rewards).toHaveLength(1);
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].couponCode).toBe('MNDAY');
  });

  it('GET /public/:token serves the customer storefront page and shows live data', async () => {
    const token = generatePublicToken();
    await seed(token);

    const res = await fetch(`${baseUrl}/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toContain('text/html');
    // The route relaxes CSP for its own inline script only.
    expect(res.headers.get('content-security-policy') || '').toContain("script-src 'self' 'unsafe-inline'");

    const html = await res.text();
    expect(html).toContain(`public-store`);
    expect(html).toContain(`/api/public-store/`);
    expect(html).toContain('Scan. Enjoy.');
    expect(html).toContain('Loyalty rewards program');
    expect(html).toContain('window.__STORE_TOKEN__');
  });

  it('rejects unknown and malformed tokens with 404', async () => {
    const res = await fetch(`${baseUrl}/api/public-store/pbl_doesNotExist12345`);
    expect(res.status).toBe(404);

    const page = await fetch(`${baseUrl}/public/not-a-token`);
    expect(page.status).toBe(404);
  });

  it('serves the page when loyalty is disabled but marks it in the payload', async () => {
    const token = generatePublicToken();
    await seed(token);
    await Restaurant.updateOne({ publicToken: token }, { $set: { loyaltyEnabled: false } }).exec();

    const res = await fetch(`${baseUrl}/api/public-store/${token}`);
    const body = await res.json();
    expect(body.store.loyaltyEnabled).toBe(false);
    expect(body.loyalty.enabled).toBe(false);
  });
});
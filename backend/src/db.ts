/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * =============================================================================
 *  db.ts — Database Connection & Admin Seed
 * =============================================================================
 *
 * Purpose:
 *   - connectDB(): Initializes Mongoose connection to MongoDB
 *   - seedDashboardAdmin(): Creates/updates the SUPER_ADMIN user on startup
 *   - disconnectDB(): Graceful shutdown
 *   - isConnected(): Health check helper
 *
 * Architecture:
 *   - connectDB() initializes the Mongoose connection.
 *   - The first Owner registers via the First-Time Setup flow.
 *   - All data (products, customers, etc.) is created through normal
 *     POS operations and synced to the backend API.
 *
 * Offline mode:
 *   The frontend caches data locally from the last sync and uses
 *   localStorage as a read-through cache when the backend is unreachable.
 *
 * Sections:
 *   1. Seed: Admin dashboard user
 *   2. Connect / Disconnect
 *   3. Health check
 */

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { config } from './config';
import type { AuthorizationAction } from './models/Authorization';

// =============================================================================
// SECTION 1: ADMIN SEED
// =============================================================================

/**
 * Seed the admin dashboard user on every server start.
 * - Login: userId="admin", password="1008"
 * - Creates the ADMIN restaurant + user if they don't exist
 * - Updates the password hash if the user already exists
 * - Grants full CRUD+admin authorization on all collections
 */
async function seedDashboardAdmin(): Promise<void> {
  try {
    const User = (await import('./models/User')).default;
    const Restaurant = (await import('./models/Restaurant')).default;
    const Authorization = (await import('./models/Authorization')).default;

    const hashed = await bcrypt.hash('1008', 10);

    // ─── Find or create the ADMIN restaurant ────────────────────
    let restaurant = await Restaurant.findOne({ restaurantId: 'ADMIN' }).exec();
    if (!restaurant) {
      restaurant = await Restaurant.create({
        restaurantId: 'ADMIN',
        name: 'Admin Platform',
        phone: '+1-555-000-0000',
        email: 'admin@pos.com',
        isActive: true,
      });
    }

    // ─── Upsert the admin user by userId ────────────────────────
    let user = await User.findOne({ userId: 'admin', role: 'super_admin' }).exec();
    if (user) {
      await User.updateOne(
        { _id: user._id },
        { $set: { password: hashed, status: 'active', name: 'Admin' } }
      ).exec();
      console.log('[Seed] Admin user password updated: userId=admin');
    } else {
      user = await User.create({
        restaurantId: restaurant._id,
        userId: 'admin',
        phone: '+1-555-000-0001',
        name: 'Admin',
        email: 'admin@pos.com',
        password: hashed,
        role: 'super_admin',
        status: 'active',
        branchIds: [],
      });
      console.log('[Seed] Admin user created: userId=admin');
    }

    // ─── Grant full authorization on all collections ────────────
    // Idempotent upsert per (principalId, targetCollection) — safe to re-run on
    // every startup without duplicate-key races or clobbering other principals.
    const adminCollections = [
      'Restaurant', 'User', 'Subscription', 'SubscriptionPlan', 'Device', 'Authorization',
      'Employee', 'Branch', 'Product', 'Order', 'Bill', 'Customer',
      'Expense', 'Reservation', 'Table', 'TakeawayOrder', 'Reward',
      'SupportTicket', 'AuditLog',
    ];
    const fullActions: AuthorizationAction[] = ['create', 'read', 'update', 'delete', 'admin'];
    await Authorization.bulkWrite(
      adminCollections.map(collection => ({
        updateOne: {
          filter: { principalId: user._id, principalType: 'user' as const, targetCollection: collection },
          // $set only — Mongo applies the equality filter to the inserted doc on upsert.
          update: {
            $set: {
              actions: fullActions,
              isActive: true,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    console.log(`[Seed] Granted full authorization on ${adminCollections.length} collections`);
  } catch (error) {
    console.error('[Seed] Error seeding dashboard admin:', error);
  }
}

// =============================================================================
// SECTION 2: CONNECT / DISCONNECT
// =============================================================================

/**
 * Connect to MongoDB
 * Runs the admin seed automatically after successful connection.
 */
export async function connectDB(): Promise<void> {
  const { mongoUri } = config;

  try {
    await mongoose.connect(mongoUri);
    console.log(`[DB] Connected to MongoDB at ${mongoUri}`);
    await seedDashboardAdmin();
  } catch (error) {
    console.error('[DB] MongoDB connection error:', error);
    // Don't crash the server — it might be intentional (dev without MongoDB)
    console.warn('[DB] Server will start but DB operations will fail');
  }
}

/**
 * Disconnect from MongoDB (graceful shutdown)
 */
export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('[DB] Disconnected from MongoDB');
  } catch (error) {
    console.error('[DB] Error disconnecting:', error);
  }
}

// =============================================================================
// SECTION 3: HEALTH CHECK
// =============================================================================

/**
 * Check MongoDB connection status
 * Returns true if Mongoose connection state is 'connected' (readyState === 1)
 */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RestaurantService — Business logic for the Restaurant Management (platform) module.
 *
 * Consolidates the lifecycle previously scattered in adminRestaurantsController so
 * controllers stay thin and every write is validated / audited / operating on a
 * tenant-isolated basis.
 *
 * Responsibilities:
 *   - Transactional onboarding (restaurant + owner + branch + settings + subscription
 *     + optional cash Payment/Invoice) with compensating rollback.
 *   - Paged listing with server-side search / filter / sort and a REAL total.
 *   - Status transitions (active / suspended / pending).
 *   - Soft delete / restore / permanent delete.
 *   - Aggregated single-restaurant usage + stats.
 *
 * The repository layer does not pass mongoose sessions, so atomicity is implemented
 * with compensating rollback (reverse-order hardDelete) — the same pattern already
 * used by authService.registerOwner.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import Restaurant from '../models/Restaurant';
import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Branch from '../models/Branch';
import License from '../models/License';
import Device from '../models/Device';
import DeviceActivity from '../models/DeviceActivity';
import Employee from '../models/Employee';
import Payment from '../models/Payment';
import Invoice from '../models/Invoice';
import InvoiceCounter from '../models/InvoiceCounter';
import User from '../models/User';
import Bill from '../models/Bill';
import Product from '../models/Product';
import Customer from '../models/Customer';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import AIUsageLog from '../models/AIUsageLog';
import VoiceAuditLog from '../modules/voice-inventory/models/VoiceAuditLog';
import Expense from '../models/Expense';
import Offer from '../models/Offer';
import Reward from '../models/Reward';
import Reservation from '../models/Reservation';
import Table from '../models/Table';
import Floor from '../models/Floor';
import Purchase from '../models/Purchase';
import DailySummary from '../models/DailySummary';
import MonthlySummary from '../models/MonthlySummary';
import YearlySummary from '../models/YearlySummary';
import Order from '../models/Order';
import TakeawayOrder from '../models/TakeawayOrder';
import HeldOrder from '../models/HeldOrder';
import CustomerActivity from '../models/CustomerActivity';
import CustomerVisit from '../models/CustomerVisit';
import BranchSettings from '../models/BranchSettings';
import RestaurantSettings from '../modules/settings/models/RestaurantSettings';
import Printer from '../modules/settings/models/Printer';
import { hashPin } from '../utils/bcrypt';
import { AppError } from '../utils/AppError';
import { generatePublicToken } from '../utils/publicToken';
import { entitlementService } from './entitlementService';
import { config } from '../config';
import {
  restaurantRepo, branchRepo, userRepo, auditLogRepo, subscriptionRepo, deviceRepo,
} from '../repositories';
import { parsePagination, parseSearch, parseSort, parseDateRange } from '../utils/queryParser';
import { settingsService } from '../modules/settings/services/settingsService';
import { computeStorageMetrics } from '../modules/media/mediaService';

const SUBSCRIPTION_DAYS = 30;
const GRACE_DAYS = 10;

const SEARCH_FIELDS = [
  'name', 'legalName', 'brandName', 'restaurantId', 'phone', 'email', 'gst', 'city', 'state',
  'ownerName', 'ownerEmail', 'ownerPhone',
];
const ALLOWED_SORTS = ['name', 'createdAt', 'updatedAt', 'plan', 'status'];
const UPDATEABLE_FIELDS = [
  'name', 'legalName', 'brandName', 'restaurantType', 'cuisineType', 'phone', 'altPhone',
  'email', 'website', 'description', 'notes', 'extraInfo', 'gst', 'fssai', 'pan',
  'businessRegNumber', 'ownerName', 'ownerPhone', 'ownerEmail', 'emergencyContact',
  'identityType', 'identityNumber', 'address', 'area', 'city', 'district', 'state',
  'country', 'pinCode', 'latitude', 'longitude', 'timezone', 'currency', 'gstEnabled',
  'printerType', 'receiptWidth', 'taxMode', 'offlineMode', 'aiEnabled', 'loyaltyEnabled',
  'weatherEnabled',
];

type OnboardingMode = 'cash' | 'trial' | 'create_only';
type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'suspended';
interface AdminIdentity { id: string; name: string; }

/** Normalize a row into the admin API contract (also handles deleted rows in list). */
function toRestaurantRow(r: any, sub: any, branchCount: number, deviceCount: number): any {
  return {
    id: r._id.toString(),
    restaurantId: r.restaurantId,
    name: r.name,
    legalName: r.legalName || r.name,
    brandName: r.brandName,
    restaurantType: r.restaurantType,
    cuisineType: r.cuisineType,
    phone: r.phone,
    altPhone: r.altPhone,
    email: r.email,
    website: r.website,
    description: r.description,
    notes: r.notes,
    extraInfo: r.extraInfo,
    gst: r.gst,
    fssai: r.fssai,
    pan: r.pan,
    businessRegNumber: r.businessRegNumber,
    ownerName: r.ownerName || r.name,
    ownerPhone: r.ownerPhone || r.phone,
    ownerEmail: r.ownerEmail || r.email || '',
    emergencyContact: r.emergencyContact,
    identityType: r.identityType,
    identityNumber: r.identityNumber,
    address: r.address,
    area: r.area,
    city: r.city,
    district: r.district,
    state: r.state,
    country: r.country,
    pinCode: r.pinCode,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    currency: r.currency,
    gstEnabled: r.gstEnabled,
    printerType: r.printerType,
    receiptWidth: r.receiptWidth,
    taxMode: r.taxMode,
    offlineMode: r.offlineMode,
    aiEnabled: r.aiEnabled || (sub?.features || []).includes('ai'),
    loyaltyEnabled: r.loyaltyEnabled,
    publicToken: r.publicToken || null,
    weatherEnabled: r.weatherEnabled,
    plan: sub?.plan || 'N/A',
    subscriptionStatus: sub?.status || 'active',
    status: r.isActive ? 'active' as const : 'inactive' as const,
    devices: deviceCount,
    maxDevices: sub?.maxDevices || r.maxDevices || 3,
    branchCount,
    logoUrl: r.logoUrl || null,
    coverImageUrl: r.coverImageUrl || null,
    ownerUserId: r.ownerUserId,
    tempPasswordShown: r.tempPasswordShown || false,
    adminNotes: r.adminNotes || [],
    auditTrail: r.auditTrail || [],
    createdAt: r.createdAt?.toISOString() || null,
    updatedAt: r.updatedAt?.toISOString() || null,
  };
}

export class RestaurantService {
  private async loadContext(restaurantId: mongoose.Types.ObjectId) {
    const [sub, deviceCount, branchCount, lastActive] = await Promise.all([
      Subscription.findOne({ restaurantId }).lean().exec(),
      Device.countDocuments({ restaurantId, isActive: true }).exec(),
      Branch.countDocuments({ restaurantId, isDeleted: { $ne: true } }).exec(),
      DeviceActivity.aggregate([
        { $match: { restaurantId, createdAt: { $exists: true } } },
        { $group: { _id: null, lastActive: { $max: '$createdAt' } } },
      ]).exec(),
    ]);
    return {
      sub,
      deviceCount,
      branchCount,
      lastActive: lastActive[0]?.lastActive?.toISOString() || null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // LIST — real total, search / filter / sort / pagination, N+1 fixed
  // ──────────────────────────────────────────────────────────────
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 10 });

    const filter: Record<string, any> = { isDeleted: { $ne: true } };
    if (query.deleted === 'true') {
      filter.isDeleted = true;
      filter.deletedAt = { $exists: true };
    }
    const searchable = parseSearch(query.search, SEARCH_FIELDS);
    if (searchable) Object.assign(filter, searchable);

    const status = query.status;
    if (status === 'active') filter.isActive = true;
    else if (status === 'inactive' || status === 'suspended' || status === 'disabled') filter.isActive = false;

    if (query.createdFrom) {
      filter.createdAt = { $gte: new Date(query.createdFrom as string) };
    }
    if (query.createdTo) {
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$lte = new Date(query.createdTo as string);
    }

    // Compound filters that must combine with $and (each is an `_id` set or `$or`).
    const andConditions: Record<string, any>[] = [];

    // Owner filter — partial match on owner identity fields.
    if (typeof query.owner === 'string' && query.owner.trim()) {
      const safeOwner = query.owner.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        $or: [
          { ownerName: { $regex: safeOwner, $options: 'i' } },
          { ownerEmail: { $regex: safeOwner, $options: 'i' } },
          { ownerPhone: { $regex: safeOwner, $options: 'i' } },
        ],
      });
    }

    // Resolve plan filter against subscriptions first (subscription store is authoritative).
    let planRestaurantIds: string[] | null = null;
    if (query.plan) {
      const subs = await Subscription.find({ plan: query.plan }).select('restaurantId').lean().exec();
      planRestaurantIds = subs.map((s) => s.restaurantId.toString());
      if (planRestaurantIds.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0, next: null, previous: null };
      }
      andConditions.push({ _id: { $in: planRestaurantIds } });
    }

    // Last-activity filter — restaurants with device activity at/after the date.
    if (query.lastActiveFrom) {
      const from = new Date(query.lastActiveFrom as string);
      if (!Number.isNaN(from.getTime())) {
        const activeAgg = await DeviceActivity.aggregate([
          { $match: { createdAt: { $gte: from } } },
          { $group: { _id: '$restaurantId' } },
        ]).exec();
        const activeIds = activeAgg.map((a) => a._id?.toString()).filter(Boolean);
        if (activeIds.length === 0) {
          return { data: [], total: 0, page, limit, totalPages: 0, next: null, previous: null };
        }
        andConditions.push({ _id: { $in: activeIds } });
      }
    }

    if (andConditions.length > 0) {
      filter.$and = [...(filter.$and || []), ...andConditions];
    }

    const sortBy = ALLOWED_SORTS.includes(query.sortBy) ? query.sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip).limit(limit)
        .lean().exec(),
      Restaurant.countDocuments(filter).exec(),
    ]);

    if (restaurants.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit), next: page, previous: page };
    }

    const restaurantIds = restaurants.map((r) => r._id);

    // Grouped aggregations replace per-row queries (N+1 fix).
    const [subsMap, branchAgg, deviceAgg, lastActiveAgg] = await Promise.all([
      Subscription.find({ restaurantId: { $in: restaurantIds } }).lean().exec(),
      Branch.aggregate([
        { $match: { restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } } },
        { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
      ]).exec(),
      Device.aggregate([
        { $match: { restaurantId: { $in: restaurantIds }, isActive: true } },
        { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
      ]).exec(),
      DeviceActivity.aggregate([
        { $match: { restaurantId: { $in: restaurantIds } } },
        { $group: { _id: '$restaurantId', lastActive: { $max: '$createdAt' } } },
      ]).exec(),
    ]);

    const subById = new Map(subsMap.map((s) => [s.restaurantId.toString(), s]));
    const branchCount = new Map(branchAgg.map((b) => [b._id.toString(), b.count]));
    const deviceCount = new Map(deviceAgg.map((d) => [d._id.toString(), d.count]));
    const lastActiveById = new Map(lastActiveAgg.map((a) => [a._id.toString(), a.lastActive]));

    const data = restaurants.map((r) => {
      const id = r._id.toString();
      const row = toRestaurantRow(r, subById.get(id), branchCount.get(id) || 0, deviceCount.get(id) || 0);
      row.lastActive = lastActiveById.get(id)?.toISOString() || null;
      return row;
    });

    // Sort by `plan`/`status` requires post-sort (not a schema field).
    if (sortBy === 'plan' || sortBy === 'status') {
      data.sort((a, b) => {
        const cmp = String(a[sortBy]).localeCompare(String(b[sortBy]));
        return sortOrder * cmp;
      });
    }

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      total,
      page,
      limit,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // GET ONE
  // ──────────────────────────────────────────────────────────────
  async getById(id: string) {
    const restaurant = await Restaurant.findById(id).lean().exec();
    if (!restaurant) return null;
    const { sub, deviceCount, branchCount, lastActive } = await this.loadContext(restaurant._id);
    const row = toRestaurantRow(restaurant, sub, branchCount as number, deviceCount as number);
    row.lastActive = lastActive;
    return row;
  }

  // ──────────────────────────────────────────────────────────────
  // CREATE — transactional onboarding with compensating rollback
  // ──────────────────────────────────────────────────────────────
  async create(body: Record<string, any>, adminIdentity: AdminIdentity) {
    const name = body.name || body.restaurantName;
    if (!name) throw new AppError(400, 'Restaurant name is required');

    const shortName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 12);
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const ownerUserId = `owner_${shortName}_${randomSuffix}`;
    const ownerPin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPin = await hashPin(ownerPin);
    const restaurantId = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 20);

    const plan = body.plan || 'basic';
    const planDoc = await SubscriptionPlan.findOne({ planId: plan, isActive: true }).lean().exec();
    // Validate the plan BEFORE writing anything so an unknown plan never leaves
    // partial onboarding records behind (fail fast instead of relying on rollback).
    if (body.plan && !planDoc) {
      throw new AppError(400, `Selected plan '${body.plan}' is not available`);
    }
    const onboardingMode: OnboardingMode = ['cash', 'trial', 'create_only'].includes(body.onboardingMode)
      ? body.onboardingMode
      : 'cash';

    const now = new Date();

    // ─── Phase A: create the Restaurant doc ───────────────────────
    const restaurant = await Restaurant.create({
      restaurantId,
      name,
      legalName: body.legalName,
      brandName: body.brandName,
      restaurantType: body.restaurantType,
      cuisineType: body.cuisineType,
      phone: body.phone,
      altPhone: body.altPhone,
      email: body.email,
      website: body.website,
      description: body.description,
      notes: body.notes,
      extraInfo: body.extraInfo,
      gst: body.gst,
      fssai: body.fssai,
      pan: body.pan,
      businessRegNumber: body.businessRegNumber,
      ownerName: body.ownerName || name,
      ownerPhone: body.ownerPhone || body.phone,
      ownerEmail: body.ownerEmail || body.email,
      emergencyContact: body.emergencyContact,
      identityType: body.identityType,
      identityNumber: body.identityNumber,
      address: body.address,
      area: body.area,
      city: body.city,
      district: body.district,
      state: body.state,
      country: body.country,
      pinCode: body.pinCode,
      latitude: body.latitude,
      longitude: body.longitude,
      timezone: body.timezone || 'UTC',
      currency: body.currency || 'INR',
      gstEnabled: body.gstEnabled !== false,
      printerType: body.printerType || 'Thermal 80mm',
      receiptWidth: body.receiptWidth || '80mm',
      taxMode: body.taxMode || 'Inclusive',
      offlineMode: body.offlineMode !== false,
      aiEnabled: !!body.aiEnabled,
      loyaltyEnabled: body.loyaltyEnabled !== false,
      weatherEnabled: body.weatherEnabled !== false,
      maxDevices: body.maxDevices || 3,
      isActive: true,
      ownerUserId,
      ownerPin: hashedPin,
      tempPasswordShown: false,
      secretKey: crypto.randomBytes(16).toString('hex'),
      apiKey: `pk_live_${crypto.randomBytes(24).toString('hex')}`,
      publicToken: generatePublicToken(),
      auditTrail: [{
        id: crypto.randomUUID(),
        action: 'Restaurant Created',
        admin: adminIdentity.name,
        timestamp: now,
        reason: 'Initial Onboarding',
      }],
    });

    const planMaxDevicesPerBranch = planDoc?.limits?.maxDevicesPerBranch ?? (planDoc?.limits as any)?.maxDevices ?? planDoc?.maxDevices ?? body.maxDevices ?? 3;
    const featuresList = planDoc?.features || [];
    const planLimits = {
      maxRestaurants: planDoc?.limits?.maxRestaurants ?? 1,
      maxBranches: planDoc?.limits?.maxBranches ?? 1,
      maxDevicesPerBranch: planMaxDevicesPerBranch,
      maxUsers: planDoc?.maxUsers ?? 10,
      maxProducts: planDoc?.limits?.maxProducts ?? 0,
      maxCustomers: planDoc?.limits?.maxCustomers ?? 0,
      maxMonthlyOrders: planDoc?.limits?.maxMonthlyOrders ?? 0,
      maxStorageMB: planDoc?.limits?.maxStorageMB ?? 500,
      maxAIRequests: planDoc?.limits?.maxAIRequests ?? 0,
      maxVoiceRequests: planDoc?.limits?.maxVoiceRequests ?? 0,
      maxImages: planDoc?.limits?.maxImages ?? 0,
      maxExports: planDoc?.limits?.maxExports ?? 0,
    };

    // ─── Phase 2..N: subscription / branch / payment / invoice / user ───
    let subscription: any = null;
    let branch: any = null;
    let payment: any = null;
    let invoice: any = null;
    let ownerUser: any = null;

    let subStatus: SubscriptionStatus;
    let subFeatures: string[];
    let subLimits;
    let subEndDate: Date | null;
    let trialEnd: Date | null;
    let planPrice = 0;
    let invoiceNumber: string | undefined;

    const trialDays = config.subscription?.trialDays ?? 7;

    try {
      if (onboardingMode === 'create_only') {
        subStatus = 'suspended';
        subFeatures = [];
        subLimits = { maxBranches: 1, maxDevicesPerBranch: 1 };
        subEndDate = null;
        trialEnd = null;
      } else if (onboardingMode === 'trial') {
        subStatus = 'trial';
        subFeatures = [
          'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty', 'reservations',
          'multi_branch', 'analytics', 'custom_branding', 'advanced_reports',
          'expense_tracking', 'api_access', 'priority_support',
        ];
        subLimits = { maxBranches: 5, maxDevicesPerBranch: 10 };
        subEndDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
        trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
      } else {
        subStatus = 'active';
        subFeatures = featuresList;
        subLimits = planLimits;
        subEndDate = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
        trialEnd = null;
      }

      const subExpiryDate = subEndDate || new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
      const subGraceEnd = new Date(subExpiryDate.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

      const subscriptionPayload: Record<string, any> = {
        restaurantId: restaurant._id,
        plan,
        status: subStatus,
        startDate: now,
        endDate: subEndDate,
        expiryDate: subExpiryDate,
        graceEnd: subGraceEnd,
        maxUsers: onboardingMode === 'trial' ? 50 : (planDoc?.maxUsers || 5),
        maxDevices: onboardingMode === 'trial' ? 10 : planMaxDevicesPerBranch,
        features: subFeatures,
        limits: subLimits,
      };
      if (trialEnd) {
        subscriptionPayload.trialStart = now;
        subscriptionPayload.trialEnd = trialEnd;
      }
      subscription = await subscriptionRepo.create(subscriptionPayload as any);

      // Default head branch (reuses branchService entitlement semantics).
      branch = await this.ensureHeadBranch(restaurant._id as mongoose.Types.ObjectId, name);

      if (onboardingMode === 'cash') {
        planPrice = planDoc?.price || 499;
        const cashOrderId = `cash_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const counter = await InvoiceCounter.findOneAndUpdate(
          { name: 'subscription_admin' },
          { $inc: { sequence: 1 } },
          { upsert: true, new: true },
        ).exec();
        invoiceNumber = `SUB-${new Date().getFullYear()}-${String(counter.sequence).padStart(6, '0')}`;

        payment = await Payment.create({
          restaurantId: restaurant._id,
          subscriptionId: subscription._id,
          razorpayOrderId: cashOrderId,
          amount: planPrice,
          currency: 'INR',
          gateway: 'cash',
          paymentMethod: 'cash',
          status: 'success',
          invoiceNumber,
        });
        invoice = await Invoice.create({
          restaurantId: restaurant._id,
          paymentId: payment._id,
          invoiceNumber,
          plan,
          amount: planPrice,
          tax: Math.round(planPrice * 0.18),
          generatedAt: new Date(),
        });
      }

      // Default restaurant-scope settings + an owner User profile so the
      // admin Owners dashboard reflects the owner identity consistently.
      await settingsService.getEffective(restaurant._id.toString());
      if (body.ownerName || body.ownerPhone || body.ownerEmail) {
        ownerUser = await userRepo.create({
          userId: ownerUserId,
          restaurantId: restaurant._id,
          phone: body.ownerPhone || body.phone || '',
          name: body.ownerName || name,
          email: body.ownerEmail || body.email || null,
          role: 'owner',
          status: 'active',
          password: hashedPin,
        } as any);
      }

      await auditLogRepo.create({
        action: 'RESTAURANT_CREATED',
        entityType: 'Restaurant',
        entityId: restaurant._id.toString(),
        performedBy: adminIdentity.name,
        performedById: adminIdentity.id,
        details: {
          restaurantId: restaurant.restaurantId,
          plan,
          onboardingMode,
          invoiceNumber,
        },
      } as any);
    } catch (error) {
      // Compensating rollback — remove any partially-created records in reverse order.
      const rollbackSteps: Array<[string, any]> = [];
      if (ownerUser) rollbackSteps.push(['user', ownerUser._id.toString()]);
      if (invoice) rollbackSteps.push(['invoice', invoice._id.toString()]);
      if (payment) rollbackSteps.push(['payment', payment._id.toString()]);
      if (branch) rollbackSteps.push(['branch', branch._id.toString()]);
      if (subscription) rollbackSteps.push(['subscription', subscription._id.toString()]);
      await this.rollbackRestaurant(restaurant, rollbackSteps);
      console.error('[RestaurantService] create failed — rolled back partial creation:', error);
      throw error;
    }

    // Keep restaurant feature flags aligned with the derived subscription features.
    await Restaurant.findByIdAndUpdate(restaurant._id, {
      $set: {
        aiEnabled: subFeatures.includes('ai'),
        loyaltyEnabled: subFeatures.includes('loyalty') || (restaurant.loyaltyEnabled && subFeatures.includes('loyalty')),
        weatherEnabled: subFeatures.includes('weather') || restaurant.weatherEnabled,
      },
    }).exec();

    const responseStatus = onboardingMode === 'create_only' ? 'pending' : subscription.status;
    return {
      id: restaurant._id.toString(),
      restaurantId: restaurant.restaurantId,
      name: restaurant.name,
      phone: restaurant.phone,
      plan: subscription.plan,
      status: responseStatus,
      onboardingMode,
      devices: 0,
      maxDevices: onboardingMode === 'trial' ? 12 : planMaxDevicesPerBranch,
      aiEnabled: subFeatures.includes('ai'),
      ownerUserId,
      ownerPin,
      ...(onboardingMode === 'cash' && invoiceNumber ? {
        invoice: { number: invoiceNumber, amount: planPrice, tax: Math.round(planPrice * 0.18) },
      } : {}),
      createdAt: restaurant.createdAt.toISOString(),
      updatedAt: restaurant.updatedAt.toISOString(),
    };
  }

  private async ensureHeadBranch(restaurantId: mongoose.Types.ObjectId, name: string): Promise<any> {
    const existing = await Branch.findOne({ restaurantId, isHeadBranch: true }).exec();
    if (existing) return existing;
    const can = await entitlementService.canCreateBranch(restaurantId.toString());
    if (!can.allowed) return null; // head branch already implied by first-time setup
    return branchRepo.create({
      name,
      isHeadBranch: true,
      isActive: true,
      restaurantId,
    } as any);
  }

  private async rollbackRestaurant(restaurant: any, steps: Array<[string, any]>) {
    for (const [kind, id] of steps.reverse()) {
      try {
        switch (kind) {
          case 'user': await userRepo.hardDelete(id); break;
          case 'invoice': await Invoice.findByIdAndDelete(id).exec(); break;
          case 'payment': await Payment.findByIdAndDelete(id).exec(); break;
          case 'branch': await Branch.findByIdAndDelete(id).exec(); break;
          case 'subscription': await subscriptionRepo.hardDelete(id); break;
        }
      } catch { /* best-effort cleanup */ }
    }
    try { await restaurantRepo.hardDelete(restaurant._id.toString()); } catch { /* best-effort */ }
  }

  // ──────────────────────────────────────────────────────────────
  // UPDATE (whitelist-guarded, no mass assignment)
  // ──────────────────────────────────────────────────────────────
  async update(id: string, body: Record<string, any>, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    const updates: Record<string, any> = {};
    const sanitized: Record<string, any> = {};
    for (const key of Object.keys(body)) {
      if (!UPDATEABLE_FIELDS.includes(key)) continue;
      updates[key] = body[key];
      sanitized[key] = body[key];
    }

    const subUpdates: Record<string, any> = {};

    // Plan change → re-sync features / limits / maxUsers from target plan.
    if (body.plan) {
      const planDoc = await SubscriptionPlan.findOne({ planId: body.plan, isActive: true }).lean().exec();
      if (planDoc) {
        subUpdates.plan = body.plan;
        subUpdates.features = planDoc.features || [];
        const planLimits = (planDoc.limits as Record<string, any>) || {};
        subUpdates.limits = {
          ...planLimits,
          maxBranches: planLimits.maxBranches ?? 1,
          maxDevicesPerBranch: planLimits.maxDevicesPerBranch ?? planDoc.maxDevices ?? 3,
        };
        subUpdates.maxUsers = planDoc.maxUsers;
        subUpdates.maxDevices = planLimits.maxDevicesPerBranch ?? planDoc.maxDevices;
        updates.aiEnabled = (planDoc.features || []).includes('ai');
        updates.loyaltyEnabled = (planDoc.features || []).includes('loyalty');
        updates.weatherEnabled = (planDoc.features || []).includes('weather');
        updates.maxDevices = planDoc.maxDevices;
      }
    }

    // Feature flag toggles → sync subscription features vector (no drift).
    if ('aiEnabled' in updates || 'loyaltyEnabled' in updates) {
      const sub = await Subscription.findOne({ restaurantId: restaurant._id }).exec();
      const base = sub?.features || [];
      const next = [...base];
      if ('aiEnabled' in updates) {
        const flag = !!updates.aiEnabled;
        const idx = next.indexOf('ai');
        if (flag && idx === -1) next.push('ai');
        if (!flag && idx !== -1) next.splice(idx, 1);
        updates.aiEnabled = flag;
      }
      if ('loyaltyEnabled' in updates) {
        const flag = !!updates.loyaltyEnabled;
        const idx = next.indexOf('loyalty');
        if (flag && idx === -1) next.push('loyalty');
        if (!flag && idx !== -1) next.splice(idx, 1);
        updates.loyaltyEnabled = flag;
      }
      subUpdates.features = next;
    }

    const updated = await Restaurant.findByIdAndUpdate(id, { $set: updates }, { new: true }).exec();
    if (Object.keys(subUpdates).length > 0) {
      await Subscription.findOneAndUpdate({ restaurantId: restaurant._id }, { $set: subUpdates }).exec();
    }

    restaurant.auditTrail = restaurant.auditTrail || [];
    restaurant.auditTrail.push({
      id: crypto.randomUUID(),
      action: 'Restaurant Updated',
      admin: adminIdentity.name,
      timestamp: new Date(),
      reason: sanitized.notes || 'Details updated',
    });
    await restaurant.save();

    await auditLogRepo.create({
      action: 'RESTAURANT_UPDATED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { changed: Object.keys(sanitized) },
    } as any);

    return updated;
  }

  // ──────────────────────────────────────────────────────────────
  // STATUS TRANSITIONS
  // ──────────────────────────────────────────────────────────────
  async setStatus(id: string, status: 'suspend' | 'activate', adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    const isSuspend = status === 'suspend';
    await Restaurant.findByIdAndUpdate(id, { isActive: !isSuspend }).exec();
    await Subscription.findOneAndUpdate(
      { restaurantId: restaurant._id },
      { status: isSuspend ? 'suspended' : 'active' },
    ).exec();

    restaurant.auditTrail = restaurant.auditTrail || [];
    restaurant.auditTrail.push({
      id: crypto.randomUUID(),
      action: isSuspend ? 'Restaurant Suspended' : 'Restaurant Activated',
      admin: adminIdentity.name,
      timestamp: new Date(),
      reason: isSuspend ? 'Suspended by admin' : 'Activated by admin',
    });
    await restaurant.save();

    await auditLogRepo.create({
      action: isSuspend ? 'RESTAURANT_SUSPENDED' : 'RESTAURANT_ACTIVATED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { status: isSuspend ? 'suspended' : 'active' },
    } as any);

    return { message: isSuspend ? 'Restaurant suspended' : 'Restaurant activated' };
  }

  // ──────────────────────────────────────────────────────────────
  // DELETE / RESTORE / PERMANENT DELETE
  // ──────────────────────────────────────────────────────────────
  async softDelete(id: string, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    const now = new Date();

    await Promise.all([
      Restaurant.findByIdAndUpdate(id, { isDeleted: true, deletedAt: now, isActive: false }).exec(),
      Subscription.findOneAndUpdate({ restaurantId: restaurant._id }, { status: 'suspended', endDate: now }).exec(),
      License.updateMany({ restaurantId: restaurant._id, isActive: true }, { $set: { isActive: false } }).exec(),
      deviceRepo.updateMany({ restaurantId: restaurant._id, isActive: true }, { isActive: false } as any),
    ]);

    await auditLogRepo.create({
      action: 'RESTAURANT_DELETED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { softDelete: true, restaurantId: restaurant.restaurantId },
    } as any);

    return { message: 'Restaurant soft deleted successfully' };
  }

  async restore(id: string, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    if (!restaurant.isDeleted) throw new AppError(400, 'Restaurant is not deleted');

    // Only flip the subscription back to active when its billing period has not
    // already lapsed — the scheduler re-evaluates expiry and will re-suspend a
    // genuinely expired subscription anyway.
    const sub = await Subscription.findOne({ restaurantId: restaurant._id }).exec();
    const now = new Date();
    const subStatus = sub && sub.expiryDate && sub.expiryDate <= now ? undefined : 'active';

    await Promise.all([
      Restaurant.findByIdAndUpdate(id, { isDeleted: false, deletedAt: null }).exec(),
      ...(subStatus ? [Subscription.findOneAndUpdate({ restaurantId: restaurant._id }, { status: subStatus }).exec()] : []),
      // Mirror the soft-delete cascade: reactivate devices + licenses so the
      // restored restaurant can log in again. Blocked devices stay blocked.
      deviceRepo.updateMany(
        { restaurantId: restaurant._id, isActive: false, status: { $ne: 'blocked' } },
        { isActive: true } as any,
      ),
      License.updateMany({ restaurantId: restaurant._id, isActive: false }, { $set: { isActive: true } }).exec(),
    ]);

    await auditLogRepo.create({
      action: 'RESTAURANT_RESTORED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { restaurantId: restaurant.restaurantId },
    } as any);

    return { message: 'Restaurant restored successfully' };
  }

  async permanentDelete(id: string, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    if (!restaurant.isDeleted) throw new AppError(400, 'Permanent deletion requires the restaurant to be soft-deleted first');

    const restaurantId = restaurant._id;

    // Branch-scoped data (orders, takeaway, held) is swept via branch ids.
    const branchIds = (await Branch.find({ restaurantId }).select('_id').lean().exec())
      .map((b) => b._id);

    // Remove the tenant's persisted media files (logo / cover) from disk.
    try {
      await fs.rm(path.join(config.uploads.dir, 'restaurants', restaurant._id.toString()), { recursive: true, force: true });
    } catch { /* best-effort — DB cascade below is authoritative */ }

    // Danger zone — cascade ALL tenant data across every restaurant-scoped
    // collection (and branch-scoped collections via the branch ids above).
    await Promise.all([
      User.deleteMany({ restaurantId }).exec(),
      Employee.deleteMany({ restaurantId }).exec(),
      License.deleteMany({ restaurantId }).exec(),
      Subscription.deleteMany({ restaurantId }).exec(),
      Invoice.deleteMany({ restaurantId }).exec(),
      Payment.deleteMany({ restaurantId }).exec(),
      Branch.deleteMany({ restaurantId }).exec(),
      Device.deleteMany({ restaurantId }).exec(),
      DeviceActivity.deleteMany({ restaurantId }).exec(),
      Bill.deleteMany({ restaurantId }).exec(),
      Product.deleteMany({ restaurantId }).exec(),
      Customer.deleteMany({ restaurantId }).exec(),
      CustomerActivity.deleteMany({ restaurantId }).exec(),
      CustomerVisit.deleteMany({ restaurantId }).exec(),
      LoyaltyTransaction.deleteMany({ restaurantId }).exec(),
      Expense.deleteMany({ restaurantId }).exec(),
      Offer.deleteMany({ restaurantId }).exec(),
      Reward.deleteMany({ restaurantId }).exec(),
      Reservation.deleteMany({ restaurantId }).exec(),
      Table.deleteMany({ restaurantId }).exec(),
      Floor.deleteMany({ restaurantId }).exec(),
      Purchase.deleteMany({ restaurantId }).exec(),
      DailySummary.deleteMany({ restaurantId }).exec(),
      MonthlySummary.deleteMany({ restaurantId }).exec(),
      YearlySummary.deleteMany({ restaurantId }).exec(),
      AIUsageLog.deleteMany({ restaurantId }).exec(),
      VoiceAuditLog.deleteMany({ restaurantId }).exec(),
      BranchSettings.deleteMany({ restaurantId }).exec(),
      RestaurantSettings.deleteMany({ restaurantId }).exec(),
      Printer.deleteMany({ restaurantId }).exec(),
      ...(branchIds.length > 0
        ? [
            Order.deleteMany({ branchId: { $in: branchIds } }).exec(),
            TakeawayOrder.deleteMany({ branchId: { $in: branchIds } }).exec(),
            HeldOrder.deleteMany({ branchId: { $in: branchIds } }).exec(),
          ]
        : []),
    ]);

    await Restaurant.findByIdAndDelete(id).exec();

    await auditLogRepo.create({
      action: 'RESTAURANT_PERMANENT_DELETED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { restaurantId: restaurant.restaurantId, softDeletedAt: restaurant.deletedAt },
    } as any);

    return { message: 'Restaurant permanently deleted' };
  }

  // ──────────────────────────────────────────────────────────────
  // RESET PASSWORD (no plaintext leak back to caller as a secret)
  // ──────────────────────────────────────────────────────────────
  async resetOwnerPassword(id: string, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await hashPin(newPin);
    await Restaurant.findByIdAndUpdate(id, { ownerPin: hashed, tempPasswordShown: false }).exec();

    // Keep the owner User (and any linked Employee) credentials in sync so the
    // owners dashboard reset and the POS owner login never diverge from this PIN.
    if (restaurant.ownerUserId) {
      const ownerUser = await User.findOne({ userId: restaurant.ownerUserId }).exec();
      if (ownerUser) {
        await User.updateOne({ _id: ownerUser._id }, { password: hashed }).exec();
        if (ownerUser.employeeId) {
          await Employee.updateOne({ _id: ownerUser.employeeId }, { pin: hashed }).exec();
        }
      }
    }

    await auditLogRepo.create({
      action: 'RESTAURANT_PIN_RESET',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { restaurantId: restaurant.restaurantId },
    } as any);

    return { message: 'Password reset successfully', ownerUserId: restaurant.ownerUserId };
  }

  // ──────────────────────────────────────────────────────────────
  // STATISTICS — real aggregated per-restaurant metrics
  // ──────────────────────────────────────────────────────────────
  async statistics(id: string) {
    const restaurant = await Restaurant.findById(id).lean().exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    const rid = restaurant._id;
    const ctx = await this.loadContext(rid);

    const [
      sub, deviceSummary, recentActivity, totals, branchAgg,
      employeeCount, productCount, billAgg, customerCount, loyaltyCount,
      aiCount, voiceCount,
    ] = await Promise.all([
      Subscription.findOne({ restaurantId: rid }).lean().exec(),
      Device.aggregate([
        { $match: { restaurantId: rid } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
          },
        },
      ]).exec(),
      DeviceActivity.aggregate([
        { $match: { restaurantId: rid } },
        { $sort: { createdAt: -1 } },
        { $limit: 8 },
      ]).exec(),
      DeviceActivity.aggregate([
        { $match: { restaurantId: rid } },
        {
          $group: {
            _id: null,
            events: { $sum: 1 },
            logins: { $sum: { $cond: [{ $eq: ['$event', 'device_login'] }, 1, 0] } },
          },
        },
      ]).exec(),
      Branch.aggregate([
        { $match: { restaurantId: rid, isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            head: { $sum: { $cond: ['$isHeadBranch', 1, 0] } },
          },
        },
      ]).exec(),
      Employee.countDocuments({ restaurantId: rid, isDeleted: { $ne: true } }).exec(),
      Product.countDocuments({ restaurantId: rid, isDeleted: { $ne: true } }).exec(),
      Bill.aggregate([
        { $match: { restaurantId: rid } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
      ]).exec(),
      Customer.countDocuments({ restaurantId: rid, isDeleted: { $ne: true } }).exec(),
      LoyaltyTransaction.countDocuments({ restaurantId: rid }).exec(),
      AIUsageLog.countDocuments({ restaurantId: rid }).exec(),
      VoiceAuditLog.countDocuments({ restaurantId: rid }).exec(),
    ]);

    // Resolve the plan for the storage quota (falls back to the subscription
    // limits snapshot, then to a platform default).
    let plan = null;
    if (sub?.plan) {
      plan = await SubscriptionPlan.findOne({ planId: sub.plan }).lean().exec();
    }
    const storage = computeStorageMetrics(restaurant, sub, plan);

    const deviceTotal = deviceSummary[0]?.total || 0;
    const deviceActive = deviceSummary[0]?.active || 0;

    return {
      id: restaurant._id.toString(),
      restaurantId: restaurant.restaurantId,
      name: restaurant.name,
      logoUrl: restaurant.logoUrl || null,
      coverImageUrl: restaurant.coverImageUrl || null,
      storage,
      plan: sub?.plan || 'N/A',
      subscriptionStatus: sub?.status || 'active',
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            expiryDate: sub.expiryDate?.toISOString() || null,
            graceEnd: sub.graceEnd?.toISOString() || null,
          }
        : null,
      branches: branchAgg[0]?.total || 0,
      branchStats: {
        total: branchAgg[0]?.total || 0,
        active: branchAgg[0]?.active || 0,
        headBranches: branchAgg[0]?.head || 0,
        inactive: (branchAgg[0]?.total || 0) - (branchAgg[0]?.active || 0),
      },
      devices: {
        total: deviceTotal,
        active: deviceActive,
        offline: deviceTotal - deviceActive,
        blocked: deviceSummary[0]?.blocked || 0,
        limit: sub?.maxDevices || restaurant.maxDevices || 3,
      },
      usage: {
        employees: employeeCount,
        products: productCount,
        customers: customerCount,
        loyaltyMembers: loyaltyCount,
        bills: billAgg[0]?.count || 0,
        revenue: billAgg[0]?.revenue || 0,
        aiRequests: aiCount,
        voiceRequests: voiceCount,
      },
      activity: {
        totalEvents: totals[0]?.events || 0,
        logins: totals[0]?.logins || 0,
        lastActive: ctx.lastActive,
        recent: recentActivity.map((a) => ({
          id: a._id.toString(),
          event: a.event,
          description: a.description,
          metadata: a.metadata,
          ipAddress: a.ipAddress,
          createdAt: a.createdAt?.toISOString() || null,
        })),
      },
    };
  }

  // ──────────────────────────────────────────────────────────────
  // REGENERATE CREDENTIALS — rotate secretKey / apiKey (audited)
  // ──────────────────────────────────────────────────────────────
  async regenerateCredentials(id: string, adminIdentity: AdminIdentity) {
    const restaurant = await Restaurant.findById(id).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    const newSecretKey = crypto.randomBytes(16).toString('hex');
    const newApiKey = `pk_live_${crypto.randomBytes(24).toString('hex')}`;

    await Restaurant.findByIdAndUpdate(id, { $set: { secretKey: newSecretKey, apiKey: newApiKey } }).exec();

    restaurant.auditTrail = restaurant.auditTrail || [];
    restaurant.auditTrail.push({
      id: crypto.randomUUID(),
      action: 'Restaurant Credentials Regenerated',
      admin: adminIdentity.name,
      timestamp: new Date(),
      reason: 'Regenerated by admin',
    });
    await restaurant.save();

    await auditLogRepo.create({
      action: 'RESTAURANT_CREDENTIALS_REGENERATED',
      entityType: 'Restaurant',
      entityId: id,
      performedBy: adminIdentity.name,
      performedById: adminIdentity.id,
      details: { restaurantId: restaurant.restaurantId },
    } as any);

    return { message: 'Credentials regenerated successfully', secretKey: newSecretKey, apiKey: newApiKey };
  }
}

export const restaurantService = new RestaurantService();
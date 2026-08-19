import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Restaurant from '../models/Restaurant';
import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Branch from '../models/Branch';
import License from '../models/License';
import Device from '../models/Device';
import Employee from '../models/Employee';
import DeviceActivity from '../models/DeviceActivity';
import { entitlementService } from '../services/entitlementService';
import { branchService, restaurantService } from '../services';
import { planPriceForPeriod } from '../modules/subscription/subscriptionService';
import { effectiveFeatures } from '../utils/subscriptionFeatures';
import { FEATURE_CATALOG } from '../constants/planFeatures';
import { AppError } from '../utils/AppError';
import { toAbsoluteMediaUrl } from '../modules/media';
import crypto from 'crypto';

interface AdminIdentity { id: string; name: string; }

function adminIdentity(req: Request): AdminIdentity {
  const user = (req as any).user;
  return {
    id: user?._id?.toString() || user?.id || 'system',
    name: user?.name || 'Super Admin',
  };
}

function handleError(res: Response, error: any, logPrefix: string) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  console.error(`[${logPrefix}]`, error);
  res.status(500).json({ message: 'Internal server error' });
}

/** Resolve stored relative media paths to absolute URLs for API responses. */
function resolveRowMedia(req: Request, row: any): any {
  if (!row) return row;
  row.logoUrl = toAbsoluteMediaUrl(req, row.logoUrl);
  row.coverImageUrl = toAbsoluteMediaUrl(req, row.coverImageUrl);
  return row;
}

export async function getRestaurants(req: Request, res: Response): Promise<void> {
  try {
    const result = await restaurantService.list(req.query);
    if (Array.isArray(result.data)) {
      result.data = result.data.map((row) => resolveRowMedia(req, row));
    }
    res.json(result);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants List');
  }
}

export async function getRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const row = await restaurantService.getById(req.params.id);
    if (!row) { res.status(404).json({ message: 'Restaurant not found' }); return; }
    res.json(resolveRowMedia(req, row));
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Get');
  }
}

export async function createRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const created = await restaurantService.create(req.body, adminIdentity(req));
    res.status(201).json(created);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Create');
  }
}

export async function updateRestaurant(req: Request, res: Response): Promise<void> {
  try {
    await restaurantService.update(req.params.id, req.body, adminIdentity(req));
    res.json({ message: 'Restaurant updated successfully' });
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Update');
  }
}

export async function deleteRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.softDelete(req.params.id, adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Delete');
  }
}

export async function restoreRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.restore(req.params.id, adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Restore');
  }
}

export async function permanentDeleteRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.permanentDelete(req.params.id, adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants PermanentDelete');
  }
}

export async function suspendRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.setStatus(req.params.id, 'suspend', adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Suspend');
  }
}

export async function activateRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.setStatus(req.params.id, 'activate', adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Activate');
  }
}

export async function resetRestaurantPassword(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.resetOwnerPassword(req.params.id, adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants ResetPassword');
  }
}

export async function regenerateRestaurantCredentials(req: Request, res: Response): Promise<void> {
  try {
    const out = await restaurantService.regenerateCredentials(req.params.id, adminIdentity(req));
    res.json(out);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants RegenerateCredentials');
  }
}

export async function getRestaurantStatistics(req: Request, res: Response): Promise<void> {
  try {
    const stats = await restaurantService.statistics(req.params.id);
    res.json(resolveRowMedia(req, stats));
  } catch (error) {
    handleError(res, error, 'AdminRestaurants Statistics');
  }
}

export async function createRestaurantBranch(req: Request, res: Response): Promise<void> {
  try {
    const { name, address, phone, isHeadBranch } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ message: 'Branch name is required' });
      return;
    }
    const branch = await branchService.create({
      name: name.trim(),
      address: address || undefined,
      phone: phone || undefined,
      isHeadBranch: !!isHeadBranch,
      restaurantId: req.params.id,
    });
    res.status(201).json({ data: branch });
  } catch (error: any) {
    if (error.statusCode === 403) {
      res.status(403).json({ message: error.message });
      return;
    }
    console.error('[AdminRestaurants] Create branch error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
}

export async function getRestaurantBranchUsage(req: Request, res: Response): Promise<void> {
  try {
    const usage = await entitlementService.getBranchUsage(req.params.id);
    res.json(usage);
  } catch (error) {
    handleError(res, error, 'AdminRestaurants BranchUsage');
  }
}

export async function addAdminNote(req: Request, res: Response): Promise<void> {
  try {
    const { note } = req.body;
    if (!note) { res.status(400).json({ message: 'Note content is required' }); return; }
    const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, {
      $push: {
        adminNotes: {
          id: crypto.randomUUID(),
          note,
          admin: 'Super Admin',
          timestamp: new Date(),
        }
      }
    }, { new: true }).exec();
    if (!restaurant) { res.status(404).json({ message: 'Restaurant not found' }); return; }
    res.json({ message: 'Note added successfully', adminNotes: restaurant.adminNotes });
  } catch (error) {
    handleError(res, error, 'AdminRestaurants AddNote');
  }
}

export async function getSubscriptionUsage(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;

    const [
      restaurant,
      subscription,
      branchCount,
      deviceCount,
      employeeCount,
    ] = await Promise.all([
      Restaurant.findById(restaurantId).exec(),
      Subscription.findOne({ restaurantId }).exec(),
      Branch.countDocuments({ restaurantId, isDeleted: { $ne: true } }).exec(),
      Device.countDocuments({ restaurantId, isActive: true }).exec(),
      Employee.countDocuments({ restaurantId, status: 'Active', isDeleted: { $ne: true } }).exec(),
    ]);

    if (!restaurant) {
      res.status(404).json({ message: 'Restaurant not found' });
      return;
    }

    const plan = subscription?.plan
      ? await SubscriptionPlan.findOne({ planId: subscription.plan }).exec()
      : null;

    const effectiveLimits = subscription?.limits || plan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };
    // Effective feature keys = the REAL catalog, accounting for:
    //   - trial  → every feature unlocked
    //   - paid   → plan snapshot + admin-granted add-ons (grantedFeatures)
    // The old code compared a hardcoded catalog using wrong keys (`kot`,
    // `qr_menu`) against the snapshot, so KOT/QR ordering always showed as
    // "not included" even when the subscription had kitchen_display and
    // qr_ordering. Now the catalog and the keys are the single source of truth.
    const resolvedFeatureKeys: string[] = subscription?.status === 'trial'
      ? FEATURE_CATALOG.map((f) => f.key)
      : effectiveFeatures(subscription?.features, subscription?.grantedFeatures);
    const featureKeys: string[] = resolvedFeatureKeys && resolvedFeatureKeys.length > 0 ? resolvedFeatureKeys : (plan?.features || []);

    const maxBranches = effectiveLimits.maxBranches;
    const branchUsage = {
      current: branchCount,
      limit: maxBranches === 0 ? Infinity : maxBranches,
      percentage: maxBranches === 0 ? 0 : Math.round((branchCount / maxBranches) * 100),
      remaining: maxBranches === 0 ? -1 : Math.max(0, maxBranches - branchCount),
      isUnlimited: maxBranches === 0,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyLimits: any = effectiveLimits;
    const maxDevicesPerBranch = legacyLimits.maxDevicesPerBranch ?? legacyLimits.maxDevices ?? 3;
    const deviceUsage = {
      current: deviceCount,
      limit: maxDevicesPerBranch,
      percentage: Math.round((deviceCount / maxDevicesPerBranch) * 100),
      remaining: Math.max(0, maxDevicesPerBranch - deviceCount),
      isUnlimited: false,
    };

    // Users are counted company-wide (all branches) against the plan's maxUsers.
    const maxUsers = legacyLimits.maxUsers ?? subscription?.maxUsers ?? plan?.maxUsers ?? 10;
    const userUsage = {
      current: employeeCount,
      limit: maxUsers,
      percentage: Math.round((employeeCount / maxUsers) * 100),
      remaining: Math.max(0, maxUsers - employeeCount),
      isUnlimited: false,
    };

    // Single source of truth — the same catalog the plans, entitlements and
    // the admin feature-grant UI use (constants/planFeatures.ts).
    const featureCatalog: Record<string, { label: string; description: string }> = Object.fromEntries(
      FEATURE_CATALOG.map((f) => [f.key, { label: f.label, description: f.description }])
    );

    const features = featureKeys.map((f: string) => ({
      key: f,
      label: featureCatalog[f]?.label || f.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      description: featureCatalog[f]?.description || '',
      enabled: true,
    }));

    const availableFeatures = FEATURE_CATALOG
      .filter((f) => !featureKeys.includes(f.key))
      .map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        enabled: false,
      }));

    res.json({
      restaurantId: restaurant._id.toString(),
      restaurantName: restaurant.name,
      plan: {
        id: subscription?.plan || 'N/A',
        name: plan?.name || subscription?.plan || 'N/A',
        status: subscription?.status || 'active',
        billingPeriod: subscription?.billingPeriod || 'monthly',
        price: plan?.price || 0,
        yearlyPrice: plan?.yearlyPrice || 0,
        billingPrice: planPriceForPeriod(plan, subscription?.billingPeriod) || 0,
        expiryDate: subscription?.expiryDate?.toISOString() || null,
        graceEnd: subscription?.graceEnd?.toISOString() || null,
      },
      limits: { branches: branchUsage, devicesPerBranch: deviceUsage, users: userUsage },
      features: { enabled: features, available: availableFeatures },
    });
  } catch (error) {
    handleError(res, error, 'AdminRestaurants SubscriptionUsage');
  }
}

export async function getDeviceActivitySummary(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const now = new Date();

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalEvents, last24h, last7d, eventBreakdown] = await Promise.all([
      DeviceActivity.countDocuments({ restaurantId }).exec(),
      DeviceActivity.countDocuments({ restaurantId, createdAt: { $gte: twentyFourHoursAgo } }).exec(),
      DeviceActivity.countDocuments({ restaurantId, createdAt: { $gte: sevenDaysAgo } }).exec(),
      DeviceActivity.aggregate([
        { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
        { $group: { _id: '$event', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
    ]);

    res.json({
      totalEvents,
      last24h,
      last7d,
      uniqueDevices: await Device.countDocuments({ restaurantId, isActive: true }).exec(),
      eventBreakdown: eventBreakdown.map((e) => ({ event: e._id, count: e.count })),
    });
  } catch (error) {
    handleError(res, error, 'AdminRestaurants DeviceActivity');
  }
}
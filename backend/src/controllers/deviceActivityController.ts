import { Request, Response } from 'express';
import DeviceActivity from '../models/DeviceActivity';
import Device from '../models/Device';
import type { IDeviceActivity } from '../models/DeviceActivity';

/**
 * POST /api/admin/devices/:id/activity — Log a device activity event
 * (Internal — called by admin actions like block/unblock)
 */
export async function logActivity(
  deviceId: string,
  restaurantId: string | undefined,
  event: IDeviceActivity['event'],
  description: string,
  metadata?: Record<string, any>,
  ipAddress?: string,
): Promise<void> {
  try {
    await DeviceActivity.create({
      deviceId,
      restaurantId: restaurantId || undefined,
      event,
      description,
      metadata: metadata || {},
      ipAddress: ipAddress || '',
    });
  } catch (error) {
    console.error('[DeviceActivity] Log error:', error);
  }
}

/**
 * GET /api/admin/devices/:id/activity — Fetch activity log for a device
 */
export async function getDeviceActivity(req: Request, res: Response): Promise<void> {
  try {
    const deviceId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const device = await Device.findById(deviceId).exec();
    if (!device) {
      res.status(404).json({ message: 'Device not found' });
      return;
    }

    const [activities, total] = await Promise.all([
      DeviceActivity.find({ deviceId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      DeviceActivity.countDocuments({ deviceId }).exec(),
    ]);

    const data = activities.map((a) => ({
      id: a._id.toString(),
      event: a.event,
      description: a.description,
      metadata: a.metadata,
      ipAddress: a.ipAddress,
      timestamp: a.createdAt.toISOString(),
    }));

    res.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      device: {
        id: device._id.toString(),
        deviceName: device.deviceName || 'Unknown',
        deviceId: device.deviceId,
      },
    });
  } catch (error) {
    console.error('[DeviceActivity] List error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}


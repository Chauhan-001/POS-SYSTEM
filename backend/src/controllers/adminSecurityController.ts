/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminSecurityController.ts — Admin Security (IP blocklist) endpoints.
 *
 * The manual "IP blocker": an admin can list every blocked IP/range, block an
 * attacking source (exact IP, CIDR or prefix) permanently or for N hours, and
 * unblock. A "suggested" endpoint surfaces the most frequent failed-login
 * sources from the audit log so an admin can cut off an attacker in one click.
 *
 * Every mutation writes an AuditLog entry and invalidates the ipBlocklist
 * middleware cache so the block applies immediately.
 */

import { Request, Response } from 'express';
import BlockedIp from '../models/BlockedIp';
import AuditLog from '../models/AuditLog';
import { auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { invalidateIpBlocklistCache, clientIp } from '../middleware/ipBlocklist';

interface AdminIdentity { id: string; name: string; }

function adminIdentity(req: Request): AdminIdentity {
  const user = (req as any).user;
  return {
    id: user?.userId || user?._id?.toString() || 'system',
    name: user?.name || 'Super Admin',
  };
}

function handleError(res: Response, error: any, logPrefix: string) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({ message: 'This IP / range is already blocked' });
    return;
  }
  console.error(`[${logPrefix}]`, error);
  res.status(500).json({ message: 'Internal server error' });
}

async function writeAudit(actor: AdminIdentity, action: string, ip: string, req: Request, detail: Record<string, any>): Promise<void> {
  try {
    await auditLogRepo.create({
      action,
      entityType: 'blockedIp',
      entityId: ip,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: clientIp(req),
      metadata: detail,
      details: { summary: `${actor.name} ${action.replace('ADMIN_IP_', '').toLowerCase()} ${ip}` },
    } as any);
  } catch (err) {
    console.error('[AdminSecurity] audit write failed:', (err as Error)?.message);
  }
}

// ─── List blocked IPs ──────────────────────────────────────────

export async function listBlockedIps(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const search = (req.query.search as string)?.trim();
    const status = req.query.status as string | undefined;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const now = new Date();
    const filter: Record<string, any> = {};
    if (search) filter.ip = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (status === 'active') filter.$or = [{ permanent: true }, { expiresAt: { $gt: now } }];
    if (status === 'expired') filter.$and = [{ permanent: false }, { expiresAt: { $lte: now } }];

    const [total, rows] = await Promise.all([
      BlockedIp.countDocuments(filter).exec(),
      BlockedIp.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    res.json({
      data: rows.map((r: any) => ({
        id: r._id.toString(),
        ip: r.ip,
        reason: r.reason,
        blockedBy: r.blockedBy,
        blockedById: r.blockedById,
        permanent: r.permanent,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
        isActive: r.isActive,
        createdAt: r.createdAt?.toISOString(),
        updatedAt: r.updatedAt?.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    handleError(res, error, 'AdminSecurity List');
  }
}

// ─── Block an IP / range ──────────────────────────────────────

export async function blockIp(req: Request, res: Response): Promise<void> {
  try {
    const ip = String(req.body.ip).trim().toLowerCase();
    const reason = String(req.body.reason || '').trim();
    const hours = req.body.hours ? Number(req.body.hours) : 0;
    const actor = adminIdentity(req);

    // Safety: never let an admin lock themselves out of the platform.
    const callerIp = (clientIp(req) || '').replace(/^::ffff:/, '').toLowerCase();
    if (callerIp && (callerIp === ip || (ip.includes('/') && callerIp.startsWith(ip.split('/')[0])))) {
      throw new AppError(400, 'Cannot block your own IP address — this would lock you out of the platform');
    }

    const existing = await BlockedIp.findOne({ ip, isActive: true }).exec();
    if (existing) throw new AppError(409, 'This IP / range is already blocked');

    const expiresAt = hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
    const doc = await BlockedIp.create({
      ip,
      reason,
      blockedBy: actor.name,
      blockedById: actor.id,
      permanent: hours <= 0,
      expiresAt,
      isActive: true,
    });

    invalidateIpBlocklistCache();
    await writeAudit(actor, 'ADMIN_IP_BLOCK', ip, req, { reason, hours, permanent: hours <= 0 });

    res.status(201).json({
      message: hours > 0 ? `IP ${ip} blocked for ${hours}h` : `IP ${ip} blocked permanently`,
      blockedIp: {
        id: doc._id.toString(),
        ip: doc.ip,
        reason: doc.reason,
        permanent: doc.permanent,
        expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
        createdAt: doc.createdAt?.toISOString(),
      },
    });
  } catch (error) {
    handleError(res, error, 'AdminSecurity Block');
  }
}

// ─── Unblock an IP / range ────────────────────────────────────

export async function unblockIp(req: Request, res: Response): Promise<void> {
  try {
    const actor = adminIdentity(req);
    const doc = await BlockedIp.findById(req.params.id).exec();
    if (!doc) throw new AppError(404, 'Block entry not found');

    doc.isActive = false;
    await doc.save();

    invalidateIpBlocklistCache();
    await writeAudit(actor, 'ADMIN_IP_UNBLOCK', doc.ip, req, {});

    res.json({ message: `IP ${doc.ip} unblocked` });
  } catch (error) {
    handleError(res, error, 'AdminSecurity Unblock');
  }
}

// ─── Suggested attacking IPs ──────────────────────────────────

/**
 * Top failed-login sources from the audit log that are NOT yet blocked.
 * Groups LOGIN_FAILED entries by IP over the last 7 days, returns the
 * worst offenders so an admin can block them with one click.
 */
export async function getSuggestedBlockedIps(_req: Request, res: Response): Promise<void> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [failedLogins, blockedRows] = await Promise.all([
      AuditLog.aggregate([
        {
          $match: {
            createdAt: { $gte: since },
            action: { $in: ['LOGIN_FAILED', 'auth.login_failed'] },
            ipAddress: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $group: {
            _id: { $toLower: { $trim: { input: { $arrayElemAt: [{ $split: ['$ipAddress', ','] }, 0] } } } },
            count: { $sum: 1 },
            lastSeen: { $max: '$createdAt' },
            usernames: { $addToSet: '$performedBy' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]).exec(),
      BlockedIp.find({ isActive: true }).select('ip permanent expiresAt').lean().exec(),
    ]);

    const blockedSet = new Set(blockedRows.map((b: any) => b.ip.toLowerCase()));

    const suggestions = failedLogins
      .filter((r: any) => r._id && !blockedSet.has(r._id))
      .map((r: any) => ({
        ip: r._id,
        count: r.count,
        lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
        usernames: Array.isArray(r.usernames) ? r.usernames.slice(0, 5) : [],
      }));

    res.json({ suggestions });
  } catch (error) {
    handleError(res, error, 'AdminSecurity Suggested');
  }
}

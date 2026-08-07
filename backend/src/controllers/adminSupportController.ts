import { Request, Response } from 'express';
import Restaurant from '../models/Restaurant';
import User from '../models/User';
import Subscription from '../models/Subscription';
import Device from '../models/Device';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { ok, okWithMeta, fail } from '../utils/apiResponse';
import {
  createSupportTicket, getSupportTicket, listSupportTickets, updateSupportTicket,
  setTicketStatus, assignTicket, getTicketReplies, addTicketReply,
  addTicketAttachment, deleteTicketAttachment, deleteTicket, restoreTicket,
  getTicketStats, getTicketActivity, recordTicketSatisfaction,
} from '../services/supportTicketService';

/** Extract the acting admin identity from the JWT-authenticated request. */
function actorFrom(req: AuthenticatedRequest): { id?: string; name: string; ipAddress?: string } {
  const user = req.user as any;
  return {
    id: user?.userId || user?.id,
    name: user?.name || user?.userId || 'System',
    ipAddress: req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip,
  };
}

// ─── Unified support search (existing) ─────────────────────────────────────

export async function searchSupport(req: Request, res: Response): Promise<void> {
  try {
    const query = (req.query.query as string) || '';
    const restaurantId = req.query.restaurantId as string;
    const phone = req.query.phone as string;
    const name = req.query.name as string;

    const filter: Record<string, any> = { isDeleted: { $ne: true } };
    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } },
      ];
    }
    if (restaurantId) filter._id = restaurantId;
    if (phone) filter.phone = { $regex: phone, $options: 'i' };
    if (name) filter.name = { $regex: name, $options: 'i' };

    const restaurants = await Restaurant.find(filter).limit(20).exec();
    const results = await Promise.all(restaurants.map(async (r) => {
      const owner = await User.findOne({ restaurantId: r._id, role: 'owner' }).exec();
      const subscription = await Subscription.findOne({ restaurantId: r._id }).exec();
      const devicesCount = await Device.countDocuments({ userId: { $in: (await User.find({ restaurantId: r._id }).exec()).map(u => u._id) } }).exec();
      return {
        restaurant: {
          id: r._id.toString(), name: r.name, phone: r.phone, ownerId: owner?._id.toString() || '',
          ownerName: owner?.name || 'N/A', ownerEmail: owner?.email || 'N/A',
          plan: subscription?.plan || 'free', status: r.isActive ? 'active' as const : 'inactive' as const,
          devices: devicesCount, maxDevices: subscription?.maxDevices || 6,
          aiEnabled: (subscription?.features || []).includes('ai'),
          createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        },
        owner: { id: owner?._id.toString() || '', name: owner?.name || 'N/A', email: owner?.email || '', phone: owner?.phone || '' },
        subscription: { plan: subscription?.plan || 'free', status: subscription?.status || 'trial', expiryDate: subscription?.endDate?.toISOString() || '' },
        devices: devicesCount,
        lastLogin: (await User.findOne({ restaurantId: r._id }).sort({ lastLogin: -1 }).exec())?.lastLogin?.toISOString() || '',
      };
    }));
    res.json(results);
  } catch (error) {
    console.error('[AdminSupport] Search error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// ─── Ticket management ─────────────────────────────────────────────────────

export async function getTickets(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await listSupportTickets(req.query as Record<string, any>);
    res.json(okWithMeta(result.data, { pagination: {
      page: result.page, limit: result.limit, total: result.total,
      totalPages: result.totalPages, sortApplied: result.sortApplied,
    }, priorityRanked: result.priorityRanked }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list tickets', error?.statusCode));
  }
}

export async function getTicketStatsEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const stats = await getTicketStats(req.query as Record<string, any>);
    res.json(ok(stats));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load stats', error?.statusCode));
  }
}

export async function getTicket(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const ticket = await getSupportTicket((req.params as any).id);
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load ticket', error?.statusCode));
  }
}

export async function createTicket(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body as any;
    const ticket = await createSupportTicket({
      restaurantId: body.restaurantId,
      category: body.category,
      priority: body.priority,
      subject: body.subject,
      description: body.description,
      source: body.source,
      reporterName: body.reporterName,
      reporterEmail: body.reporterEmail,
      actor: actorFrom(req),
    });
    res.status(201).json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to create ticket', error?.statusCode));
  }
}

export async function updateTicket(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const ticket = await updateSupportTicket((req.params as any).id, req.body as Record<string, any>, actorFrom(req));
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to update ticket', error?.statusCode));
  }
}

export async function setTicketStatusEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { status, note } = req.body as { status: any; note?: string };
    const ticket = await setTicketStatus((req.params as any).id, status, note, actorFrom(req));
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to update status', error?.statusCode));
  }
}

export async function assignTicketEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { assigneeId } = req.body as { assigneeId?: string | null };
    const ticket = await assignTicket((req.params as any).id, assigneeId ?? null, actorFrom(req));
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to assign ticket', error?.statusCode));
  }
}

export async function getReplies(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const replies = await getTicketReplies((req.params as any).id);
    res.json(ok(replies));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load replies', error?.statusCode));
  }
}

export async function addReply(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { body, isInternal } = req.body as { body: string; isInternal?: boolean };
    const user = req.user as any;
    const reply = await addTicketReply({
      ticketId: (req.params as any).id,
      body,
      isInternal,
      authorId: user?.userId || user?.id,
      authorName: user?.name || user?.userId || 'System',
    });
    res.status(201).json(ok(reply));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to add reply', error?.statusCode));
  }
}

export async function uploadAttachment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const file = (req as any).file;
    if (!file) {
      res.status(400).json(fail('No file attached'));
      return;
    }
    const result = await addTicketAttachment({
      ticketId: (req.params as any).id,
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname,
      actor: actorFrom(req),
    });
    res.status(201).json(ok(result));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to upload attachment', error?.statusCode));
  }
}

export async function removeAttachment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const params = req.params as any;
    const result = await deleteTicketAttachment(params.id, params.attachmentId, actorFrom(req));
    res.json(ok(result));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to remove attachment', error?.statusCode));
  }
}

export async function deleteTicketEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reason = (req.body as any)?.reason;
    const ticket = await deleteTicket((req.params as any).id, reason, actorFrom(req));
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to delete ticket', error?.statusCode));
  }
}

export async function restoreTicketEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const ticket = await restoreTicket((req.params as any).id, actorFrom(req));
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to restore ticket', error?.statusCode));
  }
}

export async function getActivity(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const entries = await getTicketActivity((req.params as any).id);
    res.json(ok(entries));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load activity', error?.statusCode));
  }
}

export async function setSatisfaction(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { rating, comment } = req.body as { rating: number; comment?: string };
    const ticket = await recordTicketSatisfaction((req.params as any).id, rating, comment);
    res.json(ok(ticket));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to record satisfaction', error?.statusCode));
  }
}
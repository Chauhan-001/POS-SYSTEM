/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing API — LAYER: CORE (AI execution removed in Phase 3).
 * Message generation is deterministic template copy (previously the LLM's
 * fallback path — identical output shape, no LLM dependency).
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';

const router = Router();

// ─── POST /api/marketing/generate-message ─────────────────────────
// Deterministic campaign message based on offer + style + language.

router.post('/generate-message', requireAuth, requireRole('Owner', 'Manager'), (req: Request, res: Response) => {
  try {
    const {
      offer, restaurantName, branchNames,
      useEmojis,
    } = req.body;

    const offerValue = offer?.type === 'percentage'
      ? `${offer.value || 10}% OFF`
      : offer?.type === 'flat'
      ? `₹${offer.value || 50} OFF`
      : offer?.type === 'combo'
      ? `Combo at ₹${offer.value || 199}`
      : `${offer?.value || ''} OFF`;
    const emoji = useEmojis ? '🎉 ' : '';
    const endEmoji = useEmojis ? ' 🔥' : '';
    const minLine = offer?.minOrderValue ? ` (min order ₹${offer.minOrderValue})` : '';
    const validLine = offer?.endDate ? ` Valid till ${offer.endDate}.` : '';
    const branchLine = branchNames && branchNames !== 'All locations' ? ` Visit us at ${branchNames}!` : '';

    let message = `${emoji}🎉 *${offer?.title || 'Special Offer'}*\n\n`;
    message += `${offerValue} on ${offer?.type === 'percentage' ? 'all orders' : 'your favourites'}${minLine}!${validLine}`;
    if (offer?.description) message += `\n${offer.description}`;
    message += `\n${branchLine ? branchLine + '\n' : ''}`;
    message += `\n👉 Visit us today or order now!${endEmoji}`;
    message += `\n— ${restaurantName || 'Our Restaurant'}`;

    const subject = offer?.title || 'Special Offer';

    res.json({ success: true, message, subject });
  } catch (err: any) {
    console.error('[Marketing] Message generation failed:', err.message);
    res.status(500).json({ success: false, error: 'Message generation failed' });
  }
});

// ─── POST /api/marketing/test-message ─────────────────────────────
// Send a test message (does not count as campaign delivery).

router.post('/test-message', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { target, message, channels } = req.body;
    if (!target || !message) {
      return res.status(400).json({ success: false, error: 'target and message required' });
    }

    // TODO: Wire to actual WhatsApp/SMS/Email providers when configured.
    // For now, log the test and return success so the UX flow works.
    console.log(`[Marketing] Test message → ${target} via ${channels?.join(',') || 'whatsapp'}: ${message.slice(0, 80)}...`);

    res.json({ success: true, sent: true });
  } catch (err: any) {
    console.error('[Marketing] Test message failed:', err.message);
    res.status(500).json({ success: false, error: 'Test message failed' });
  }
});

// ─── GET /api/marketing/feedback ─────────────────────────────────
// List customer feedback (from receipt QR scans) for the restaurant.
// Supports pagination, date range filtering, and rating filtering.

router.get('/feedback', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const restaurantId = (req as any).user?.restaurantId;
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId required' });
    }

    // Dynamic import to avoid circular deps
    const { default: ReceiptFeedback } = await import('../models/ReceiptFeedback');
    const { default: Bill } = await import('../models/Bill');

    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit)) || 20));
    const skip = (page - 1) * limit;

    // Optional filters
    const filter: any = { restaurantId };

    if (req.query.rating) {
      filter.rating = parseInt(String(req.query.rating));
    }
    if (req.query.minRating) {
      filter.rating = { ...filter.rating, $gte: parseInt(String(req.query.minRating)) };
    }
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(String(req.query.startDate));
      if (req.query.endDate) filter.createdAt.$lte = new Date(String(req.query.endDate));
    }
    if (req.query.search) {
      filter.comment = { $regex: String(req.query.search), $options: 'i' };
    }

    const [items, total, stats] = await Promise.all([
      ReceiptFeedback.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      ReceiptFeedback.countDocuments(filter).exec(),
      ReceiptFeedback.aggregate([
        { $match: { restaurantId: filter.restaurantId, ...(filter.rating ? { rating: filter.rating } : {}) } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, total: { $sum: 1 }, count: { $sum: 1 },
          stars: { $push: '$rating' } } },
      ]).exec(),
    ]);

    // Enrich with bill info (invoice number + date) for each feedback item
    const billIds = [...new Set(items.map((f: any) => String(f.billId)).filter(Boolean))];
    const bills = billIds.length > 0
      ? await Bill.find({ _id: { $in: billIds } }).select('invoiceNumber date grandTotal').lean().exec()
      : [];
    const billMap = new Map(bills.map((b: any) => [String(b._id), b]));

    const enriched = items.map((f: any) => ({
      _id: f._id,
      rating: f.rating,
      comment: f.comment || null,
      createdAt: f.createdAt,
      bill: (() => {
        const b = billMap.get(String(f.billId));
        return b ? { invoiceNumber: (b as any).invoiceNumber, date: (b as any).date, total: (b as any).grandTotal } : null;
      })(),
    }));

    const agg = stats[0] || { avgRating: 0, total: 0, stars: [] };
    const distribution = [0, 0, 0, 0, 0];
    (agg.stars || []).forEach((s: number) => { if (s >= 1 && s <= 5) distribution[s - 1]++; });

    res.json({
      success: true,
      feedback: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: {
        averageRating: Math.round((agg.avgRating || 0) * 10) / 10,
        totalReviews: agg.total || 0,
        distribution,
      },
    });
  } catch (err: any) {
    console.error('[Marketing] Feedback list failed:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load feedback' });
  }
});

export default router;

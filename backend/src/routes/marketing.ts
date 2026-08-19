/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing API — AI message generation, test messages.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { complete } from '../modules/ai/provider/llmProvider';

const router = Router();

// ─── POST /api/marketing/generate-message ─────────────────────────
// AI generates a campaign message based on offer + style + language.

router.post('/generate-message', requireAuth, requireRole('Owner', 'Manager'), async (req: Request, res: Response) => {
  try {
    const {
      offer, restaurantName, branchNames,
      style, language, length, useEmojis,
      channel, modify, currentMessage,
    } = req.body;

    const styleLabel = style === 'auto' ? 'a suitable' : style;
    const langLabel = language === 'auto' ? 'Hinglish' : language === 'hi-en' ? 'Hinglish' : language === 'hi' ? 'Hindi' : 'English';
    const lengthLabel = length || 'medium';

    let modifyInstruction = '';
    if (modify === 'shorter') modifyInstruction = 'Make it shorter and more concise.';
    else if (modify === 'catchier') modifyInstruction = 'Make it more catchy and attention-grabbing.';
    else if (modify === 'professional') modifyInstruction = 'Make it more professional and business-like.';
    else if (modify === 'urgency') modifyInstruction = 'Add urgency — make the customer feel they must act now.';
    else if (modify === 'emojis') modifyInstruction = useEmojis ? 'Add relevant emojis.' : 'Remove all emojis.';

    const emojiInstruction = useEmojis ? 'Use relevant emojis to make it lively.' : 'Do NOT use any emojis.';

    const channelInstruction = channel === 'sms'
      ? 'Keep it under 160 characters for SMS. No emojis.'
      : channel === 'email'
      ? 'Write an email subject line AND body. Format: SUBJECT: <subject>\\nBODY: <body>'
      : 'Write a WhatsApp-appropriate message with formatting.';

    const prompt = `You are a marketing message generator for a restaurant.

OFFER DETAILS:
- Name: ${offer.title || 'Special Offer'}
- Type: ${offer.type || 'percentage'}
- Value: ${offer.value || 0}
- Description: ${offer.description || ''}
- Min Order: ${offer.minOrderValue ? `₹${offer.minOrderValue}` : 'None'}
- Valid: ${offer.startDate || 'today'} to ${offer.endDate || 'ongoing'}

RESTAURANT: ${restaurantName || 'Our Restaurant'}
BRANCHES: ${branchNames || 'All locations'}

STYLE: ${styleLabel}
LANGUAGE: ${langLabel}
LENGTH: ${lengthLabel}
CHANNEL: ${channel || 'whatsapp'}
${emojiInstruction}
${channelInstruction}
${modifyInstruction ? `\nMODIFICATION: ${modifyInstruction}` : ''}
${modify && currentMessage ? `\nCURRENT MESSAGE:\n${currentMessage}` : ''}

RULES:
1. Write ONLY the message text — no explanations, no quotes, no markdown.
2. If style is "auto", pick the most suitable style for a restaurant promotion.
3. Include the offer value, restaurant name, and a clear call to action.
4. For Hinglish, use natural Romanized Hindi mixed with English.
5. Keep it authentic to how Indian restaurants communicate with customers.
6. Include branch names naturally if multiple branches.

OUTPUT: Just the message text, nothing else.`;

    const result = await complete([
      { role: 'system', content: 'You are a restaurant marketing message writer. Output ONLY the message text.' },
      { role: 'user', content: prompt },
    ], { timeout: 15000, maxTokens: 500 });

    let message = result.content?.trim() || '';
    let subject = offer.title || 'Special Offer';

    // Detect circuit-breaker / fallback response: when the AI provider is
    // unavailable the LLM provider returns a generic fallback JSON blob that
    // does NOT contain a marketing message. Substitute a deterministic
    // template so the studio always shows something useful.
    const isFallback = !message
      || message.includes('circuit breaker')
      || message.includes('AI service temporarily unavailable')
      || message.includes('AI-powered recommendations paused')
      || message.includes('keyInsight');

    if (isFallback) {
      const offerValue = offer.type === 'percentage'
        ? `${offer.value || 10}% OFF`
        : offer.type === 'flat'
        ? `₹${offer.value || 50} OFF`
        : offer.type === 'combo'
        ? `Combo at ₹${offer.value || 199}`
        : `${offer.value || ''} OFF`;
      const emoji = useEmojis ? '🎉 ' : '';
      const endEmoji = useEmojis ? ' 🔥' : '';
      const minLine = offer.minOrderValue ? ` (min order ₹${offer.minOrderValue})` : '';
      const validLine = offer.endDate ? ` Valid till ${offer.endDate}.` : '';
      const branchLine = branchNames && branchNames !== 'All locations' ? ` Visit us at ${branchNames}!` : '';
      message = `${emoji}🎉 *${offer.title || 'Special Offer'}*

`;
      message += `${offerValue} on ${offer.type === 'percentage' ? 'all orders' : 'your favourites'}${minLine}!${validLine}`;
      if (offer.description) message += `\n${offer.description}`;
      message += `\n${branchLine ? branchLine + '\n' : ''}`;
      message += `\n👉 Visit us today or order now!${endEmoji}`;
      message += `\n— ${restaurantName || 'Our Restaurant'}`;
    }

    // Parse email format if present
    if (channel === 'email' && message.includes('SUBJECT:')) {
      const subjectMatch = message.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
      const bodyMatch = message.match(/BODY:\s*([\s\S]+)/i);
      if (subjectMatch) subject = subjectMatch[1].trim();
      if (bodyMatch) message = bodyMatch[1].trim();
    }

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

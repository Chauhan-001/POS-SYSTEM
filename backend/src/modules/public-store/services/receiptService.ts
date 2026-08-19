/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReceiptService — public receipt-QR resolution.
 *
 * The QR printed on a bill's thermal receipt encodes
 * `{qrBaseUrl}/#/r/{receiptToken}`. Scanning it opens the customer-site
 * landing page, which calls these PUBLIC (no-auth) endpoints:
 *
 *   GET  /api/public-store/receipt/:token        → sanitized bill summary
 *   POST /api/public-store/receipt/:token/feedback → save star rating + comment
 *   POST /api/public-store/receipt/:token/otp/request → send OTP to a phone
 *   POST /api/public-store/receipt/:token/otp/verify  → verify OTP, unlock "see more"
 *
 * Privacy contract (hard requirements from product):
 *   - Never returns customer name / phone / cashier PII.
 *   - Openable WITHOUT a phone number (the base page needs no login).
 *   - The optional OTP login only unlocks the customer's OWN loyalty summary.
 *   - Receipt links EXPIRE 12h after minting (410 Gone afterwards).
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import Restaurant from '../../../models/Restaurant';
import ReceiptFeedback from '../../../models/ReceiptFeedback';
import Customer from '../../../models/Customer';
import CustomerVisit from '../../../models/CustomerVisit';
import { AppError } from '../../../utils/AppError';

const RECEIPT_TOKEN_PATTERN = /^rcpt_[a-f0-9]{24}$/;
/** Demo token used by the POS Settings live preview (scannable sample page). */
export const DEMO_RECEIPT_TOKEN = 'demo';

/** Resolve the bill behind a receipt token (no PII touched). Throws 404/410. */
export async function resolveBillByReceiptToken(receiptToken: string): Promise<any> {
  if (receiptToken === DEMO_RECEIPT_TOKEN) {
    return { _demo: true, bill: null };
  }
  if (!RECEIPT_TOKEN_PATTERN.test(receiptToken)) {
    throw new AppError(404, 'Receipt not found');
  }
  const bill = await Bill.findOne({ receiptToken }).lean().exec();
  if (!bill) throw new AppError(404, 'Receipt not found');

  // 12-hour expiry — a scanned receipt link must not work forever.
  const expiresAt = (bill as any).receiptTokenExpiresAt
    ? new Date((bill as any).receiptTokenExpiresAt).getTime()
    : 0;
  if (expiresAt < Date.now()) {
    throw new AppError(410, 'This receipt link has expired. Please ask the restaurant for a new one.');
  }
  return { _demo: false, bill };
}

/** Build the sanitized public payload — reward + line items, zero PII. */
export async function buildPublicReceipt(bill: any): Promise<any> {
  const restaurantId = (bill as any).restaurantId
    ? String((bill as any).restaurantId)
    : '';
  const [restaurant, items] = await Promise.all([
    restaurantId
      ? Restaurant.findById(restaurantId).select('name brandName').lean().exec()
      : null,
    BillItem.find({ billId: String((bill as any)._id) }).sort({ createdAt: 1 }).lean().exec(),
  ]);

  return {
    token: (bill as any).receiptToken,
    restaurant: {
      name: (restaurant as any)?.brandName || (restaurant as any)?.name || 'Restaurant',
    },
    invoiceNumber: (bill as any).invoiceNumber,
    date: (bill as any).date,
    time: (bill as any).time,
    orderType: (bill as any).orderType,
    tableNumber: (bill as any).tableNumber || null,
    paymentMethod: (bill as any).paymentMethod,
    items: (items || []).map((i: any) => ({
      name: i.itemName,
      quantity: i.quantity,
      price: i.priceAtSale ?? 0,
      gstRate: i.gstRateAtSale ?? 0,
      variantName: i.variantName || null,
      notes: i.notes || null,
      isFree: !!i.isFree,
    })),
    subtotal: (bill as any).subtotal ?? 0,
    discount: (bill as any).discount ?? 0,
    gst: (bill as any).gst ?? 0,
    grandTotal: (bill as any).grandTotal ?? 0,
    pointsEarned: (bill as any).pointsEarned ?? 0,
    pointsRedeemed: (bill as any).pointsRedeemed ?? 0,
    redeemedRewardTitle: (bill as any).redeemedRewardTitle || null,
    milestoneRewardAwarded: (bill as any).milestoneRewardAwarded || null,
    expiresAt: (bill as any).receiptTokenExpiresAt || null,
  };
}

/** Sample payload for the POS Settings preview QR (`/receipt/demo`). */
export function buildDemoReceipt(): any {
  return {
    token: DEMO_RECEIPT_TOKEN,
    restaurant: { name: 'The Royal Bistro' },
    invoiceNumber: 'INV-000123',
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    orderType: 'Dine In',
    tableNumber: 4,
    paymentMethod: 'Cash',
    items: [
      { name: 'Truffle Risotto', quantity: 1, price: 1200, gstRate: 5, variantName: null, notes: null, isFree: false },
      { name: 'Margherita Pizza', quantity: 2, price: 750, gstRate: 5, variantName: null, notes: 'Extra cheese', isFree: false },
      { name: 'Mango Lassi', quantity: 1, price: 200, gstRate: 18, variantName: 'Large', notes: null, isFree: false },
    ],
    subtotal: 2900,
    discount: 300,
    gst: 153.31,
    grandTotal: 2753.31,
    pointsEarned: 86,
    pointsRedeemed: 200,
    redeemedRewardTitle: '20% Off Large Bills',
    milestoneRewardAwarded: 'Free Dessert',
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  };
}

/** Save anonymous feedback for a bill (rating 1–5 + optional comment). */
export async function saveFeedback(bill: any, data: { rating: number; comment?: string }): Promise<void> {
  await ReceiptFeedback.create({
    restaurantId: (bill as any).restaurantId || null,
    billId: (bill as any)._id,
    rating: data.rating,
    comment: data.comment || undefined,
  } as any);
}

/**
 * "See more" — OTP login. Returns the customer's OWN loyalty summary when the
 * verified phone matches an existing customer; otherwise null (the landing
 * page stays fully functional with zero PII).
 */
export async function verifyReceiptOtp(
  bill: any,
  phone: string,
  code: string,
  verify: (restaurantId: string, phone: string, code: string, purpose: string) => Promise<boolean>
): Promise<any> {
  const restaurantId = (bill as any).restaurantId ? String((bill as any).restaurantId) : '';
  if (!restaurantId) throw new AppError(400, 'Loyalty login is unavailable for this receipt.');
  const valid = await verify(restaurantId, phone.trim(), code, 'login');
  if (!valid) throw new AppError(400, 'Invalid code. Please try again.');

  const customer = await Customer.findOne({ restaurantId: new mongoose.Types.ObjectId(restaurantId), phone: phone.trim() })
    .select('name points lifetimePoints tier visits totalSpent lastVisit')
    .lean()
    .exec();
  if (!customer) return { loggedIn: true, customer: null };

  const visits = await CustomerVisit.countDocuments({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    customerId: (customer as any)._id,
  }).exec();

  return {
    loggedIn: true,
    customer: {
      name: (customer as any).name,
      points: (customer as any).points ?? 0,
      lifetimePoints: (customer as any).lifetimePoints ?? 0,
      tier: (customer as any).tier || 'Bronze',
      visits,
      totalSpent: (customer as any).totalSpent ?? 0,
    },
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Receipt routes — public (no-auth), mounted at /api/public-store/receipt.
 * Served under the same publicLimiter as the rest of the storefront.
 */

import { Router } from 'express';
import {
  getPublicReceipt,
  postReceiptFeedback,
  requestReceiptOtp,
  verifyReceiptOtpHandler,
} from '../controllers/receiptController';

const router = Router();

router.get('/:receiptToken', getPublicReceipt);
router.post('/:receiptToken/feedback', postReceiptFeedback);
router.post('/:receiptToken/otp/request', requestReceiptOtp);
router.post('/:receiptToken/otp/verify', verifyReceiptOtpHandler);

export default router;
